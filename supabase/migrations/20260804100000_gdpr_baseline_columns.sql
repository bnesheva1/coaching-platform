-- GDPR baseline, schema half: account-deletion audit marker + marketing
-- consent. The deletion flow itself (app/[locale]/settings/account-
-- actions.ts) never hard-deletes a profile row — it anonymises fields
-- in place so bookings/reviews/payments the other party depends on stay
-- intact — so deleted_at is what makes an anonymised row distinguishable
-- from a broken one later ("was this account deleted, and when").

begin;

alter table public.profiles
  add column deleted_at timestamptz,
  add column marketing_consent boolean not null default false,
  add column marketing_consent_updated_at timestamptz;

-- deleted_at: deliberately no grant to anon/authenticated at all, in
-- either direction. Nothing in the app ever needs to read it back
-- through a user session — by the time it's set, that account's own
-- session is already invalidated (see the deletion action) — and only
-- the deletion action itself (service-role) ever writes it. Pure
-- admin-visibility field, same category as stripe_connected_account_id.
--
-- marketing_consent/marketing_consent_updated_at: the opposite —
-- self-service by design, so both are select+update grantable to
-- authenticated, same as display_name/timezone already are. Both set
-- together in the same update() call from the settings action (never
-- consent without also stamping when), so there's no path where one is
-- set without the other.
grant select (marketing_consent, marketing_consent_updated_at)
  on public.profiles to authenticated;
grant update (marketing_consent, marketing_consent_updated_at)
  on public.profiles to authenticated;

commit;
