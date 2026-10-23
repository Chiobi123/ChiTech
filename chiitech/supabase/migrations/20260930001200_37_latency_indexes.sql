-- ChiiTech migration 37 — fill index gaps found in the latency audit.
-- sales and worker_invitations lacked company indexes (every sibling table
-- has one); profiles lacked a company lookup index. Read path only.

create index if not exists sales_company_idx on public.sales(company_id, created_at desc);
create index if not exists worker_invitations_company_idx on public.worker_invitations(company_id, status);
create index if not exists profiles_company_idx on public.profiles(company_id);
