-- Fixes a real bug, not hardening: get_booking_email_context and
-- get_booking_payment_context read delivery_type/delivery_info live
-- from services instead of from the booking's own frozen snapshot
-- (bookings.delivery_type/delivery_info/phone_number/meeting_link,
-- populated at booking time — see bookings_delivery_snapshot and
-- bookings_snapshot_price_and_delivery_info). Two consequences:
--
-- 1. Neither RPC ever read phone_number at all, so a phone-type
--    booking's confirmation email had no phone number in it —  there
--    was nothing to fall back to.
-- 2. For every delivery type, a practitioner editing their service
--    between booking and email send changed what the client's
--    confirmation email showed, even though the booking itself already
--    froze the terms the client actually agreed to. The dashboard
--    bookings list (get_my_confirmed_bookings_contact_info, and
--    BookingsList.tsx's own deliveryDetailsValue selection) already
--    reads the snapshot correctly — this brings both email RPCs in
--    line with that, not introducing a new pattern.
--
-- service_name is deliberately left reading live from services (s.name)
-- in both functions, unchanged — same class of live-vs-snapshot gap,
-- but out of scope for this fix; flagged separately, not bundled in
-- silently.
--
-- DROP + CREATE, not CREATE OR REPLACE — both RETURNS TABLE column
-- lists are widened (service_phone_number, service_meeting_link
-- added), which CREATE OR REPLACE can't do.

drop function if exists public.get_booking_email_context(uuid);
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
  service_delivery_type text,
  service_delivery_info text,
  service_phone_number text,
  service_meeting_link text,
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
    s.name, b.delivery_type, b.delivery_info, b.phone_number, b.meeting_link,
    b.start_utc, b.end_utc, b.status
  from public.bookings b
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  join public.services s on s.id = b.service_id
  where b.id = target_booking_id
    and auth.uid() in (b.client_id, b.practitioner_id);
$$;

grant execute on function public.get_booking_email_context(uuid) to authenticated;

-- Same fix, paid/commission path — service-role-only, no auth.uid()
-- check (matches its existing shape, unchanged).
drop function if exists public.get_booking_payment_context(uuid);
create function public.get_booking_payment_context(target_booking_id uuid)
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
  service_delivery_type text,
  service_delivery_info text,
  service_phone_number text,
  service_meeting_link text,
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
    s.name, b.delivery_type, b.delivery_info, b.phone_number, b.meeting_link,
    b.start_utc, b.end_utc, b.status
  from public.bookings b
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  join public.services s on s.id = b.service_id
  where b.id = target_booking_id;
$$;

revoke all on function public.get_booking_payment_context(uuid) from public, authenticated, anon;
grant execute on function public.get_booking_payment_context(uuid) to service_role;
