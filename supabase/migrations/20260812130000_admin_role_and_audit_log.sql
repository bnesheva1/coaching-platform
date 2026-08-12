-- Admin role + audit log (admin dashboard, slice 2).
begin;

-- 1. Allow 'admin' as a third role. The constraint name is confirmed against
-- the live schema (profiles_role_check), so this drop can't silently no-op
-- and leave the old two-value check in place.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('practitioner', 'client', 'admin'));

-- 2. Harden signup so 'admin' can ONLY be granted by a manual DB update, never
-- self-provisioned. handle_new_user previously inserted raw_user_meta_data's
-- role verbatim — which was safe only WHILE the CHECK rejected 'admin'. Now
-- that the CHECK allows it, coerce any signup role that isn't 'practitioner'
-- to 'client'. Everything else about the function is unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_role text;
begin
  -- Only 'practitioner' or 'client' can ever come from signup; anything else
  -- (including a forged 'admin') becomes 'client'. Admin is granted out of
  -- band (a manual profiles.role update), never through this path.
  new_role := case
    when new.raw_user_meta_data ->> 'role' = 'practitioner' then 'practitioner'
    else 'client'
  end;

  insert into public.profiles (id, role, display_name, email, locale)
  values (
    new.id, new_role, new.raw_user_meta_data ->> 'display_name',
    new.email, coalesce(new.raw_user_meta_data ->> 'locale', 'bg')
  );

  if new_role = 'practitioner' then
    insert into public.practitioner_profiles (id)
    values (new.id);
  end if;

  return new;
end;
$$;

-- 3. Admin audit log — every admin action writes one row: who (actor_id +
-- a denormalised actor_email snapshot, so the log stays readable if that
-- account is later anonymised), when (created_at), what changed (action), and
-- the previous/new values.
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  actor_email text,
  action text not null,
  previous_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

-- RLS on with zero policies: no anon/authenticated access. The audit writer
-- and the dashboard's own read both go through the service-role client, which
-- bypasses RLS — so no client can read or forge an audit entry.
alter table public.admin_audit_log enable row level security;

commit;
