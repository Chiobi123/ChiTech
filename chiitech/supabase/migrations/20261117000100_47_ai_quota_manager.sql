-- Tenant-safe daily Workers AI quota reservations.
create table if not exists public.ai_usage_user_daily (
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 day date not null, requests integer not null default 0 check(requests>=0),
 estimated_neurons numeric(14,2) not null default 0 check(estimated_neurons>=0),
 primary key(company_id,user_id,day)
);
create table if not exists public.ai_usage_platform_daily (
 day date primary key, requests integer not null default 0 check(requests>=0),
 estimated_neurons numeric(14,2) not null default 0 check(estimated_neurons>=0)
);
create table if not exists public.ai_quota_config (
 id smallint primary key default 1 check(id=1),
 daily_neuron_budget numeric(14,2) not null default 8000 check(daily_neuron_budget>0),
 reserve_neurons numeric(14,2) not null default 2000 check(reserve_neurons>=0),
 user_share numeric(5,4) not null default 0.30 check(user_share>0 and user_share<=1),
 shared_pool_threshold numeric(5,4) not null default 0.70 check(shared_pool_threshold>0 and shared_pool_threshold<=1),
 updated_at timestamptz not null default now()
);
insert into public.ai_quota_config(id,daily_neuron_budget,reserve_neurons,user_share,shared_pool_threshold)
values(1,8000,2000,0.30,0.70) on conflict(id) do nothing;
alter table public.ai_usage add column if not exists estimated_neurons numeric(14,2) not null default 0;
alter table public.ai_usage_user_daily enable row level security;
alter table public.ai_usage_platform_daily enable row level security;
alter table public.ai_quota_config enable row level security;
revoke all on public.ai_usage_user_daily from anon,authenticated;
revoke all on public.ai_usage_platform_daily from anon,authenticated;
revoke all on public.ai_quota_config from anon,authenticated;

create or replace function public.reserve_ai_quota(p_estimated_neurons numeric default 40)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_uid uuid:=auth.uid(); v_company uuid; v_role text;
 v_active_companies integer; v_active_users integer;
 v_budget numeric(14,2); v_reserve numeric(14,2); v_user_share numeric(5,4); v_shared_threshold numeric(5,4);
 v_company_budget numeric(14,2); v_day date:=(now() at time zone 'utc')::date;
 v_global_used numeric(14,2):=0; v_company_used numeric(14,2):=0; v_user_used numeric(14,2):=0;
 v_estimate numeric(14,2):=greatest(1,least(coalesce(p_estimated_neurons,40),1000));
begin
 if v_uid is null then return jsonb_build_object('allowed',false,'reason','authentication_required'); end if;
 select p.company_id,p.role into v_company,v_role from public.profiles p
 where p.id=v_uid and p.active is true and p.deleted_at is null;
 if v_company is null or v_role not in('company_admin','worker','auditor') then
  return jsonb_build_object('allowed',false,'reason','workspace_access_required');
 end if;
 if not exists(select 1 from public.companies c where c.id=v_company and c.deleted_at is null) then
  return jsonb_build_object('allowed',false,'reason','workspace_unavailable');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('chiitech-ai-global:'||v_day::text,0));
 select daily_neuron_budget,reserve_neurons,user_share,shared_pool_threshold
 into v_budget,v_reserve,v_user_share,v_shared_threshold from public.ai_quota_config where id=1;
 v_budget:=coalesce(v_budget,8000); v_reserve:=coalesce(v_reserve,2000);
 v_user_share:=coalesce(v_user_share,0.30); v_shared_threshold:=coalesce(v_shared_threshold,0.70);
 select count(distinct p.company_id)::integer into v_active_companies
 from public.profiles p join public.companies c on c.id=p.company_id
 where p.active is true and p.deleted_at is null and p.role in('company_admin','worker','auditor') and c.deleted_at is null;
 select count(*)::integer into v_active_users from public.profiles p
 where p.company_id=v_company and p.active is true and p.deleted_at is null and p.role in('company_admin','worker','auditor');
 v_company_budget:=greatest(1,floor(greatest(1,v_budget-v_reserve)/greatest(1,v_active_companies)));
 insert into public.ai_usage_platform_daily(day) values(v_day) on conflict(day) do nothing;
 select estimated_neurons into v_global_used from public.ai_usage_platform_daily where day=v_day for update;
 insert into public.ai_usage(company_id,day) values(v_company,v_day) on conflict(company_id,day) do nothing;
 select estimated_neurons into v_company_used from public.ai_usage where company_id=v_company and day=v_day for update;
 insert into public.ai_usage_user_daily(company_id,user_id,day) values(v_company,v_uid,v_day) on conflict(company_id,user_id,day) do nothing;
 select estimated_neurons into v_user_used from public.ai_usage_user_daily where company_id=v_company and user_id=v_uid and day=v_day for update;
 if coalesce(v_global_used,0)+v_estimate>greatest(1,v_budget-v_reserve) then
  return jsonb_build_object('allowed',false,'reason','platform_daily_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 if coalesce(v_company_used,0)+v_estimate>v_company_budget then
  return jsonb_build_object('allowed',false,'reason','company_daily_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 -- Team members have a 30% normal share. They may draw from the shared pool
 -- until 70% of the company's daily allocation is consumed.
 if v_active_users>1 and coalesce(v_user_used,0)+v_estimate>(v_company_budget*v_user_share)
    and coalesce(v_company_used,0)+v_estimate>(v_company_budget*v_shared_threshold) then
  return jsonb_build_object('allowed',false,'reason','user_shared_pool_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 update public.ai_usage_platform_daily set requests=requests+1,estimated_neurons=estimated_neurons+v_estimate where day=v_day;
 update public.ai_usage set questions=questions+1,estimated_neurons=estimated_neurons+v_estimate where company_id=v_company and day=v_day;
 update public.ai_usage_user_daily set requests=requests+1,estimated_neurons=estimated_neurons+v_estimate where company_id=v_company and user_id=v_uid and day=v_day;
 return jsonb_build_object('allowed',true,'estimated_neurons_reserved',v_estimate,
  'company_budget',v_company_budget,'company_remaining',greatest(0,v_company_budget-coalesce(v_company_used,0)-v_estimate),
  'global_remaining',greatest(0,(v_budget-v_reserve)-coalesce(v_global_used,0)-v_estimate),
  'reset_at',(v_day+1)::text||'T00:00:00Z');
end; $$;
revoke all on function public.reserve_ai_quota(numeric) from public,anon;
grant execute on function public.reserve_ai_quota(numeric) to authenticated;
