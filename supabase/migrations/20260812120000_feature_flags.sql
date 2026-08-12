-- Runtime feature-flag overrides for the admin kill switches.
--
-- Only RUNTIME-scope flags (see lib/flags/registry.ts) ever get a row here;
-- an absent row means the resolver falls through to the env baseline, then the
-- code default. Deploy-scope flags never touch this table.
begin;

create table public.feature_flags (
  key text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- RLS on with ZERO policies denies all anon/authenticated access. The resolver
-- reads and the admin action writes ONLY through the service-role client
-- (which bypasses RLS), so no client can read or toggle a flag directly.
alter table public.feature_flags enable row level security;

commit;
