
-- companies: visible to anyone belonging to it, or the super admin
alter table public.companies enable row level security;
create policy companies_select on public.companies for select
  using (public.can_access_company(id));

-- profiles: you can see everyone in your own company (or yourself);
-- only a company_admin (or super_admin) can add/edit/remove profiles
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select
  using (public.can_access_company(company_id) or id = auth.uid());
create policy profiles_admin_write on public.profiles for all
  using (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'))
  with check (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'));

-- company_settings: any team member can read; only an admin can change it
-- (it holds tax rates alongside payout/billing config, so it's kept
-- admin-write-only as a single unit rather than split by department)
alter table public.company_settings enable row level security;
create policy settings_select on public.company_settings for select
  using (public.can_access_company(company_id));
create policy settings_admin_write on public.company_settings for all
  using (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'))
  with check (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'));

-- Business tables: full access (read/write) gated on the matching
-- department, exactly mirroring today's DEPARTMENTS list in data.js.
-- This is a simplification worth knowing about: it doesn't split "can
-- view" from "can edit" within a department the way a bank-grade system
-- might — anyone granted a department can both see and change that
-- department's records, same as the current UI's assumption. Splitting
-- read vs. write per department is a reasonable later refinement, not
-- required for this to already be far stronger than today's UI-only
-- enforcement.
create policy products_access on public.products for all
  using (public.can_access_company(company_id) and public.has_department('products'))
  with check (public.can_access_company(company_id) and public.has_department('products'));

create policy customers_access on public.customers for all
  using (public.can_access_company(company_id) and public.has_department('customers'))
  with check (public.can_access_company(company_id) and public.has_department('customers'));

create policy sales_access on public.sales for all
  using (public.can_access_company(company_id) and public.has_department('sales'))
  with check (public.can_access_company(company_id) and public.has_department('sales'));

create policy expenses_access on public.expenses for all
  using (public.can_access_company(company_id) and public.has_department('expenses'))
  with check (public.can_access_company(company_id) and public.has_department('expenses'));

create policy orders_access on public.orders for all
  using (public.can_access_company(company_id) and public.has_department('orders'))
  with check (public.can_access_company(company_id) and public.has_department('orders'));

create policy sop_access on public.sop for all
  using (public.can_access_company(company_id) and public.has_department('audit'))
  with check (public.can_access_company(company_id) and public.has_department('audit'));

alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.orders enable row level security;
alter table public.sop enable row level security;

-- audit_log: select-only for anyone with audit department (or admin);
-- insert allowed for any active company member (any action anywhere
-- in the app can generate a log entry) but deliberately NO update or
-- delete policy at all, for anyone, ever — that's what makes it
-- append-only. Even a company_admin cannot alter or remove an entry
-- through the API.
create policy audit_log_select on public.audit_log for select
  using (public.can_access_company(company_id) and public.has_department('audit'));
create policy audit_log_insert on public.audit_log for insert
  with check (public.can_access_company(company_id));
alter table public.audit_log enable row level security;

-- auditor_grants / audit_visit_log: admin-only for now via this
-- connector. The auditor's own read-only session isn't a Supabase Auth
-- user at all (kept code-based, per your call) so its access will go
-- through a separate SECURITY DEFINER function when the login flow is
-- wired up next — not through these RLS policies, which are for the
-- admin's "Auditor access" management page only.
create policy auditor_grants_admin on public.auditor_grants for all
  using (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'))
  with check (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'));
alter table public.auditor_grants enable row level security;

create policy audit_visit_log_admin_select on public.audit_visit_log for select
  using (public.can_access_company(company_id) and public.my_role() in ('company_admin','super_admin'));
alter table public.audit_visit_log enable row level security;
