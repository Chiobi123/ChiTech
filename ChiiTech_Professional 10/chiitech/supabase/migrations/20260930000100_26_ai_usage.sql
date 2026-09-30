-- ChiiTech migration 26 — AI usage accounting (daily per-company cap).
-- The ai-assist Edge Function increments these counters; the app never
-- touches this table directly (no client policies by design).

create table if not exists public.ai_usage (
  company_id uuid not null references public.companies(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  questions integer not null default 0,
  primary key (company_id, day)
);

alter table public.ai_usage enable row level security;
-- Intentionally no policies: only SECURITY DEFINER server code writes here.
