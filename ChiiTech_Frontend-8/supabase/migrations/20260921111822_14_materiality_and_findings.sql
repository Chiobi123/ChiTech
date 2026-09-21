
-- Materiality threshold: real auditors set a naira amount below which a
-- discrepancy isn't worth chasing — without one, every tiny rounding
-- difference looks as urgent as a real problem. Defaults to ₦5,000,
-- admin-editable, stored alongside the other company-wide settings.
alter table public.company_settings add column materiality_threshold numeric not null default 5000;

-- A findings/exceptions log — what audit working papers exist to
-- capture: a documented conclusion ("we looked at X, here's what we
-- found"), not just the raw activity log. Distinct from audit_log
-- (which is an immutable record of actions taken in the app) — this is
-- a record of judgment calls made by whoever reviewed the books.
create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','resolved')),
  raised_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index audit_findings_company_idx on public.audit_findings(company_id);

-- Same department pattern as every other audit-facing table: full
-- access (read/write/resolve) for the 'audit' department or admin.
-- The auditor role itself stays read-only — see auditor_fetch_data,
-- which will expose findings for the auditor to READ but never write
-- to, same guarantee as everything else in the Command Center.
create policy audit_findings_access on public.audit_findings for all
  using (app_private.can_access_company(company_id) and app_private.has_department('audit'))
  with check (app_private.can_access_company(company_id) and app_private.has_department('audit'));
alter table public.audit_findings enable row level security;

-- Expose findings (read-only) to the auditor's fetch RPC too.
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
