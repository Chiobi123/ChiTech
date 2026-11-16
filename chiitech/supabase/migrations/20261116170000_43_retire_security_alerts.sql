-- Retire the ChiiTech security-alert feature without touching business records.
-- Apply only after reviewing live function definitions and taking a current backup.
-- Historical alert records are preserved in an archive table for rollback/audit history.
begin;
create table if not exists public.security_alerts_retired_20261116 (like public.security_alerts including all);
insert into public.security_alerts_retired_20261116 select * from public.security_alerts on conflict do nothing;
drop trigger if exists security_alert_audit_trigger on public.audit_log;
drop trigger if exists security_alert_large_expense_trigger on public.expenses;
drop trigger if exists security_alert_large_sale_trigger on public.sales;
create or replace function public.platform_overview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if app_private.my_role()<>'super_admin' then raise exception 'Not authorised'; end if;
 select jsonb_build_object(
  'companies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'plan',c.plan,'created_at',c.created_at,'deleted_at',c.deleted_at,'owner_email',(select p.email from public.profiles p where p.company_id=c.id and p.role='company_admin' limit 1),'team_size',(select count(*) from public.profiles p where p.company_id=c.id)) order by c.created_at desc) from public.companies c),'[]'::jsonb),
  'users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'email',p.email,'name',p.name,'role',p.role,'company_id',p.company_id,'departments',p.departments,'active',p.active) order by p.created_at desc) from public.profiles p),'[]'::jsonb),
  'sales_by_company',coalesce((select jsonb_agg(jsonb_build_object('company_id',s.company_id,'total',s.total)) from (select company_id,coalesce(sum(total),0) total from public.sales group by company_id) s),'[]'::jsonb),
  'plans',coalesce((select jsonb_agg(jsonb_build_object('id',pl.id,'name',pl.name,'price',pl.price,'features',pl.features,'active',pl.active) order by pl.price) from public.plans pl),'[]'::jsonb),
  'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('company_id',s.company_id,'plan_id',s.plan_id,'status',s.status,'renews_at',s.renews_at)) from public.subscriptions s),'[]'::jsonb)
 ) into v_result;
 return v_result;
end; $$;
revoke all on function public.platform_overview() from public;
grant execute on function public.platform_overview() to authenticated;
drop function if exists public.create_security_alert(uuid,text,text,text,text,jsonb);
drop function if exists public.resolve_security_alert(uuid,text);
drop function if exists public.security_alert_from_audit();
drop function if exists public.security_alert_large_expense();
drop function if exists public.security_alert_large_sale();
drop table if exists public.security_alerts;
commit;
