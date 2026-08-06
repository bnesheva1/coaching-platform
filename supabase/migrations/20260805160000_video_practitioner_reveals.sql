-- Lets a practitioner see, on their own bookings, that (and when) the
-- client used the emergency-contact fallback. video_fallback_reveals has
-- no client grant at all (service-role/RPC only), so this SECURITY DEFINER
-- read is the practitioner's window into it — scoped to reveals on
-- bookings they own, returning just the booking id + latest reveal time
-- (no client identity beyond the booking they already see). Mirrors the
-- shape of the other get_my_* reads.

begin;

create function public.get_my_practitioner_video_reveals()
returns table (booking_id uuid, revealed_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select r.booking_id, max(r.revealed_at)
  from public.video_fallback_reveals r
  join public.bookings b on b.id = r.booking_id
  where b.practitioner_id = auth.uid()
  group by r.booking_id
$$;

grant execute on function public.get_my_practitioner_video_reveals() to authenticated;

commit;
