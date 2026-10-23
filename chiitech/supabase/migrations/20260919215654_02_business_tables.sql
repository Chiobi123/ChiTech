
create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  cost numeric not null default 0,
  price numeric not null default 0,
  stock integer not null default 0,
  reorder integer not null default 0,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_company_idx on public.products(company_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  total_spent numeric not null default 0,
  balance_due numeric not null default 0,
  last_purchase timestamptz,
  visits integer not null default 0,
  tier text default 'New',
  created_at timestamptz not null default now()
);
create index customers_company_idx on public.customers(company_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_no text,
  time timestamptz not null default now(),
  items jsonb not null default '[]',
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  vat numeric not null default 0,
  total numeric not null default 0,
  cost numeric not null default 0,
  customer_id uuid references public.customers(id),
  customer_name text,
  payment text,
  recorded_by text,
  created_at timestamptz not null default now()
);
create index sales_company_idx on public.sales(company_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  time timestamptz not null default now(),
  category text,
  note text,
  amount numeric not null default 0,
  flag boolean not null default false,
  reason text,
  logged_by text,
  created_at timestamptz not null default now()
);
create index expenses_company_idx on public.expenses(company_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text,
  customer_name text,
  items text,
  total numeric not null default 0,
  status text not null default 'Pending',
  placed_at timestamptz not null default now(),
  notes text
);
create index orders_company_idx on public.orders(company_id);

create table public.sop (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  area text,
  description text,
  frequency text,
  responsible text,
  created_at timestamptz not null default now(),
  last_reviewed timestamptz not null default now()
);
create index sop_company_idx on public.sop(company_id);
