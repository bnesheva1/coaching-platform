-- Sibling of 20260804120000_booking_email_context_use_snapshot.sql:
-- get_reminder_batch has the identical bug. It reads delivery_type/
-- delivery_info live from services (via the join) instead of the
-- booking's own frozen snapshot, and never reads phone_number/
-- meeting_link at all — so a phone booking's 24h reminder email has no
-- phone number, and every delivery type is exposed to a practitioner's
-- later service edit silently changing what an already-sent-for
-- reminder shows. Same fix: read delivery_type/delivery_info/
-- phone_number/meeting_link from bookings, not services.
--
-- service_name is deliberately left as the live s.name join, same as
-- the confirmation-email fix — out of scope here too (see that
-- migration's comment for why).

begin;

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
  service_phone_number text,
  service_meeting_link text,
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
    s.name, b.delivery_type, b.delivery_info, b.phone_number, b.meeting_link,
    b.start_utc, b.end_utc
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

revoke all on function public.get_reminder_batch(timestamptz, timestamptz, int) from public, authenticated, anon;
grant execute on function public.get_reminder_batch(timestamptz, timestamptz, int) to service_role;

commit;
