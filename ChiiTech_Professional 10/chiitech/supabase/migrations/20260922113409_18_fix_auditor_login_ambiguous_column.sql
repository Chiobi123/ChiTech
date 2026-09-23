
-- The function's own RETURNS TABLE column `company_id` was shadowing
-- the real auditor_grants.company_id column inside this WHERE clause —
-- PL/pgSQL treats OUT-parameter names as in-scope variables for the
-- whole function body, so `company_id = v_company.id` was ambiguous
-- between "the OUT param" and "the table column" and always errored.
-- This means auditor sign-in has never actually worked end to end.
-- Fixed by qualifying the table reference explicitly.
create or replace function public.auditor_login(p_company_code text, p_access_code text)
returns table(company_id uuid, company_name text, grant_id uuid, grant_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_company record;
  v_grant record;
begin
  select id, name into v_company from public.companies where code = upper(trim(p_company_code));
  if v_company.id is null then raise exception 'Company code not recognised'; end if;

  select * into v_grant from public.auditor_grants ag
    where ag.company_id = v_company.id and ag.code = upper(trim(p_access_code));
  if v_grant.id is null then raise exception 'Auditor access code not recognised'; end if;
  if v_grant.revoked then raise exception 'This auditor access has been revoked'; end if;
  if v_grant.expires_at is not null and now() > v_grant.expires_at then
    raise exception 'This auditor access code has expired';
  end if;

  update public.auditor_grants set last_visit = now() where id = v_grant.id;
  insert into public.audit_visit_log(grant_id, company_id, auditor_name)
    values (v_grant.id, v_company.id, v_grant.name);
  insert into public.audit_log(company_id, action, details, "user")
    values (v_company.id, 'auditor.visit', v_grant.name || ' (auditor) opened the Auditor Command Center', v_grant.name);

  return query select v_company.id, v_company.name, v_grant.id, v_grant.name, v_grant.expires_at;
end;
$$;
