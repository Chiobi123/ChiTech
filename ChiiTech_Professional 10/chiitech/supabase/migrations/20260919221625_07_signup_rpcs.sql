
-- Called right after a brand-new admin's supabase.auth.signUp() succeeds.
-- Creates their company, its settings row, and their own company_admin
-- profile, all in one transaction — this is what RLS on `companies`
-- would otherwise block (a user has no profile yet, so can't satisfy
-- can_access_company()). SECURITY DEFINER is what allows the insert to
-- go through; the check on auth.uid() and the "profile doesn't already
-- exist" guard is what stops it being misused as an open door.
create or replace function public.register_company(p_company_name text, p_admin_name text)
returns table(company_id uuid, company_code text) language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_code text;
  v_company_id uuid;
  letters text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'This account already has a profile';
  end if;

  select email into v_email from auth.users where id = v_uid;

  letters := upper(regexp_replace(coalesce(p_company_name,''), '[^A-Za-z]', '', 'g'));
  letters := coalesce(nullif(left(letters,3), ''), 'CHI');
  loop
    v_code := letters || '-' || lpad(floor(random()*9000+1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.companies where code = v_code);
  end loop;

  insert into public.companies(name, code, plan) values (p_company_name, v_code, 'Founding')
    returning id into v_company_id;
  insert into public.company_settings(company_id) values (v_company_id);
  insert into public.profiles(id, company_id, email, name, role, departments, active)
    values (v_uid, v_company_id, v_email, p_admin_name, 'company_admin', array['all'], true);

  return query select v_company_id, v_code;
end;
$$;
revoke all on function public.register_company(text, text) from public;
grant execute on function public.register_company(text, text) to authenticated;

-- Called right after a worker's own supabase.auth.signUp() succeeds.
-- They join by company code (same code an admin shares for this
-- purpose today); their profile starts with no departments — the
-- admin assigns those afterward from the Team page (already covered
-- by the profiles_admin_update policy from migration 06).
create or replace function public.join_company_as_worker(p_company_code text, p_name text)
returns table(company_id uuid, company_name text) language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_company record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'This account already has a profile';
  end if;

  select id, name into v_company from public.companies where code = upper(trim(p_company_code));
  if v_company.id is null then raise exception 'Company code not recognised'; end if;

  select email into v_email from auth.users where id = v_uid;
  insert into public.profiles(id, company_id, email, name, role, departments, active)
    values (v_uid, v_company.id, v_email, p_name, 'worker', '{}', true);

  return query select v_company.id, v_company.name;
end;
$$;
revoke all on function public.join_company_as_worker(text, text) from public;
grant execute on function public.join_company_as_worker(text, text) to authenticated;

-- One-time, self-limiting: the fixed reserved email can promote its own
-- freshly signed-up account to super_admin (company_id null), and only
-- if it doesn't have a profile yet. No company/admin role can ever
-- reach this — it's gated purely on matching that exact email.
create or replace function public.bootstrap_super_admin()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select email into v_email from auth.users where id = v_uid;
  if lower(v_email) <> 'igbanichiobiebere@gmail.com' then
    raise exception 'Not authorised';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then return; end if;
  insert into public.profiles(id, company_id, email, name, role, departments, active)
    values (v_uid, null, v_email, 'Platform Admin', 'super_admin', array['all'], true);
end;
$$;
revoke all on function public.bootstrap_super_admin() from public;
grant execute on function public.bootstrap_super_admin() to authenticated;

-- The auditor's own path in — no Supabase Auth account at all, so this
-- is the one function here callable by `anon`. Validates the grant,
-- rejects it cleanly if revoked/expired, and logs the visit itself
-- (both the dedicated visit log and the normal audit log) so the
-- admin sees it land, exactly like the localStorage version did.
create or replace function public.auditor_login(p_company_code text, p_access_code text)
returns table(company_id uuid, company_name text, grant_id uuid, grant_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_company record;
  v_grant record;
begin
  select id, name into v_company from public.companies where code = upper(trim(p_company_code));
  if v_company.id is null then raise exception 'Company code not recognised'; end if;

  select * into v_grant from public.auditor_grants
    where company_id = v_company.id and code = upper(trim(p_access_code));
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
revoke all on function public.auditor_login(text, text) from public;
grant execute on function public.auditor_login(text, text) to anon, authenticated;
