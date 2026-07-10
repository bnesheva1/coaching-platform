-- Product decision: a practitioner's minimum booking notice must be at
-- least 1 hour (no notice requirement doesn't make sense operationally)
-- and at most 48 hours (previously bounded only by generateSlots' own
-- 14-day window, which was far looser than actually useful).

begin;

-- Defensive: clamp any existing value that would violate the tighter
-- bound before swapping the constraint — no real practitioners are
-- expected to have set anything outside [1, 48] yet, but this is the
-- same safe pattern used when the availability grid constraint was
-- tightened (20260710150000_availability_15_minute_grid.sql).
update public.practitioner_profiles
set min_notice_hours = least(greatest(min_notice_hours, 1), 48)
where min_notice_hours < 1 or min_notice_hours > 48;

alter table public.practitioner_profiles
  drop constraint if exists practitioner_profiles_min_notice_hours_check;
alter table public.practitioner_profiles
  add constraint practitioner_profiles_min_notice_hours_check
  check (min_notice_hours between 1 and 48);

commit;
