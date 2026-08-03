-- Simplification pass, part 2b: a €500 platform-default maximum price,
-- with a per-practitioner override (nullable — null means "use the
-- €500 default"). No UI yet; set directly on the row until an admin
-- control exists.
--
-- A plain CHECK constraint on services.price_cents can't express this:
-- Postgres CHECK constraints are single-row, single-table expressions
-- only (no subqueries, no cross-table lookups), so there's no way for
-- one to look up the owning practitioner's own max_price_cents. A
-- BEFORE INSERT OR UPDATE trigger is the standard way to get an
-- equivalent hard DB-level guarantee across two tables — same
-- enforcement strength as a CHECK constraint (a violation still aborts
-- the write with an error), just implemented as a trigger because a
-- literal CHECK constraint structurally cannot do this.

begin;

alter table public.practitioner_profiles
  add column max_price_cents integer;

alter table public.practitioner_profiles
  add constraint practitioner_profiles_max_price_cents_sane
  check (max_price_cents is null or max_price_cents >= 2000);

-- Not added to the general select/update grant from
-- 20260802140000_practitioner_connect_status_and_grants.sql — this is
-- an admin-set business rule about a practitioner, not something that
-- needs to be publicly readable (or client-writable at all; no UI
-- writes it, only a future admin path will). A narrow RPC, same shape
-- as get_my_connect_status()/get_my_services_delivery_info(), is how
-- the practitioner's own server actions read their own override to
-- validate against it before ever reaching this trigger.
create function public.get_my_max_price_cents()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select max_price_cents from public.practitioner_profiles where id = auth.uid()
$$;

grant execute on function public.get_my_max_price_cents() to authenticated;

create function public.enforce_service_price_max()
returns trigger
language plpgsql
as $$
declare
  v_effective_max integer;
begin
  select coalesce(max_price_cents, 50000) into v_effective_max
  from public.practitioner_profiles
  where id = new.practitioner_id;

  if new.price_cents > v_effective_max then
    -- 23514 = check_violation — same SQLSTATE a real CHECK constraint
    -- failure would raise, so this reads identically to one from the
    -- caller's side (including to any future generic constraint-
    -- violation handling in the app layer).
    raise exception 'price_cents % exceeds practitioner %''s maximum of %', new.price_cents, new.practitioner_id, v_effective_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger services_price_max_check
  before insert or update of price_cents on public.services
  for each row
  execute function public.enforce_service_price_max();

commit;
