-- ChiiTech Phase 19
-- Business import/review pipeline + platform security alerts + strict
-- separation of the Super Admin from company data access.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null,
  source_type text not null check (source_type in ('csv','json','xlsx')),
  status text not null default 'uploaded' check (status in ('uploaded','analysed','imported','failed')),
  row_count integer not null default 0,
  columns jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  imported_at timestamptz
);
create index if not exists import_batches_company_idx on public.import_batches(company_id, created_at desc);

create table if not exists public.import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','warning','invalid','imported')),
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id, row_number)
);
create index if not exists import_rows_batch_idx on public.import_rows(batch_id, row_number);

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  event_type text not null,
  title text not null,
  description text,
  source text not null default 'system',
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz
);
create index if not exists security_alerts_company_idx on public.security_alerts(company_id, created_at desc);
create index if not exists security_alerts_status_idx on public.security_alerts(status, severity, created_at desc);

-- Replace the old "super admin can access every company row" helper with a
-- company-only helper. Platform administration is now performed through
-- tightly-scoped SECURITY DEFINER RPCs below. This prevents a super-admin
-- browser session from directly becoming a company-data session.
create or replace function app_private.can_access_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select cid = app_private.my_company_id()
     and not exists (select 1 from public.companies where id = cid and deleted_at is not null);
$$;

-- Ensure the reserved platform account is always a platform account. The
-- password remains in Supabase Auth; it is never stored in source code.
create or replace function public.ensure_super_admin()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email <> 'igbanichiobiebere@gmail.com' then raise exception 'Not authorised'; end if;

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values(v_uid, null, v_email, 'Platform Admin', 'super_admin', array['all'], true, null)
  on conflict (id) do update set
    company_id = null,
    email = excluded.email,
    role = 'super_admin',
    departments = array['all'],
    active = true,
    deleted_at = null;
end;
$$;
revoke all on function public.ensure_super_admin() from public;
grant execute on function public.ensure_super_admin() to authenticated;

-- Platform overview. The caller gets only platform metadata and aggregate
-- business figures, never raw company sales/expenses/customer records.
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
      where a.status <> 'dismissed' limit 100),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.platform_overview() from public;
grant execute on function public.platform_overview() to authenticated;

-- Company users can report a security-relevant application event for their
-- own company. Super Admin can report a platform event. This is deliberately
-- an alert/reporting primitive, not an automatic accusation of fraud.
create or replace function public.create_security_alert(
  p_company_id uuid,
  p_severity text,
  p_event_type text,
  p_title text,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := app_private.my_role();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_severity not in ('low','medium','high','critical') then raise exception 'Invalid severity'; end if;
  if v_role <> 'super_admin' and p_company_id <> app_private.my_company_id() then
    raise exception 'Not authorised for this company';
  end if;

  insert into public.security_alerts(company_id,severity,event_type,title,description,metadata,created_by,source)
  values(p_company_id,p_severity,p_event_type,p_title,p_description,coalesce(p_metadata,'{}'::jsonb),v_uid,'application')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_security_alert(uuid,text,text,text,text,jsonb) from public;
grant execute on function public.create_security_alert(uuid,text,text,text,text,jsonb) to authenticated;

create or replace function public.resolve_security_alert(p_alert_id uuid, p_status text default 'resolved')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text := app_private.my_role();
  v_company uuid := app_private.my_company_id();
begin
  if p_status not in ('resolved','reviewing','dismissed') then raise exception 'Invalid status'; end if;
  if v_role = 'super_admin' then
    update public.security_alerts set status=p_status,resolved_by=auth.uid(),resolved_at=case when p_status='resolved' then now() else null end where id=p_alert_id;
  else
    update public.security_alerts set status=p_status,resolved_by=auth.uid(),resolved_at=case when p_status='resolved' then now() else null end where id=p_alert_id and company_id=v_company;
  end if;
end;
$$;
revoke all on function public.resolve_security_alert(uuid,text) from public;
grant execute on function public.resolve_security_alert(uuid,text) to authenticated;

-- Generic server-side analysis of an uploaded batch. It never imports data
-- into business tables; it produces a review first.
create or replace function public.analyse_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_rows integer;
  v_blank integer;
  v_duplicate integer;
  v_result jsonb;
begin
  select company_id into v_company from public.import_batches where id=p_batch_id;
  if app_private.my_role() <> 'company_admin' or v_company is null or v_company <> app_private.my_company_id() then raise exception 'Not authorised'; end if;

  select count(*) into v_rows from public.import_rows where batch_id=p_batch_id;
  select count(*) into v_blank from public.import_rows where batch_id=p_batch_id and raw_data='{}'::jsonb;
  select coalesce(sum(cnt-1),0)::integer into v_duplicate from (
    select md5(raw_data::text), count(*) cnt from public.import_rows where batch_id=p_batch_id group by md5(raw_data::text) having count(*)>1
  ) d;

  select jsonb_build_object(
    'total_rows',v_rows,
    'blank_rows',v_blank,
    'duplicate_rows',v_duplicate,
    'usable_rows',greatest(v_rows-v_blank,0),
    'duplicate_rate',case when v_rows=0 then 0 else round((v_duplicate::numeric/v_rows)*100,2) end
  ) into v_result;

  update public.import_batches set row_count=v_rows,analysis=v_result,status='analysed' where id=p_batch_id;
  return v_result;
end;
$$;
revoke all on function public.analyse_import_batch(uuid) from public;
grant execute on function public.analyse_import_batch(uuid) to authenticated;

create or replace function public.save_import_analysis(p_batch_id uuid, p_analysis jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  update public.import_batches set analysis=coalesce(p_analysis,'{}'::jsonb),status='analysed'
  where id=p_batch_id and company_id=app_private.my_company_id();
  if not found then raise exception 'Import batch not found or not authorised'; end if;
end;
$$;
revoke all on function public.save_import_analysis(uuid,jsonb) from public;
grant execute on function public.save_import_analysis(uuid,jsonb) to authenticated;

-- RLS: import data is company-private; security alerts are company-private,
-- while the platform console reaches them through platform_overview().
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.security_alerts enable row level security;

drop policy if exists import_batches_access on public.import_batches;
create policy import_batches_access on public.import_batches for all
  using (company_id=app_private.my_company_id() and app_private.my_role()='company_admin')
  with check (company_id=app_private.my_company_id() and app_private.my_role()='company_admin');

drop policy if exists import_rows_access on public.import_rows;
create policy import_rows_access on public.import_rows for all
  using (app_private.my_role()='company_admin' and exists(select 1 from public.import_batches b where b.id=batch_id and b.company_id=app_private.my_company_id()))
  with check (app_private.my_role()='company_admin' and exists(select 1 from public.import_batches b where b.id=batch_id and b.company_id=app_private.my_company_id()));

drop policy if exists security_alerts_select on public.security_alerts;
create policy security_alerts_select on public.security_alerts for select
  using (company_id=app_private.my_company_id());

-- Only the SECURITY DEFINER RPC writes alerts. There is intentionally no
-- client INSERT policy on this table.
revoke all on public.security_alerts from authenticated;
grant select on public.security_alerts to authenticated;
grant select,insert,update,delete on public.import_batches,public.import_rows to authenticated;

-- Transactional promotion of staged/normalized rows into the selected
-- business table. The mapping is done in the browser, but the final write
-- is performed server-side in one database transaction, so a failed import
-- does not leave half of a file committed.
create or replace function public.commit_import_batch(p_batch_id uuid, p_record_type text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_count integer := 0;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  select company_id into v_company from public.import_batches where id=p_batch_id and company_id=app_private.my_company_id();
  if v_company is null then raise exception 'Import batch not found or not authorised'; end if;
  if p_record_type not in ('sales','expenses','products','customers') then raise exception 'Unsupported record type'; end if;

  if p_record_type='products' then
    insert into public.products(id,company_id,name,category,cost,price,stock,reorder,updated_by)
    select gen_random_uuid(),v_company, r.normalized_data->>'name', nullif(r.normalized_data->>'category',''),
      coalesce((r.normalized_data->>'cost')::numeric,0),coalesce((r.normalized_data->>'price')::numeric,0),
      coalesce((r.normalized_data->>'stock')::integer,0),coalesce((r.normalized_data->>'reorder')::integer,0),r.normalized_data->>'updated_by'
    from public.import_rows r where r.batch_id=p_batch_id and r.validation_status in ('valid','warning');
  elsif p_record_type='customers' then
    insert into public.customers(id,company_id,name,phone,total_spent,balance_due,last_purchase,visits,tier)
    select gen_random_uuid(),v_company,r.normalized_data->>'name',nullif(r.normalized_data->>'phone',''),
      coalesce((r.normalized_data->>'total_spent')::numeric,0),coalesce((r.normalized_data->>'balance_due')::numeric,0),
      nullif(r.normalized_data->>'last_purchase','')::timestamptz,coalesce((r.normalized_data->>'visits')::integer,0),coalesce(r.normalized_data->>'tier','Imported')
    from public.import_rows r where r.batch_id=p_batch_id and r.validation_status in ('valid','warning');
  elsif p_record_type='expenses' then
    insert into public.expenses(id,company_id,time,category,note,amount,flag,reason,logged_by)
    select gen_random_uuid(),v_company,coalesce(nullif(r.normalized_data->>'time','')::timestamptz,now()),
      nullif(r.normalized_data->>'category',''),nullif(r.normalized_data->>'note',''),coalesce((r.normalized_data->>'amount')::numeric,0),
      coalesce((r.normalized_data->>'flag')::boolean,false),nullif(r.normalized_data->>'reason',''),r.normalized_data->>'logged_by'
    from public.import_rows r where r.batch_id=p_batch_id and r.validation_status in ('valid','warning');
  else
    insert into public.sales(id,company_id,invoice_no,time,items,items_summary,subtotal,discount,vat,total,cost,customer_name,payment,recorded_by)
    select gen_random_uuid(),v_company,nullif(r.normalized_data->>'invoice_no',''),coalesce(nullif(r.normalized_data->>'time','')::timestamptz,now()),
      coalesce(r.normalized_data->'items','[]'::jsonb),nullif(r.normalized_data->>'items_summary',''),
      coalesce((r.normalized_data->>'subtotal')::numeric,0),coalesce((r.normalized_data->>'discount')::numeric,0),coalesce((r.normalized_data->>'vat')::numeric,0),
      coalesce((r.normalized_data->>'total')::numeric,0),coalesce((r.normalized_data->>'cost')::numeric,0),
      nullif(r.normalized_data->>'customer_name',''),nullif(r.normalized_data->>'payment',''),r.normalized_data->>'recorded_by'
    from public.import_rows r where r.batch_id=p_batch_id and r.validation_status in ('valid','warning');
  end if;

  get diagnostics v_count = row_count;
  update public.import_rows set validation_status='imported' where batch_id=p_batch_id and validation_status in ('valid','warning');
  update public.import_batches set status='imported', imported_at=now() where id=p_batch_id;
  return v_count;
end;
$$;
revoke all on function public.commit_import_batch(uuid,text) from public;
grant execute on function public.commit_import_batch(uuid,text) to authenticated;
