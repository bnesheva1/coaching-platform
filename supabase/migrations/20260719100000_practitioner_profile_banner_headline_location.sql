-- New profile fields for the redesigned practitioner profile page: a
-- banner image, a short headline, and a location string. Public like
-- bio/avatar_url already are — the existing "Anyone can view practitioner
-- profiles" select policy on this table already covers any new column,
-- so no RLS change is needed. No CHECK constraints, matching bio's own
-- precedent (length is validated at the app layer only).
alter table public.practitioner_profiles
  add column banner_url text,
  add column headline text,
  add column location text;
