
-- The auditor's read path for everything the Command Center shows.
-- Re-validates the grant fresh on every call (not just at login) so a
-- revoke takes effect immediately on the auditor's next refresh, not
-- just their next sign-in. Returns only the fields the Command Center
-- actually renders — this is the read-only boundary, enforced here
-- rather than relying on the frontend to behave.
create or replace function public.auditor_fetch_data(p_grant_id uuid, p_access_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_grant record;
  v_result jsonb;
begin
  select * into v_grant from public.auditor_grants
    where id = p_grant_id and code = upper(trim(p_access_code));
  if v_grant.id is null or v_grant.revoked
     or (v_grant.expires_at is not null and now() > v_grant.expires_at) then
    raise exception 'Auditor access is no longer valid';
  end if;

  select jsonb_build_object(
    'products', (select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.products p where p.company_id = v_grant.company_id),
    'sales', (select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.sales s where s.company_id = v_grant.company_id),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from public.expenses e where e.company_id = v_grant.company_id),
    'sop', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.sop x where x.company_id = v_grant.company_id),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (
        select * from public.audit_log where company_id = v_grant.company_id order by time desc limit 200
      ) a),
    'team_count', (select count(*) from public.profiles where company_id = v_grant.company_id),
    'concentrated_count', (select count(*) from public.profiles
        where company_id = v_grant.company_id and (role = 'company_admin' or 'all' = any(departments)))
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.auditor_fetch_data(uuid, text) from public;
grant execute on function public.auditor_fetch_data(uuid, text) to anon, authenticated;
