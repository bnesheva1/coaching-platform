-- Practitioner profile gallery: up to 3 images per practitioner, each with an
-- optional short (<=100 char) plain-text caption, shown on the public profile
-- right after the About section.
--
-- Public content by design (it renders on the public profile to guests), so
-- SELECT is open to everyone — same posture as `services`/`reviews`, which the
-- profile page already reads unauthenticated. Writes are owner-only. The images
-- themselves live in the existing public `avatars` bucket under the owner's own
-- folder (path `<user id>/gallery-<uuid>`), already permitted by that bucket's
-- "own folder" write policy — no new bucket needed.
begin;

create table public.practitioner_gallery (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles (id) on delete cascade,
  -- Deterministic storage object path in the `avatars` bucket, kept so removal
  -- can delete the underlying file, not just the row.
  storage_path text not null,
  image_url text not null,
  -- Plain text, capped at 100 chars (matches the app-side limit). Nullable — an
  -- image may have no caption. Empty string is normalised to null in the action.
  caption text check (caption is null or char_length(caption) <= 100),
  -- Display order within a practitioner's gallery (0,1,2). Assigned on add.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- A practitioner's own images, in display order.
create index practitioner_gallery_owner_idx
  on public.practitioner_gallery (practitioner_id, position);

-- Hard cap of 3 images per practitioner at the DB level, so a double-submit or
-- any future caller can't exceed it regardless of the app-side check. BEFORE
-- INSERT (not a CHECK — a CHECK can't count sibling rows).
create function public.enforce_gallery_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.practitioner_gallery where practitioner_id = new.practitioner_id) >= 3 then
    raise exception 'practitioner_gallery: limit of 3 images per practitioner reached';
  end if;
  return new;
end;
$$;

create trigger practitioner_gallery_limit
  before insert on public.practitioner_gallery
  for each row execute function public.enforce_gallery_limit();

alter table public.practitioner_gallery enable row level security;

-- Public read: the gallery is public profile content. No `to` clause → applies
-- to anon (guests) and authenticated alike, same as the profile page's other
-- public reads.
create policy "Anyone can read practitioner galleries"
on public.practitioner_gallery for select
using (true);

-- Writes are owner-only, all scoped to the practitioner editing their OWN
-- profile (auth.uid() = practitioner_id, since a practitioner_profiles row's id
-- IS the auth user id).
create policy "Practitioners can add their own gallery images"
on public.practitioner_gallery for insert to authenticated
with check (auth.uid() = practitioner_id);

create policy "Practitioners can update their own gallery images"
on public.practitioner_gallery for update to authenticated
using (auth.uid() = practitioner_id)
with check (auth.uid() = practitioner_id);

create policy "Practitioners can delete their own gallery images"
on public.practitioner_gallery for delete to authenticated
using (auth.uid() = practitioner_id);

commit;
