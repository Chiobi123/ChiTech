-- ChiiTech migration 40 — company_summary() RPC (audit P1 boot path).
-- A single round-trip aggregate over the caller's own company, so the
-- frontend can stop downloading full history for headline numbers.
-- No arguments: the company always comes from app_private.my_company_id(),
-- which reads the caller's own profiles row — a caller can never ask for
-- another company's numbers. STABLE + SECURITY DEFINER like the other
-- helper functions. Frontend cross-checks counts against loaded rows and
-- falls back to local computation on any mismatch (see data.js), so a
-- stale or missing RPC can never corrupt displayed totals.

create or replace function public.company_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company_id', app_private.my_company_id(),
    'sales_count', (select count(*) from public.sales where company_id = app_private.my_company_id()),
    'sales_total', (select coalesce(sum(total), 0) from public.sales where company_id = app_private.my_company_id()),
    'sales_vat_total', (select coalesce(sum(vat), 0) from public.sales where company_id = app_private.my_company_id()),
    'sales_cost_total', (select coalesce(sum(cost), 0) from public.sales where company_id = app_private.my_company_id()),
    'expenses_count', (select count(*) from public.expenses where company_id = app_private.my_company_id()),
    'expenses_total', (select coalesce(sum(amount), 0) from public.expenses where company_id = app_private.my_company_id()),
    'products_count', (select count(*) from public.products where company_id = app_private.my_company_id()),
    'customers_count', (select count(*) from public.customers where company_id = app_private.my_company_id()),
    'orders_count', (select count(*) from public.orders where company_id = app_private.my_company_id()),
    'generated_at', now()
  );
$$;
revoke all on function public.company_summary() from public;
grant execute on function public.company_summary() to authenticated;
