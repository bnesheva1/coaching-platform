-- The live "is this available?" check runs while someone is still filling
-- out the signup form — i.e. as an anonymous visitor, before they have any
-- session. The profiles table's own SELECT policy only lets a user read
-- their own row, so an anonymous caller querying it directly would always
-- see zero rows regardless of whether a username is actually taken.
--
-- Rather than loosen that policy (which would expose every user's role and
-- display_name to anyone), this function returns only a boolean — nothing
-- about the row itself — and runs as SECURITY DEFINER so it can check
-- existence without needing its own broad read policy.
create or replace function public.is_username_taken(candidate text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where username = lower(candidate)
  );
$$;

grant execute on function public.is_username_taken(text) to anon, authenticated;
