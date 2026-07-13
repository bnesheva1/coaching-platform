-- Re-adds a stored reviewer name, but as internal-only metadata this
-- time — never displayed, to the public OR the practitioner. A snapshot
-- of the reviewing client's display_name at the time they wrote the
-- review, captured for possible future internal use (e.g. resolving an
-- abuse report), without weakening pseudonymity: this column is
-- deliberately never added to the SELECT grant below, so it gets the
-- exact same treatment booking_id already has — present in the row,
-- structurally unselectable via any plain .select(), by anyone.

begin;

alter table public.reviews add column reviewer_display_name text;

-- Deliberately no GRANT statement for this column. Postgres denies
-- SELECT on a newly added column by default — a column only becomes
-- readable via an explicit grant, and the existing column-level grant
-- on this table (from the original reviews migration) already lists
-- its columns exhaustively, so it does not implicitly cover this new
-- one. That absence is the entire enforcement mechanism: like
-- booking_id, this column has no path to being read except a direct
-- database connection, by anyone, ever.

commit;
