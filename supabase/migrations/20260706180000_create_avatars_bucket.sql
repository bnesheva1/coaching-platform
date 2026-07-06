-- Create the bucket: public (photos are meant to be visible to anyone
-- browsing practitioner profiles), capped at 2MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']);

-- Anyone can view avatar images (matches the public-bucket setting, but
-- explicit policies are still the mechanism Storage checks for API access)
create policy "Avatar images are publicly accessible"
on storage.objects for select
to public
using (bucket_id = 'avatars');

-- A practitioner can only upload/update/delete files inside a folder
-- named after their own user id — e.g. "3f9a.../avatar"
create policy "Practitioners can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Practitioners can update their own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Practitioners can delete their own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
