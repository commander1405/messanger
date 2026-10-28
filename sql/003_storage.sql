-- Storage buckets for DarkKnight Messenger
-- Create buckets in Dashboard or via SQL:

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('attachments', 'attachments', false, 52428800, null)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit;

-- Avatars: public read, own folder write
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_owner_write on storage.objects;
create policy avatars_owner_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Private attachments: path = {conversation_id}/{user_id}/...
drop policy if exists attachments_member_read on storage.objects;
create policy attachments_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_conversation_member(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

drop policy if exists attachments_member_write on storage.objects;
create policy attachments_member_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_conversation_member(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
    and (storage.foldername(name))[2] = auth.uid()::text
  );
