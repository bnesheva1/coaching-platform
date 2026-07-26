-- Epic 9: payment module. Stripe Connect, commission model, book-on-
-- successful-payment (no slot reservation during Checkout — a booking
-- row is only ever created once Stripe confirms payment, inside
-- confirm_paid_booking() below). This means bookings.status never
-- needs a 'pending'/'unpaid' state for this flow — every row this
-- migration's function ever creates goes straight to 'confirmed',
-- exactly like every booking before this epic. No change to
-- bookings.status, the exclusion constraint, or get_practitioner_busy_times
-- is needed at all.

begin;

-- billing_model is the seam the rest of the app dispatches on — never
-- Stripe/Connect specifics directly. software_provider (not built out
-- beyond the column existing yet) is meant to mean "no payment gate,
-- confirm immediately" — today's exact pre-Epic-9 behavior — so the
-- default deliberately is NOT commission; a practitioner has to be
-- explicitly switched over (or seeded that way) to go through Checkout.
alter table public.practitioner_profiles
  add column billing_model text not null default 'software_provider'
    check (billing_model in ('commission', 'software_provider')),
  add column stripe_connected_account_id text;

-- One row per successful payment. Never created until Stripe confirms
-- paid — there is no 'pending'/'failed' state to represent, so status
-- only ever starts at 'succeeded' and may later become 'refunded'.
-- booking_id is nullable for the rare case a payment succeeds but the
-- booking can't be created (lost the double-booking race, or the slot
-- became invalid while Checkout was open) — that money still needs to
-- be traceable even with no booking to hang it off. Postgres allows
-- multiple NULLs under a UNIQUE constraint, so nullable + unique here
-- is safe: at most one succeeded-payment row per real booking, any
-- number of orphaned/refunded-before-booking rows.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete cascade,
  -- THE idempotency key: both the webhook and the cron reconciliation
  -- sweep check "does a payments row already exist for this session"
  -- before doing anything else. A real column, not buried in
  -- provider_ref, because both of those callers query on it directly.
  stripe_checkout_session_id text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'succeeded' check (status in ('succeeded', 'refunded')),
  provider text not null default 'stripe',
  -- Everything else Stripe-specific (payment_intent id, charge id,
  -- transfer id, refund id) lives here, not as named columns — this
  -- table's own shape stays provider-agnostic; only lib/payments/stripe/
  -- ever reads/writes into this object's keys.
  provider_ref jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments enable row level security;

-- No authenticated INSERT/UPDATE policy at all, deliberately — a
-- client is never capable of creating or modifying a payments row by
-- any request they can make. The only writers are the service-role
-- client inside the webhook handler / cron sweep (both call
-- confirm_paid_booking below, SECURITY DEFINER) and the refund
-- function (plain service-role UPDATE from lib/payments). This is the
-- actual guarantee behind "a client cannot mark their own payment
-- successful" — it's not a check, it's the absence of any path.
create policy "Booking parties can view their own payment"
on public.payments
for select
to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id
      and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
  )
);

-- The atomic "did this payment actually turn into a booking" step.
-- Runs as service-role (webhook handler / cron sweep), so RLS is
-- bypassed entirely for the insert below — every check the normal
-- "Clients can create their own bookings" RLS policy would have made
-- is re-implemented explicitly here instead, so this function can never
-- produce an invalid booking regardless of what the caller already
-- checked. Idempotent: a duplicate call with the same checkout session
-- id (webhook retried, or cron sees a session the webhook already
-- handled) returns the existing booking_id and does nothing further —
-- this is what makes "webhook and cron both see it" safe.
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
  -- Idempotency check, first move, before anything else.
  select p.booking_id into v_existing_booking_id
  from public.payments p
  where p.stripe_checkout_session_id = p_checkout_session_id;

  if found then
    return query select v_existing_booking_id, true, null::text;
    return;
  end if;

  -- Re-derive duration/price from the service row itself — never
  -- trusted from the caller, mirrors the existing bookings INSERT
  -- policy's own re-check.
  select s.duration_minutes, s.is_active, s.price_cents
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

  -- The real guarantee: this can raise exclusion_violation (23P01) if
  -- the slot was taken by a concurrent confirmed booking — the exact
  -- same constraint every other booking path relies on, just reached
  -- later in the flow (at payment-confirmation time, not at checkout-
  -- start time, since nothing reserves the slot during Checkout).
  insert into public.bookings (practitioner_id, client_id, service_id, start_utc, end_utc, status)
  values (p_practitioner_id, p_client_id, p_service_id, p_start_utc, v_end_utc, 'confirmed')
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

-- This function bypasses every normal booking safeguard by design, so
-- it must never be reachable from a user session — same explicit
-- revoke/grant shape as get_reminder_batch (the existing service-role-
-- only precedent), not just "no grant to authenticated" by omission.
revoke all on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  from public, authenticated, anon;
grant execute on function public.confirm_paid_booking(uuid, uuid, uuid, timestamptz, text, integer, integer, text, text)
  to service_role;

-- get_booking_email_context (existing, Epic 6) requires auth.uid() to be
-- one of the booking's two parties — correct for every caller so far,
-- all of which run inside an actual user session. The payment webhook
-- and cron sweep run as service_role, which has no auth.uid() at all,
-- so that check would just return zero rows. Same fix as
-- get_reminder_batch already established: a separate, service-role-only
-- function with no auth.uid() check, rather than weakening the
-- user-facing one.
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
    s.name, s.delivery_type, s.delivery_info,
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

-- For the "charged but no booking was ever created" refund notice —
-- there's no booking row to join through at all in that case, just the
-- client/practitioner ids from the Checkout Session's own metadata.
create function public.get_profile_contact(target_profile_id uuid)
returns table (email text, display_name text, locale text)
language sql
security definer
set search_path = public
stable
as $$
  select p.email, p.display_name, p.locale
  from public.profiles p
  where p.id = target_profile_id;
$$;

revoke all on function public.get_profile_contact(uuid) from public, authenticated, anon;
grant execute on function public.get_profile_contact(uuid) to service_role;

commit;
