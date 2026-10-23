-- ChiiTech migration 36 — deactivated auditors lose API reads too.
-- App boot already blocks inactive auditors, but the SELECT policies did
-- not check active, so a paused auditor's still-valid JWT could keep
-- reading via direct API calls. Now every auditor_read policy also
-- requires the caller's own profile to be active.

drop policy if exists sales_auditor_read on public.sales;
create policy sales_auditor_read on public.sales for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists expenses_auditor_read on public.expenses;
create policy expenses_auditor_read on public.expenses for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists products_auditor_read on public.products;
create policy products_auditor_read on public.products for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists customers_auditor_read on public.customers;
create policy customers_auditor_read on public.customers for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists orders_auditor_read on public.orders;
create policy orders_auditor_read on public.orders for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists sop_auditor_read on public.sop;
create policy sop_auditor_read on public.sop for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists findings_auditor_read on public.audit_findings;
create policy findings_auditor_read on public.audit_findings for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists audit_log_auditor_read on public.audit_log;
create policy audit_log_auditor_read on public.audit_log for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
drop policy if exists settings_auditor_read on public.company_settings;
create policy settings_auditor_read on public.company_settings for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor'
    and exists (select 1 from public.profiles where id = auth.uid() and active is not false));
