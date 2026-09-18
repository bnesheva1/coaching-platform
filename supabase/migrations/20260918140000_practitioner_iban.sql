-- DAC7: a practitioner's IBAN (the reportable seller's bank account identifier).
-- Stripe only returns the connected account's bank last4, never the full number,
-- so we collect and store it ourselves — SAME pattern as tin (20260918120000):
--   * practitioner_profiles' SELECT grant is column-scoped, so this new column is
--     unreadable by anon/authenticated (other practitioners, clients, public) by
--     default. We do NOT add it to any SELECT grant → read only server-side via
--     the service role (owner pre-fill + reporting).
--   * Owner WRITES via the existing owner-UPDATE RLS policy + the column grant.
-- No at-rest encryption (access control is the protection), same as tin.
-- account_holder_name is NOT collected — Stripe returns it in full on the
-- connected account's external bank account; it's pulled from there at filing.

begin;

alter table public.practitioner_profiles
  add column iban text,
  -- Format backstop only. The full ISO 7064 MOD-97 checksum is enforced in the
  -- app (lib/tax/iban.ts) before write; this guarantees shape at rest.
  add constraint practitioner_iban_format check (
    iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
  );

grant update (iban) on public.practitioner_profiles to authenticated;

commit;
