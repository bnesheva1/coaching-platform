-- Epic 5: partial-day (time-range) availability blocking. Extends
-- availability_exceptions rather than introducing a parallel system —
-- this is exactly the extension the table's own original comment
-- anticipated. NULL on both start_time/end_time keeps meaning
-- "whole-date block" (unchanged); both set means "block just this
-- range on this date."

begin;

alter table public.availability_exceptions
  add column start_time time,
  add column end_time time;

alter table public.availability_exceptions
  add constraint availability_exceptions_times_both_or_neither
  check ((start_time is null) = (end_time is null));

alter table public.availability_exceptions
  add constraint availability_exceptions_time_range_valid
  check (start_time is null or end_time > start_time);

-- Same 15-minute-grid pattern as
-- practitioner_availability_15_minute_grid, NULL-tolerant.
alter table public.availability_exceptions
  add constraint availability_exceptions_15_minute_grid
  check (
    start_time is null or (
      (extract(hour from start_time) * 60 + extract(minute from start_time))::int % 15 = 0
      and (extract(hour from end_time) * 60 + extract(minute from end_time))::int % 15 = 0
    )
  );

-- The original blanket unique(practitioner_id, exception_date,
-- exception_type) would wrongly block a SECOND partial-day range on
-- the same date (e.g. 09:00-10:00 AND 14:00-16:00 on the same day is
-- legitimate). Narrow it to whole-date rows only, where "one block per
-- date" is still the correct, meaningful rule.
alter table public.availability_exceptions
  drop constraint if exists availability_exceptions_practitioner_id_exception_date_exception_type_key;
create unique index availability_exceptions_whole_date_unique
  on public.availability_exceptions (practitioner_id, exception_date, exception_type)
  where start_time is null;

-- No RLS policy changes: all three existing policies gate purely on
-- auth.uid() = practitioner_id (plus, for select, the
-- public-discoverable-practitioner clause) and never reference
-- start_time/end_time — ownership enforcement is completely orthogonal
-- to whether a row is whole-date or partial-day. The CHECK constraints
-- above are what reject a malformed range, independent of who's
-- inserting it.

commit;
