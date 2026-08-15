-- Per-practitioner admin controls (slice 2). A graduated moderation ladder plus
-- an independent payouts-freeze flag, folded into the EXISTING bookable
-- derivation rather than a competing notion of who can be booked.
begin;

-- ── State on practitioner_profiles ──────────────────────────────────────────
-- moderation_status: mutually-exclusive severity ladder. payouts_frozen: a
-- separate money axis (a dispute can freeze payouts on an otherwise-active
-- practitioner). Each axis carries its own admin-written reason (shown to the
-- practitioner) + who/when. New columns are intentionally NOT granted to any
-- client role — the practitioner reads their own state via the security-definer
-- get_my_moderation_status() below, admins read via the service role, and the
-- reason columns never reach the client at all.
alter table public.practitioner_profiles
  add column moderation_status text not null default 'active'
    constraint practitioner_profiles_moderation_status_check
    check (moderation_status in ('active', 'hidden', 'bookings_frozen', 'suspended')),
  add column moderation_reason text,
  add column moderation_applied_by uuid references auth.users(id),
  add column moderation_applied_at timestamptz,
  add column payouts_frozen boolean not null default false,
  add column payouts_reason text,
  add column payouts_frozen_by uuid references auth.users(id),
  add column payouts_frozen_at timestamptz;

-- ── Fold moderation into the single bookable derivation ─────────────────────
-- Same signature (CREATE OR REPLACE), one new internal condition: a practitioner
-- with bookings frozen or suspended is not bookable. HIDDEN stays bookable
-- (bookable-by-URL); payouts_frozen doesn't touch bookability at all. Every
-- existing consumer (booking action, search, public profile, dashboard) now
-- respects the controls for free, through this one function.
create or replace function public.practitioner_bookable_flags(target_practitioner_id uuid)
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
        else true
      end as connect_ready,
      -- NEW: an admin control that stops new bookings.
      (pp.moderation_status not in ('bookings_frozen', 'suspended')) as not_moderated
    from public.practitioner_profiles pp
    where pp.id = target_practitioner_id
  )
  select
    profile_complete, has_active_service, availability_set, connect_ready,
    profile_complete and has_active_service and availability_set and connect_ready and not_moderated
  from flags
$$;

-- ── Search visibility ───────────────────────────────────────────────────────
-- Excludes hidden + suspended from browse/search — independent of bookability,
-- so a HIDDEN practitioner drops out of search while staying bookable by direct
-- link. Security-definer so moderation_status needs no public column grant.
create function public.is_practitioner_searchable(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select moderation_status not in ('hidden', 'suspended')
  from public.practitioner_profiles
  where id = target_practitioner_id
$$;

grant execute on function public.is_practitioner_searchable(uuid) to anon, authenticated;

-- Re-create search_practitioners with the extra visibility filter (same 3-arg
-- signature; drop+create so it's a real replacement).
drop function if exists public.search_practitioners(text[], text, boolean);

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
    and public.is_practitioner_searchable(pp.id)
  order by
    case when search_query is not null and search_query <> ''
      then pgroonga_score(psd.tableoid, psd.ctid)
      else 0
    end desc,
    pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text, boolean) to anon, authenticated;

-- ── Owner-scoped moderation status, for the practitioner's dashboard notice ──
create function public.get_my_moderation_status()
returns table (
  moderation_status text,
  moderation_reason text,
  payouts_frozen boolean,
  payouts_reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select moderation_status, moderation_reason, payouts_frozen, payouts_reason
  from public.practitioner_profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_moderation_status() to authenticated;

-- ── Admin practitioner list (one query, service-role only) ──────────────────
-- Everything the admin list needs, aggregated: name/username, the current
-- controls, live bookability (through the same is_practitioner_bookable), Connect
-- state, upcoming/total booking counts, rating. Not granted to anon/authenticated
-- — only ever called via the service role from the admin page.
create function public.admin_list_practitioners(search text default null)
returns table (
  id uuid,
  username text,
  display_name text,
  moderation_status text,
  payouts_frozen boolean,
  is_bookable boolean,
  connect_transfers_active boolean,
  billing_model text,
  has_connect_account boolean,
  upcoming_count bigint,
  total_sessions bigint,
  average_rating numeric,
  review_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pp.id,
    pp.username,
    p.display_name,
    pp.moderation_status,
    pp.payouts_frozen,
    public.is_practitioner_bookable(pp.id),
    pp.stripe_connect_transfers_active,
    pp.billing_model,
    pp.stripe_connected_account_id is not null,
    coalesce(ub.cnt, 0),
    coalesce(ts.cnt, 0),
    r.average_rating,
    coalesce(r.review_count, 0)
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join (
    select practitioner_id, count(*) as cnt
    from public.bookings
    where start_utc > now() and status in ('pending', 'confirmed')
    group by practitioner_id
  ) ub on ub.practitioner_id = pp.id
  left join (
    select practitioner_id, count(*) as cnt
    from public.bookings
    where status = 'completed'
    group by practitioner_id
  ) ts on ts.practitioner_id = pp.id
  left join (
    select practitioner_id, avg(rating)::numeric(3, 2) as average_rating, count(*) as review_count
    from public.reviews
    group by practitioner_id
  ) r on r.practitioner_id = pp.id
  where p.role = 'practitioner'
    and (
      search is null or search = ''
      or p.display_name ilike '%' || search || '%'
      or pp.username ilike '%' || search || '%'
    )
  order by p.display_name;
$$;

commit;
