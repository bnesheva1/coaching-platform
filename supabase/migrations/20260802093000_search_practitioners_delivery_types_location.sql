-- Foundational slice, browse portion: search_practitioners gains
-- delivery_types (the distinct set of delivery types across a
-- practitioner's ACTIVE services — a practitioner offering both an
-- online and an in-person service returns both) and location (reused
-- from the existing practitioner_profiles.location free-text field,
-- already public — not a new "city" column; that's the structured-
-- address epic that isn't built yet, this just surfaces what already
-- exists). Both null-safe: delivery_types is '{}' for a practitioner
-- with no active services, location is whatever practitioner_profiles.
-- location already is (frequently null — most practitioners haven't
-- filled it in).

begin;

-- RETURNS TABLE shape is changing (two new columns) — same DROP-then-
-- CREATE requirement as the topics migration's own note explains.
drop function if exists public.search_practitioners(text[], text);

create function public.search_practitioners(
  specialty_keys text[] default null,
  search_query text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  specialties text[],
  topics text[],
  average_rating numeric,
  review_count bigint,
  created_at timestamptz,
  delivery_types text[],
  location text
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
    pp.specialties,
    pp.topics,
    r.average_rating,
    coalesce(r.review_count, 0),
    pp.created_at,
    coalesce(sv.delivery_types, '{}'::text[]),
    pp.location
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.practitioner_search_documents psd on psd.practitioner_id = pp.id
  left join (
    select practitioner_id, avg(rating)::numeric(3,2) as average_rating, count(*) as review_count
    from public.reviews
    group by practitioner_id
  ) r on r.practitioner_id = pp.id
  left join (
    select practitioner_id, array_agg(distinct delivery_type) as delivery_types
    from public.services
    where is_active = true
    group by practitioner_id
  ) sv on sv.practitioner_id = pp.id
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
