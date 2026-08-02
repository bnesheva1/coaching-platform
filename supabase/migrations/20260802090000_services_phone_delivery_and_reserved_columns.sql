-- Foundational slice for video/in-person-location/browse-filtering work
-- to build on: extends the existing delivery_type/delivery_info system
-- (Epic 7) with a third delivery type (phone) and three new reserved
-- columns for work that isn't built yet. delivery_info itself is
-- UNCHANGED — it stays the current free-text "how to join" field for
-- online/in-person; the new columns are additive, not a replacement.

begin;

-- Dynamically finds and drops whatever the existing delivery_type CHECK
-- constraint is actually named, rather than guessing — a wrong guessed
-- name in a plain `drop constraint if exists <name>` silently no-ops
-- (confirmed painful precedent on this project: a truncated/mismatched
-- constraint name once did exactly this with no error), which here
-- would leave the OLD 2-value constraint enforcing alongside a new one,
-- silently rejecting every 'phone' insert despite the migration
-- reporting success.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'services'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%delivery_type%'
  loop
    execute format('alter table public.services drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.services
  add constraint services_delivery_type_check
  check (delivery_type in ('online', 'in_person', 'phone'));

-- Safe with no backfill: confirmed live against production data first
-- (28 services, 0 with a null delivery_type — every active service
-- already satisfies the existing services_delivery_info_required_if_active
-- constraint, which already implies delivery_type is not null for any
-- active row; the few historically-possible inactive+null rows don't
-- exist today either).
alter table public.services
  alter column delivery_type set not null;

alter table public.services
  -- Only used when delivery_type = 'phone'. Same sensitivity as
  -- delivery_info (a practitioner's personal contact info) — excluded
  -- from the general column grant below, same reasoning.
  add column phone_number text,
  -- Reserved for a future custom link override — auto-generated
  -- per-booking links (LiveKit) are what actually power online
  -- sessions once that slice lands; this column has no reader/writer
  -- yet. Excluded from the general grant proactively (an unused column
  -- today doesn't mean a public one should ever have been the default).
  add column meeting_link text,
  -- Reserved for a future per-service location override (structured
  -- address: street/city/postcode/country/lat/lng — none of that shape
  -- exists yet, deliberately not designed here). NULL means "use the
  -- practitioner profile's own location" once that's built. Reserve
  -- only, per the request — no reader/writer in this slice.
  add column location_override jsonb;

-- Epic 7's services_delivery_info_required_if_active only knew about
-- delivery_info — a 'phone' service satisfies neither branch of it as
-- originally written (delivery_info can legitimately be empty for
-- phone), so it's replaced rather than left in place. Explicitly named
-- in that migration, so no name-guessing risk dropping it (unlike the
-- delivery_type CHECK above). Same NOT VALID treatment as the original:
-- enforced going forward only, doesn't require fixing any existing
-- incomplete row retroactively.
alter table public.services drop constraint if exists services_delivery_info_required_if_active;
alter table public.services
  add constraint services_delivery_contact_required_if_active
  check (
    not is_active
    or (delivery_type in ('online', 'in_person') and delivery_info is not null and delivery_info <> '')
    or (delivery_type = 'phone' and phone_number is not null and phone_number <> '')
  )
  not valid;

-- No grant statement touches phone_number/meeting_link/location_override
-- at all — column-level grants aren't inherited by new columns the way
-- table-level grants are, so simply never adding them to the existing
-- `grant select (...)` list from the Epic 7 migration is what keeps them
-- excluded. delivery_type itself needs no grant change either (already
-- public, unchanged).

-- Widens the existing owner-only RPC (DROP FUNCTION required — Postgres
-- won't let CREATE OR REPLACE change a RETURNS TABLE column list) so the
-- service edit form can pre-fill phone_number, same access pattern
-- already established for delivery_info. meeting_link/location_override
-- are deliberately NOT added here — no UI consumes them yet, and
-- widening this RPC again later (when they do have a consumer) is a
-- one-line change, not a redesign.
drop function if exists public.get_my_services_delivery_info();
create function public.get_my_services_delivery_info()
returns table (service_id uuid, delivery_info text, phone_number text)
language sql
security definer
set search_path = public
stable
as $$
  select id, delivery_info, phone_number
  from public.services
  where practitioner_id = auth.uid()
$$;

grant execute on function public.get_my_services_delivery_info() to authenticated;

commit;
