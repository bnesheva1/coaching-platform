-- Epic 8, part 2: reviews/ratings. A review is publicly-pseudonymous
-- (shown with a first name or "Verified client", never full identity)
-- but internally tied to a real completed booking, so it's verifiably
-- from a genuine client. The booking link (booking_id) is therefore the
-- one column that must never be selectable by anyone, including the
-- reviewing client's own account and the reviewed practitioner — RLS
-- row policies can't express that (they gate rows, not columns), so
-- this uses the same column-level GRANT pattern already established for
-- profiles.email and services.delivery_info.

begin;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  practitioner_id uuid not null references public.practitioner_profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review_text text,
  reviewer_display_name text,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

-- Public read of the pseudonymous shape — everyone, including
-- logged-out visitors, can see reviews on a practitioner's profile.
create policy "Reviews are publicly readable"
on public.reviews
for select
to public
using (true);

-- The entire authenticity gate: a client may only insert a review for a
-- booking that is (a) theirs and (b) already completed. This single
-- WITH CHECK is what makes every adversarial case fail structurally —
-- reviewing someone else's booking, reviewing a pending/confirmed
-- booking before its time has passed, reviewing a cancelled booking
-- (which can never reach 'completed'), and a practitioner reviewing
-- their own service (no booking ever has client_id = the practitioner
-- who owns it, since booking creation already requires role = 'client')
-- are all rejected by this one condition. Double-review is rejected
-- separately, by the UNIQUE constraint on booking_id.
create policy "A client can review their own completed booking"
on public.reviews
for insert
to authenticated
with check (
  exists (
    select 1 from public.bookings b
    where b.id = booking_id
      and b.client_id = auth.uid()
      and b.status = 'completed'
  )
);

-- No update/delete policy — a review is immutable once created.

-- booking_id is the only column excluded from the public grant. This is
-- the actual pseudonymity mechanism: it's not filtered or masked, it's
-- structurally absent from any plain .select() response for anyone,
-- including the reviewing client's own row and the reviewed
-- practitioner. There is no query shape that recovers which booking —
-- and therefore which client — produced a given review.
revoke select on public.reviews from anon, authenticated;
grant select (id, practitioner_id, rating, review_text, reviewer_display_name, created_at)
  on public.reviews to anon, authenticated;

-- The client dashboard needs "have I already reviewed this booking" per
-- completed booking, but can't determine that via a plain select once
-- booking_id is grant-excluded. A narrow SECURITY DEFINER RPC, scoped
-- to the caller's own bookings, batched (one call for every booking,
-- not one call per booking) — same shape as get_my_active_booking_delivery_info.
create function public.get_my_reviewed_booking_ids()
returns table (booking_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select r.booking_id
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  where b.client_id = auth.uid()
$$;

grant execute on function public.get_my_reviewed_booking_ids() to authenticated;

-- Ratings aggregate for discovery cards. search_practitioners is
-- SECURITY INVOKER (runs as the calling role), and rating/practitioner_id
-- are already in reviews' public grant above, so this join needs no new
-- grant. Postgres won't let CREATE OR REPLACE change a RETURNS TABLE
-- column list — DROP is required first, which also wipes existing
-- grants, so they're re-stated below.
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
  average_rating numeric,
  review_count bigint
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
    r.average_rating,
    coalesce(r.review_count, 0)
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
