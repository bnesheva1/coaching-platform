-- Epic 6, slice 1 follow-up: profiles.email (added in
-- 20260713100000_profiles_email_locale_timezone.sql) is only ever set
-- by handle_new_user() at signup — anyone who signed up BEFORE that
-- migration has email = NULL forever, since no other code path
-- populates it. Confirmed live: a pre-existing test practitioner's
-- booking-confirmation/cancellation-notice emails both failed with
-- "The `to` field must be a `string`" — a null recipient, not a config
-- or provider problem. One-time, idempotent backfill from the
-- authoritative source (auth.users.email), only touching rows that are
-- still null so it's safe to run more than once.

begin;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

commit;
