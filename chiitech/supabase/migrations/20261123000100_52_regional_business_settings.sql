-- ChiiTech regional business preferences.
-- Historical transactions are deliberately untouched; this stores display defaults only.
alter table public.company_settings
  add column if not exists regional_settings jsonb not null
  default '{"country":"NG","currency":"NGN","locale":"en-NG","timezone":"Africa/Lagos","dateFormat":"default","numberFormat":"default","financialYearStart":1}'::jsonb;
