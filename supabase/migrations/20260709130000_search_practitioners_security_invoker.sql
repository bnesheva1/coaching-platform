-- Restores search_practitioners to SECURITY INVOKER so it structurally
-- runs subject to RLS, rather than relying on today's RLS policies
-- happening to be equivalent. The prior SECURITY DEFINER switch
-- (20260709110000) was to stop practitioner_search_documents from being
-- directly bulk-readable while it still contained inactive-service text.
-- That's fixed now: refresh_practitioner_search_document only aggregates
-- active services, so search_text is entirely composed of data that's
-- already independently public elsewhere (display_name and bio via
-- practitioner_profiles' own `using (true)` policy, active service
-- name/description via services' own policy). Given that invariant, a
-- public SELECT policy back on practitioner_search_documents doesn't
-- expose anything new.
--
-- Also adds a DB-side length cap on the search query. The 200-char cap in
-- lib/practitioners/search.ts only protects callers going through the
-- app; search_practitioners is a public RPC anyone can call directly with
-- the anon key, so the cap needs to also live here to hold unconditionally.

begin;

create policy "Anyone can view practitioner search documents"
on public.practitioner_search_documents
for select
to public
using (true);

create or replace function public.search_practitioners(
  specialty_keys text[] default null,
  search_query text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  specialties text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    pp.id,
    pp.username,
    p.display_name,
    pp.bio,
    pp.avatar_url,
    pp.specialties
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.practitioner_search_documents psd on psd.practitioner_id = pp.id
  where pp.username is not null
    and (
      specialty_keys is null
      or array_length(specialty_keys, 1) is null
      or pp.specialties && specialty_keys
    )
    and (
      search_query is null
      or search_query = ''
      or psd.search_text &@~ left(search_query, 200)
    )
  order by
    case when search_query is not null and search_query <> ''
      then pgroonga_score(psd.tableoid, psd.ctid)
      else 0
    end desc,
    pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text) to anon, authenticated;

commit;
