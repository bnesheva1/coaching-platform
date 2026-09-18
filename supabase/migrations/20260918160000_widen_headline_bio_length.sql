-- Widen the free-text length caps for practitioner_profiles.headline and .bio,
-- keeping the DB CHECK backstop in sync with the app-layer MAX_*_LENGTH
-- constants (practitioner-dashboard/actions.ts + EditableIdentity.tsx /
-- EditableAbout.tsx):
--   headline 150 -> 350   (now a "short description in large text", not a title)
--   bio      1000 -> 3000
-- These only RELAX the limits, so no existing row can be invalidated. The
-- constraints were added in 20260803160000_text_length_check_constraints.sql;
-- drop-and-re-add is the only way to change a CHECK's expression. length()
-- (not char_length()) matches the original precedent; a CHECK passes on NULL,
-- so nullable columns are unaffected.

begin;

alter table public.practitioner_profiles
  drop constraint practitioner_profiles_headline_length_check,
  add constraint practitioner_profiles_headline_length_check
    check (length(headline) <= 350);

alter table public.practitioner_profiles
  drop constraint practitioner_profiles_bio_length_check,
  add constraint practitioner_profiles_bio_length_check
    check (length(bio) <= 3000);

commit;
