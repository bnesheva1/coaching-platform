-- DAC7: a practitioner's TIN (Tax Identification Number) — ЕГН for a Bulgarian
-- individual, or a VAT number for a VAT-registered one. Stripe can't provide
-- this (its Persons API is write-only — only a boolean "id provided"), so we
-- collect and store it ourselves.
--
-- Sensitivity: this is a national identifier. It follows the SAME pattern as
-- emergency_contact — NOT a new scheme:
--   * practitioner_profiles' SELECT grant is column-scoped, so a newly-added
--     column is unreadable by anon/authenticated by default. We deliberately do
--     NOT add tin/tin_type to any SELECT grant → not readable by other
--     practitioners, clients, or any public-facing query. Read only server-side
--     via the service role (owner pre-fill + admin/reporting code).
--   * Owner WRITES go through the existing owner UPDATE RLS policy on
--     practitioner_profiles plus the column-level UPDATE grant below.
-- No at-rest encryption is used anywhere in this codebase; access control is the
-- protection, consistent with emergency_contact and stripe_connected_account_id.

begin;

alter table public.practitioner_profiles
  add column tin text,
  add column tin_type text,
  -- Format backstop only. The full ЕГН mod-11 checksum + embedded-date validity
  -- (and VAT normalisation) are enforced in the app (lib/tax/tin.ts) before write;
  -- this CHECK guarantees shape at rest and that tin/tin_type are set together.
  add constraint practitioner_tin_format check (
    (tin is null and tin_type is null)
    or (tin_type = 'egn' and tin ~ '^[0-9]{10}$')
    or (tin_type = 'vat' and tin ~ '^BG[0-9]{9,10}$')
  );

-- Owner-only writes (via the existing "practitioners update their own profile"
-- RLS policy). No SELECT grant — see the header.
grant update (tin, tin_type) on public.practitioner_profiles to authenticated;

commit;
