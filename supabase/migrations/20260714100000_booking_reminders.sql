-- Epic 6, final sub-slice: 24h pre-session reminder emails, sent by a
-- Vercel Cron job (no logged-in user behind it, unlike every other
-- email in this app) via the service_role credential.
--
-- Two independent markers, not one shared flag: a booking where the
-- client's send succeeds but the practitioner's fails must retry ONLY
-- the practitioner next run, never re-send to the client. A single
-- shared "reminded" flag set only once both succeed would force a
-- retry of BOTH on partial failure, duplicating the one that already
-- went out.

begin;

alter table public.bookings
  add column client_reminder_sent_at timestamptz,
  add column practitioner_reminder_sent_at timestamptz;

-- No column-level grant change needed: the existing UPDATE grant on
-- bookings (20260712100000_booking_cancellation.sql) already restricts
-- `authenticated` to the `status` column only, so these two new
-- columns are automatically excluded from what any normal user can
-- touch. Only the service-role client (used exclusively in
-- lib/email/reminders.ts) ever sets them, and service_role bypasses
-- grants entirely.

-- Unlike every other RPC in this app, this one has NO auth.uid() check
-- — none would be meaningful for a multi-booking batch query ("give me
-- every booking that's due," not "give me the one booking I'm a party
-- to"). Access is gated the other way: granted to service_role only,
-- not authenticated or anon, so it's structurally uncallable by any
-- normal logged-in user or anonymous visitor regardless of what's
-- inside it — enforced by Postgres before the function body ever runs.
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
    s.name, b.start_utc, b.end_utc
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
