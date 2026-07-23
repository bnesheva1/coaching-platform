-- The practitioner-cancel policy from 20260712100000_booking_cancellation.sql
-- deliberately had no time restriction ("emergencies happen" — a
-- practitioner could cancel an upcoming booking anytime, even inside
-- the client's own notice window). That's still true here — this only
-- adds a floor at the booking's own start_utc: a session that has
-- already happened is no longer "cancellable," it's just history.
-- start_utc >= now() mirrors lib/booking-time.ts's splitUpcomingPast,
-- which already drives the practitioner dashboard's upcoming/past
-- split — same criterion at the DB layer as the UI already uses.

begin;

drop policy "Practitioners can cancel any of their own bookings" on public.bookings;
create policy "Practitioners can cancel any of their own upcoming bookings"
on public.bookings
for update
to authenticated
using (auth.uid() = practitioner_id and status in ('pending', 'confirmed') and start_utc >= now())
with check (auth.uid() = practitioner_id and status = 'cancelled_by_practitioner');

commit;
