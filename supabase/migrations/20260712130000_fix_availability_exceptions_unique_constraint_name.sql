-- Follow-up fix: 20260712120000's `drop constraint if exists
-- availability_exceptions_practitioner_id_exception_date_exception_type_key`
-- silently no-op'd. Postgres truncates auto-generated identifiers over
-- 63 characters, so the constraint's real name was actually
-- `availability_exceptions_practitioner_id_exception_date_exce_key`
-- (confirmed from the live error) — the guessed, untruncated name
-- never existed, so the old blanket unique constraint was still live,
-- wrongly blocking a second non-overlapping partial-day block on an
-- already-blocked date.

begin;

alter table public.availability_exceptions
  drop constraint if exists availability_exceptions_practitioner_id_exception_date_exce_key;

commit;
