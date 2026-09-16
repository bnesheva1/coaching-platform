-- Master PDFs for gated PDF content items — a PRIVATE bucket (public = false),
-- same posture as session-documents. The master file is NEVER served to a buyer
-- directly and NEVER via a signed/bookmarkable URL: the download route
-- (app/api/content/[id]/download) loads the master with the SERVICE ROLE, stamps
-- a per-buyer footer with pdf-lib, and streams the result fresh each time. So the
-- only principals who touch this bucket via RLS are practitioners managing their
-- own masters — buyers have no storage access at all.
--
-- file_size_limit is a hard backstop above the server-side cap; allowed_mime_types
-- is PDF only, belt-and-braces with the app's magic-byte check.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-pdfs',
  'content-pdfs',
  false,
  52428800, -- 50MB hard ceiling; real cap is server-side
  array['application/pdf']
);

-- Object paths are "{content_item_id}/{random-token}.pdf", so
-- foldername(name)[1] is the content item id. Every policy is scoped to this
-- bucket and keyed to owning the parent content item — the same owner boundary
-- content_items itself enforces (the exists subquery is subject to
-- content_items' own RLS, so it can't be used to probe another practitioner's
-- item).
create policy "Owners can read their content masters"
on storage.objects for select to authenticated
using (
  bucket_id = 'content-pdfs'
  and exists (
    select 1 from public.content_items ci
    where ci.id = ((storage.foldername(name))[1])::uuid
      and ci.practitioner_id = auth.uid()
  )
);

create policy "Owners can upload their content masters"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'content-pdfs'
  and exists (
    select 1 from public.content_items ci
    where ci.id = ((storage.foldername(name))[1])::uuid
      and ci.practitioner_id = auth.uid()
  )
);

create policy "Owners can update their content masters"
on storage.objects for update to authenticated
using (
  bucket_id = 'content-pdfs'
  and exists (
    select 1 from public.content_items ci
    where ci.id = ((storage.foldername(name))[1])::uuid
      and ci.practitioner_id = auth.uid()
  )
);

create policy "Owners can delete their content masters"
on storage.objects for delete to authenticated
using (
  bucket_id = 'content-pdfs'
  and exists (
    select 1 from public.content_items ci
    where ci.id = ((storage.foldername(name))[1])::uuid
      and ci.practitioner_id = auth.uid()
  )
);

commit;
