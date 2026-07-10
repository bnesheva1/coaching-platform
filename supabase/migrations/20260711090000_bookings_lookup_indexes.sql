-- Epic 5, booking visibility slice. Postgres doesn't auto-index foreign
-- keys, and the only existing index touching practitioner_id is the
-- GiST exclusion constraint's composite index (not ideal for a plain
-- equality lookup). The new client/practitioner dashboard booking lists
-- both filter on exactly these columns, so add plain btree indexes.
-- Purely additive — no RLS or table change.

begin;

create index bookings_client_id_idx on public.bookings (client_id);
create index bookings_practitioner_id_idx on public.bookings (practitioner_id);

commit;
