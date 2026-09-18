-- DAC7 reports consideration in the quarter it was CREDITED to the seller (OECD
-- Model Rules). In our separate-charges-&-transfers model the credit event is the
-- Stripe Transfer created by the payout release sweep — not the session date or
-- the client's checkout. Record that moment explicitly so the quarterly report
-- can bucket on it durably (rather than inferring it from updated_at).

begin;

alter table public.payments add column transferred_at timestamptz;
alter table public.content_purchases add column transferred_at timestamptz;

-- Backfill already-released rows: nothing touches a released+succeeded row after
-- release (a later refund flips it to refunded/reversed, which the report
-- excludes anyway), so updated_at on a currently-released row IS the release
-- moment — the best available proxy for historical transfers. Going forward the
-- release sweep (transfer.ts) sets transferred_at precisely at transfer time.
update public.payments set transferred_at = updated_at where transfer_status = 'released' and transferred_at is null;
update public.content_purchases set transferred_at = updated_at where transfer_status = 'released' and transferred_at is null;

commit;
