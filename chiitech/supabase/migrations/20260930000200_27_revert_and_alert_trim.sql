-- ChiiTech migration 27 — plan revert, alert-metadata minimization.
-- 1) set_subscription_status gains an optional plan change, so trials and
--    Pro users can be reverted to Free without touching other rows.
-- 2) platform_overview strips raw amounts/thresholds from alert metadata.
--    The console keeps company, severity, type, title, timestamps, status
--    and reference ids (enough to triage); money figures stay out.

create or replace function public.set_subscription_status(
  p_company_id uuid, p_status text, p_renew_days integer default 30,
  p_plan_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  if p_status not in ('trial','active','past_due','cancelled') then raise exception 'Invalid status'; end if;
  if p_plan_id is not null and not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan';
  end if;
  select plan_id into v_plan from public.subscriptions where company_id = p_company_id;
  if v_plan is null then
    insert into public.subscriptions(company_id, plan_id, status, renews_at, updated_at)
    values (p_company_id, coalesce(p_plan_id, 'free'), p_status,
      now() + (coalesce(p_renew_days,30) || ' days')::interval, now());
  else
    update public.subscriptions
    set status = p_status,
        plan_id = coalesce(p_plan_id, plan_id),
        renews_at = now() + (coalesce(p_renew_days,30) || ' days')::interval,
        updated_at = now()
    where company_id = p_company_id;
  end if;
  insert into public.audit_log(company_id, action, details, "user")
  values (p_company_id, 'billing.status_change',
    'Subscription set to ' || p_status || coalesce(' on plan ' || p_plan_id, '') || '.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.set_subscription_status(uuid, text, integer, text) from public;
grant execute on function public.set_subscription_status(uuid, text, integer, text) to authenticated;

create or replace function public.platform_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;

  select jsonb_build_object(
    'companies', coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'code',c.code,'plan',c.plan,
      'created_at',c.created_at,'deleted_at',c.deleted_at,
      'owner_email',(select p.email from public.profiles p where p.company_id=c.id and p.role='company_admin' limit 1),
      'team_size',(select count(*) from public.profiles p where p.company_id=c.id)
    ) order by c.created_at desc) from public.companies c),'[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'email',p.email,'name',p.name,'role',p.role,
      'company_id',p.company_id,'departments',p.departments,'active',p.active
    ) order by p.created_at desc) from public.profiles p),'[]'::jsonb),
    'sales_by_company', coalesce((select jsonb_agg(jsonb_build_object(
      'company_id',s.company_id,'total',s.total
    )) from (
      select company_id, coalesce(sum(total),0) total from public.sales group by company_id
    ) s),'[]'::jsonb),
    'security_alerts', coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'company_id',a.company_id,'company_name',c.name,
      'severity',a.severity,'event_type',a.event_type,'title',a.title,
      'description',a.description,'source',a.source,'status',a.status,
      'metadata',(a.metadata - 'amount') - 'threshold',
      'created_at',a.created_at,'resolved_at',a.resolved_at
    ) order by a.created_at desc) from public.security_alerts a
      left join public.companies c on c.id=a.company_id
      where a.status <> 'dismissed' limit 100),'[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
      'id',pl.id,'name',pl.name,'price',pl.price,'features',pl.features,'active',pl.active
    ) order by pl.price) from public.plans pl),'[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object(
      'company_id',s.company_id,'plan_id',s.plan_id,'status',s.status,'renews_at',s.renews_at
    )) from public.subscriptions s),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.platform_overview() from public;
grant execute on function public.platform_overview() to authenticated;
