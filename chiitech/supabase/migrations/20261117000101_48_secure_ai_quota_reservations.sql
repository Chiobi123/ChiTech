-- Harden quota reservation: only the trusted Cloudflare Pages server may reserve capacity.
-- End-user JWTs must not be able to drain the shared platform allowance by calling this RPC directly.
create or replace function public.reserve_ai_quota(
 p_user_id uuid,
 p_company_id uuid,
 p_estimated_neurons numeric default 40
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
 v_role text := auth.role();
 v_profile_company uuid;
 v_profile_role text;
 v_active_companies integer;
 v_active_users integer;
 v_budget numeric(14,2);
 v_reserve numeric(14,2);
 v_user_share numeric(5,4);
 v_shared_threshold numeric(5,4);
 v_company_budget numeric(14,2);
 v_day date := (now() at time zone 'utc')::date;
 v_global_used numeric(14,2) := 0;
 v_company_used numeric(14,2) := 0;
 v_user_used numeric(14,2) := 0;
 v_estimate numeric(14,2) := greatest(1, least(coalesce(p_estimated_neurons,40),1000));
begin
 if v_role <> 'service_role' then raise exception 'Quota reservations are server-only'; end if;
 if p_user_id is null or p_company_id is null then raise exception 'User and company are required'; end if;
 select p.company_id,p.role into v_profile_company,v_profile_role
 from public.profiles p where p.id=p_user_id and p.active is true and p.deleted_at is null;
 if v_profile_company is distinct from p_company_id or v_profile_role not in ('company_admin','worker','auditor') then
  raise exception 'User does not belong to the requested active workspace';
 end if;
 if not exists(select 1 from public.companies c where c.id=p_company_id and c.deleted_at is null) then
  raise exception 'Workspace is unavailable';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('chiitech-ai-global:'||v_day::text,0));
 select daily_neuron_budget,reserve_neurons,user_share,shared_pool_threshold
 into v_budget,v_reserve,v_user_share,v_shared_threshold from public.ai_quota_config where id=1;
 v_budget:=coalesce(v_budget,8000); v_reserve:=coalesce(v_reserve,2000);
 v_user_share:=coalesce(v_user_share,0.30); v_shared_threshold:=coalesce(v_shared_threshold,0.70);
 select count(distinct p.company_id)::integer into v_active_companies
 from public.profiles p join public.companies c on c.id=p.company_id
 where p.active is true and p.deleted_at is null and p.role in ('company_admin','worker','auditor') and c.deleted_at is null;
 select count(*)::integer into v_active_users from public.profiles p
 where p.company_id=p_company_id and p.active is true and p.deleted_at is null and p.role in ('company_admin','worker','auditor');
 v_company_budget:=greatest(1,floor(greatest(1,v_budget-v_reserve)/greatest(1,v_active_companies)));
 insert into public.ai_usage_platform_daily(day) values(v_day) on conflict(day) do nothing;
 select estimated_neurons into v_global_used from public.ai_usage_platform_daily where day=v_day for update;
 insert into public.ai_usage(company_id,day) values(p_company_id,v_day) on conflict(company_id,day) do nothing;
 select estimated_neurons into v_company_used from public.ai_usage where company_id=p_company_id and day=v_day for update;
 insert into public.ai_usage_user_daily(company_id,user_id,day) values(p_company_id,p_user_id,v_day) on conflict(company_id,user_id,day) do nothing;
 select estimated_neurons into v_user_used from public.ai_usage_user_daily where company_id=p_company_id and user_id=p_user_id and day=v_day for update;
 if coalesce(v_global_used,0)+v_estimate>greatest(1,v_budget-v_reserve) then
  return jsonb_build_object('allowed',false,'reason','platform_daily_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 if coalesce(v_company_used,0)+v_estimate>v_company_budget then
  return jsonb_build_object('allowed',false,'reason','company_daily_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 if v_active_users>1 and coalesce(v_user_used,0)+v_estimate>(v_company_budget*v_user_share)
    and coalesce(v_company_used,0)+v_estimate>(v_company_budget*v_shared_threshold) then
  return jsonb_build_object('allowed',false,'reason','user_shared_pool_limit','reset_at',(v_day+1)::text||'T00:00:00Z');
 end if;
 update public.ai_usage_platform_daily set requests=requests+1,estimated_neurons=estimated_neurons+v_estimate where day=v_day;
 update public.ai_usage set questions=questions+1,estimated_neurons=estimated_neurons+v_estimate where company_id=p_company_id and day=v_day;
 update public.ai_usage_user_daily set requests=requests+1,estimated_neurons=estimated_neurons+v_estimate where company_id=p_company_id and user_id=p_user_id and day=v_day;
 return jsonb_build_object('allowed',true,'estimated_neurons_reserved',v_estimate,
  'company_budget',v_company_budget,'company_remaining',greatest(0,v_company_budget-coalesce(v_company_used,0)-v_estimate),
  'global_remaining',greatest(0,(v_budget-v_reserve)-coalesce(v_global_used,0)-v_estimate),
  'reset_at',(v_day+1)::text||'T00:00:00Z');
end;
$$;
revoke all on function public.reserve_ai_quota(numeric) from public,anon,authenticated;
revoke all on function public.reserve_ai_quota(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.reserve_ai_quota(uuid,uuid,numeric) to service_role;
