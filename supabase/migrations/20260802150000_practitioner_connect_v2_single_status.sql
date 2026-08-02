begin;

-- Correction to the previous migration: Stripe's API rejected v1 account
-- creation outright for this platform's account ("Stripe no longer
-- recommends Accounts v1 for new Connect integrations"), confirmed via a
-- live create call. The correct v2 model for a marketplace/destination-
-- charge platform (this one) tracks a single capability —
-- configuration.recipient.capabilities.stripe_balance.stripe_transfers.
-- status — not separate charges_enabled/payouts_enabled booleans, which
-- are deprecated v1 fields with no direct v2 equivalent pair.
alter table public.practitioner_profiles
  drop column stripe_connect_charges_enabled,
  drop column stripe_connect_payouts_enabled,
  add column stripe_connect_transfers_active boolean not null default false;

drop function if exists public.get_my_connect_status();
create function public.get_my_connect_status()
returns table (is_connected boolean, transfers_active boolean)
language sql security definer set search_path = public stable
as $$
  select
    stripe_connected_account_id is not null,
    stripe_connect_transfers_active
  from public.practitioner_profiles
  where id = auth.uid()
$$;
grant execute on function public.get_my_connect_status() to authenticated;

commit;
