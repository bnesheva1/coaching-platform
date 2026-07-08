-- Powers the discovery/browse page. security invoker (Postgres's default,
-- written explicitly here so it's a documented decision) means this runs
-- with the caller's own privileges — the same RLS policies that already
-- apply to direct queries against practitioner_profiles (public read) and
-- profiles (public read only for role = 'practitioner') apply here too.
-- Since the join only ever matches rows that have a practitioner_profiles
-- row — which, per the signup trigger, only ever exist for practitioners
-- — a client's profile can never surface through this function.
create or replace function public.search_practitioners(
  specialty_keys text[] default null,
  search_text text default null
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
set search_path = public
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
  where pp.username is not null
    and (
      specialty_keys is null
      or array_length(specialty_keys, 1) is null
      or pp.specialties && specialty_keys
    )
    and (
      search_text is null
      or search_text = ''
      or p.display_name ilike '%' || search_text || '%'
    )
  order by pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text) to anon, authenticated;
