-- Defense-in-depth for the specialties array on practitioner_profiles.
-- The app already validates submitted values against the real taxonomy
-- (data/specialties.json) inside saveProfile — but that's an app-level
-- check, bypassable via a direct API call with the caller's own session
-- (same technique that exposed the role self-escalation issue fixed in
-- 20260710100000). Confirmed empirically that a raw update could stuff
-- arbitrary strings — including a literal `<script>` tag — into this
-- column.
--
-- This constraint intentionally does NOT mirror the taxonomy (that would
-- require keeping a SQL-side list in sync with data/specialties.json).
-- It only enforces SHAPE: a sane array size, sane per-element length, and
-- a restricted charset — enough to block scripted mass-junk/giant-payload
-- abuse without needing to know what a "real" specialty is. Exact-value
-- correctness stays the app's job.

begin;

create or replace function public.practitioner_specialties_valid(specialties text[])
returns boolean
language sql
immutable
as $$
  select
    array_length(specialties, 1) is null
    or (
      array_length(specialties, 1) <= 20
      and (
        select bool_and(s ~ '^[a-z0-9_-]{1,30}$')
        from unnest(specialties) as s
      )
    )
$$;

-- Adding a CHECK constraint validates every existing row — sanitize any
-- rows that would already violate it first (this project has live test
-- data from security-audit testing with deliberately malformed
-- specialties), by dropping invalid elements and capping length rather
-- than clearing the whole array.
update public.practitioner_profiles
set specialties = coalesce(
  (select array_agg(s) from (
    select s from unnest(specialties) as s
    where s ~ '^[a-z0-9_-]{1,30}$'
    limit 20
  ) as capped),
  '{}'
)
where not public.practitioner_specialties_valid(specialties);

alter table public.practitioner_profiles
  add constraint practitioner_profiles_specialties_shape
  check (public.practitioner_specialties_valid(specialties));

commit;
