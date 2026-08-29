-- Practitioner subscription billing — data model (slice 1 of 3).
--
-- A monthly platform fee, charged via Stripe Billing. This is a genuinely NEW
-- relationship on the practitioner: they are already a Connect *account we pay*
-- (stripe_connected_account_id, booking payouts); a subscription makes them
-- ALSO a *customer we charge* (stripe_customer_id + stripe_subscription_id).
-- Two Stripe objects, one row — the column names keep them distinct.
--
-- Subscription is a SEPARATE axis from commission: a practitioner can pay both,
-- either, or neither. An exempt subscription does NOT grant zero commission
-- (that is the separate commission override, 20260829120000). So these columns
-- never touch the commission_* columns.
--
-- The override quartet mirrors the commission override exactly — nullable,
-- no default, deliberately NOT added to any client grant (admin-set business
-- rule; the practitioner reads their OWN status via the definer RPC below, and
-- admins via admin_list_practitioners, extended in slice 3).
--
-- ENFORCEMENT (slices 2): only subscription_status = 'lapsed' restricts (not
-- bookable + not findable). 'not_required' (never subscribed), 'active',
-- 'grace' (a payment failed, Stripe still retrying) and 'exempt' all stay
-- bookable and findable — "lapse-only". This migration only lays down the
-- column + default; the derivation functions are recomposed in slice 2.

begin;

-- ── practitioner_profiles: the two Stripe ids + lifecycle + override ──
alter table public.practitioner_profiles
  -- The charge relationship (Customer + its Subscription) — distinct from
  -- stripe_connected_account_id, which is the PAY relationship. Both can be set
  -- on the same practitioner.
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  -- The lifecycle state the whole feature composes on. Default 'not_required'
  -- so every existing practitioner is unaffected (never subscribed → never
  -- restricted). Stripe is the source of truth; the webhook maps its status
  -- onto this column.
  add column subscription_status text not null default 'not_required'
    constraint practitioner_profiles_subscription_status_check
    check (subscription_status in ('not_required', 'active', 'grace', 'lapsed', 'exempt')),
  -- When the currently-paid period ends (display + a coarse safety net). Null
  -- until the first paid invoice.
  add column subscription_current_period_end timestamptz,
  -- ── the admin override quartet (mirrors commission_rate_* ) ──
  -- Exempt is a STATUS, not an absence: an exempt practitioner is subscribed
  -- and active, charged nothing (founders, shareholders, negotiated terms).
  add column subscription_exempt boolean not null default false,
  -- A custom monthly amount in cents; null = the brand default (env). Ignored
  -- when exempt. A whole-euro platform fee, but stored in cents for parity with
  -- every other money column here.
  add column subscription_price_override_cents integer
    constraint practitioner_profiles_subscription_price_override_positive
    check (subscription_price_override_cents is null or subscription_price_override_cents >= 0),
  add column subscription_override_reason text,
  add column subscription_override_set_by uuid references auth.users(id),
  add column subscription_override_set_at timestamptz;

-- Deliberately NOT granted to anon/authenticated — admin-only, read via the
-- service role in the subscription flow and via admin_list_practitioners for
-- display. The practitioner reads their OWN subscription state through the
-- narrow definer RPC below (same pattern as get_my_commission_context).

-- ── get_my_subscription_context: the practitioner's own read path ────
-- The subscription columns are admin-only / not client-granted, but a
-- practitioner needs to see their own state to render the dashboard banner and
-- the Membership section (subscribe / update card). Same shape as
-- get_my_commission_context (20260829130000): a narrow SECURITY DEFINER RPC
-- scoped to auth.uid(), exposing only the caller's own row. The EFFECTIVE
-- monthly price (exempt ? 0 : override ?? brand default) is still resolved in
-- app code — this only exposes the inputs. has_customer / has_subscription are
-- booleans, never the raw Stripe ids (the UI only needs "are you enrolled").
create function public.get_my_subscription_context()
returns table (
  subscription_status text,
  subscription_current_period_end timestamptz,
  subscription_exempt boolean,
  subscription_price_override_cents integer,
  has_customer boolean,
  has_subscription boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    subscription_status,
    subscription_current_period_end,
    subscription_exempt,
    subscription_price_override_cents,
    stripe_customer_id is not null,
    stripe_subscription_id is not null
  from public.practitioner_profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_subscription_context() to authenticated;

commit;
