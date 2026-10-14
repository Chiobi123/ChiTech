-- ChiiTech migration 39 — receipt photos move toward Supabase Storage (audit P1).
-- ADDITIVE ONLY: nothing existing is altered or dropped, so staging this
-- file changes no live behavior. The frontend code switch (upload to the
-- bucket with fallback to image_data) plus backfill land separately, once
-- database access is available to verify them end to end.
--
-- Design:
--   * private bucket `receipts` (no public URLs, ever — signed URLs only).
--   * object path convention: {company_id}/{receipt_id}.jpg — the first
--     path segment is the owning company, which is what the policies check.
--   * public.receipts gains a nullable storage_path; existing image_data
--     rows keep working until the backfill sets storage_path per row.
--   * policies mirror the receipts table policy from migration 23
--     (own company only, via app_private.my_company_id()).

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

alter table public.receipts add column if not exists storage_path text;

-- New Storage rows insert image_data = null (the upload holds the bytes),
-- so the legacy NOT NULL constraint is relaxed here. Existing rows are
-- untouched; their backfill + space reclaim stay documented below.
alter table public.receipts alter column image_data drop not null;

drop policy if exists "receipts_select_own_company" on storage.objects;
create policy "receipts_select_own_company" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = app_private.my_company_id()::text);

drop policy if exists "receipts_insert_own_company" on storage.objects;
create policy "receipts_insert_own_company" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = app_private.my_company_id()::text);

drop policy if exists "receipts_update_own_company" on storage.objects;
create policy "receipts_update_own_company" on storage.objects for update to authenticated
  using (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = app_private.my_company_id()::text)
  with check (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = app_private.my_company_id()::text);

drop policy if exists "receipts_delete_own_company" on storage.objects;
create policy "receipts_delete_own_company" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts'
    and (storage.foldername(name))[1] = app_private.my_company_id()::text);

-- Backfill (run once with the service_role key, AFTER the frontend code
-- switch ships; not part of this migration):
--   for each receipts row where storage_path is null:
--     1. decode image_data (data URL) and upload to
--        receipts/{company_id}/{id}.jpg with content-type image/jpeg,
--     2. update public.receipts set storage_path = '{company_id}/{id}.jpg'
--        where id = <row id>.
-- Cleanup (later migration, only after every row has storage_path):
--   null out migrated image_data to reclaim space (the NOT NULL
--   constraint was already relaxed above, so no alter is needed).
