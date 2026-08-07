-- Client past-sessions view needs three things per booking that a plain
-- .select() can't reach: the video session OUTCOME (video_sessions.* is
-- grant-excluded from clients), the client's own review RATING (reviews.
-- booking_id is grant-excluded — the pseudonymity mechanism, see
-- 20260712160000_reviews.sql), and REFUND status/amount (payments has no
-- authenticated table grant). One narrow SECURITY DEFINER RPC, scoped to
-- the caller's own bookings and batched (one call for all bookings) —
-- same shape/precedent as get_my_reviewed_booking_ids, which this
-- supersedes for the client dashboard.
--
-- Returns a row only for bookings that actually have something extra to
-- show (an outcome, a review, or a refund); everything else the client
-- dashboard already knows from its plain bookings select.
create or replace function public.get_my_client_past_session_meta()
returns table (
  booking_id uuid,
  outcome text,
  review_rating smallint,
  refunded boolean,
  refund_amount_cents integer,
  refund_currency text
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
    pay.currency
  from public.bookings b
  -- reviews.booking_id is UNIQUE, so at most one row per booking.
  left join public.reviews r on r.booking_id = b.id
  -- Laterals guard against the (unlikely) multiple-rows-per-booking case
  -- for video_sessions/payments — pick the resolved/refunded one.
  left join lateral (
    select v.outcome
    from public.video_sessions v
    where v.booking_id = b.id
    order by (v.outcome is not null) desc, v.created_at desc
    limit 1
  ) vs on true
  left join lateral (
    select p.status, p.amount_cents, p.currency
    from public.payments p
    where p.booking_id = b.id
    order by (p.status = 'refunded') desc, p.created_at desc
    limit 1
  ) pay on true
  where b.client_id = auth.uid()
    and (vs.outcome is not null or r.rating is not null or pay.status = 'refunded');
$$;

revoke all on function public.get_my_client_past_session_meta() from public, anon;
grant execute on function public.get_my_client_past_session_meta() to authenticated;
