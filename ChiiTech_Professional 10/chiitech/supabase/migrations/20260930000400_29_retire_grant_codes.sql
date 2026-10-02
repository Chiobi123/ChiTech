-- ChiiTech migration 29 — retire legacy code-grant auditor access.
-- Auditors now join exactly like workers (emailed invitation token +
-- their own Supabase Auth account). The grant-code tables and RPCs are
-- removed so the two systems can never conflict. Tables are already
-- empty (pre-launch wipe); no data migration needed.

drop function if exists public.auditor_login(text, text);
drop function if exists public.auditor_fetch_data(uuid, text);
drop table if exists public.audit_visit_log;
drop table if exists public.auditor_grants;
