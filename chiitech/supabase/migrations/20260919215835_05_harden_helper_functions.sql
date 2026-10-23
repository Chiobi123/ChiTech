
-- Move the RLS helper functions into a schema PostgREST doesn't expose
-- as public API endpoints. This is purely a hardening step: moving a
-- function's schema keeps its identity, so every policy that already
-- references it (from migration 04) keeps working with zero changes.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

alter function public.my_company_id() set schema app_private;
alter function public.my_role() set schema app_private;
alter function public.has_department(text) set schema app_private;
alter function public.can_access_company(uuid) set schema app_private;

revoke execute on function app_private.my_company_id() from public;
revoke execute on function app_private.my_role() from public;
revoke execute on function app_private.has_department(text) from public;
revoke execute on function app_private.can_access_company(uuid) from public;
grant execute on function app_private.my_company_id() to authenticated, service_role;
grant execute on function app_private.my_role() to authenticated, service_role;
grant execute on function app_private.has_department(text) to authenticated, service_role;
grant execute on function app_private.can_access_company(uuid) to authenticated, service_role;

-- Pin the search_path on the audit hash trigger too, so it can't be
-- redirected by a session-level search_path change.
alter function public.audit_log_set_hash() set search_path = public;
