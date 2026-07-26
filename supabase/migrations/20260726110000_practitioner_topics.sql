-- Topics/issues taxonomy (Browse Card 2a handoff) — a second, independent
-- tag dimension alongside practitioner_profiles.specialties (modality:
-- tarot/astrology/reiki/coaching). Topics describe what a session helps
-- with (love, career, decisions, ...), specialties describe the
-- practice/method — genuinely separate axes, not a subset of one
-- another, so this is its own column rather than folded into
-- specialties.
--
-- Shape constraint mirrors practitioner_specialties_valid exactly (see
-- 20260710110000_specialties_shape_constraint.sql's own reasoning):
-- SQL-side enforcement is shape-only (sane array size, sane per-element
-- length, restricted charset) — it deliberately does not mirror
-- data/topics.json's actual taxonomy, since keeping a SQL-side list in
-- sync with the app-level one is the app's job, not the DB's. Exact-value
-- correctness is enforced in updateTopics (app layer), same split as
-- specialties.

begin;

alter table public.practitioner_profiles
  add column topics text[] not null default '{}';

create or replace function public.practitioner_topics_valid(topics text[])
returns boolean
language sql
immutable
as $$
  select
    array_length(topics, 1) is null
    or (
      array_length(topics, 1) <= 20
      and (
        select bool_and(t ~ '^[a-z0-9_-]{1,30}$')
        from unnest(topics) as t
      )
    )
$$;

alter table public.practitioner_profiles
  add constraint practitioner_profiles_topics_shape
  check (public.practitioner_topics_valid(topics));

-- search_practitioners must now also return topics so Browse can render
-- topic chips, plus created_at so the new "Newest" sort option (Browse
-- Card 2a's sort control) has real data instead of only ever reflecting
-- whatever order the RPC itself happened to return rows in. RETURNS
-- TABLE shape is changing (two new columns), which CREATE OR REPLACE
-- cannot do — Postgres requires DROP + CREATE for a signature-shape
-- change (learned the hard way in the Delivery-info epic; see that
-- migration's own note on this).
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
  created_at timestamptz
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
    pp.created_at
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.practitioner_search_documents psd on psd.practitioner_id = pp.id
  left join (
    select practitioner_id, avg(rating)::numeric(3,2) as average_rating, count(*) as review_count
    from public.reviews
    group by practitioner_id
  ) r on r.practitioner_id = pp.id
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
