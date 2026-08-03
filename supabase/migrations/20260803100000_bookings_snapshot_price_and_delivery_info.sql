-- Expandable booking details: bookings already snapshots delivery_type/
-- phone_number/meeting_link (see bookings_delivery_snapshot), but three
-- gaps remain, all of the same shape — a field the UI needs to show
-- "what was actually agreed at booking time" is instead only available
-- via a live join to the CURRENT services row, so editing that service
-- later silently rewrites what an old booking appears to show:
--
-- 1. service_name/price_cents/currency were never snapshotted at all.
-- 2. delivery_info (the real online meeting link / in-person address
--    text) was explicitly left out of the earlier snapshot migration
--    ("still fetched live via the existing Epic 7 RPCs") — meeting_link
--    looks like it should cover this, but it's a distinct, reserved-for-
--    future column (services.meeting_link has no reader/writer anywhere
--    in the app today; it's meant for a future LiveKit auto-generated
--    link, not today's real join info) and is always null in practice.
-- 3. get_my_confirmed_bookings_contact_info() — built to expose exactly
--    this snapshot — was never actually wired into any UI (zero call
--    sites), and its `status = 'confirmed'` filter is stale against the
--    real status domain (a completed or cancelled booking would get
--    nothing back even if it were called).

begin;

alter table public.bookings
  add column service_name text,
  add column price_cents integer,
  add column currency text,
  add column delivery_info text;

-- Backfill existing rows. price_cents/currency prefer the actually-
-- charged amount from payments (accurate for commission-model bookings,
-- which always have a payments row) and fall back to the service's
-- current price only where no payment row exists (software_provider
-- bookings never had one) — the closest available truth for rows that
-- predate this column. delivery_info is only meaningful for online/
-- in_person; phone-type bookings keep their existing phone_number
-- column and get no delivery_info here, mirroring services' own shape.
--
-- Correlated scalar subqueries, not a FROM-list join to payments: the
-- UPDATE target's own alias (b) can't be referenced inside a JOIN ... ON
-- clause in the FROM list (confirmed live — Postgres rejects it with
-- "invalid reference to FROM-clause entry for table b"), only in WHERE/
-- SET expressions, which a correlated subquery here is.
update public.bookings b
set
  service_name = s.name,
  price_cents = coalesce(
    (select p.amount_cents from public.payments p where p.booking_id = b.id),
    s.price_cents
  ),
  currency = coalesce(
    (select p.currency from public.payments p where p.booking_id = b.id),
    s.currency
  ),
  delivery_info = case when b.delivery_type in ('online', 'in_person') then s.delivery_info else null end
from public.services s
where s.id = b.service_id
  and b.service_name is null;

alter table public.bookings
  alter column service_name set not null,
  alter column price_cents set not null,
  alter column currency set not null;

-- service_name/price_cents/currency are the same sensitivity as the
-- already-granted delivery_type: not secret from the row's own two
-- parties, and RLS's row-level policy is what actually restricts which
-- rows are visible at all. delivery_info stays excluded, same as
-- phone_number/meeting_link — RPC-only, below.
revoke select on public.bookings from anon, authenticated;
grant select (
  id, practitioner_id, client_id, service_id, start_utc, end_utc,
  status, created_at, delivery_type, service_name, price_cents, currency
) on public.bookings to authenticated;

-- Widened to add delivery_info, and rescoped from `status = 'confirmed'`
-- (stale — a completed or cancelled booking's status is no longer
-- literally 'confirmed', so this would return nothing for either) to
-- ownership, which is the real boundary: a client or practitioner may
-- see this snapshot for any booking that is genuinely theirs, at any
-- point in its lifecycle, not just while it's still upcoming.
drop function if exists public.get_my_confirmed_bookings_contact_info();
create function public.get_my_confirmed_bookings_contact_info()
returns table (booking_id uuid, phone_number text, meeting_link text, delivery_info text)
language sql
security definer
set search_path = public
stable
as $$
  select id, phone_number, meeting_link, delivery_info
  from public.bookings
  where client_id = auth.uid() or practitioner_id = auth.uid()
$$;

grant execute on function public.get_my_confirmed_bookings_contact_info() to authenticated;

-- Same signature (CREATE OR REPLACE is enough — no RETURNS TABLE change
-- here, just widening the internal service lookup and the insert).
-- p_amount_cents/p_currency (not v_service.price_cents/currency) are
-- snapshotted — already validated equal at this point, but this is
-- literally the amount charged, which is what "price paid" means.
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

revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  to service_role;

commit;
