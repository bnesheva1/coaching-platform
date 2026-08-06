-- Practitioner-facing side of the emergency-contact fallback: let a
-- practitioner SET their contact, and REVOKE it per booking in advance.
-- (The read side — reveal_booking_emergency_contact, the reveal log, the
-- notification, the marker — already exists from the video slices.)

begin;

-- Setting the contact. emergency_contact was added excluded from every
-- grant (sensitive; read only via reveal_booking_emergency_contact). Open
-- it for UPDATE only — a practitioner may write their OWN (own-row scoping
-- is the existing update RLS policy's job; SELECT stays excluded, so this
-- grant never lets anyone READ another practitioner's number).
grant update (emergency_contact) on public.practitioner_profiles to authenticated;

-- Per-booking, in-advance-only revocation. The practitioner on an online
-- booking may toggle emergency_contact_revoked BEFORE the session window
-- opens; once opens_at passes it's locked — there's no reliable live
-- channel to decide at the moment a session is failing. Returns true when
-- a row actually changed, false otherwise (not their booking, not online,
-- or the window already opened) so the action can report honestly.
create function public.set_booking_emergency_contact_revoked(
  target_booking_id uuid,
  p_revoked boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.video_sessions vs
  set emergency_contact_revoked = p_revoked
  from public.bookings b
  where vs.booking_id = target_booking_id
    and b.id = vs.booking_id
    and b.delivery_type = 'online'
    and b.practitioner_id = auth.uid()   -- practitioner-only
    and now() < vs.opens_at;             -- in advance only
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.set_booking_emergency_contact_revoked(uuid, boolean) from public, anon;
grant execute on function public.set_booking_emergency_contact_revoked(uuid, boolean) to authenticated;

-- The practitioner's own per-booking video state: the revoke flag,
-- opens_at (so the UI knows whether it's still changeable), and the latest
-- reveal time (the booking marker). video_sessions / video_fallback_reveals
-- carry no client grant, so this SECURITY DEFINER read is the only path.
-- Supersedes get_my_practitioner_video_reveals (left in place, now unused).
create function public.get_my_practitioner_video_session_states()
returns table (booking_id uuid, emergency_contact_revoked boolean, opens_at timestamptz, revealed_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    vs.booking_id,
    vs.emergency_contact_revoked,
    vs.opens_at,
    (select max(r.revealed_at) from public.video_fallback_reveals r where r.booking_id = vs.booking_id)
  from public.video_sessions vs
  join public.bookings b on b.id = vs.booking_id
  where b.practitioner_id = auth.uid();
$$;

grant execute on function public.get_my_practitioner_video_session_states() to authenticated;

commit;
