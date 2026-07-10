-- Fixes a real bug found via live testing: the SELECT policy on
-- practitioner_availability only allowed reading rows for practitioners
-- with a username set (the public-discoverability gate), with no "or
-- it's my own row" clause — unlike the equivalent, correct pattern
-- already used on services ("is_active = true or auth.uid() =
-- practitioner_id"). This broke two things for any practitioner who
-- hasn't set a username yet (i.e. every practitioner right after
-- signup): (1) supabase-js's `.insert(...).select()` implements as
-- `INSERT ... RETURNING *`, and Postgres applies the SELECT policy to
-- the RETURNING output — so even a practitioner's own successful insert
-- of their own availability failed with a row-level-security error
-- because they couldn't "see" the row back; (2) the dashboard's own
-- plain SELECT of a practitioner's availability (app/[locale]/
-- practitioner-dashboard/page.tsx) would silently return nothing for
-- the same reason, even after rows were actually saved.

begin;

drop policy "Anyone can view availability of public practitioners" on public.practitioner_availability;

create policy "Practitioners can view own or public availability"
on public.practitioner_availability
for select
to public
using (
  auth.uid() = practitioner_id
  or exists (
    select 1 from public.practitioner_profiles pp
    where pp.id = practitioner_availability.practitioner_id
      and pp.username is not null
  )
);

commit;
