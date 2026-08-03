-- Simplification pass: duration dropdown offers exactly 30/45/60/75/90/
-- 105/120 minutes now (was a free numeric input up to 240). Tightens
-- the existing multiple-of-15 constraint's upper bound from 240 to 120,
-- and adds an explicit lower bound of 30 — the original constraint
-- never actually had one (only `duration_minutes % 15 = 0 and <= 240`),
-- so 0 or a negative multiple of 15 was technically DB-legal even
-- though the app never produced one; closing that gap in the same
-- change since the new UI's own floor is 30 anyway.
--
-- No existing row violates either new bound (confirmed live: zero
-- services with duration_minutes > 120 as of this migration), so no
-- data sanitization step is needed this time, unlike the original
-- migration that introduced this constraint.

begin;

alter table public.services
  drop constraint services_duration_minutes_multiple_of_15;

alter table public.services
  add constraint services_duration_minutes_multiple_of_15
  check (duration_minutes % 15 = 0 and duration_minutes >= 30 and duration_minutes <= 120);

commit;
