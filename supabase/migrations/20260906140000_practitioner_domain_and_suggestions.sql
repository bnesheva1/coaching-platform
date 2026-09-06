begin;

-- Domain: the single top-level category a practitioner sits under (data/domains.json,
-- active domains only). It groups specialties — it narrows the specialty picker in
-- the profile form and drives the accent domain pill on the public profile. Nullable:
-- existing rows are backfilled below, and new profiles set it on first save (the form
-- requires it). Deliberately NOT added to the bookable gate (practitioner_bookable_flags
-- still keys profile_complete on >=1 specialty), so adding this column never flips an
-- existing practitioner un-bookable.
--
-- pending_*_suggestion: raw free text a practitioner typed when their domain/specialty
-- wasn't in the list. This is a SUGGESTION, not an automatic taxonomy change — nothing
-- is added to the JSON taxonomies here. It's stored on the practitioner's own row so
-- that once the key is added to data/*.json by hand, it's easy to find who asked and
-- apply the real tag back. Until then the profile simply has no real tag (no placeholder
-- state). An email to CONTACT_SUPPORT_EMAIL is the actual notification (see
-- sendTaxonomySuggestion); this column is the durable record.
alter table public.practitioner_profiles
  add column domain text,
  add column pending_specialty_suggestion text,
  add column pending_domain_suggestion text;

-- Shape check on domain mirrors the specialties element rule (a lowercase key, not
-- free text). pending_* are length-capped as a DB backstop to the app-layer cap +
-- sanitisation — a taxonomy name is short.
alter table public.practitioner_profiles
  add constraint practitioner_profiles_domain_shape
    check (domain is null or domain ~ '^[a-z0-9_-]{1,30}$'),
  add constraint practitioner_profiles_pending_specialty_length
    check (char_length(pending_specialty_suggestion) <= 200),
  add constraint practitioner_profiles_pending_domain_length
    check (char_length(pending_domain_suggestion) <= 200);

-- Backfill domain from existing specialties. Every specialty key belongs to exactly
-- one domain (data/domains.json), so a profile's domain is unambiguous from what it
-- already has. `&&` is array-overlap; the `domain is null` guard keeps each statement
-- idempotent and prevents a later statement from overwriting an already-set value.
update public.practitioner_profiles set domain = 'intuitive_practices'
  where domain is null and specialties && array['astrology','tarot','reiki','coffee_reading'];
update public.practitioner_profiles set domain = 'psychology'
  where domain is null and specialties && array['psychologist','art_therapist'];
update public.practitioner_profiles set domain = 'coaching'
  where domain is null and specialties && array['coaching'];

-- practitioner_profiles is column-grant-restricted (see 20260802140000): every
-- readable/writable column is named explicitly. domain is public (rendered on the
-- profile) + owner-writable. pending_* are owner-WRITABLE only — never granted SELECT
-- to anon/authenticated, because a suggestion is private review metadata (any logged-in
-- user could otherwise read every practitioner's pending text, since profiles are
-- world-readable at the row level). Admin reviews them via the service role, which
-- bypasses column grants. The suggestion action writes with a bare .update() (no
-- RETURNING/.select()), so no SELECT grant is needed for the write to land.
grant select (domain) on public.practitioner_profiles to anon, authenticated;
grant update (domain, pending_specialty_suggestion, pending_domain_suggestion)
  on public.practitioner_profiles to authenticated;

commit;
