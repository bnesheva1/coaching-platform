begin;

-- 1. Give username a new home: practitioner_profiles, alongside the rest
--    of the practitioner's public-profile content.
alter table public.practitioner_profiles
  add column username text;

create unique index practitioner_profiles_username_lower_idx
  on public.practitioner_profiles (lower(username));

-- 2. Remove it from the shared table. Existing rows' usernames are
--    discarded here, per the call that pre-existing accounts are
--    throwaway test data.
drop index public.profiles_username_lower_idx;

alter table public.profiles
  drop column username;

-- 3. The signup trigger now creates a practitioner_profiles row (with
--    username, everything else at its default) immediately for
--    practitioners only — clients never get one, matching the model that
--    only practitioners have a public profile at all.
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

  insert into public.profiles (id, role)
  values (new.id, new_role);

  if new_role = 'practitioner' then
    insert into public.practitioner_profiles (id, username)
    values (new.id, new.raw_user_meta_data ->> 'username');
  end if;

  return new;
end;
$$;

-- 4. The availability check now looks at practitioner_profiles instead of
--    profiles. Its signature (name + argument types) is unchanged, so the
--    existing "grant execute ... to anon, authenticated" from the earlier
--    migration still applies — no need to re-grant.
create or replace function public.is_username_taken(candidate text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.practitioner_profiles where username = lower(candidate)
  );
$$;

commit;
