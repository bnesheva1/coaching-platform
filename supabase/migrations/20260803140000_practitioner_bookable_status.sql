-- Single source of truth for "can this practitioner actually be booked
-- right now": profile complete, at least one active service, weekly
-- availability set, and (commission-model only) Stripe Connect actually
-- able to receive transfers. Previously only computed inline, in one
-- place (practitioner-dashboard/page.tsx's activation checklist), and
-- even there missing the Connect condition — every other consumer
-- (browse/search, the public profile page) had no notion of this at
-- all. This migration makes it one function family, reused everywhere.

begin;

-- The one place all 4 conditions are written. Not granted to anon/
-- authenticated directly — only ever called from within the two
-- narrower wrappers below, which already run with the definer's
-- privilege, so their own EXECUTE grants are what actually gate access.
create function public.practitioner_bookable_flags(target_practitioner_id uuid)
returns table (
  profile_complete boolean,
  has_active_service boolean,
  availability_set boolean,
  connect_ready boolean,
  is_bookable boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with flags as (
    select
      -- `is not null and <> ''` on every text field, not just `is not
      -- null` — matches the JS-truthiness semantics of the inline check
      -- this replaces (`practitionerProfile?.bio && ...`), so an
      -- empty-string field is still correctly "incomplete."
      (
        pp.avatar_url is not null and pp.avatar_url <> ''
        and pp.bio is not null and pp.bio <> ''
        and pp.headline is not null and pp.headline <> ''
        and pp.location is not null and pp.location <> ''
        and coalesce(array_length(pp.specialties, 1), 0) > 0
      ) as profile_complete,
      exists (
        select 1 from public.services s
        where s.practitioner_id = pp.id and s.is_active = true
      ) as has_active_service,
      exists (
        select 1 from public.practitioner_availability pa
        where pa.practitioner_id = pp.id
      ) as availability_set,
      case
        when pp.billing_model = 'commission' then coalesce(pp.stripe_connect_transfers_active, false)
        -- software_provider practitioners never collect payment through
        -- the platform, so they never touch Stripe Connect at all —
        -- exempt by default. Flip this `else true` to match the
        -- commission branch's own check to require Connect for them
        -- too (e.g. once an admin-panel-backed toggle replaces this
        -- literal) — this is the one place that policy lives.
        else true
      end as connect_ready
    from public.practitioner_profiles pp
    where pp.id = target_practitioner_id
  )
  select
    profile_complete, has_active_service, availability_set, connect_ready,
    profile_complete and has_active_service and availability_set and connect_ready
  from flags
$$;

-- Public-safe: a boolean only, never exposes WHICH condition failed —
-- browse/search and the public profile page need "can I book this
-- person," never "why not."
create function public.is_practitioner_bookable(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_bookable from public.practitioner_bookable_flags(target_practitioner_id)
$$;

grant execute on function public.is_practitioner_bookable(uuid) to anon, authenticated;

-- Owner-only: the full breakdown, for the dashboard's own "why aren't I
-- visible" checklist. auth.uid()-scoped internally, not parameterized —
-- mirrors get_my_connect_status()'s exact shape/reasoning.
create function public.get_my_bookable_status()
returns table (
  profile_complete boolean,
  has_active_service boolean,
  availability_set boolean,
  connect_ready boolean,
  is_bookable boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select * from public.practitioner_bookable_flags(auth.uid())
$$;

grant execute on function public.get_my_bookable_status() to authenticated;

-- Widen search_practitioners with an only_bookable filter, default true
-- (browse/search and the recommended-practitioners widget both want
-- unbookable practitioners excluded by default). Adding a parameter
-- changes the function's identity (Postgres overloads on the parameter
-- list, defaults notwithstanding) — CREATE OR REPLACE alone would leave
-- the old 2-parameter version sitting alongside this one as a separate,
-- still-callable, still-unfiltered overload, rather than actually
-- replacing it. The explicit DROP is what makes this a real replacement.
drop function if exists public.search_practitioners(text[], text);

create function public.search_practitioners(
  specialty_keys text[] default null,
  search_query text default null,
  only_bookable boolean default true
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
    and (not only_bookable or public.is_practitioner_bookable(pp.id))
  order by
    case when search_query is not null and search_query <> ''
      then pgroonga_score(psd.tableoid, psd.ctid)
      else 0
    end desc,
    pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text, boolean) to anon, authenticated;

commit;
