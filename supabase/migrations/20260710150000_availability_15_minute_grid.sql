-- Requires both start_time and end_time to land on a 15-minute mark
-- (:00/:15/:30/:45), not just that the gap between them is >= 15
-- minutes — e.g. 09:07-09:22 was previously accepted (exactly 15
-- minutes) despite not being "on the grid". Same defense-in-depth
-- pattern as the rest of this table: app validates
-- (availability-actions.ts), DB bounds as a backstop against a direct
-- API call.
--
-- An earlier live check via the anon key found no violations, but that
-- check couldn't see rows for practitioners without a username set
-- (RLS-gated). A direct diagnostic query found 2 violating rows for one
-- practitioner (00:53-14:57 and 00:54-08:54) — timestamps and odd
-- unaligned values point to manual UI testing before this constraint
-- (and the 15-minute step on the time inputs) existed, not real
-- intended availability. Removing them and re-adding through the now
-- grid-constrained form is safer than guessing what was actually meant
-- and rounding in place, especially since rounding could also break the
-- existing minimum-duration/end-after-start constraints depending on
-- direction.

begin;

delete from public.practitioner_availability
where (extract(hour from start_time) * 60 + extract(minute from start_time))::int % 15 <> 0
   or (extract(hour from end_time) * 60 + extract(minute from end_time))::int % 15 <> 0;

alter table public.practitioner_availability
  add constraint practitioner_availability_15_minute_grid
  check (
    (extract(hour from start_time) * 60 + extract(minute from start_time))::int % 15 = 0
    and (extract(hour from end_time) * 60 + extract(minute from end_time))::int % 15 = 0
  );

commit;
