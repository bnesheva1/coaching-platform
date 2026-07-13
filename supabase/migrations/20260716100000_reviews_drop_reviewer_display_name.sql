-- Simplifies review pseudonymity: instead of showing a defensively-
-- extracted first name (or a fallback when none was safe to show), a
-- review author is now shown as a constant "Verified user" to BOTH the
-- public and the reviewed practitioner, always. This removes the need
-- to store or derive any name at all — reviewer_display_name is no
-- longer written or read anywhere in the app, so the column is dropped
-- outright rather than left in place unused.
--
-- Dropping a column automatically drops any column-level GRANT that
-- referenced it — no separate REVOKE needed.

begin;

alter table public.reviews drop column reviewer_display_name;

commit;
