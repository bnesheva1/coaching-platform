-- Epic 4: practitioner availability foundation. See the accompanying
-- plan for the full timezone model explanation — short version:
-- recurring weekly rules are stored as LOCAL wall-clock time (day +
-- start_time/end_time, no timezone attached) plus a reference to the
-- practitioner's own timezone column. No UTC instant is stored here on
-- purpose — a recurring rule isn't a single instant, it's a pattern
-- whose actual UTC time shifts with DST depending on the calendar date
-- it's eventually resolved against. That resolution (local time + date +
-- that date's DST state -> UTC) happens in a later slice when concrete
-- bookable slots are generated; "store in UTC" applies there, literally.

begin;

-- The practitioner's home timezone, e.g. 'Europe/Sofia'. Shape-only
-- check here (same philosophy as the specialties fix: DB enforces
-- shape, app enforces real IANA validity via Intl.DateTimeFormat, which
-- a CHECK constraint can't do without an external data table).
alter table public.practitioner_profiles
  add column timezone text not null default 'Europe/Sofia';

alter table public.practitioner_profiles
  add constraint practitioner_profiles_timezone_shape
  check (timezone ~ '^[A-Za-z]+(/[A-Za-z_]+){0,2}$' and length(timezone) <= 50);

create table public.practitioner_availability (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  -- ISO 8601 convention: 1=Monday..7=Sunday. Deliberately not 0-6 to
  -- avoid the classic "is Sunday 0 or 6" ambiguity bug class.
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  -- No overnight-crossing-midnight blocks in v1 (end_time > start_time
  -- disallows e.g. 23:00-01:00) and a 15-minute minimum window — both
  -- deliberate scope cuts, not oversights. See the plan for why.
  constraint practitioner_availability_sane_range
    check (end_time > start_time and (end_time - start_time) >= interval '15 minutes')
);

alter table public.practitioner_availability enable row level security;

-- Same "has a username" public-discoverability gate already used by
-- search_practitioners and the public profile page — a practitioner
-- without one isn't publicly findable yet, so their availability
-- shouldn't be either.
create policy "Anyone can view availability of public practitioners"
on public.practitioner_availability
for select
to public
using (
  exists (
    select 1 from public.practitioner_profiles pp
    where pp.id = practitioner_availability.practitioner_id
      and pp.username is not null
  )
);

create policy "Practitioners can create their own availability"
on public.practitioner_availability
for insert
to authenticated
with check (auth.uid() = practitioner_id);

create policy "Practitioners can update their own availability"
on public.practitioner_availability
for update
to authenticated
using (auth.uid() = practitioner_id)
with check (auth.uid() = practitioner_id);

create policy "Practitioners can delete their own availability"
on public.practitioner_availability
for delete
to authenticated
using (auth.uid() = practitioner_id);

commit;
