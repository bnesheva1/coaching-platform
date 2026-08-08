-- Richer per-session "what actually happened" data for the client's past
-- sessions, superseding get_my_client_past_session_meta (kept in place;
-- the dashboard now calls this one). Everything here reads a column that's
-- grant-excluded from clients (video_sessions.*, video_attendance_events,
-- reviews.booking_id, payments), so it goes through one narrow SECURITY
-- DEFINER RPC scoped to the caller's own bookings.
--
-- Returns a row for any of the client's bookings that has a video session,
-- a payment, or a review — i.e. anything with more to say than the booking
-- snapshot. Attendance is summarised (first join per role + the connected
-- span) rather than returning the full event log.
create or replace function public.get_my_client_past_session_details()
returns table (
  booking_id uuid,
  outcome text,
  review_rating smallint,
  refunded boolean,
  refund_amount_cents integer,
  refund_currency text,
  payment_status text,
  has_video_session boolean,
  room_created boolean,
  fallback_revealed boolean,
  client_joined_at timestamptz,
  practitioner_joined_at timestamptz,
  connected_from timestamptz,
  connected_to timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    vs.outcome,
    r.rating,
    coalesce(pay.status = 'refunded', false),
    case when pay.status = 'refunded' then pay.amount_cents end,
    pay.currency,
    pay.status,
    (vs.id is not null),
    (vs.room_created_at is not null),
    coalesce(vs.fallback_used, false),
    ev.client_joined_at,
    ev.practitioner_joined_at,
    ev.connected_from,
    ev.connected_to
  from public.bookings b
  left join public.reviews r on r.booking_id = b.id
  left join lateral (
    select v.id, v.outcome, v.room_created_at, v.fallback_used
    from public.video_sessions v
    where v.booking_id = b.id
    order by v.created_at desc
    limit 1
  ) vs on true
  left join lateral (
    select p.status, p.amount_cents, p.currency
    from public.payments p
    where p.booking_id = b.id
    order by (p.status = 'refunded') desc, p.created_at desc
    limit 1
  ) pay on true
  left join lateral (
    select
      min(e.occurred_at) filter (where e.event_type = 'participant_joined' and e.participant_role = 'client') as client_joined_at,
      min(e.occurred_at) filter (where e.event_type = 'participant_joined' and e.participant_role = 'practitioner') as practitioner_joined_at,
      min(e.occurred_at) filter (where e.event_type = 'participant_joined') as connected_from,
      max(e.occurred_at) filter (where e.event_type = 'participant_left') as connected_to
    from public.video_attendance_events e
    where e.video_session_id = vs.id
  ) ev on true
  where b.client_id = auth.uid()
    and (vs.id is not null or r.rating is not null or pay.status is not null);
$$;

revoke all on function public.get_my_client_past_session_details() from public, anon;
grant execute on function public.get_my_client_past_session_details() to authenticated;
