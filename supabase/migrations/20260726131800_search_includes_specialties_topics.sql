-- Neither specialties nor topics fed the free-text search index before
-- this — refresh_practitioner_search_document only combined display_name
-- + bio + active service name/description, so typing "любов" or "таро"
-- as plain text matched nothing unless that exact word happened to
-- appear in someone's bio; only the checkbox filters caught it. This
-- folds both taxonomies in, as both bg and en labels (a seeker's query
-- language isn't tied to the practitioner's own bio language).
--
-- The label mapping is embedded directly in SQL rather than read from
-- data/specialties.json / data/topics.json (which remain the single
-- source of truth for what the UI shows) — search_text is computed
-- purely in the database by a trigger, with no app round-trip, so a
-- small amount of duplication here is the only way to get human-
-- readable words into it. Same shape-not-taxonomy split already used
-- for the specialties/topics CHECK constraints: if the taxonomy ever
-- changes, this mapping needs a matching migration, same as those.

begin;

create or replace function public.refresh_practitioner_search_document(target_practitioner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  combined_text text;
  tag_text text;
begin
  select
    coalesce(p.display_name, '') || ' ' ||
    coalesce(pp.bio, '') || ' ' ||
    coalesce(string_agg(coalesce(s.name, '') || ' ' || coalesce(s.description, ''), ' '), '')
  into combined_text
  from public.practitioner_profiles pp
  join public.profiles p on p.id = pp.id
  left join public.services s on s.practitioner_id = pp.id and s.is_active = true
  where pp.id = target_practitioner_id
  group by p.display_name, pp.bio;

  select coalesce(string_agg(v.label, ' '), '')
  into tag_text
  from public.practitioner_profiles pp
  cross join lateral unnest(pp.specialties || pp.topics) as tag_key
  join (values
    ('tarot', 'Таро Tarot'),
    ('astrology', 'Астрология Astrology'),
    ('reiki', 'Рейки Reiki'),
    ('coaching', 'Коучинг Coaching'),
    ('love', 'Любов Love'),
    ('career', 'Кариера Career'),
    ('business', 'Бизнес Business'),
    ('life_path', 'Житейски път Life path'),
    ('decisions', 'Решения Decisions'),
    ('trust', 'Доверие Trust'),
    ('energy_protection', 'Енергия и защита Energy protection'),
    ('inner_balance', 'Вътрешен баланс Inner balance')
  ) as v(tag_key, label) on v.tag_key = tag_key
  where pp.id = target_practitioner_id;

  insert into public.practitioner_search_documents (practitioner_id, search_text)
  values (target_practitioner_id, trim(coalesce(combined_text, '') || ' ' || coalesce(tag_text, '')))
  on conflict (practitioner_id) do update set search_text = excluded.search_text;
end;
$$;

-- The sync trigger only fired on bio changes (plus insert/delete) — a
-- practitioner editing their specialties or topics never refreshed the
-- search document at all, a second, independent staleness gap from the
-- text-content one above. Recreated (not "or replace", triggers don't
-- support that) with both new columns added to the "update of" list.
drop trigger if exists practitioner_profiles_search_sync on public.practitioner_profiles;

create trigger practitioner_profiles_search_sync
  after insert or update of bio, specialties, topics or delete on public.practitioner_profiles
  for each row execute function public.trg_refresh_search_on_practitioner_profiles();

-- Recompute every existing document with the fixed function so already-
-- set specialties/topics are searchable immediately, not just after the
-- next edit.
do $$
declare
  r record;
begin
  for r in select id from public.practitioner_profiles loop
    perform public.refresh_practitioner_search_document(r.id);
  end loop;
end $$;

commit;
