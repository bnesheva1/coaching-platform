-- Immediate booking, slice 1: presence + the request/confirm handshake.
-- Gated in app code behind IMMEDIATE_BOOKING_ENABLED; these objects exist but
-- nothing reaches them while the flag is off.
begin;

-- ── Presence ────────────────────────────────────────────────────────────────
-- "Available now" is DECLARED here but only TRUSTED when backed by a fresh
-- heartbeat from an open tab (see is_practitioner_available_now). A closed tab
-- stops beating and the practitioner reads as offline at query time — no sweep
-- needed, and always failing toward "offline".
create table public.immediate_presence (
  practitioner_id uuid primary key references auth.users(id) on delete cascade,
  available_now boolean not null default false,
  last_heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.immediate_presence enable row level security;
-- A practitioner may read their own presence row; all WRITES go through the
-- service-role toggle/heartbeat actions (no client write policy).
create policy "own presence read" on public.immediate_presence
  for select to authenticated using (auth.uid() = practitioner_id);

-- Derived availability: declared AND heartbeat within the staleness window.
-- Public-safe boolean, never exposes the raw heartbeat. The 40s window must stay
-- in sync with lib/immediate/config.ts (TICK 10s → ~4 missed ticks).
create function public.is_practitioner_available_now(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select available_now and last_heartbeat_at > now() - interval '40 seconds'
     from public.immediate_presence
     where practitioner_id = target),
    false);
$$;
grant execute on function public.is_practitioner_available_now(uuid) to anon, authenticated;

-- ── The request/confirm handshake ───────────────────────────────────────────
create table public.immediate_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  -- pending -> confirmed | declined | lapsed | superseded (terminal all four).
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'lapsed', 'superseded')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  -- The real projected session window, computed at CONFIRM (not at request time).
  projected_start_at timestamptz,
  projected_end_at timestamptz
);
alter table public.immediate_requests enable row level security;
-- Each party may read the requests they're in; writes go through the
-- service-role handshake actions (create/confirm/decline), never a client write.
create policy "client reads own requests" on public.immediate_requests
  for select to authenticated using (auth.uid() = client_id);
create policy "practitioner reads incoming requests" on public.immediate_requests
  for select to authenticated using (auth.uid() = practitioner_id);

-- At most one live (pending) request per client→practitioner pair — anti-spam
-- and idempotency, so a double-tap can't open two.
create unique index immediate_requests_one_live
  on public.immediate_requests (client_id, practitioner_id)
  where status = 'pending';

-- The practitioner's pending-inbox lookup (the ~10s tick).
create index immediate_requests_inbox
  on public.immediate_requests (practitioner_id, status, requested_at desc);

commit;
