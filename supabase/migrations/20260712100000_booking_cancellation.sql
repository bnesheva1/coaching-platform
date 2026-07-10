-- Epic 5: booking cancellation. Adds a per-practitioner notice-period
-- setting that governs BOTH how far ahead a client must book and how
-- late a client can self-cancel, widens bookings.status to record HOW
-- a booking ended (not implemented yet: completed/no_show — this is
-- deliberately narrow-now/widen-later, same convention as
-- availability_exceptions.exception_type in the previous slice), and
-- adds asymmetric cancellation: a client is bound by the notice cutoff,
-- a practitioner is not (emergencies happen).

begin;

-- One setting, not two: the same value governs generateSlots' minimum
-- lead time AND the client-cancellation cutoff below. 336h = 14 days =
-- generateSlots' own window; anything larger would trivially zero out
-- all availability, so it's not a meaningful upper bound to allow past
-- that.
alter table public.practitioner_profiles
  add column min_notice_hours integer not null default 24
  check (min_notice_hours between 0 and 336);

-- Defensive: no cancellation feature existed before this migration, so
-- no row should hold the old generic 'cancelled' value, but backfill
-- before swapping the constraint just in case.
update public.bookings set status = 'cancelled_by_practitioner' where status = 'cancelled';

-- Inline column CHECK constraints get Postgres' default
-- {table}_{column}_check name when not explicitly named, which is what
-- the original create_bookings.sql migration left this as.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled_by_client', 'cancelled_by_practitioner'));

-- Both the exclusion constraint and the busy-times RPC switch from a
-- deny-list ("not cancelled") to an allow-list ("still active") of
-- which statuses occupy a slot. This is the actual slot-freeing
-- mechanic cancellation depends on: moving status out of this allow-
-- list is the only thing needed to free the slot, in both places, with
-- no separate "free the slot" step anywhere in the app. It's also the
-- safer default going forward — a future completed/no_show status is
-- excluded automatically unless explicitly opted back in, rather than
-- needing to be remembered and added to a deny-list.
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    practitioner_id with =,
    tstzrange(start_utc, end_utc) with &&
  )
  where (status in ('pending', 'confirmed'));

create or replace function public.get_practitioner_busy_times(
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
    and b.status in ('pending', 'confirmed')
    and b.end_utc > window_start
    and b.start_utc < window_end
$$;

-- The INSERT policy never checked timing at all — only the app's own
-- getBookableSlots re-validation stopped a past/immediate direct-API
-- booking. This is the other half of "one setting governs both": the
-- same notice cutoff now applies to booking creation, enforced at the
-- DB, not just the app.
drop policy "Clients can create their own bookings" on public.bookings;
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
  and start_utc >= now() + (
    select coalesce(pp.min_notice_hours, 24)
    from public.practitioner_profiles pp
    where pp.id = bookings.practitioner_id
  ) * interval '1 hour'
);

-- Two separate policies, not one OR'd together, because their
-- conditions genuinely differ: a client is bound by the notice cutoff,
-- a practitioner is not. USING gates which existing rows this policy
-- lets the caller touch; WITH CHECK gates what the row is allowed to
-- become.
create policy "Clients can cancel their own bookings before the notice cutoff"
on public.bookings
for update
to authenticated
using (
  auth.uid() = client_id
  and status in ('pending', 'confirmed')
  and start_utc >= now() + (
    select coalesce(pp.min_notice_hours, 24)
    from public.practitioner_profiles pp
    where pp.id = bookings.practitioner_id
  ) * interval '1 hour'
)
with check (auth.uid() = client_id and status = 'cancelled_by_client');

create policy "Practitioners can cancel any of their own bookings"
on public.bookings
for update
to authenticated
using (auth.uid() = practitioner_id and status in ('pending', 'confirmed'))
with check (auth.uid() = practitioner_id and status = 'cancelled_by_practitioner');

-- An UPDATE RLS policy only constrains which rows qualify and what the
-- listed columns may become — it says nothing about OTHER columns in
-- the same statement. Without this, a client whose UPDATE legitimately
-- passes the policy above could smuggle start_utc/service_id/client_id
-- changes into the same call. Same fix as
-- 20260710100000_restrict_profiles_column_updates.sql (profiles.role
-- privilege escalation): a column-level GRANT, not a smarter policy.
-- This is also why the policies above can safely trust start_utc/
-- practitioner_id/client_id as stable — they structurally cannot change
-- via this grant.
revoke update on public.bookings from authenticated;
grant update (status) on public.bookings to authenticated;

commit;
