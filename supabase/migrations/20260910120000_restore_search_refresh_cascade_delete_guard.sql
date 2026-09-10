-- Regression fix. Migration 20260709120000 added a guard to
-- refresh_practitioner_search_document so that deleting a practitioner
-- (which cascades to their services, firing the services search-sync
-- trigger) would NOT try to re-insert a practitioner_search_documents row
-- for the practitioner_profiles row already being removed in the same
-- cascade — the insert otherwise violates
-- practitioner_search_documents_practitioner_id_fkey and the whole delete
-- (including `auth.admin.deleteUser` / dashboard "delete user") fails with
-- an opaque error.
--
-- Migration 20260726131800 (search includes specialties/topics) then did a
-- `create or replace` of this function to fold the taxonomies into
-- search_text — but reintroduced the un-guarded body, silently reverting
-- the 20260709120000 fix. This restores the guard on top of the current
-- (specialties + topics) body: bail out (and clean up any stale document
-- row) when the practitioner no longer exists, instead of re-inserting.
--
-- Surfaced again while bulk-deleting leftover @example.com test accounts.

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
  -- The guard: if the practitioner is gone (e.g. we're mid-cascade from a
  -- profile/account deletion), just drop any stale document and return —
  -- never re-insert a row that would dangle against a deleted FK target.
  if not exists (select 1 from public.practitioner_profiles where id = target_practitioner_id) then
    delete from public.practitioner_search_documents where practitioner_id = target_practitioner_id;
    return;
  end if;

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
  cross join lateral unnest(pp.specialties || pp.topics) as u(tag_key)
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
  ) as v(tag_key, label) on v.tag_key = u.tag_key
  where pp.id = target_practitioner_id;

  insert into public.practitioner_search_documents (practitioner_id, search_text)
  values (target_practitioner_id, trim(coalesce(combined_text, '') || ' ' || coalesce(tag_text, '')))
  on conflict (practitioner_id) do update set search_text = excluded.search_text;
end;
$$;

commit;
