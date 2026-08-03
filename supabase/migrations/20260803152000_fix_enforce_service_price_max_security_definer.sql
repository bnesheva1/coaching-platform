-- Urgent fix: enforce_service_price_max() (from
-- 20260803151500_practitioner_max_price_override.sql) was created
-- without SECURITY DEFINER, so it runs as the INVOKING role — the
-- practitioner's own `authenticated` role, not an elevated one. Its
-- body selects practitioner_profiles.max_price_cents, but that column
-- is deliberately excluded from the general column grant (same
-- migration's own comment: admin-only, not meant to be readable even
-- by the row's own owner via a plain select). The result: the trigger
-- itself gets "permission denied for table practitioner_profiles" on
-- every single insert/update of a service's price_cents, for every
-- real practitioner — this broke saving ANY service, not just the
-- override case, the moment the previous migration was applied.
--
-- SECURITY DEFINER makes the function run with the privileges of its
-- owner (elevated, bypassing the column grant) regardless of who
-- invokes it — the standard fix for exactly this "needs to read
-- something the caller structurally can't, but only to compute a
-- pass/fail result" shape, same reasoning as every other SECURITY
-- DEFINER function in this codebase (get_my_connect_status,
-- get_my_services_delivery_info, etc.). CREATE OR REPLACE is enough
-- here (unlike a RETURNS TABLE function, a trigger function's signature
-- isn't changing, just its body/attributes) — no DROP needed.

begin;

create or replace function public.enforce_service_price_max()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_max integer;
begin
  select coalesce(max_price_cents, 50000) into v_effective_max
  from public.practitioner_profiles
  where id = new.practitioner_id;

  if new.price_cents > v_effective_max then
    raise exception 'price_cents % exceeds practitioner %''s maximum of %', new.price_cents, new.practitioner_id, v_effective_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

commit;
