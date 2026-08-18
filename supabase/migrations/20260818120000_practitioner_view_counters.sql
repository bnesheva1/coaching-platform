-- Privacy-safe aggregate view counters for the practitioner stats dashboard.
--
-- Two metrics: 'profile_viewed' (someone landed on the public profile) and
-- 'schedule_opened' (someone expanded a service's availability — intent, the more
-- meaningful of the two). COUNTERS ONLY — no per-visitor rows, nothing that
-- identifies anyone, which is the whole point: it stays out of GDPR entirely. Do
-- NOT add a view-events table. Bucketed by ISO week and by month (Europe/Sofia
-- boundaries, the platform's market) rather than an ever-growing all-time total.
-- Deduplication per session is done client-side with a short-lived flag; this
-- table never sees a session id.
begin;

create table public.practitioner_view_counters (
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  metric text not null check (metric in ('profile_viewed', 'schedule_opened')),
  bucket text not null check (bucket in ('week', 'month')),
  period_start date not null,
  count integer not null default 0,
  primary key (practitioner_id, metric, bucket, period_start)
);

-- RLS on with NO policies: reads happen only through the service role (the stats
-- page, already gated to the owner/admin), and writes only through the definer
-- function below. There is nothing per-visitor to protect, but locking it keeps
-- the raw counts off the public API surface.
alter table public.practitioner_view_counters enable row level security;

-- Atomic increment for the current week AND month bucket. SECURITY DEFINER so an
-- anonymous profile viewer can bump the count without any table grant; it writes
-- nothing but the increment. Callable by anon + authenticated (public profiles
-- are viewed anonymously). The metric is validated so a caller can't invent one.
create function public.increment_view_counter(p_practitioner_id uuid, p_metric text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now() at time zone 'Europe/Sofia';
  v_week date := date_trunc('week', v_now)::date;
  v_month date := date_trunc('month', v_now)::date;
begin
  if p_metric not in ('profile_viewed', 'schedule_opened') then
    return;
  end if;

  insert into public.practitioner_view_counters (practitioner_id, metric, bucket, period_start, count)
  values (p_practitioner_id, p_metric, 'week', v_week, 1)
  on conflict (practitioner_id, metric, bucket, period_start)
  do update set count = public.practitioner_view_counters.count + 1;

  insert into public.practitioner_view_counters (practitioner_id, metric, bucket, period_start, count)
  values (p_practitioner_id, p_metric, 'month', v_month, 1)
  on conflict (practitioner_id, metric, bucket, period_start)
  do update set count = public.practitioner_view_counters.count + 1;
end;
$$;

grant execute on function public.increment_view_counter(uuid, text) to anon, authenticated;

commit;
