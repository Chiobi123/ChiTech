-- ChiiTech migration 30 — allow the auditor role on profiles.
-- The invitation flow (migration 28) was correct, but these older table
-- CHECKs only knew super_admin/company_admin/worker, so every auditor
-- accept died with a 23514 violation. Auditors are company-bound exactly
-- like workers; super_admin stays the only company-less role.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin','company_admin','worker','auditor'));

alter table public.profiles drop constraint if exists profiles_company_matches_role;
alter table public.profiles add constraint profiles_company_matches_role check (
  (role = 'super_admin' and company_id is null)
  or (role in ('company_admin','worker','auditor') and company_id is not null)
);
