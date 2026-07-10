-- Epic 5, slice 2: booking writes. See the accompanying plan for the
-- full double-booking mechanism explanation — short version: an
-- app-level "check then insert" always has a race window between the
-- two statements; only a database-level atomic guard closes it.
--
-- Unlike recurring availability (Epic 4: local wall-clock + timezone,
-- deliberately NOT a fixed UTC instant), a booking IS a concrete
-- instant — start_utc/end_utc are timestamptz, the UTC principle
-- applied literally here.

begin;

create extension if not exists btree_gist;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  -- No payment step exists yet to be "pending" for — new bookings are
  -- immediately confirmed. A future payment slice will change this flow
  -- to insert 'pending' first, then transition to 'confirmed'.
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (end_utc > start_utc)
);

-- The actual double-booking guard: for a given practitioner, no two
-- non-cancelled bookings' [start_utc, end_utc) ranges may overlap.
-- Identical-slot double-booking is just the special case where the
-- ranges are equal — this single constraint covers both. Enforced
-- atomically by Postgres as part of the index-insertion step itself
-- (same mechanism as a unique index), so a race between two concurrent
-- inserts is resolved by the database, not application logic: whichever
-- commits first wins, the second gets a 23P01 (exclusion_violation)
-- error, caught explicitly in booking-actions.ts for a clean message.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    practitioner_id with =,
    tstzrange(start_utc, end_utc) with &&
  )
  where (status <> 'cancelled');

alter table public.bookings enable row level security;

-- Only a client can create a booking, only as themselves, and only for
-- a service that genuinely belongs to the stated practitioner, is
-- active, and has a duration matching the booked range exactly. This is
-- deliberate defense-in-depth: the app already re-validates the slot
-- server-side (see booking-actions.ts) before ever attempting this
-- insert, but a direct API call bypassing the app entirely still hits
-- this same check.
create policy "Clients can create their own bookings"
on public.bookings
for insert
to authenticated
with check (
  auth.uid() = client_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'client'
  )
  and exists (
    select 1 from public.services s
    where s.id = service_id
      and s.practitioner_id = bookings.practitioner_id
      and s.is_active = true
      and end_utc = start_utc + (s.duration_minutes * interval '1 minute')
  )
);

-- A booking is visible only to the two people it concerns — no public
-- or anon read at all, unlike availability rules.
create policy "Clients and practitioners can view their own bookings"
on public.bookings
for select
to authenticated
using (auth.uid() = client_id or auth.uid() = practitioner_id);

-- getBookableSlots is called from the PUBLIC profile page — anonymous
-- visitors and other clients need to know which time ranges are already
-- booked (to exclude them from what's offered), but the SELECT policy
-- above deliberately does not let them read bookings rows directly (that
-- would leak who booked what). This function bridges the gap the same
-- way is_username_taken does: SECURITY DEFINER to bypass RLS, but the
-- returned shape is narrowed to just the two columns that are safe to
-- expose publicly — no client_id, no service_id, no booking id.
create function public.get_practitioner_busy_times(
  target_practitioner_id uuid,
  window_start timestamptz,
  window_end timestamptz
)
returns table (start_utc timestamptz, end_utc timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.start_utc, b.end_utc
  from public.bookings b
  where b.practitioner_id = target_practitioner_id
    and b.status <> 'cancelled'
    and b.end_utc > window_start
    and b.start_utc < window_end
$$;

grant execute on function public.get_practitioner_busy_times(uuid, timestamptz, timestamptz) to anon, authenticated;

commit;
