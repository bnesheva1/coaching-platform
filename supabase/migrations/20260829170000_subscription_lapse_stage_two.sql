-- Practitioner subscription billing — lapse stage two (full hide).
--
-- Slice 2 made a lapsed practitioner not-bookable + not-findable, but the
-- profile stayed reachable by direct link so outstanding clients could still
-- reach them. This adds the SECOND stage: once the practitioner's last existing
-- booking has completed (no pending/confirmed bookings remain), the profile
-- goes fully hidden — the public page shows a quiet "not currently listed"
-- notice instead. Rationale: while sessions are outstanding, clients need to
-- reach them; once none remain, there's nothing to preserve.
--
-- The username stays reserved (the row is untouched — no 404), and one
-- successful payment (status → active) lifts full-hide immediately, since the
-- condition below simply stops being true.
--
-- "Fully hidden" is a derived condition, not a stored column: lapsed AND no
-- outstanding bookings. Kept as a SECURITY DEFINER function so a public viewer
-- (who can't see anyone else's bookings under RLS) still gets a correct answer,
-- and only ever a boolean — no booking detail leaks.

begin;

create function public.is_practitioner_fully_hidden(target_practitioner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    pp.subscription_status = 'lapsed'
    and not exists (
      select 1 from public.bookings b
      where b.practitioner_id = pp.id
        and b.status in ('pending', 'confirmed')
    )
  from public.practitioner_profiles pp
  where pp.id = target_practitioner_id
$$;

grant execute on function public.is_practitioner_fully_hidden(uuid) to anon, authenticated;

-- ── get_practitioner_cards: expose visibility so saved cards aren't dead links ─
-- The saved list deliberately shows practitioners who've become unbookable
-- (bookable=false → "not taking bookings"). A fully-hidden one, though, has no
-- reachable profile — so the card must stop linking there. Add a `visible`
-- column (= not fully hidden) the client can use to render a non-clickable
-- "no longer listed" state instead. RETURNS TABLE changes → drop + recreate;
-- otherwise identical to 20260817120000.
drop function if exists public.get_practitioner_cards(uuid[]);

create function public.get_practitioner_cards(practitioner_ids uuid[])
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
  delivery_types text[],
  location text,
  bookable boolean,
  visible boolean
)
language sql
stable
security definer
set search_path = public
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
    coalesce(sv.delivery_types, '{}'::text[]),
    pp.location,
    public.is_practitioner_bookable(pp.id),
    not public.is_practitioner_fully_hidden(pp.id)
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
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
  where pp.id = any(practitioner_ids)
    and pp.username is not null;
$$;

grant execute on function public.get_practitioner_cards(uuid[]) to authenticated;

commit;
