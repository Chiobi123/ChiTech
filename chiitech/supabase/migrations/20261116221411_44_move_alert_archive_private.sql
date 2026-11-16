-- Keep the archived security-alert history outside the exposed public API schema.
alter table public.security_alerts_retired_20261116 set schema app_private;
revoke all on table app_private.security_alerts_retired_20261116 from public, anon, authenticated;
grant all on table app_private.security_alerts_retired_20261116 to service_role;
alter table app_private.security_alerts_retired_20261116 enable row level security;
