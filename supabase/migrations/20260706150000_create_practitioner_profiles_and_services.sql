-- 1. Practitioner-specific profile data, extending the base profile
create table public.practitioner_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  bio text,
  specialties text[] not null default '{}',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.practitioner_profiles enable row level security;

create policy "Anyone can view practitioner profiles"
on public.practitioner_profiles
for select
to public
using (true);

create policy "Practitioners can create their own profile"
on public.practitioner_profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'practitioner'
  )
);

create policy "Practitioners can update their own profile"
on public.practitioner_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- 2. Services a practitioner offers
create table public.services (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  price numeric(10, 2) not null check (price >= 0),
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

create policy "Anyone can view services"
on public.services
for select
to public
using (true);

create policy "Practitioners can create their own services"
on public.services
for insert
to authenticated
with check (auth.uid() = practitioner_id);

create policy "Practitioners can update their own services"
on public.services
for update
to authenticated
using (auth.uid() = practitioner_id)
with check (auth.uid() = practitioner_id);

create policy "Practitioners can delete their own services"
on public.services
for delete
to authenticated
using (auth.uid() = practitioner_id);
