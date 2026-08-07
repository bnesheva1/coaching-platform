-- Rename rate limits + username redirects.
--
-- Two tables, both locked down (no authenticated grants) — everything
-- touching them goes through the service role (lib/rename-limits.ts) or a
-- SECURITY DEFINER RPC, the same shape as other write-audited data here.

-- 1. Audit log of every display-name / username change. Doubles as the
--    rate-limit counter (count rows for a user+field in the trailing
--    window) so there's a single source of truth for both "how many
--    changes remain" and "who renamed to what, when" (identity disputes).
create table public.rename_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field text not null check (field in ('display_name', 'username')),
  old_value text,
  new_value text not null,
  created_at timestamptz not null default now()
);

create index rename_events_user_field_idx on public.rename_events (user_id, field, created_at desc);

alter table public.rename_events enable row level security;
-- No policy on purpose: rows are written and read only via the service
-- role. A client never touches this table directly.

-- 2. Previous usernames, kept so an old handle keeps resolving (redirect,
--    not 404) after a change, and so a released handle can't be claimed by
--    anyone else while it's still redirecting. Usernames are always stored
--    normalized (lowercase) — see lib/validation/username.ts — so a plain
--    UNIQUE on the column is a case-correct global reservation.
create table public.username_history (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioner_profiles(id) on delete cascade,
  username text not null unique,
  released_at timestamptz not null default now()
);

create index username_history_practitioner_idx on public.username_history (practitioner_id);

alter table public.username_history enable row level security;
-- No authenticated grants: written via the service role in updateUsername,
-- read only through resolve_username_redirect below.

-- is_username_taken now also treats another practitioner's PAST username as
-- taken (the reclaim guard), while still letting a practitioner reclaim
-- their own old handle (exclude_id filters out their own rows in both
-- tables). Signature unchanged, so replace in place.
create or replace function public.is_username_taken(candidate text, exclude_id uuid default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.practitioner_profiles
      where username = lower(candidate)
        and (exclude_id is null or id <> exclude_id)
    )
    or exists (
      select 1 from public.username_history
      where username = lower(candidate)
        and (exclude_id is null or practitioner_id <> exclude_id)
    );
$$;

grant execute on function public.is_username_taken(text, uuid) to anon, authenticated;

-- Public redirect resolver for /p/[username]: given a handle that isn't a
-- live username, return the current username of whoever used to hold it
-- (following through multiple renames via practitioner_id), or null.
create function public.resolve_username_redirect(candidate text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select pp.username
  from public.username_history uh
  join public.practitioner_profiles pp on pp.id = uh.practitioner_id
  where uh.username = lower(candidate)
  limit 1;
$$;

grant execute on function public.resolve_username_redirect(text) to anon, authenticated;
