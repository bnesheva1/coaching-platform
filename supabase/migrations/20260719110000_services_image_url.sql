-- Square thumbnail for the redesigned profile page's service tile.
-- Public, same as name/description/price already are.
--
-- services has an explicit column-level SELECT grant (from Epic 7's
-- delivery_info work: revoke select on services from anon,
-- authenticated; grant select (<explicit column list>) ...) rather than
-- a plain RLS policy — a new column isn't covered by that list
-- automatically, so without this second statement image_url would be
-- silently unreadable by anyone (a "permission denied for table
-- services" error on any query that selects it, even though the column
-- exists).
alter table public.services
  add column image_url text;

grant select (image_url) on public.services to anon, authenticated;
