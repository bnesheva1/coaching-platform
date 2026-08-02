begin;

alter table public.practitioner_profiles
  add column stripe_connect_charges_enabled boolean not null default false,
  add column stripe_connect_payouts_enabled boolean not null default false;

-- practitioner_profiles never got the column-grant treatment every other
-- sensitive table in this codebase already has (bookings, services,
-- profiles, reviews). Today stripe_connected_account_id is fully
-- readable by anyone via a plain select() and fully writable by any
-- practitioner on their own row via a plain update() — a practitioner
-- could read another practitioner's connected-account id (fully exposed)
-- and write it onto their own row, redirecting their own future payouts
-- to someone else's Stripe account. Closed here, alongside adding the
-- two new status columns, since it's the same column this feature is
-- built around.
--
-- Every existing call site (18, across app/ and lib/) was audited before
-- writing this — every one already uses an explicit column list, none do
-- a bare select()/select("*"), so this is safe to apply without the kind
-- of regression found and fixed today in the cancel-booking actions.
revoke select, update on public.practitioner_profiles from anon, authenticated;

grant select (
  id, bio, specialties, avatar_url, created_at, username, timezone,
  min_notice_hours, banner_url, headline, location, topics, billing_model
) on public.practitioner_profiles to anon, authenticated;

-- billing_model is included here even though no current call site writes
-- it client-side — not part of this task, nothing depends on removing
-- it. stripe_connected_account_id and the two new booleans are excluded
-- from both grants entirely: every write to them goes through a
-- service-role path, never a client session.
grant update (
  bio, specialties, avatar_url, username, timezone, min_notice_hours,
  banner_url, headline, location, topics, billing_model
) on public.practitioner_profiles to authenticated;

-- Practitioner's own Connect status, for the dashboard UI. Deliberately
-- never returns the raw stripe_connected_account_id — nothing in the UI
-- needs the actual value, only whether it's set. Mirrors
-- get_my_services_delivery_info()'s exact shape.
create function public.get_my_connect_status()
returns table (is_connected boolean, charges_enabled boolean, payouts_enabled boolean)
language sql security definer set search_path = public stable
as $$
  select
    stripe_connected_account_id is not null,
    stripe_connect_charges_enabled,
    stripe_connect_payouts_enabled
  from public.practitioner_profiles
  where id = auth.uid()
$$;
grant execute on function public.get_my_connect_status() to authenticated;

commit;
