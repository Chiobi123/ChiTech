
drop table if exists public.users;

create extension if not exists pgcrypto;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  plan text not null default 'Founding',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('super_admin','company_admin','worker')),
  departments text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profiles_company_matches_role check (
    (role = 'super_admin' and company_id is null)
    or (role in ('company_admin','worker') and company_id is not null)
  )
);
create index profiles_company_idx on public.profiles(company_id);

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  expense_categories text[] not null default array['Transport','Rent','Utilities','Restock / supplies','Staff','Marketing','Other'],
  tax_settings jsonb not null default '{"vatRate":7.5,"whtRate":5,"whtThreshold":50000}',
  growth jsonb not null default '{"mode":"automated","chartStyle":"bar","dashboardChartType":"bar"}',
  payout_config jsonb not null default '{"paystackConnected":false,"bankTransfer":null}',
  billing_history jsonb not null default '[]'
);

-- Helper functions used by RLS policies. SECURITY DEFINER so they read
-- profiles directly without re-triggering RLS on profiles (which would
-- otherwise recurse), and STABLE so Postgres can cache the result once
-- per statement instead of once per row.
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.can_access_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select cid = public.my_company_id() or public.my_role() = 'super_admin';
$$;

create or replace function public.has_department(dept text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
    and (role in ('company_admin','super_admin') or dept = any(departments) or 'all' = any(departments))
  );
$$;
