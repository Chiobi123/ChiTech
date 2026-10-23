-- ChiiTech migration 32 — re-retire legacy grant-code auditor access.
-- Decision: invitation model wins. These objects were recreated outside the
-- migration flow after migration 29 retired them; removing again so exactly
-- one auditor system exists. Tables are empty test residue; no data kept.

drop function if exists public.auditor_login(text, text);
drop function if exists public.auditor_fetch_data(uuid, text);
drop table if exists public.audit_visit_log;
drop table if exists public.auditor_grants;
