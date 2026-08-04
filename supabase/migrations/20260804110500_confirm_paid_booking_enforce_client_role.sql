-- Hardening ahead of any future dual-role work, same reasoning as the
-- self-booking CHECK constraint added alongside this migration.
--
-- confirm_paid_booking (the paid/commission booking path, called only
-- from the Stripe webhook/cron reconciliation, SECURITY DEFINER,
-- service-role-only) re-derives every other precondition itself
-- (service exists/active, price matches, notice window, slot free) but
-- never checked the booker's own role — it relied entirely on
-- bookSlot() never calling initiateBookingPayment for a non-client in
-- the first place. That's an app-level guarantee about the ONE caller
-- that exists today, not a guarantee this function makes about itself.
-- Every other precondition here is enforced by this function directly,
-- specifically so a future second caller (another admin tool, a bug in
-- bookSlot, a direct service-role script) can't skip it — the role
-- check belongs to the same category and was simply missed when this
-- function was first written, before the client-role RLS check existed
-- on the direct-insert path it mirrors.
--
-- Same signature, CREATE OR REPLACE — no RETURNS TABLE change.

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

  -- The new check — mirrors the "Clients can create their own bookings"
  -- RLS policy's own role clause (bookings_client_not_practitioner,
  -- this same migration set, is the identity half; this is the role
  -- half), so this function now enforces the same two guarantees on
  -- its own insert that the direct path gets from RLS.
  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'client'
  ) then
    return query select null::uuid, false, 'client_role_required'::text;
    return;
  end if;

  select s.name, s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link, s.delivery_info
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
    delivery_type, phone_number, meeting_link,
    service_name, price_cents, currency, delivery_info
  )
  values (
    p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed',
    v_service.delivery_type, v_service.phone_number, v_service.meeting_link,
    v_service.name, p_amount_cents, p_currency, v_service.delivery_info
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

-- Unchanged from the previous definition — CREATE OR REPLACE doesn't
-- touch privileges, but restating them keeps this migration a complete,
-- self-contained record of the function's final state.
revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  to service_role;
