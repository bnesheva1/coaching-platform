-- Bulk cancel-and-refund a practitioner's upcoming bookings (slice 3) — the one
-- admin action that moves real money.
begin;

-- A distinct terminal status: cancelled by the PLATFORM (admin), not by the
-- practitioner. The difference is load-bearing — it drives different client-
-- facing wording ("the platform cancelled" vs "the practitioner cancelled") and
-- keeps a platform action out of any future practitioner-reliability metric.
-- Active-booking consumers use an allow-list (status in ('pending','confirmed')
-- — busy-times, the exclusion constraint, reminders, completion, delivery,
-- video RPCs), so they exclude this value automatically; only the app-side
-- enumerations that assumed exactly two cancelled values are updated in code.
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled_by_client', 'cancelled_by_practitioner', 'cancelled_by_admin', 'completed'));

-- Per-booking client-cancellation-email idempotency marker (mirrors the
-- reminder markers). A re-run of a timed-out bulk cancel must not email a
-- client a second cancellation notice.
alter table public.bookings add column cancellation_notice_sent_at timestamptz;

-- One row per bulk-cancel operation. Lets the practitioner summary be sent
-- exactly once when the operation completes (practitioner_notified_at), a
-- timed-out run resume the SAME operation on re-run rather than fragment into
-- overlapping summaries, and the whole thing be tied together for the audit.
create table public.bulk_cancellations (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id),
  initiated_by uuid not null references auth.users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  practitioner_notified_at timestamptz
);

-- RLS on with zero policies: service-role only (the admin action), same as
-- feature_flags / alerts / cron_runs / admin_audit_log.
alter table public.bulk_cancellations enable row level security;

-- Which operation cancelled a given booking (for the once-per-op summary and
-- for forensics: "why was this cancelled" is answerable from the row alone).
alter table public.bookings add column cancellation_batch_id uuid references public.bulk_cancellations(id);

-- Structured per-booking outcomes for the audit log (the admin action records
-- a summary in new_value and the full per-booking result list here).
alter table public.admin_audit_log add column detail jsonb;

commit;
