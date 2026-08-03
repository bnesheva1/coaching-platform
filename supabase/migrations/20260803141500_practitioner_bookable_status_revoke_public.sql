-- Fix: Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION
-- unless explicitly revoked — confirmed live that an anonymous caller
-- could call practitioner_bookable_flags(any_id) directly and get back
-- the full per-condition breakdown (including WHICH condition failed),
-- defeating the entire "boolean only, never expose why" design of
-- is_practitioner_bookable. get_my_bookable_status() was likewise
-- publicly callable (self-limiting in practice, since it's scoped to
-- auth.uid() internally, but still not the intended boundary). Every
-- other narrow RPC in this codebase (e.g. confirm_paid_booking)
-- explicitly revokes from public first — this one should have too.

begin;

revoke all on function public.practitioner_bookable_flags(uuid) from public, anon, authenticated;

revoke all on function public.get_my_bookable_status() from public, anon;
grant execute on function public.get_my_bookable_status() to authenticated;

commit;
