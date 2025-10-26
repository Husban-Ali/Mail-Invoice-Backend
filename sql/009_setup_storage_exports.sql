-- Setup Supabase Storage for Exports
-- Run this in your Supabase SQL Editor

-- 1. Ensure the bucket exists and is public
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', true)
on conflict (id) do update
set public = true;

-- 2. Drop existing policies if any (to avoid conflicts)
drop policy if exists "Users can upload to own folder" on storage.objects;
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Users can update own files" on storage.objects;
drop policy if exists "Users can delete own files" on storage.objects;

-- 3. Allow authenticated users to upload to their own folder
create policy "Users can upload to own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'invoices' 
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Allow public read access to all files in the bucket
create policy "Public read access"
on storage.objects for select
to public
using (bucket_id = 'invoices');

-- 5. Allow users to update their own files
create policy "Users can update own files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'invoices' 
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 6. Allow users to delete their own files
create policy "Users can delete own files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'invoices' 
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 7. Verify the bucket is public
select id, name, public, created_at
from storage.buckets
where id = 'invoices';
