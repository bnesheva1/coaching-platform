-- LiveKit video integration, slice 1 of N: schema + state only. No
-- booking-flow wiring, no cron wiring, no UI — those are later slices.
-- Everything here is provider-independent; nothing in this file (or the
-- companion RPC migration) mentions LiveKit. The provider lives entirely
-- behind the lib/video/ seam.

begin;

-- practitioner_profiles.emergency_contact: an optional out-of-band way
-- for a client to reach the practitioner if the video connection fails
-- mid-session (see the fallback flow in lib/video/). Sensitive personal
-- data (a phone number), so it is DELIBERATELY NOT added to the client
-- column grant in 20260802140000 — a new column is invisible to the
-- explicit grant list by default, which is exactly what we want here.
-- It is readable only via reveal_booking_emergency_contact() (companion
-- migration), never a plain select(). Do not "helpfully" add it to the
-- grant list.
alter table public.practitioner_profiles
  add column emergency_contact text;

alter table public.practitioner_profiles
  add constraint practitioner_profiles_emergency_contact_length_check
  check (length(emergency_contact) <= 100);

-- video_sessions: one row per online booking — our own durable state for
-- the video session, provider-independent. The provider room itself is
-- created lazily on first join (room_created_at stamps when); this row
-- exists from booking time so timing/capacity/attendance logic never
-- depends on whether the provider room has been instantiated yet.
create table public.video_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  -- = booking_id::text, set server-side. Kept as an explicit column
  -- rather than derived so a future provider that names rooms
  -- differently doesn't force a schema change.
  provider_room_name text not null,
  -- Filled from the room_opened event / lazy create once the provider
  -- room actually exists; null until then.
  provider_room_sid text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'open', 'closed', 'expired')),
  -- Snapshotted from booking + config at creation (start_utc minus
  -- EARLY_JOIN_MINUTES, end_utc plus POST_SESSION_GRACE_MINUTES) so a
  -- later config change can't retroactively move an already-scheduled
  -- window. Tokens are minted only inside [opens_at, closes_at]; closes_at
  -- is also the token's own expiry.
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  -- Additive concurrency accounting: 2 for a 1:1 session (one connection
  -- unit per participant). Group sessions later just carry a higher value.
  connection_units smallint not null default 2,
  room_created_at timestamptz,
  -- Resolved post-close by lib/video/attendance.ts from the event log.
  client_attended boolean,
  practitioner_attended boolean,
  -- 'manual_review' when the emergency-contact fallback was used: a phone
  -- fallback can't be attendance-verified from join events, so we never
  -- auto-refund on absent joins in that case (see fallback_used).
  outcome text
    check (outcome in ('both_attended', 'client_no_show', 'practitioner_no_show', 'neither_attended', 'manual_review')),
  -- Practitioner may pre-revoke the emergency-contact reveal for a
  -- specific booking (default: revealable if a contact is set at all).
  emergency_contact_revoked boolean not null default false,
  -- Set true the moment a client actually reveals the fallback contact —
  -- flips no-show resolution to manual review rather than auto-refund.
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Drives the reconcile sweep's "overdue but still open" scan.
create index video_sessions_status_closes_at_idx on public.video_sessions (status, closes_at);
-- Powers the platform-wide concurrency-cap overlap query.
create index video_sessions_window_idx on public.video_sessions (opens_at, closes_at);

-- video_attendance_events: append-only, OUR event shape — never a mirror
-- of the provider payload. normaliseEvent() maps a provider event to one
-- of these four types and nothing else; the no-show rules read only this
-- table. Provider dedup via provider_event_id (webhook redelivery is a
-- clean no-op). No raw-payload column on purpose: it would quietly become
-- the mirror this table exists to avoid.
create table public.video_attendance_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  video_session_id uuid not null references public.video_sessions(id) on delete cascade,
  event_type text not null
    check (event_type in ('room_opened', 'participant_joined', 'participant_left', 'room_closed')),
  -- profiles.id of the participant (= the identity we set at token issue).
  -- Null for room-level events. ON DELETE SET NULL so a GDPR account
  -- anonymisation doesn't cascade-delete the attendance record itself.
  participant_id uuid references public.profiles(id) on delete set null,
  participant_role text check (participant_role in ('client', 'practitioner')),
  occurred_at timestamptz not null,
  provider_event_id text not null unique,
  created_at timestamptz not null default now()
);

create index video_attendance_events_session_idx on public.video_attendance_events (video_session_id);

-- video_fallback_reveals: every emergency-contact reveal, logged. One row
-- per reveal action by a client during an active session window.
create table public.video_fallback_reveals (
  id uuid primary key default gen_random_uuid(),
  video_session_id uuid not null references public.video_sessions(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  revealed_to uuid not null references public.profiles(id) on delete cascade,
  revealed_at timestamptz not null default now()
);

create index video_fallback_reveals_session_idx on public.video_fallback_reveals (video_session_id);

-- RLS: all three tables locked to non-service-role entirely. Writes are
-- service-role only (webhook/cron). Client reads go through the SECURITY
-- DEFINER RPCs in the companion migration, each with its own ownership +
-- eligibility check — so no broad client SELECT is granted here. RLS
-- enabled with no policies means authenticated/anon can't read a row even
-- if a stray grant existed; service_role bypasses RLS for the legitimate
-- write/read paths.
revoke all on public.video_sessions from anon, authenticated;
revoke all on public.video_attendance_events from anon, authenticated;
revoke all on public.video_fallback_reveals from anon, authenticated;

alter table public.video_sessions enable row level security;
alter table public.video_attendance_events enable row level security;
alter table public.video_fallback_reveals enable row level security;

commit;
