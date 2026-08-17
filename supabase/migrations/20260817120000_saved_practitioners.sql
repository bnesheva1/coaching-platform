-- A client's private list of saved ("favourited") practitioners.
--
-- Privacy is the whole point: a practitioner must NEVER learn who saved them, nor
-- see a count — exposing that would change how the feature gets used. So there is
-- no SELECT policy for anyone but the owning client, and nothing reads this table
-- with the service role on a practitioner's behalf. It's a plain toggle (insert to
-- save, delete to unsave — no update), unique per (client, practitioner).
begin;

create table public.saved_practitioners (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users (id) on delete cascade,
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  saved_at timestamptz not null default now(),
  unique (client_id, practitioner_id)
);

-- The client's own list, newest first.
create index saved_practitioners_client_idx on public.saved_practitioners (client_id, saved_at desc);

alter table public.saved_practitioners enable row level security;

-- Owner-only, all three operations. No policy grants any other role read access,
-- so a practitioner (or anyone else) cannot see a saver's identity or a tally.
create policy "Clients can read their own saves"
on public.saved_practitioners for select to authenticated
using (auth.uid() = client_id);

create policy "Clients can create their own saves"
on public.saved_practitioners for insert to authenticated
with check (auth.uid() = client_id);

create policy "Clients can delete their own saves"
on public.saved_practitioners for delete to authenticated
using (auth.uid() = client_id);

-- Card data for a set of practitioner ids, WITHOUT the searchable-visibility
-- filter search_practitioners applies — a client's saved list must still show a
-- practitioner who has since been hidden/suspended (the client chose to keep
-- them), just without a booking action. Carries a `bookable` flag so the caller
-- can suppress the booking CTA for one who's no longer bookable. Returns only
-- public card fields (same data browse already shows), so no ownership check is
-- needed; it reveals nothing about who saved whom.
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
  bookable boolean
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
    public.is_practitioner_bookable(pp.id)
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
