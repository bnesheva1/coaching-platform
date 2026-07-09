-- Bug: deleting a practitioner_profiles row cascades to delete its
-- services rows, which fires the services delete trigger, which calls
-- refresh_practitioner_search_document for a practitioner_id that no
-- longer exists in practitioner_profiles (it was removed earlier in the
-- same cascade) — the resulting insert then violates
-- practitioner_search_documents_practitioner_id_fkey. Surfaced when
-- attempting to bulk-delete test accounts via `delete from auth.users`.
--
-- Fix: bail out (and clean up any stale document row) if the practitioner
-- no longer exists, instead of unconditionally trying to write one.

create or replace function public.refresh_practitioner_search_document(target_practitioner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  combined_text text;
begin
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

  insert into public.practitioner_search_documents (practitioner_id, search_text)
  values (target_practitioner_id, coalesce(combined_text, ''))
  on conflict (practitioner_id) do update set search_text = excluded.search_text;
end;
$$;
