-- Security fix: refresh_practitioner_search_document is SECURITY DEFINER,
-- so it bypassed RLS on services and pulled in inactive/hidden services'
-- name + description when building each practitioner's search document.
-- practitioner_search_documents was also publicly SELECT-able (`using
-- (true)`), so that hidden text was directly readable, verbatim, by any
-- anonymous client via a bulk unfiltered read — confirmed empirically:
-- an is_active=false service's name/description showed up both in
-- search_practitioners results and in a raw `select * from
-- practitioner_search_documents` as anon.

begin;

-- 1. Root cause: only fold ACTIVE services into the search document.
create or replace function public.refresh_practitioner_search_document(target_practitioner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  combined_text text;
begin
  select
    coalesce(p.display_name, '') || ' ' ||
    coalesce(pp.bio, '') || ' ' ||
    coalesce(string_agg(coalesce(s.name, '') || ' ' || coalesce(s.description, ''), ' '), '')
  into combined_text
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.services s on s.practitioner_id = pp.id and s.is_active = true
  where pp.id = target_practitioner_id
  group by p.display_name, pp.bio;

  insert into public.practitioner_search_documents (practitioner_id, search_text)
  values (target_practitioner_id, coalesce(combined_text, ''))
  on conflict (practitioner_id) do update set search_text = excluded.search_text;
end;
$$;

-- 2. Purge already-cached leaked text: recompute every existing document
--    with the fixed function above.
do $$
declare
  r record;
begin
  for r in select id from public.practitioner_profiles loop
    perform public.refresh_practitioner_search_document(r.id);
  end loop;
end $$;

-- 3. Defense in depth: practitioner_search_documents is an internal search
--    index, not public-facing content in its own right — nothing in the
--    app reads it directly, only search_practitioners does (and that
--    function never returns the raw search_text column). Remove direct
--    public readability entirely, and make search_practitioners SECURITY
--    DEFINER so it no longer depends on callers holding their own grant
--    on this table. This doesn't weaken what's effectively public: the
--    other two tables the function joins are already unconditionally
--    public (practitioner_profiles: `using (true)`) or public exactly for
--    the rows this join ever touches (profiles: public where role =
--    'practitioner', and this join never reaches a client row).
drop policy "Anyone can view practitioner search documents" on public.practitioner_search_documents;

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
security definer
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
      or psd.search_text &@~ search_query
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
