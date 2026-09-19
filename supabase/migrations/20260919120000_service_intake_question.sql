-- Per-service intake question + per-booking client answer.
--
-- A practitioner can set a short free-text prompt on a service (e.g. an
-- astrologer asking for date/time/place of birth). The client answers it in
-- their own text field. It is NOT a booking gate — answering is always optional,
-- and the answer is editable throughout the booking's active window (up to
-- end_utc + retention, like the session-document exchange), so both sides can
-- still exchange it during the call. That also means the immediate ("book now")
-- path supports it with no pre-booking step.
--
-- Conventions mirrored:
--   * services.intake_prompt is snapshotted onto the booking at creation, exactly
--     like documents_enabled / service_name / delivery_info (20260826120000),
--     so editing the service later never changes what an existing booking asked.
--   * length CHECKs mirror 20260803160000; a CHECK passes on NULL, so the
--     nullable columns are unaffected when unset.
--   * intake_answer is client-written but NOT added to any UPDATE grant — the
--     bookings UPDATE grant is deliberately (status)-only (20260712100000), and a
--     blanket client-update policy would let status changes bypass the
--     cancellation-notice window. It is written only through the SECURITY DEFINER
--     RPC below, which does its own auth/window checks. Both fields are readable
--     by the booking parties via a plain column select grant.

begin;

-- ── services: the prompt the practitioner controls ───────────────────
alter table public.services
  add column intake_prompt text,
  add constraint services_intake_prompt_length check (intake_prompt is null or length(intake_prompt) <= 300);

grant select (intake_prompt) on public.services to authenticated;

-- ── bookings: the frozen prompt snapshot + the client's answer ────────
alter table public.bookings
  add column intake_prompt text,
  add column intake_answer text,
  add constraint bookings_intake_prompt_length check (intake_prompt is null or length(intake_prompt) <= 300),
  add constraint bookings_intake_answer_length check (intake_answer is null or length(intake_answer) <= 300);

-- Both readable by the booking parties (the existing SELECT policy already
-- restricts rows to client/practitioner). No UPDATE grant for intake_answer —
-- see the header; it is written only via set_booking_intake_answer.
grant select (intake_prompt, intake_answer) on public.bookings to authenticated;

-- ── confirm_paid_booking: snapshot the prompt on the paid path ───────
-- CREATE OR REPLACE of the current definition
-- (20260829120000_practitioner_commission_override.sql), adding intake_prompt to
-- the service read and the booking insert. Same signature — no client answer is
-- collected at booking time (it's post-booking), so no new parameter is needed.
-- The direct (bookSlot) and immediate paths snapshot intake_prompt in app code.
create or replace function public.confirm_paid_booking(
  p_practitioner_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_start_utc timestamptz,
  p_checkout_session_id text,
  p_amount_cents integer,
  p_commission_cents integer,
  p_currency text,
  p_payment_intent_id text,
  p_commission_rate numeric default null
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

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'client'
  ) then
    return query select null::uuid, false, 'client_role_required'::text;
    return;
  end if;

  select s.name, s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link, s.delivery_info,
         s.documents_enabled, s.intake_prompt
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
    service_name, price_cents, currency, delivery_info, documents_enabled, intake_prompt
  )
  values (
    p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed',
    v_service.delivery_type, v_service.phone_number, v_service.meeting_link,
    v_service.name, p_amount_cents, p_currency, v_service.delivery_info, v_service.documents_enabled, v_service.intake_prompt
  )
  returning id into v_new_booking_id;

  insert into public.payments (
    booking_id, stripe_checkout_session_id, amount_cents, commission_cents,
    commission_rate, currency, status, provider_ref
  )
  values (
    v_new_booking_id, p_checkout_session_id, p_amount_cents, p_commission_cents,
    p_commission_rate, p_currency, 'succeeded',
    jsonb_build_object('payment_intent_id', p_payment_intent_id)
  );

  return query select v_new_booking_id, false, null::text;
exception
  when exclusion_violation then
    return query select null::uuid, false, 'slot_taken'::text;
end;
$$;

revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text, numeric)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text, numeric)
  to service_role;

-- ── set_booking_intake_answer: the ONLY write path for the answer ────
-- SECURITY DEFINER so it can write intake_answer (not covered by any UPDATE
-- grant) after enforcing, in the DB layer:
--   * the caller is THIS booking's client (auth.uid()), not the practitioner
--     or a third party — the answer is the client's to write;
--   * the service offered an intake prompt (booking.intake_prompt is not null);
--   * we're still inside the active window: now() <= end_utc + 14 days
--     (mirrors SESSION_DOCUMENT_RETENTION_DAYS in lib/documents/config.ts — the
--     same "a contract before, a summary after" window the file exchange uses);
--   * length <= 300 (the column CHECK is the ultimate backstop).
-- An empty/blank answer clears the slot (stored as NULL). Control-char stripping
-- and trimming happen in the server action before this is called; this is the
-- authoritative gate that a forged direct RPC call cannot skip.
create or replace function public.set_booking_intake_answer(
  p_booking_id uuid,
  p_answer text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_normalized text;
begin
  select client_id, end_utc, intake_prompt
  into v_booking
  from public.bookings
  where id = p_booking_id;

  if not found then
    return false;
  end if;
  if v_booking.client_id <> auth.uid() then
    return false;
  end if;
  if v_booking.intake_prompt is null then
    return false;
  end if;
  if now() > v_booking.end_utc + interval '14 days' then
    return false;
  end if;

  v_normalized := nullif(btrim(coalesce(p_answer, '')), '');
  if v_normalized is not null and length(v_normalized) > 300 then
    return false;
  end if;

  update public.bookings
  set intake_answer = v_normalized
  where id = p_booking_id;

  return true;
end;
$$;

revoke all on function public.set_booking_intake_answer(uuid, text) from public, anon;
grant execute on function public.set_booking_intake_answer(uuid, text) to authenticated;

commit;
