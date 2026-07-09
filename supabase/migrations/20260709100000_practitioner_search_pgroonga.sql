-- Broadens practitioner search beyond display_name to also match bio,
-- service names, and service descriptions, with proper stemming/multi-word
-- handling and relevance ranking — including Bulgarian, which Postgres's
-- built-in Snowball dictionaries do not support.
--
-- Approach: PGroonga (Supabase-supported extension) with its default
-- TokenBigram tokenizer, which handles non-ASCII/Cyrillic text via bigram
-- matching. This is not true linguistic stemming, but in practice gives
-- good recall against Bulgarian's rich inflection because most inflected
-- forms of a word share long runs of bigrams with their root/stem. It does
-- not always match across differing suffixes if too few bigrams overlap
-- (verified in testing: "кристалотерапия" did not match a bio containing
-- only "кристалотерапевтични", since PGroonga's default query mode ANDs
-- all bigram tokens from the query).
--
-- Search spans three source tables (profiles.display_name,
-- practitioner_profiles.bio, services.name/description), so we maintain a
-- denormalized, trigger-synced practitioner_search_documents table (one
-- row per practitioner, concatenated searchable text) and PGroonga-index
-- that single column for unified ranked search.

create extension if not exists pgroonga with schema extensions;

create table public.practitioner_search_documents (
  practitioner_id uuid primary key references public.practitioner_profiles (id) on delete cascade,
  search_text text not null default ''
);

alter table public.practitioner_search_documents enable row level security;

-- Mirrors already-public practitioner content (display name, bio, service
-- names/descriptions), so exposing the concatenated text to anyone is safe.
create policy "Anyone can view practitioner search documents"
on public.practitioner_search_documents
for select
to public
using (true);

-- Recomputes and upserts the search document for one practitioner from the
-- current state of profiles/practitioner_profiles/services.
create or replace function public.refresh_practitioner_search_document(target_practitioner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  combined_text text;
begin
  select
    coalesce(p.display_name, '') || ' ' ||
    coalesce(pp.bio, '') || ' ' ||
    coalesce(string_agg(coalesce(s.name, '') || ' ' || coalesce(s.description, ''), ' '), '')
  into combined_text
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.services s on s.practitioner_id = pp.id
  where pp.id = target_practitioner_id
  group by p.display_name, pp.bio;

  insert into public.practitioner_search_documents (practitioner_id, search_text)
  values (target_practitioner_id, coalesce(combined_text, ''))
  on conflict (practitioner_id) do update set search_text = excluded.search_text;
end;
$$;

create or replace function public.trg_refresh_search_on_practitioner_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.practitioner_search_documents where practitioner_id = old.id;
    return old;
  end if;
  perform public.refresh_practitioner_search_document(new.id);
  return new;
end;
$$;

create trigger practitioner_profiles_search_sync
  after insert or update of bio or delete on public.practitioner_profiles
  for each row execute function public.trg_refresh_search_on_practitioner_profiles();

create or replace function public.trg_refresh_search_on_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.practitioner_profiles where id = new.id) then
    perform public.refresh_practitioner_search_document(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_search_sync
  after update of display_name on public.profiles
  for each row execute function public.trg_refresh_search_on_profiles();

create or replace function public.trg_refresh_search_on_services()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_practitioner_search_document(old.practitioner_id);
    return old;
  end if;
  perform public.refresh_practitioner_search_document(new.practitioner_id);
  if tg_op = 'UPDATE' and old.practitioner_id is distinct from new.practitioner_id then
    perform public.refresh_practitioner_search_document(old.practitioner_id);
  end if;
  return new;
end;
$$;

create trigger services_search_sync
  after insert or update or delete on public.services
  for each row execute function public.trg_refresh_search_on_services();

-- Backfill for practitioners that existed before this migration.
insert into public.practitioner_search_documents (practitioner_id, search_text)
select
  pp.id,
  coalesce(
    coalesce(p.display_name, '') || ' ' ||
    coalesce(pp.bio, '') || ' ' ||
    coalesce(string_agg(coalesce(s.name, '') || ' ' || coalesce(s.description, ''), ' '), ''),
    ''
  )
from public.practitioner_profiles pp
join public.profiles p on p.id = pp.id
left join public.services s on s.practitioner_id = pp.id
group by pp.id, p.display_name, pp.bio
on conflict (practitioner_id) do update set search_text = excluded.search_text;

create index practitioner_search_documents_pgroonga_idx
  on public.practitioner_search_documents
  using pgroonga (practitioner_id, search_text);

-- Replaces the display-name-only search_practitioners function from
-- 20260709090000_search_practitioners_function.sql. security invoker (the
-- default, written explicitly) so it inherits the caller's RLS exactly
-- like a direct query would.
drop function if exists public.search_practitioners(text[], text);

create function public.search_practitioners(
  specialty_keys text[] default null,
  search_query text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  specialties text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    pp.id,
    pp.username,
    p.display_name,
    pp.bio,
    pp.avatar_url,
    pp.specialties
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.practitioner_search_documents psd on psd.practitioner_id = pp.id
  where pp.username is not null
    and (
      specialty_keys is null
      or array_length(specialty_keys, 1) is null
      or pp.specialties && specialty_keys
    )
    and (
      search_query is null
      or search_query = ''
      or psd.search_text &@~ search_query
    )
  order by
    case when search_query is not null and search_query <> ''
      then pgroonga_score(psd.tableoid, psd.ctid)
      else 0
    end desc,
    pp.created_at desc;
$$;

grant execute on function public.search_practitioners(text[], text) to anon, authenticated;
