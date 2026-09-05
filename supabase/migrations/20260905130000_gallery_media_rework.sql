-- Rework the practitioner gallery into a 16:9 lightbox photo grid, and add a
-- videos section. Both are per-practitioner, public-read + owner-write, shown on
-- the profile in order About -> Services -> Videos -> Gallery.
--
-- Supersedes 20260905120000: the gallery no longer stores captions or a derived
-- image_url (the public URL is derived from storage_path + the `avatars` bucket
-- at read time), and `position` is renamed `sort_order` to match the videos
-- table. No real gallery data existed yet, so the table is dropped and recreated
-- rather than migrated column-by-column.
--
-- Images live in the existing PUBLIC `avatars` bucket (path
-- `<uid>/gallery-<uuid>.webp`) — its own-folder write policy and webp mime
-- allowance already cover this, so NO new bucket is required. Only the processed
-- (re-encoded, EXIF-stripped, 1200x675) output is ever written there; the raw
-- upload is validated and transformed in the server action and never persisted.
begin;

-- ---- Gallery (rebuilt) ----
drop table if exists public.practitioner_gallery cascade;
drop function if exists public.enforce_gallery_limit() cascade;

create table public.practitioner_gallery (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  -- Generated UUID-based object path in the `avatars` bucket. The ORIGINAL
  -- uploaded filename is never stored anywhere.
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index practitioner_gallery_owner_idx
  on public.practitioner_gallery (practitioner_id, sort_order);

-- ---- Videos (new) ----
create table public.practitioner_videos (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  -- The raw URL the practitioner pasted (kept for reference/editing).
  url text not null,
  -- Derived server-side; the app builds the embed URL from platform + video_id
  -- and never renders user-supplied markup.
  platform text not null check (platform in ('youtube', 'vimeo')),
  video_id text not null,
  -- Fetched via the platform's oEmbed endpoint at add time. thumbnail_url is a
  -- deliberate extension of the requested columns — the grid card needs a
  -- thumbnail, and resolving it once at add time is more robust than an oEmbed
  -- call on every render.
  title text,
  thumbnail_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index practitioner_videos_owner_idx
  on public.practitioner_videos (practitioner_id, sort_order);

-- ---- Per-practitioner caps (BEFORE INSERT; a CHECK can't count siblings) ----
create function public.enforce_gallery_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.practitioner_gallery where practitioner_id = new.practitioner_id) >= 9 then
    raise exception 'practitioner_gallery: limit of 9 images per practitioner reached';
  end if;
  return new;
end;
$$;

create trigger practitioner_gallery_limit
  before insert on public.practitioner_gallery
  for each row execute function public.enforce_gallery_limit();

create function public.enforce_video_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.practitioner_videos where practitioner_id = new.practitioner_id) >= 9 then
    raise exception 'practitioner_videos: limit of 9 videos per practitioner reached';
  end if;
  return new;
end;
$$;

create trigger practitioner_videos_limit
  before insert on public.practitioner_videos
  for each row execute function public.enforce_video_limit();

-- ---- RLS: public read, owner-only writes (both tables) ----
alter table public.practitioner_gallery enable row level security;
alter table public.practitioner_videos enable row level security;

create policy "Anyone can read practitioner galleries"
on public.practitioner_gallery for select using (true);
create policy "Practitioners manage their own gallery (insert)"
on public.practitioner_gallery for insert to authenticated with check (auth.uid() = practitioner_id);
create policy "Practitioners manage their own gallery (update)"
on public.practitioner_gallery for update to authenticated using (auth.uid() = practitioner_id) with check (auth.uid() = practitioner_id);
create policy "Practitioners manage their own gallery (delete)"
on public.practitioner_gallery for delete to authenticated using (auth.uid() = practitioner_id);

create policy "Anyone can read practitioner videos"
on public.practitioner_videos for select using (true);
create policy "Practitioners manage their own videos (insert)"
on public.practitioner_videos for insert to authenticated with check (auth.uid() = practitioner_id);
create policy "Practitioners manage their own videos (update)"
on public.practitioner_videos for update to authenticated using (auth.uid() = practitioner_id) with check (auth.uid() = practitioner_id);
create policy "Practitioners manage their own videos (delete)"
on public.practitioner_videos for delete to authenticated using (auth.uid() = practitioner_id);

commit;
