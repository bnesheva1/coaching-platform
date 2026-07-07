-- 1. Reconcile full_name -> display_name (same concept — the public-
--    facing name shown across the app — so no overlapping fields),
--    and add the new username column.
alter table public.profiles
  rename column full_name to display_name;

alter table public.profiles
  add column username text;

-- 2. Case-insensitive uniqueness on username, enforced at the database
--    level via a unique index on the lowercased value.
create unique index profiles_username_lower_idx
  on public.profiles (lower(username));

-- 3. The signup trigger inserts into this table by column name, so it
--    must be updated to match the rename above. This is schema-layer
--    only — the JSON key it reads from signup metadata is untouched,
--    since the actual signup form code isn't changing in this slice.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'client'),
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;
