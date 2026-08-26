-- Session document attachments — the storage bucket.
--
-- Unlike `avatars` (public, so practitioner photos are visible to anyone
-- browsing), these are private documents exchanged between the two
-- parties of a single booking — a client's contract, a practitioner's
-- summary. So: public = false, and access is gated entirely by RLS on
-- storage.objects + short-lived signed URLs minted server-side. Nothing
-- here is ever served via getPublicUrl.
--
-- file_size_limit is a HARD backstop, deliberately set well above the
-- real operational cap. The authoritative size check is server-side
-- (SESSION_DOCUMENT_MAX_BYTES, default 10MB — see lib/documents/config.ts):
-- an operator tunes that env down/up without a migration, and this
-- ceiling only exists so a bug or a forged multipart body can't smuggle
-- an enormous object past the app layer. Keep it comfortably above the
-- env default so lowering the env is the only knob that matters in
-- practice.
--
-- allowed_mime_types is the fixed, non-configurable allowlist: PDF, the
-- two Word formats, and plain text. The app additionally validates the
-- actual file bytes (magic number), so this is belt-and-braces against a
-- forged Content-Type, not the primary defence.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-documents',
  'session-documents',
  false,
  26214400, -- 25MB hard ceiling; real cap is the server-side env (default 10MB)
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
);

-- Object paths are "{booking_id}/{side}/{random-token}.{ext}", so
-- foldername(name)[1] is the booking id and foldername(name)[2] is the
-- side ('client' | 'practitioner'). Every policy below is scoped to this
-- bucket and keyed to membership of the parent booking — the SAME
-- two-party boundary the bookings table itself enforces (see
-- create_bookings.sql). The `exists` subquery against public.bookings is
-- itself subject to bookings' own RLS (a user only sees rows where they
-- are the client or practitioner), so this can't be used to probe
-- someone else's booking id.

-- SELECT: EITHER party may read EITHER slot. This is what lets a client
-- mint a signed URL for the practitioner's document and vice versa — the
-- whole point of the feature is that each side can open what the other
-- uploaded.
create policy "Booking parties can read session documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'session-documents'
  and exists (
    select 1 from public.bookings b
    where b.id = ((storage.foldername(name))[1])::uuid
      and (b.client_id = auth.uid() or b.practitioner_id = auth.uid())
  )
);

-- INSERT/UPDATE/DELETE: a party may only write into THEIR OWN side's
-- folder — a client can't overwrite or delete the practitioner's slot,
-- and vice versa. The side segment must match the caller's role on the
-- booking.
create policy "Booking parties can upload their own side"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'session-documents'
  and exists (
    select 1 from public.bookings b
    where b.id = ((storage.foldername(name))[1])::uuid
      and (
        ((storage.foldername(name))[2] = 'client' and b.client_id = auth.uid())
        or ((storage.foldername(name))[2] = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

create policy "Booking parties can update their own side"
on storage.objects for update
to authenticated
using (
  bucket_id = 'session-documents'
  and exists (
    select 1 from public.bookings b
    where b.id = ((storage.foldername(name))[1])::uuid
      and (
        ((storage.foldername(name))[2] = 'client' and b.client_id = auth.uid())
        or ((storage.foldername(name))[2] = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);

create policy "Booking parties can delete their own side"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'session-documents'
  and exists (
    select 1 from public.bookings b
    where b.id = ((storage.foldername(name))[1])::uuid
      and (
        ((storage.foldername(name))[2] = 'client' and b.client_id = auth.uid())
        or ((storage.foldername(name))[2] = 'practitioner' and b.practitioner_id = auth.uid())
      )
  )
);
