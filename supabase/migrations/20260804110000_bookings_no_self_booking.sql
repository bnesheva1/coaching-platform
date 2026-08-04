-- Hardening ahead of any future dual-role (practitioner-books-as-client)
-- work — not enabling that work itself. Self-booking is unreachable
-- today only because profiles.role is exclusive ('practitioner' XOR
-- 'client'), which makes client_id = practitioner_id impossible for a
-- real signed-up user under RLS. Nothing actually forbids it at the
-- schema level, so it would silently become reachable the moment role
-- exclusivity is ever relaxed. Closing it now, independent of that
-- decision, means it stays closed regardless of what the role model
-- does later.
--
-- One pre-existing row violated this (id e236258b-...) — a leftover
-- test artifact from earlier profile-preview testing (a throwaway
-- @example.com seed account, no payment row attached, status set
-- directly), only reachable via a service-role script bypassing RLS
-- entirely, never through the real app. Confirmed and deleted before
-- this migration was written, not worked around with NOT VALID.
--
-- A CHECK constraint, not a trigger — this protects every insert path
-- uniformly (the RLS-gated direct insert AND confirm_paid_booking's
-- SECURITY DEFINER insert) with one guarantee at the one place rows
-- actually land, rather than needing to be duplicated per code path.

alter table public.bookings
  add constraint bookings_client_not_practitioner
  check (client_id <> practitioner_id);
