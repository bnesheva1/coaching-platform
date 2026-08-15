-- Cron heartbeat. The daily cron (app/api/cron/send-reminders) appends one row
-- at the end of every invocation, so the admin health page can show whether the
-- cron is still running and when it last did. A stopped cron is otherwise
-- invisible, yet outcome resolution, reminders, room-close and the alert sweep
-- all depend on it.
begin;

create table public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  summary jsonb
);

-- Newest-first reads (health page reads limit 1).
create index cron_runs_ran_at_idx on public.cron_runs (ran_at desc);

-- RLS on with ZERO policies denies all anon/authenticated access. Only the
-- cron (service role) writes it and only the health page (service role) reads
-- it — same pattern as feature_flags / alerts / admin_audit_log.
alter table public.cron_runs enable row level security;

commit;
