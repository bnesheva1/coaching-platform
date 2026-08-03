-- DB-level backstop for free-text field lengths that were previously
-- only capped in server actions (MAX_*_LENGTH constants). A request
-- hitting the Supabase REST API directly with a valid session token
-- bypasses every Next.js server action entirely, so nothing at the DB
-- layer stopped an oversized write before this. Every limit below
-- matches its app-layer counterpart exactly (see the referenced
-- constant) — not tightened, so no existing row is invalidated;
-- confirmed against live data before writing this migration (max
-- observed length per column was well under its limit in every case).
--
-- length(), not char_length() — matches the existing precedent
-- (practitioner_profiles_timezone_shape in
-- 20260710130000_practitioner_availability.sql). No explicit "is null
-- or" guard needed: a CHECK constraint automatically passes when any
-- operand is NULL, so nullable columns are unaffected.

-- profiles.display_name — mirrors MAX_DISPLAY_NAME_LENGTH in
-- practitioner-dashboard/actions.ts.
alter table public.profiles
  add constraint profiles_display_name_length_check
  check (length(display_name) <= 100);

-- practitioner_profiles.headline/location/bio — mirror
-- MAX_HEADLINE_LENGTH/MAX_LOCATION_LENGTH/MAX_BIO_LENGTH in the same
-- file. username mirrors MAX_USERNAME_LENGTH in
-- lib/validation/username.ts — length only; the character-class/
-- reserved-word/profanity checks that also gate username stay
-- app-layer only, not something a CHECK constraint can express.
alter table public.practitioner_profiles
  add constraint practitioner_profiles_headline_length_check
  check (length(headline) <= 150),
  add constraint practitioner_profiles_location_length_check
  check (length(location) <= 100),
  add constraint practitioner_profiles_bio_length_check
  check (length(bio) <= 1000),
  add constraint practitioner_profiles_username_length_check
  check (length(username) <= 30);

-- services.name/description/delivery_info/phone_number — mirror
-- MAX_NAME_LENGTH/MAX_DESCRIPTION_LENGTH/MAX_DELIVERY_INFO_LENGTH/
-- MAX_PHONE_LENGTH in practitioner-dashboard/services-actions.ts.
alter table public.services
  add constraint services_name_length_check
  check (length(name) <= 100),
  add constraint services_description_length_check
  check (length(description) <= 1000),
  add constraint services_delivery_info_length_check
  check (length(delivery_info) <= 500),
  add constraint services_phone_number_length_check
  check (length(phone_number) <= 30);

-- reviews.review_text — mirrors MAX_REVIEW_TEXT_LENGTH in
-- components/bookings/review-actions.ts. reviewer_display_name is a
-- denormalized snapshot of profiles.display_name at review-creation
-- time (see 20260716110000_reviews_add_reviewer_display_name_internal.sql)
-- — never independently typed, but a direct API insert to this table
-- could still write an oversized value here even with the source
-- column locked down, so it gets the same 100-char limit as its source.
alter table public.reviews
  add constraint reviews_review_text_length_check
  check (length(review_text) <= 1000),
  add constraint reviews_reviewer_display_name_length_check
  check (length(reviewer_display_name) <= 100);

-- bookings.service_name/delivery_info/phone_number are denormalized
-- snapshots copied from services at booking time (see
-- 20260803100000_bookings_snapshot_price_and_delivery_info.sql and
-- 20260802091500_bookings_delivery_snapshot.sql) — same reasoning as
-- reviews.reviewer_display_name above: the source columns being capped
-- doesn't stop a direct insert into bookings itself from writing an
-- oversized value, so these get the matching limit from their source
-- column. meeting_link is deliberately excluded — it's a reserved,
-- not-yet-populated column with no app-layer cap anywhere to mirror
-- (see project memory on the services-form simplification).
alter table public.bookings
  add constraint bookings_service_name_length_check
  check (length(service_name) <= 100),
  add constraint bookings_delivery_info_length_check
  check (length(delivery_info) <= 500),
  add constraint bookings_phone_number_length_check
  check (length(phone_number) <= 30);
