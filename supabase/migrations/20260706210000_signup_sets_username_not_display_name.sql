-- Signup now collects a username (the URL handle) instead of a display
-- name — display_name moves to the profile edit page instead, alongside
-- bio/avatar. Update the trigger to match: it now writes username from
-- signup metadata, and leaves display_name unset (null) until the user
-- fills it in later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'client'),
    new.raw_user_meta_data ->> 'username'
  );
  return new;
end;
$$;
