begin;

-- Adds a graceful failure branch for the case where the client account
-- referenced by a checkout session's metadata no longer exists by the
-- time the webhook (or a Stripe retry of it) actually processes the
-- event — e.g. the account was deleted in the window between payment
-- and webhook delivery. Previously this fell through as an unhandled
-- foreign_key_violation, throwing past confirm_paid_booking entirely:
-- the payment stayed charged, no booking was created, and no refund
-- was issued, with only an error log to show for it. This mirrors the
-- existing exclusion_violation -> 'slot_taken' handling below, so the
-- same refundUnconfirmablePayment path in lib/payments/stripe/webhook.ts
-- picks it up automatically.
create or replace function public.confirm_paid_booking(
  p_practitioner_id uuid, p_client_id uuid, p_service_id uuid, p_start_utc timestamptz,
  p_checkout_session_id text, p_amount_cents integer, p_commission_cents integer,
  p_currency text, p_payment_intent_id text
)
returns table (booking_id uuid, already_processed boolean, failure_reason text)
language plpgsql security definer set search_path = public
as $$
declare
  v_existing_booking_id uuid;
  v_service record;
  v_min_notice_hours integer;
  v_end_utc timestamptz;
  v_new_booking_id uuid;
begin
  select p.booking_id into v_existing_booking_id from public.payments p where p.stripe_checkout_session_id = p_checkout_session_id;
  if found then return query select v_existing_booking_id, true, null::text; return; end if;

  select s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link
  into v_service
  from public.services s
  where s.id = p_service_id and s.practitioner_id = p_practitioner_id;

  if not found or not v_service.is_active then return query select null::uuid, false, 'service_unavailable'::text; return; end if;
  if v_service.price_cents <> p_amount_cents then return query select null::uuid, false, 'amount_mismatch'::text; return; end if;

  select coalesce(pp.min_notice_hours, 24) into v_min_notice_hours from public.practitioner_profiles pp where pp.id = p_practitioner_id;
  if p_start_utc < now() + (v_min_notice_hours * interval '1 hour') then return query select null::uuid, false, 'notice_window_passed'::text; return; end if;

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
  values (v_new_booking_id, p_checkout_session_id, p_amount_cents, p_commission_cents, p_currency, 'succeeded', jsonb_build_object('payment_intent_id', p_payment_intent_id));

  return query select v_new_booking_id, false, null::text;
exception
  when exclusion_violation then return query select null::uuid, false, 'slot_taken'::text;
  when foreign_key_violation then return query select null::uuid, false, 'client_account_deleted'::text;
end;
$$;

commit;
