-- Immediate booking, slice 2: discovery, client flow, payment + the hold.
begin;

-- Extend the request lifecycle: a confirmed request either books immediately
-- (software_provider) or awaits payment (commission) and then books, or the
-- payment window elapses.
alter table public.immediate_requests drop constraint immediate_requests_status_check;
alter table public.immediate_requests
  add constraint immediate_requests_status_check
  check (status in ('pending', 'confirmed', 'booked', 'declined', 'lapsed', 'superseded', 'payment_failed'));

-- ── The payment-window hold ─────────────────────────────────────────────────
-- The one warranted reservation: a commission practitioner is actively waiting
-- while payment is in flight. Covers the projected session window and blocks
-- scheduled slot generation. Expiry is enforced BY TIME (get_practitioner_busy_
-- times only counts holds with expires_at > now()) — a hold outliving its timer
-- can never silently keep blocking, with no cleanup job in the loop.
create table public.immediate_holds (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.immediate_requests(id) on delete cascade,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.immediate_holds enable row level security; -- service-role only
create index immediate_holds_active on public.immediate_holds (practitioner_id, expires_at);

-- Links the eventual booking back to the immediate request that produced it, so
-- the client's post-payment confirmation page (and the software_provider
-- book-on-confirm outcome) can find the booking that a webhook/confirm created —
-- the booking is created out-of-band, so the client polls for it by request id.
alter table public.bookings add column immediate_request_id uuid references public.immediate_requests(id);
create index bookings_immediate_request_id on public.bookings (immediate_request_id) where immediate_request_id is not null;

-- Busy-times now unions active holds, so scheduled slot generation and the
-- booking re-validation see a held immediate window as busy — exactly like a
-- real booking, no grid assumption (generateSlots subtracts arbitrary ranges).
create or replace function public.get_practitioner_busy_times(
  target_practitioner_id uuid,
  window_start timestamptz,
  window_end timestamptz
)
returns table (start_utc timestamptz, end_utc timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.start_utc, b.end_utc
  from public.bookings b
  where b.practitioner_id = target_practitioner_id
    and b.status in ('pending', 'confirmed')
    and b.end_utc > window_start
    and b.start_utc < window_end
  union all
  select h.start_utc, h.end_utc
  from public.immediate_holds h
  where h.practitioner_id = target_practitioner_id
    and h.expires_at > now()
    and h.end_utc > window_start
    and h.start_utc < window_end
$$;

-- ── Discovery: available-now in search ──────────────────────────────────────
-- Adds an only_available_now filter, an available_now output column, and
-- available-first ordering when no search query is sorting.
drop function if exists public.search_practitioners(text[], text, boolean);

create function public.search_practitioners(
  specialty_keys text[] default null,
  search_query text default null,
  only_bookable boolean default true,
  only_available_now boolean default false
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
  location text,
  available_now boolean
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
    pp.location,
    public.is_practitioner_available_now(pp.id)
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
    and (not only_available_now or public.is_practitioner_available_now(pp.id))
    and public.is_practitioner_searchable(pp.id)
  order by
    case when search_query is not null and search_query <> ''
      then pgroonga_score(psd.tableoid, psd.ctid)
      else 0
    end desc,
    -- Available-now first when nothing else is sorting (placement, not a badge).
    public.is_practitioner_available_now(pp.id) desc,
    pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text, boolean, boolean) to anon, authenticated;

-- Count of currently-available, bookable, searchable practitioners — gates the
-- browse filter (render only when > 0) and the homepage line.
create function public.count_available_now_practitioners()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.practitioner_profiles pp
  where pp.username is not null
    and public.is_practitioner_bookable(pp.id)
    and public.is_practitioner_searchable(pp.id)
    and public.is_practitioner_available_now(pp.id);
$$;
grant execute on function public.count_available_now_practitioners() to anon, authenticated;

commit;
