-- Session documents: raise the per-side limit from 1 to 3, symmetrically for
-- both parties, and allow image types (JPG/PNG) alongside the document types.
--
-- The table was already row-per-file (20260825121000), but a `unique
-- (booking_id, side)` capped it at one, and the download RPC returned a single
-- path per side. This migration:
--   1. drops that unique so multiple files per side are allowed;
--   2. caps each side at 3 with a BEFORE INSERT trigger (a DB-level backstop
--      against a concurrent double-submit racing past the app-side count check,
--      the same discipline as the gallery/videos 9-caps);
--   3. recreates get_session_document_path to be keyed by a single document id
--      (downloads/removes are now per-file, not per-side);
--   4. adds image/jpeg + image/png to the bucket's MIME allowlist (the app's
--      ALLOWED_DOCUMENT_TYPES + magic-byte validation gain the same two).
-- The rest of the model is unchanged: private storage, 60s signed URLs, 14-day
-- post-session deletion, and the append-only exchange record per file.

begin;

-- 1. Drop the one-per-side cap.
alter table public.session_documents
  drop constraint session_documents_booking_id_side_key;

-- 2. Cap each (booking, side) at 3 files. A trigger, because a plain constraint
--    can't count sibling rows; enforced on INSERT (a replace is now remove+add,
--    both of which pass through here). MAX = 3, matching
--    SESSION_DOCUMENT_MAX_FILES_PER_SIDE in lib/documents/config.ts.
create or replace function public.enforce_session_document_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.session_documents
    where booking_id = new.booking_id and side = new.side
  ) >= 3 then
    raise exception 'session_document_limit_reached'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger session_documents_limit
  before insert on public.session_documents
  for each row execute function public.enforce_session_document_limit();

-- 3. Per-file path reader. Same two-party boundary as before (definer bypasses
--    RLS, re-imposes it here), now keyed by the document id so a single file
--    can be signed/downloaded/removed. Either party may read either side's file.
drop function public.get_session_document_path(uuid, text);

create function public.get_session_document_path(p_document_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select d.storage_path
  from public.session_documents d
  join public.bookings b on b.id = d.booking_id
  where d.id = p_document_id
    and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
$$;

grant execute on function public.get_session_document_path(uuid) to authenticated;

-- 4. Extend the bucket allowlist with the two image types. (The app validates
--    the actual magic bytes on top of this — see lib/documents/validate.ts.)
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png'
]
where id = 'session-documents';

commit;
