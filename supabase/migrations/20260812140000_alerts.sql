-- Alerting system (admin dashboard, slice 3).
begin;

-- The alerts table is both the dashboard record and the dedupe store. Keyed
-- unique on (type, subject): the same condition for the same entity is one row.
-- fingerprint captures the meaningful state — an unchanged condition stays
-- quiet, a changed one re-notifies. last_notified_at null = pending the daily
-- batch (digest / batched push); stamped once notified.
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  subject text not null,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  message text not null,
  context jsonb not null default '{}',
  fingerprint text not null,
  status text not null default 'active' check (status in ('active', 'dismissed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users (id),
  unique (type, subject)
);
create index alerts_status_seen_idx on public.alerts (status, first_seen_at desc);

-- Repeated-webhook-failure detection: one row per failed delivery/verification,
-- counted over a window to tell "repeated" from "once". Inline raising counts a
-- short recent burst; the daily sweep counts the daily window as a backstop.
create table public.webhook_failures (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('stripe', 'livekit')),
  reason text,
  created_at timestamptz not null default now()
);
create index webhook_failures_source_time_idx on public.webhook_failures (source, created_at desc);

-- Both service-role only (RLS on, zero policies): the seam records/reads and
-- the admin dismiss writes, all via the service role, which bypasses RLS. No
-- client can read or forge an alert.
alter table public.alerts enable row level security;
alter table public.webhook_failures enable row level security;

commit;
