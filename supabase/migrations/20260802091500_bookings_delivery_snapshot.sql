-- Foundational slice, continued: snapshots delivery_type/phone_number/
-- meeting_link onto the booking itself at booking time, same immutable-
-- after-booking treatment already established for price (payments.
-- amount_cents) — a practitioner editing their service's phone number
-- or (once built) swapping delivery_type must never silently change
-- what an already-booked client sees for a session they already
-- committed to. delivery_info itself is NOT snapshotted here — it's
-- unchanged, out of scope, still fetched live via the existing Epic 7
-- RPCs.

begin;

-- Added nullable first (existing rows predate this column, so a NOT
-- NULL constraint can't apply yet), backfilled from each booking's own
-- service below, then locked to NOT NULL once every row genuinely has
-- one — every insert path is updated in this same migration set, so
-- nothing writes a booking without it from this point forward.
alter table public.bookings
  add column delivery_type text,
  add column phone_number text,
  add column meeting_link text;

-- Backfill: every pre-existing booking's delivery_type, inferred from
-- the service it was made for (the only source of truth available for
-- rows that predate this column existing at all).
update public.bookings b
set delivery_type = s.delivery_type
from public.services s
where s.id = b.service_id
  and b.delivery_type is null;

alter table public.bookings
  alter column delivery_type set not null,
  add constraint bookings_delivery_type_check
  check (delivery_type in ('online', 'in_person', 'phone'));

-- First-ever column-level grant on this table — every existing caller
-- across the app was audited (grepped every `.from("bookings").select(`)
-- to confirm the exact column set actually in use today, so this
-- doesn't silently break anything already working. phone_number/
-- meeting_link are excluded, same reasoning/pattern as services.
-- delivery_info: readable only through the narrow RPC below.
revoke select on public.bookings from anon, authenticated;
grant select (
  id, practitioner_id, client_id, service_id, start_utc, end_utc,
  status, created_at, delivery_type
) on public.bookings to authenticated;

-- Client or practitioner, for their OWN confirmed bookings only — "only
-- after confirmed" is a real, current distinction under this app's
-- payment-first booking model (unlike the existing delivery_info RPCs,
-- which treat pending+confirmed as equally "active"): every booking
-- insert path already writes status='confirmed' directly (there is no
-- pending-then-confirmed transition today — see confirm_paid_booking's
-- own comment), so this mirrors the exact language the request used
-- rather than reusing the "active" definition from the older RPCs.
create function public.get_my_confirmed_bookings_contact_info()
returns table (booking_id uuid, phone_number text, meeting_link text)
language sql
security definer
set search_path = public
stable
as $$
  select id, phone_number, meeting_link
  from public.bookings
  where status = 'confirmed'
    and (client_id = auth.uid() or practitioner_id = auth.uid())
$$;

grant execute on function public.get_my_confirmed_bookings_contact_info() to authenticated;

-- Same signature/return shape as before (CREATE OR REPLACE is enough —
-- no DROP needed, unlike the RETURNS TABLE changes elsewhere in this
-- migration set) — only the body changes: the service row it already
-- fetches for duration/price is widened to also carry the 3 delivery
-- columns, copied straight onto the new booking row at the moment it's
-- created.
create or replace function public.confirm_paid_booking(
  p_practitioner_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_start_utc timestamptz,
  p_checkout_session_id text,
  p_amount_cents integer,
  p_commission_cents integer,
  p_currency text,
  p_payment_intent_id text
)
returns table (booking_id uuid, already_processed boolean, failure_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_booking_id uuid;
  v_service record;
  v_min_notice_hours integer;
  v_end_utc timestamptz;
  v_new_booking_id uuid;
begin
  select p.booking_id into v_existing_booking_id
  from public.payments p
  where p.stripe_checkout_session_id = p_checkout_session_id;

  if found then
    return query select v_existing_booking_id, true, null::text;
    return;
  end if;

  select s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link
  into v_service
  from public.services s
  where s.id = p_service_id and s.practitioner_id = p_practitioner_id;

  if not found or not v_service.is_active then
    return query select null::uuid, false, 'service_unavailable'::text;
    return;
  end if;

  if v_service.price_cents <> p_amount_cents then
    return query select null::uuid, false, 'amount_mismatch'::text;
    return;
  end if;

  select coalesce(pp.min_notice_hours, 24) into v_min_notice_hours
  from public.practitioner_profiles pp
  where pp.id = p_practitioner_id;

  if p_start_utc < now() + (v_min_notice_hours * interval '1 hour') then
    return query select null::uuid, false, 'notice_window_passed'::text;
    return;
  end if;

  v_end_utc := p_start_utc + (v_service.duration_minutes * interval '1 minute');

  insert into public.bookings (
    practitioner_id, client_id, service_id, start_utc, end_utc, status,
    delivery_type, phone_number, meeting_link
  )
  values (
    p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed',
    v_service.delivery_type, v_service.phone_number, v_service.meeting_link
  )
  returning id into v_new_booking_id;

  insert into public.payments (booking_id, stripe_checkout_session_id, amount_cents, commission_cents, currency, status, provider_ref)
  values (
    v_new_booking_id,
    p_checkout_session_id,
    p_amount_cents,
    p_commission_cents,
    p_currency,
    'succeeded',
    jsonb_build_object('payment_intent_id', p_payment_intent_id)
  );

  return query select v_new_booking_id, false, null::text;
exception
  when exclusion_violation then
    return query select null::uuid, false, 'slot_taken'::text;
end;
$$;

revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  to service_role;

commit;
