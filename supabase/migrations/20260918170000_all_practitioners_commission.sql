-- Brand-wide billing model: this deployment is a commission marketplace, not a
-- keep-100%/software_provider brand. Make `commission` the model for EVERY
-- practitioner — a brand-level decision, not a per-practitioner one (there is no
-- admin per-practitioner model switch, and none is being added).
--
--   1. Flip every existing 'software_provider' row to 'commission'. These
--      accounts now have the platform's COMMISSION_RATE (0.15) withheld from
--      each booking, and receive (price - commission) via their Stripe Connect
--      account — the same transfer path they already used, only the split
--      changes. The per-practitioner commission_rate_override is untouched
--      (all null today), so everyone lands on the brand default rate.
--   2. Set the column default to 'commission' so any profile row created
--      outside the signup action (e.g. admin/service-role inserts) is also
--      commission by default.
--
-- New self-service signups get their model from DEFAULT_BILLING_MODEL (read in
-- signup/actions.ts) — set that env to `commission` in the deployment so it
-- matches. The billing_model CHECK ('commission','software_provider') already
-- allows this value, so nothing else changes.

begin;

update public.practitioner_profiles
  set billing_model = 'commission'
  where billing_model is distinct from 'commission';

alter table public.practitioner_profiles
  alter column billing_model set default 'commission';

commit;
