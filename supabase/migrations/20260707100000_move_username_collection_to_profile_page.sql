begin;

-- is_username_taken needs to exclude the current user's own row now that
-- username is edited (not just claimed once) on the practitioner profile
-- page — otherwise re-saving your own unchanged username would falsely
-- report itself as taken. Signature changes, so drop the old one first.
drop function if exists public.is_username_taken(text);

create function public.is_username_taken(candidate text, exclude_id uuid default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.practitioner_profiles
    where username = lower(candidate)
      and (exclude_id is null or id <> exclude_id)
  );
$$;

grant execute on function public.is_username_taken(text, uuid) to anon, authenticated;

-- Signup no longer collects username; it now collects display_name for
-- both roles. A practitioner's practitioner_profiles row is still created
-- immediately at signup (same as before — the row exists as soon as
-- you're a practitioner), just without a username until they set one in
-- profile setup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_role text;
begin
  new_role := coalesce(new.raw_user_meta_data ->> 'role', 'client');

  insert into public.profiles (id, role, display_name)
  values (new.id, new_role, new.raw_user_meta_data ->> 'display_name');

  if new_role = 'practitioner' then
    insert into public.practitioner_profiles (id)
    values (new.id);
  end if;

  return new;
end;
$$;

commit;
