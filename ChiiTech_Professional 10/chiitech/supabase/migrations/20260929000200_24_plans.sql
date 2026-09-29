-- ChiiTech migration 24 — Free/Pro subscriptions (spec: 2-plan structure).
-- Super Admin is above plans: gates apply to company roles only.
-- Additive; existing companies keep working (defaulted to Free).

create table if not exists public.plans (
  id text primary key,
  name text not null,
  price numeric not null default 0 check (price >= 0),
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans(id, name, price, features, active) values
  ('free', 'Free', 0,
   '["Dashboard","Sales","Products","Customers","Orders","Expenses","Basic tax (VAT)","Team up to 3","Password + Google login"]'::jsonb, true),
  ('pro', 'Pro', 5000,
   '["Everything in Free","Audit suite + auditor access","Growth engine + AI analysis","Import center (CSV/Excel/JSON)","Photo receipts","Spending limits","Close-the-month lock","Security alerts center","Unlimited team + invitations","Data exports"]'::jsonb, true)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_id text not null default 'free' references public.plans(id),
  status text not null default 'active'
    check (status in ('trial','active','past_due','cancelled','pending')),
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);

drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans for all
  using (app_private.my_role() = 'super_admin')
  with check (app_private.my_role() = 'super_admin');

drop policy if exists subscriptions_access on public.subscriptions;
create policy subscriptions_access on public.subscriptions for select
  using (company_id = app_private.my_company_id()
     or app_private.my_role() = 'super_admin');
drop policy if exists subscriptions_none_write on public.subscriptions;
-- No direct client writes: all changes go through the RPCs below.

grant select on public.plans to authenticated;
grant select on public.subscriptions to authenticated;

-- Backfill: every existing company gets an active Free subscription.
insert into public.subscriptions(company_id, plan_id, status)
select c.id, 'free', 'active' from public.companies c
on conflict (company_id) do nothing;

-- Super Admin: change a plan's price/features/availability.
create or replace function public.set_plan(p_plan_id text, p_price numeric default null,
  p_features jsonb default null, p_active boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  update public.plans
  set price = coalesce(p_price, price),
      features = coalesce(p_features, features),
      active = coalesce(p_active, active)
  where id = p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
end;
$$;
revoke all on function public.set_plan(text, numeric, jsonb, boolean) from public;
grant execute on function public.set_plan(text, numeric, jsonb, boolean) to authenticated;

-- Company admin: request a plan change (pending until payment confirmed).
create or replace function public.request_plan_change(p_plan_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.plans where id = p_plan_id and active) then
    raise exception 'That plan is not available';
  end if;
  insert into public.subscriptions(company_id, plan_id, status, updated_at)
  values (v_company, p_plan_id, 'pending', now())
  on conflict (company_id) do update set plan_id = excluded.plan_id, status = 'pending', updated_at = now();
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'billing.plan_requested', 'Requested plan: ' || p_plan_id,
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.request_plan_change(text) from public;
grant execute on function public.request_plan_change(text) to authenticated;

-- Super Admin: confirm payment and activate the requested plan.
create or replace function public.confirm_plan(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  select plan_id into v_plan from public.subscriptions where company_id = p_company_id;
  if v_plan is null then raise exception 'No subscription found'; end if;
  update public.subscriptions set status = 'active', renews_at = now() + interval '30 days', updated_at = now()
  where company_id = p_company_id;
  update public.companies set plan = initcap(v_plan) where id = p_company_id;
  insert into public.audit_log(company_id, action, details, "user")
  values (p_company_id, 'billing.plan_confirmed', 'Plan activated: ' || v_plan,
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.confirm_plan(uuid) from public;
grant execute on function public.confirm_plan(uuid) to authenticated;

-- Free cap: 3 team members (admin + 2). Pro is unlimited. Enforced where
-- invitations are issued, so the UI can never bypass it.
create or replace function public.invite_worker(p_email text, p_departments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_plan text;
  v_team int;
  v_id uuid;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'Invalid email'; end if;

  select coalesce(s.plan_id, 'free') into v_plan from public.subscriptions s where s.company_id = v_company;
  if coalesce(v_plan, 'free') = 'free' then
    select count(*) into v_team from public.profiles where company_id = v_company and deleted_at is null;
    if v_team >= 3 then raise exception 'Free plan teams are capped at 3 members — upgrade to Pro for unlimited invitations'; end if;
  end if;

  insert into public.worker_invitations(company_id, email, departments, created_by)
  values (v_company, lower(trim(p_email)), coalesce(p_departments, '[]'::jsonb), auth.uid())
  returning id into v_id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.invite_sent', 'Invitation sent to ' || lower(trim(p_email)) || '.',
    (select email from public.profiles where id = auth.uid()));
  return v_id;
end;
$$;
revoke all on function public.invite_worker(text, jsonb) from public;
grant execute on function public.invite_worker(text, jsonb) to authenticated;

-- platform_overview: add plans + subscriptions so both consoles read one payload.
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
      'metadata',a.metadata,'created_at',a.created_at,'resolved_at',a.resolved_at
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
