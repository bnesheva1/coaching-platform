-- Epic 5, slice 3: per-date availability exceptions (whole-date
-- blocking only). An exception is a concrete calendar date, distinct
-- from practitioner_availability's recurring weekly pattern — hence
-- `date`, not `timestamptz` (this is the first use of Postgres `date`
-- in this schema).
--
-- Only 'blocked' exists today. Partial-day blocks and one-off extra
-- availability are future work: when they arrive, the exception_type
-- check widens and nullable start_time/end_time columns get added
-- (null = whole day, matching this slice's only current meaning).
-- Both are purely additive migrations against this shape.

begin;

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  exception_date date not null,
  exception_type text not null default 'blocked' check (exception_type in ('blocked')),
  created_at timestamptz not null default now(),
  -- Scoped by exception_type (not just practitioner_id+exception_date)
  -- so a future type can coexist with 'blocked' on the same date
  -- without a schema change.
  unique (practitioner_id, exception_date, exception_type)
);

alter table public.availability_exceptions enable row level security;

-- Same pattern as practitioner_availability
-- (20260710140000_availability_owner_can_view_own.sql): a practitioner
-- always sees their own rows, and a publicly-discoverable practitioner's
-- rows are readable by anyone — required so getBookableSlots can
-- compute correct slots for anonymous/other-user visitors on the
-- public profile page.
create policy "Practitioners can view own or public exceptions"
on public.availability_exceptions
for select
to public
using (
  auth.uid() = practitioner_id
  or exists (
    select 1 from public.practitioner_profiles pp
    where pp.id = availability_exceptions.practitioner_id
      and pp.username is not null
  )
);

create policy "Practitioners can create their own exceptions"
on public.availability_exceptions
for insert
to authenticated
with check (auth.uid() = practitioner_id);

create policy "Practitioners can delete their own exceptions"
on public.availability_exceptions
for delete
to authenticated
using (auth.uid() = practitioner_id);

-- No update policy — delete-and-reinsert is the only supported
-- mutation shape, same as practitioner_availability.

commit;
