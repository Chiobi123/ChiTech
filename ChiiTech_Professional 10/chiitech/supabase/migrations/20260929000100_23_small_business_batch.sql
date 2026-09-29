-- ChiiTech migration 23 — small-business batch (spec: auditor+analyst review).
-- Additive only. Tables: accounting_periods, debts, budgets, receipts.
-- Enforcement: trigger blocks sales/expense writes dated in a closed month
-- (reopen the month first — historical imports included, deliberately).

create table if not exists public.accounting_periods (
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  reopen_reason text,
  primary key (company_id, month)
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  direction text not null check (direction in ('owed_to_me', 'i_owe')),
  party text not null,
  amount numeric not null default 0 check (amount >= 0),
  due_date date,
  status text not null default 'open' check (status in ('open','settled')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists debts_company_idx on public.debts(company_id, status, due_date);

create table if not exists public.budgets (
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null,
  month date not null,
  limit_amount numeric not null default 0 check (limit_amount >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (company_id, category, month)
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_type text not null check (record_type in ('sale','expense')),
  record_id uuid not null,
  image_data text not null,
  mime text not null default 'image/jpeg',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists receipts_record_idx on public.receipts(company_id, record_type, record_id);

alter table public.accounting_periods enable row level security;
alter table public.debts enable row level security;
alter table public.budgets enable row level security;
alter table public.receipts enable row level security;

drop policy if exists periods_access on public.accounting_periods;
create policy periods_access on public.accounting_periods for all
  using (company_id = app_private.my_company_id())
  with check (company_id = app_private.my_company_id());

drop policy if exists debts_admin on public.debts;
create policy debts_admin on public.debts for all
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin')
  with check (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin');
drop policy if exists debts_worker_read on public.debts;
create policy debts_worker_read on public.debts for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'worker');

drop policy if exists budgets_admin on public.budgets;
create policy budgets_admin on public.budgets for all
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin')
  with check (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin');
drop policy if exists budgets_worker_read on public.budgets;
create policy budgets_worker_read on public.budgets for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'worker');

drop policy if exists receipts_access on public.receipts;
create policy receipts_access on public.receipts for all
  using (company_id = app_private.my_company_id())
  with check (company_id = app_private.my_company_id());

grant select, insert, update, delete
  on public.accounting_periods, public.debts, public.budgets, public.receipts
  to authenticated;

-- Close / reopen a month. Closing is instant; reopening needs a logged reason.
create or replace function public.close_period(p_month date, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_m date := date_trunc('month', p_month)::date;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  insert into public.accounting_periods(company_id, month, closed_at, closed_by, reopen_reason)
  values (v_company, v_m, now(), auth.uid(), null)
  on conflict (company_id, month) do update set
    closed_at = now(), closed_by = auth.uid(), reopen_reason = null;
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'period.closed', 'Closed ' || to_char(v_m, 'Month YYYY') || '.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.close_period(date, text) from public;
grant execute on function public.close_period(date, text) to authenticated;

create or replace function public.reopen_period(p_month date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_m date := date_trunc('month', p_month)::date;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if p_reason is null or length(trim(p_reason)) < 4 then raise exception 'Give a short reason for reopening'; end if;
  update public.accounting_periods set closed_at = null, closed_by = null, reopen_reason = trim(p_reason)
  where company_id = v_company and month = v_m;
  if not found then raise exception 'That month is not closed'; end if;
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'period.reopened', 'Reopened ' || to_char(v_m, 'Month YYYY') || ': ' || trim(p_reason),
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.reopen_period(date, text) from public;
grant execute on function public.reopen_period(date, text) to authenticated;

-- Enforcement: no sale/expense may be written into a closed month.
create or replace function public.block_closed_period()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_m date := date_trunc('month', coalesce(new.time, now()))::date;
begin
  if exists (select 1 from public.accounting_periods
             where company_id = new.company_id and month = v_m and closed_at is not null) then
    raise exception 'That month is closed — reopen it first (reason is logged)';
  end if;
  return new;
end;
$$;

drop trigger if exists block_closed_period_sales on public.sales;
create trigger block_closed_period_sales
before insert or update on public.sales
for each row execute function public.block_closed_period();

drop trigger if exists block_closed_period_expenses on public.expenses;
create trigger block_closed_period_expenses
before insert or update on public.expenses
for each row execute function public.block_closed_period();

revoke all on function public.block_closed_period() from public;
