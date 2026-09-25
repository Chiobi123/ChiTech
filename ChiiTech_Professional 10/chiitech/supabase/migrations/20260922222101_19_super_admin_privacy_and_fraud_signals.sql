-- ChiiTech live migration 19 (RECONSTRUCTED backup, 2026-09-25)
-- Live history: 20260922222101_19_super_admin_privacy_and_fraud_signals
-- Source: pg_get_functiondef() extracted from live project ChiTech b
-- (qmypqghktxlscibgxgxo) via read-only connection. NOT a byte-perfect copy
-- of the original upload; functionally equivalent for disaster recovery.
-- Live 20 (20260923203256_20_imports_and_security_alerts) and live 21
-- (20260923203310_21_security_detection_rules) effects are covered by local
-- files 20260923000100_imports_security_superadmin.sql and
-- 20260923000200_security_detection_rules.sql (different filenames, same
-- objects — verified live 2026-09-25: 3 tables, 3 policies, 9+ functions,
-- 3 triggers, can_access_company isolated).

CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email <> 'igbanichiobiebere@gmail.com' then raise exception 'Not authorised'; end if;

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, null, v_email, 'Platform Admin', 'super_admin', array['all'], true, null)
  on conflict (id) do update set
    company_id = null, email = excluded.email, role = 'super_admin',
    departments = array['all'], active = true, deleted_at = null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_fraud_signals(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_expense_count int;
  v_flagged_count int;
  v_sale_count int;
  v_benford_flag boolean;
  v_leading int[] := array[0,0,0,0,0,0,0,0,0];
  v_digit int;
  v_expected numeric[] := array[30.1,17.6,12.5,9.7,7.9,6.7,5.8,5.1,4.6];
  v_max_drift numeric := 0;
  v_pct numeric;
  v_total_sales int;
  v_concentrated_count int;
  v_team_count int;
  r record;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;

  select count(*), count(*) filter (where flag) into v_expense_count, v_flagged_count
    from public.expenses where company_id = p_company_id;

  select count(*) into v_sale_count from public.sales where company_id = p_company_id;

  for r in select total from public.sales where company_id = p_company_id loop
    v_digit := substring(regexp_replace(round(r.total)::text, '^0+', '') from 1 for 1)::int;
    if v_digit between 1 and 9 then v_leading[v_digit] := v_leading[v_digit] + 1; end if;
  end loop;
  v_total_sales := (select sum(x) from unnest(v_leading) x);
  if v_total_sales >= 15 then
    for i in 1..9 loop
      v_pct := v_leading[i]::numeric / greatest(v_total_sales,1) * 100;
      v_max_drift := greatest(v_max_drift, abs(v_pct - v_expected[i]));
    end loop;
  end if;
  v_benford_flag := v_total_sales >= 15 and v_max_drift > 10;

  select count(*) into v_team_count from public.profiles where company_id = p_company_id;
  select count(*) into v_concentrated_count from public.profiles
    where company_id = p_company_id and (role = 'company_admin' or 'all' = any(departments));

  v_result := jsonb_build_object(
    'expense_flag_ratio', case when v_expense_count > 0 then round(v_flagged_count::numeric / v_expense_count * 100, 1) else 0 end,
    'benford_flag', v_benford_flag,
    'concentrated_access_ratio', case when v_team_count > 0 then round(v_concentrated_count::numeric / v_team_count * 100, 1) else 0 end,
    'sale_count', v_sale_count,
    'expense_count', v_expense_count
  );

  v_result := v_result || jsonb_build_object('risk_level',
    case when v_benford_flag or (v_result->>'expense_flag_ratio')::numeric > 25 then 'high'
         when (v_result->>'expense_flag_ratio')::numeric > 10 or (v_result->>'concentrated_access_ratio')::numeric > 60 then 'medium'
         else 'low' end);

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.platform_fraud_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('company_id', c.id) || public.compute_fraud_signals(c.id)), '[]'::jsonb)
    into v_result
    from public.companies c where c.deleted_at is null;
  return v_result;
end;
$function$
;
