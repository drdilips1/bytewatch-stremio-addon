-- One-time setup for "Account & sync" in PDF Editor.
-- Supabase dashboard → SQL Editor → New query → paste all of this → Run.

-- Private bucket for each user's PDFs and settings.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pdfs', 'pdfs', false, 52428800)
on conflict (id) do nothing;

-- Every signed-in user may only see and change files inside their own folder (<user id>/...).
create policy "pdf editor: read own files" on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pdf editor: add own files" on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pdf editor: update own files" on storage.objects for update to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pdf editor: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
