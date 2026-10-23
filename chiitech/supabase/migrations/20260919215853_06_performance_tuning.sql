
-- Narrow the "admin write" policies to just insert/update/delete so they
-- stop overlapping with the dedicated select policy on the same table
-- (Postgres was evaluating both on every read).
drop policy profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for insert
  with check (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));
create policy profiles_admin_update on public.profiles for update
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'))
  with check (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));
create policy profiles_admin_delete on public.profiles for delete
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));

drop policy settings_admin_write on public.company_settings;
create policy settings_admin_insert on public.company_settings for insert
  with check (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));
create policy settings_admin_update on public.company_settings for update
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'))
  with check (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));
create policy settings_admin_delete on public.company_settings for delete
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));

-- Wrap the direct auth.uid() call so Postgres evaluates it once per
-- query instead of once per row.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (app_private.can_access_company(company_id) or id = (select auth.uid()));

-- Cover the two foreign keys the linter flagged.
create index sales_customer_id_idx on public.sales(customer_id);
create index audit_visit_log_grant_id_idx on public.audit_visit_log(grant_id);
