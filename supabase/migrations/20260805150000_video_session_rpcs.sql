-- LiveKit video integration, slice 1 companion: the read/action surface.
-- Four SECURITY DEFINER functions, each mirroring an existing pattern in
-- this schema (get_practitioner_busy_times for the anon-safe aggregate,
-- get_my_active_booking_delivery_info for the party-scoped read,
-- confirm_paid_booking for the service-role-only writer).

begin;

-- Creates the video_sessions row for an online booking. SERVICE-ROLE
-- ONLY: both booking paths call it from trusted server code (the free
-- path via bookSlot's existing service-role client, the paid path via the
-- Stripe webhook handler), so the caller-supplied opens_at/closes_at are
-- trusted — they're computed once from lib/video/config.ts, the single
-- home for the window offsets, which is exactly why this isn't a trigger
-- (a trigger would force those offsets to be duplicated in SQL). If it
-- were reachable by a client session, a crafted closes_at would extend
-- their own room; restricting execution to service_role removes that.
-- Idempotent: a second call for the same booking is a clean no-op.
create function public.ensure_video_session_for_booking(
  p_booking_id uuid,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.video_sessions (booking_id, provider_room_name, opens_at, closes_at)
  select b.id, b.id::text, p_opens_at, p_closes_at
  from public.bookings b
  where b.id = p_booking_id and b.delivery_type = 'online'
  on conflict (booking_id) do nothing;
end;
$$;

revoke all on function public.ensure_video_session_for_booking(uuid, timestamptz, timestamptz)
  from public, authenticated, anon;
grant execute on function public.ensure_video_session_for_booking(uuid, timestamptz, timestamptz)
  to service_role;

-- Token-issue eligibility gate. The caller must be a party to the booking
-- (returns nothing otherwise — no "look up any booking's room" oracle),
-- and the booking must be online + confirmed. caller_role tells the seam
-- which participant this is without a second query. Mirrors the ownership
-- shape of get_booking_email_context / get_my_active_booking_delivery_info.
create function public.get_my_booking_video_access(target_booking_id uuid)
returns table (
  provider_room_name text,
  opens_at timestamptz,
  closes_at timestamptz,
  status text,
  caller_role text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    vs.provider_room_name, vs.opens_at, vs.closes_at, vs.status,
    case when auth.uid() = b.client_id then 'client' else 'practitioner' end
  from public.video_sessions vs
  join public.bookings b on b.id = vs.booking_id
  where vs.booking_id = target_booking_id
    and b.delivery_type = 'online'
    and b.status = 'confirmed'
    and auth.uid() in (b.client_id, b.practitioner_id);
$$;

grant execute on function public.get_my_booking_video_access(uuid) to authenticated;

-- Platform-wide concurrency accounting for the booking-time capacity
-- check. Sums connection_units of active-booking video sessions whose
-- [opens_at, closes_at) overlaps the window. Returns only a number, so
-- it's safe to call during slot generation for anon browsers — same
-- anon grant and identity-hiding rationale as get_practitioner_busy_times.
-- This is a SOFT cap checked at booking time, not a hard DB constraint;
-- accepted per design (LiveKit's own account ceiling is the hard backstop,
-- and serialising booking commits to close the tiny race is a bad trade).
create function public.count_overlapping_video_connection_units(
  window_start timestamptz,
  window_end timestamptz
)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(vs.connection_units), 0)::integer
  from public.video_sessions vs
  join public.bookings b on b.id = vs.booking_id
  where b.status in ('pending', 'confirmed')
    and tstzrange(vs.opens_at, vs.closes_at) && tstzrange(window_start, window_end);
$$;

grant execute on function public.count_overlapping_video_connection_units(timestamptz, timestamptz)
  to anon, authenticated;

-- Emergency-contact fallback reveal. The CLIENT on an online booking,
-- during the active session window, may reveal the practitioner's
-- emergency contact IF one is set and not revoked for this booking. Every
-- reveal is logged and flips fallback_used (which routes no-show
-- resolution to manual review, since a phone fallback can't be verified
-- from join events). Rate-limited at the app layer (the route). Both a
-- reader and a writer, hence plpgsql + a RETURNS TABLE rather than a bare
-- sql function.
create function public.reveal_booking_emergency_contact(target_booking_id uuid)
returns table (emergency_contact text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_revoked boolean;
  v_practitioner_id uuid;
  v_contact text;
begin
  select vs.id, vs.opens_at, vs.closes_at, vs.emergency_contact_revoked, b.practitioner_id
    into v_session_id, v_opens_at, v_closes_at, v_revoked, v_practitioner_id
  from public.video_sessions vs
  join public.bookings b on b.id = vs.booking_id
  where vs.booking_id = target_booking_id
    and b.delivery_type = 'online'
    and auth.uid() = b.client_id;          -- client-facing reveal only

  if not found then
    return;                                -- not the client, or not an online booking
  end if;

  if now() < v_opens_at or now() > v_closes_at then
    return;                                -- only inside the active window
  end if;

  if v_revoked then
    return;                                -- practitioner pre-revoked for this booking
  end if;

  select pp.emergency_contact into v_contact
  from public.practitioner_profiles pp
  where pp.id = v_practitioner_id;

  if v_contact is null or v_contact = '' then
    return;                                -- nothing provided
  end if;

  insert into public.video_fallback_reveals (video_session_id, booking_id, revealed_to)
  values (v_session_id, target_booking_id, auth.uid());

  update public.video_sessions set fallback_used = true where id = v_session_id;

  return query select v_contact;
end;
$$;

grant execute on function public.reveal_booking_emergency_contact(uuid) to authenticated;

commit;
