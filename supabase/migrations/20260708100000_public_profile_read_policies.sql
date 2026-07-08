-- Practitioners are publicly discoverable — anyone (including anonymous
-- visitors) can read a practitioner's identity row.
create policy "Anyone can view practitioner identity"
on public.profiles
for select
to public
using (role = 'practitioner');

-- Practitioners can see their clients' display names (for reviews, booking
-- history, etc. later on). This is a self-referential check ("is the
-- current user a practitioner?") against the same table the policy is
-- defined on, which causes infinite recursion if written as a plain
-- subquery in the policy itself — Postgres has to re-apply RLS to the
-- subquery's own access to profiles, including this same policy. Routing
-- the check through a SECURITY DEFINER function breaks the cycle, since
-- the function's internal query bypasses RLS entirely.
create or replace function public.is_practitioner(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'practitioner'
  );
$$;

create policy "Practitioners can view client display names"
on public.profiles
for select
to authenticated
using (
  role = 'client'
  and public.is_practitioner(auth.uid())
);
