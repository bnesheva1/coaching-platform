-- Per-service "allow file exchange" setting.
--
-- Session document exchange is gated by TWO switches now: the brand-level
-- SESSION_DOCUMENTS_ENABLED flag decides whether the feature exists at
-- all, and THIS per-service boolean lets each practitioner choose whether
-- a given service offers it. Default false — it's opt-in per service (the
-- practitioner turns it on when they want a contract/summary channel).
--
-- Like every other "what was agreed" field, it is SNAPSHOTTED onto the
-- booking at creation time (bookings.documents_enabled), so a practitioner
-- toggling the service later never changes what an already-booked session
-- allows — a document already exchanged can't be stranded by a later
-- setting change. Mirrors the delivery_type/service_name/price snapshot
-- discipline (see 20260802091500 / 20260803100000).

begin;

-- ── services: the setting the practitioner controls ──────────────────
alter table public.services
  add column documents_enabled boolean not null default false;

-- Additive column grant (same approach as image_url in 20260719110000 —
-- a new column isn't covered by the existing column-level grant). Not
-- sensitive (a capability flag, unlike delivery_info), and the
-- practitioner's own service form reads it via their user client, so
-- authenticated is enough; no anon/public need.
grant select (documents_enabled) on public.services to authenticated;

-- ── bookings: the frozen snapshot ────────────────────────────────────
alter table public.bookings
  add column documents_enabled boolean;

-- Backfill from the parent service (all services are false at this point,
-- so every existing booking becomes false — but written as the general
-- correlated update, same shape as the delivery_type backfill).
update public.bookings b
set documents_enabled = coalesce(s.documents_enabled, false)
from public.services s
where s.id = b.service_id
  and b.documents_enabled is null;

alter table public.bookings
  alter column documents_enabled set default false,
  alter column documents_enabled set not null;

grant select (documents_enabled) on public.bookings to authenticated;

-- ── confirm_paid_booking: snapshot the setting on the paid path ──────
-- CREATE OR REPLACE of the current definition
-- (20260804110500_confirm_paid_booking_enforce_client_role.sql), adding
-- documents_enabled to the service read and the booking insert. Same
-- signature; the direct (bookSlot) and immediate paths snapshot it in
-- application code.
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

  if not exists (
    select 1 from public.profiles p where p.id = p_client_id and p.role = 'client'
  ) then
    return query select null::uuid, false, 'client_role_required'::text;
    return;
  end if;

  select s.name, s.duration_minutes, s.is_active, s.price_cents,
         s.delivery_type, s.phone_number, s.meeting_link, s.delivery_info,
         s.documents_enabled
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
    service_name, price_cents, currency, delivery_info, documents_enabled
  )
  values (
    p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed',
    v_service.delivery_type, v_service.phone_number, v_service.meeting_link,
    v_service.name, p_amount_cents, p_currency, v_service.delivery_info, v_service.documents_enabled
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
