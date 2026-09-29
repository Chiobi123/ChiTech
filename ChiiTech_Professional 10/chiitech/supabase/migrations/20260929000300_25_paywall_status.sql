-- ChiiTech migration 25 — pay-to-use access + trial/suspend controls.
-- Model change: every feature is available to every paying company.
-- Access is governed by subscription STATUS (active/trial = in;
-- past_due/cancelled = billing-only), never by feature tiers.
-- The Free 3-seat invitation cap is removed (was a tier rule).

-- Super Admin: set any company's subscription state. Trials, suspensions
-- and reinstatements all flow through here and are audit-logged.
create or replace function public.set_subscription_status(
  p_company_id uuid, p_status text, p_renew_days integer default 30)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  if p_status not in ('trial','active','past_due','cancelled') then raise exception 'Invalid status'; end if;
  select plan_id into v_plan from public.subscriptions where company_id = p_company_id;
  if v_plan is null then
    insert into public.subscriptions(company_id, plan_id, status, renews_at, updated_at)
    values (p_company_id, 'pro', p_status, now() + (coalesce(p_renew_days,30) || ' days')::interval, now());
  else
    update public.subscriptions
    set status = p_status,
        renews_at = now() + (coalesce(p_renew_days,30) || ' days')::interval,
        updated_at = now()
    where company_id = p_company_id;
  end if;
  insert into public.audit_log(company_id, action, details, "user")
  values (p_company_id, 'billing.status_change', 'Subscription set to ' || p_status || '.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.set_subscription_status(uuid, text, integer) from public;
grant execute on function public.set_subscription_status(uuid, text, integer) to authenticated;

-- invite_worker without the Free seat cap. Email-bound, expiring,
-- single-use token rules are unchanged (see migration 22).
create or replace function public.invite_worker(p_email text, p_departments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_id uuid;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'Invalid email'; end if;

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
