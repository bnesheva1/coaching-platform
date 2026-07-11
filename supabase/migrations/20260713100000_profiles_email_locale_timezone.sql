-- Epic 6, slice 1: transactional booking emails. Adds the three pieces
-- of contact/locale/timezone data email composition needs that nothing
-- in this app has ever needed to store before (everything today is
-- either the current user's own live session, or a practitioner's
-- already-saved timezone).

begin;

alter table public.profiles
  add column email text,
  add column locale text not null default 'bg' check (locale in ('bg', 'en')),
  add column timezone text;

-- profiles' SELECT policies are broad by necessity (any visitor can
-- read a practitioner's row; any practitioner can read a client's
-- display_name — see 20260708100000_public_profile_read_policies.sql).
-- Without a column grant, the three new columns would be exposed
-- through those same broad policies the moment they exist. Same fix as
-- 20260710100000_restrict_profiles_column_updates.sql (that one was for
-- UPDATE; SELECT was never restricted at the column level before now —
-- this closes it proactively, before a leak, not after one).
revoke select on public.profiles from authenticated, anon;
grant select (id, role, display_name, created_at) on public.profiles to authenticated, anon;

-- profiles.timezone is refreshed by the client themselves (their own
-- row) at booking time and on self-cancel — same "own row only"
-- boundary display_name already has, just widened to the new column.
revoke update on public.profiles from authenticated;
grant update (display_name, timezone) on public.profiles to authenticated;

-- handle_new_user() already inserts id/role/display_name from
-- auth.users/raw_user_meta_data — extended to also set email (already
-- on the auth.users row, no new signup-flow plumbing needed) and locale
-- (passed through raw_user_meta_data, since the trigger only ever sees
-- that JSON blob plus the auth.users row itself).
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

-- The single data-fetch point for all of this slice's email
-- composition. SECURITY DEFINER so it can read the now column-
-- restricted email/locale/timezone, but scoped tightly: the caller must
-- already be one of the two parties on THIS SPECIFIC booking — this is
-- what stops it from being a general "look up anyone's contact info by
-- user id" oracle. Returns everything needed for either email type in
-- one row so both send functions share one query shape.
create function public.get_booking_email_context(target_booking_id uuid)
returns table (
  client_email text,
  client_display_name text,
  client_locale text,
  client_timezone text,
  practitioner_email text,
  practitioner_display_name text,
  practitioner_locale text,
  practitioner_timezone text,
  service_name text,
  start_utc timestamptz,
  end_utc timestamptz,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cp.email, cp.display_name, cp.locale, cp.timezone,
    pp.email, pp.display_name, pp.locale, ppr.timezone,
    s.name, b.start_utc, b.end_utc, b.status
  from public.bookings b
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  join public.services s on s.id = b.service_id
  where b.id = target_booking_id
    and auth.uid() in (b.client_id, b.practitioner_id);
$$;

grant execute on function public.get_booking_email_context(uuid) to authenticated;

commit;
