-- Epic 7: session delivery info. services has no online/in-person
-- distinction and no column-level SELECT grant at all today — this
-- migration builds both from scratch, since delivery_info (a meeting
-- link or a home/office address) must never be publicly readable the
-- way name/price/description already are.

begin;

alter table public.services
  add column delivery_type text check (delivery_type in ('online', 'in_person')),
  add column delivery_info text;

-- Enforced going forward only (NOT VALID skips checking existing
-- rows) — a plain CHECK would immediately break on services created
-- before this column existed. Every service that's active FROM NOW ON
-- is guaranteed to have delivery info, at the DB level, not just the
-- app's own validation; existing incomplete services keep working
-- (nudged in the dashboard UI, not force-fixed here).
alter table public.services
  add constraint services_delivery_info_required_if_active
  check (
    not is_active
    or (delivery_type is not null and delivery_info is not null and delivery_info <> '')
  )
  not valid;

-- delivery_type stays public — a client browsing genuinely benefits
-- from knowing "online vs in-person" before booking, and it reveals
-- nothing sensitive. delivery_info is deliberately excluded from this
-- grant entirely: nobody can read it via a plain .select(), including
-- the owning practitioner's own row — the three functions below are
-- the ONLY way it's ever readable, each with its own check scoped to
-- who legitimately needs it.
revoke select on public.services from anon, authenticated;
grant select (
  id, practitioner_id, name, description, duration_minutes,
  price_cents, currency, is_active, created_at, delivery_type
) on public.services to anon, authenticated;

-- 1. The owning practitioner, editing their own services — needs every
-- one of their own services' delivery info to pre-fill the edit form.
create function public.get_my_services_delivery_info()
returns table (service_id uuid, delivery_info text)
language sql
security definer
set search_path = public
stable
as $$
  select id, delivery_info
  from public.services
  where practitioner_id = auth.uid()
$$;

grant execute on function public.get_my_services_delivery_info() to authenticated;

-- 2. A client, for services they have an ACTIVE booking for — the
-- actual adversarial boundary: a cancelled booking (status not in
-- pending/confirmed) must not qualify, same "active" definition used
-- everywhere else in this schema (the exclusion constraint, the
-- cancellation policies).
create function public.get_my_active_booking_delivery_info()
returns table (service_id uuid, delivery_info text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct s.id, s.delivery_info
  from public.services s
  join public.bookings b on b.service_id = s.id
  where b.client_id = auth.uid()
    and b.status in ('pending', 'confirmed')
$$;

grant execute on function public.get_my_active_booking_delivery_info() to authenticated;

-- 3. Email composition — both functions already join services and
-- already carry the right ownership check; extending each with the two
-- new fields is a one-line addition, reusing everything else unchanged.
-- Postgres won't let CREATE OR REPLACE change a RETURNS TABLE column
-- list (even just adding columns) — an explicit DROP is required first.
drop function if exists public.get_booking_email_context(uuid);
create function public.get_booking_email_context(target_booking_id uuid)
returns table (
  client_email text,
  client_display_name text,
  client_locale text,
  client_timezone text,
  practitioner_email text,
  practitioner_display_name text,
  practitioner_locale text,
  practitioner_timezone text,
  service_name text,
  service_delivery_type text,
  service_delivery_info text,
  start_utc timestamptz,
  end_utc timestamptz,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cp.email, cp.display_name, cp.locale, cp.timezone,
    pp.email, pp.display_name, pp.locale, ppr.timezone,
    s.name, s.delivery_type, s.delivery_info, b.start_utc, b.end_utc, b.status
  from public.bookings b
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  join public.services s on s.id = b.service_id
  where b.id = target_booking_id
    and auth.uid() in (b.client_id, b.practitioner_id);
$$;

-- Same reason as get_booking_email_context above.
drop function if exists public.get_reminder_batch(timestamptz, timestamptz, int);
create function public.get_reminder_batch(
  window_start timestamptz,
  window_end timestamptz,
  batch_limit int
)
returns table (
  booking_id uuid,
  client_reminder_sent_at timestamptz,
  practitioner_reminder_sent_at timestamptz,
  client_email text,
  client_display_name text,
  client_locale text,
  client_timezone text,
  practitioner_email text,
  practitioner_display_name text,
  practitioner_locale text,
  practitioner_timezone text,
  service_name text,
  service_delivery_type text,
  service_delivery_info text,
  start_utc timestamptz,
  end_utc timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id,
    b.client_reminder_sent_at, b.practitioner_reminder_sent_at,
    cp.email, cp.display_name, cp.locale, cp.timezone,
    pp.email, pp.display_name, pp.locale, ppr.timezone,
    s.name, s.delivery_type, s.delivery_info, b.start_utc, b.end_utc
  from public.bookings b
  join public.profiles cp on cp.id = b.client_id
  join public.profiles pp on pp.id = b.practitioner_id
  join public.practitioner_profiles ppr on ppr.id = b.practitioner_id
  join public.services s on s.id = b.service_id
  where b.status in ('pending', 'confirmed')
    and b.start_utc between window_start and window_end
    and (b.client_reminder_sent_at is null or b.practitioner_reminder_sent_at is null)
  order by b.start_utc
  limit batch_limit
$$;

-- Required, not just defensive, now that both functions above were
-- dropped and recreated: DROP FUNCTION removes any existing grants on
-- it along with the function itself, so these must be re-stated
-- explicitly or both RPCs would be uncallable by anyone.
grant execute on function public.get_booking_email_context(uuid) to authenticated;
revoke all on function public.get_reminder_batch(timestamptz, timestamptz, int) from public, authenticated, anon;
grant execute on function public.get_reminder_batch(timestamptz, timestamptz, int) to service_role;

commit;
