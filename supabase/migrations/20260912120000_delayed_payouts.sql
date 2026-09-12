-- Delayed payouts: move from Stripe Connect DESTINATION charges to SEPARATE
-- charges & transfers. The client's card is still charged in full at booking,
-- but the funds now land in the PLATFORM balance (checkout.ts drops
-- transfer_data). The practitioner's share is transferred to their connected
-- account only after a hold window past session end (PAYOUT_HOLD_HOURS, default
-- 48h), by the daily payout-release sweep (lib/payments/stripe/transfer.ts).
-- The platform commission simply stays in the platform balance — no separate
-- application-fee object at transfer time.
--
-- Per-payment tracking (payments is 1:1 with a booking):
--   transfer_status: pending (awaiting release) → released (transfer sent) or
--     held (past due but withheld — practitioner payouts frozen / admin paused);
--     reversed (transfer reversed by a post-release refund); not_applicable
--     (no payout: refunded before release, or a non-commission/no-booking row).
--   release_at: scheduled release time (session end + hold window); backfilled
--     by the sweep on first sight, admin-adjustable.
--   stripe_transfer_id: the Transfer once sent (for reversal on later refund).

begin;

alter table public.payments
  add column transfer_status text not null default 'pending'
    check (transfer_status in ('pending', 'released', 'held', 'reversed', 'not_applicable')),
  add column release_at timestamptz,
  add column stripe_transfer_id text;

-- Grandfather every pre-existing payment: its funds already transferred
-- immediately under the old destination-charge flow (or the row is a refund).
-- Succeeded → 'released' (nothing left to pay); refunded → 'not_applicable'.
-- Either way the sweep (status='succeeded' AND transfer_status='pending') never
-- touches them, so no double-transfer of anything paid out under the old flow.
update public.payments
set transfer_status = case when status = 'refunded' then 'not_applicable' else 'released' end;

commit;
