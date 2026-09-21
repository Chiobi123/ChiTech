
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  time timestamptz not null default now(),
  action text not null,
  details text,
  hash text,
  prev_hash text,
  "user" text
);
create index audit_log_company_idx on public.audit_log(company_id, time);

-- Computes each entry's hash server-side, chained to the previous entry
-- for this company, on insert. Since only a select+insert policy will
-- exist on this table (see migration 04), and no update/delete policy,
-- an entry can never be edited or removed via the API once written —
-- this is what makes the hash-chain meaningful instead of decorative.
create or replace function public.audit_log_set_hash()
returns trigger language plpgsql as $$
declare
  prev text;
begin
  select hash into prev from public.audit_log
    where company_id = new.company_id
    order by time desc, id desc
    limit 1;
  new.prev_hash := prev;
  new.hash := encode(
    digest(coalesce(prev,'') || new.company_id::text || new.action
           || coalesce(new.details,'') || coalesce(new."user",'') || new.time::text,
           'sha256'),
    'hex'
  );
  return new;
end;
$$;

create trigger audit_log_hash_trigger
before insert on public.audit_log
for each row execute function public.audit_log_set_hash();

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
