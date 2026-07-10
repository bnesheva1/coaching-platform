-- Duration hygiene for services: must be a positive multiple of 15
-- minutes, capped at 240 (4 hours) — same app-validates/DB-bounds
-- pattern already used for practitioner_profiles.specialties. The app's
-- own validation (parseServiceForm in services-actions.ts) currently
-- only checks "positive integer," so an off-grid value like 37 or 50
-- minutes was always possible through the real UI, not just a
-- direct-API bypass — this migration both adds the DB-level guarantee
-- and the app gets tightened in the same change.
--
-- All currently-visible active services are 30 minutes (confirmed via
-- live query), but RLS limits what's checkable via the anon key —
-- hidden/inactive services on other accounts aren't visible that way.
-- Rather than assume, sanitize any non-compliant existing row first
-- (round up to the nearest valid multiple of 15, capped at 240) so the
-- ALTER TABLE can't fail on data this check couldn't see.

begin;

update public.services
set duration_minutes = least(240, greatest(15, (ceil(duration_minutes / 15.0) * 15)::integer))
where duration_minutes <= 0
   or duration_minutes % 15 <> 0
   or duration_minutes > 240;

alter table public.services
  add constraint services_duration_minutes_multiple_of_15
  check (duration_minutes % 15 = 0 and duration_minutes <= 240);

commit;
