
-- auditor_grants, audit_visit_log, auditor_login() and
-- auditor_fetch_data() were found entirely missing from the database ΓÇö
-- dropped at some point during another party's direct, untracked
-- changes to this project (not via any migration I've run). This is a
-- full, clean restore of the originally-built and tested design,
-- including the ambiguous-column fix from migration 18 and the
-- findings/materiality fields from migration 14/20.

create table public.auditor_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by text,
  revoked boolean not null default false,
  last_visit timestamptz
);
create index auditor_grants_company_idx on public.auditor_grants(company_id);

create table public.audit_visit_log (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.auditor_grants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  auditor_name text not null,
  time timestamptz not null default now()
);
create index audit_visit_log_company_idx on public.audit_visit_log(company_id);
create index audit_visit_log_grant_id_idx on public.audit_visit_log(grant_id);

alter table public.auditor_grants enable row level security;
create policy auditor_grants_admin on public.auditor_grants for all
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'))
  with check (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));

alter table public.audit_visit_log enable row level security;
create policy audit_visit_log_admin_select on public.audit_visit_log for select
  using (app_private.can_access_company(company_id) and app_private.my_role() in ('company_admin','super_admin'));

grant select, insert, update, delete on public.auditor_grants to authenticated;
grant select on public.audit_visit_log to authenticated;

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
revoke all on function public.auditor_login(text, text) from public;
grant execute on function public.auditor_login(text, text) to anon, authenticated;

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
    'team', (select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'role',pr.role,'departments',pr.departments)),'[]'::jsonb)
        from public.profiles pr where pr.company_id = v_grant.company_id),
    'findings', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]'::jsonb) from public.audit_findings f where f.company_id = v_grant.company_id),
    'materiality_threshold', (select coalesce(materiality_threshold, 5000) from public.company_settings where company_id = v_grant.company_id)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.auditor_fetch_data(uuid, text) from public;
grant execute on function public.auditor_fetch_data(uuid, text) to anon, authenticated;
