-- DAC7: a practitioner's structured mailing address (residential address for an
-- individual seller). Discrete fields, not free text. Same sensitive-field
-- pattern as tin/iban — auto-excluded from every SELECT grant (read server-side
-- via the service role only), owner-write via the existing update RLS + the
-- column grant. The OECD address type code (legalAddressType) is export-format
-- metadata handled at filing time, not stored here.

begin;

alter table public.practitioner_profiles
  add column address_street text,
  add column address_building text,
  add column address_postcode text,
  add column address_city text,
  add column address_country text,
  -- All-or-nothing: a partial address is never valid. `is null` / `is not null`
  -- always return a real boolean, so this can't hit the CHECK-passes-on-NULL gap
  -- that bit the tin constraint.
  add constraint practitioner_address_all_or_nothing check (
    (address_street is null and address_building is null and address_postcode is null and address_city is null and address_country is null)
    or (address_street is not null and address_building is not null and address_postcode is not null and address_city is not null and address_country is not null)
  ),
  -- Country format backstop (ISO 3166-1 alpha-2). Postcode/street/city are
  -- app-validated (lib/tax/address.ts) — postcode rules are country-specific.
  add constraint practitioner_address_country check (address_country is null or address_country ~ '^[A-Z]{2}$');

grant update (address_street, address_building, address_postcode, address_city, address_country) on public.practitioner_profiles to authenticated;

commit;
