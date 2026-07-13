-- Epic 8, part 1: session completion. A booking auto-completes once its
-- session end time has passed and it wasn't cancelled — no client
-- confirmation step, the passage of time is the gate. This is a pure
-- widening of the status allow-list (adding 'completed'), so unlike the
-- min_notice_hours/cancellation migration's own status-check change,
-- this needs no backfill and no NOT VALID: every existing row already
-- satisfies a superset of its old constraint.
--
-- Deliberately NOT adding 'no_show' here — auto-complete assumes the
-- session happened; no-show detection/handling stays out of scope.
--
-- No other object needs to change: bookings_no_overlap,
-- get_practitioner_busy_times, and get_reminder_batch all already key
-- off status in ('pending','confirmed') as their "active" allow-list,
-- so a booking that becomes 'completed' is automatically and correctly
-- excluded from all three with zero code changes.

begin;

alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled_by_client', 'cancelled_by_practitioner', 'completed'));

commit;
