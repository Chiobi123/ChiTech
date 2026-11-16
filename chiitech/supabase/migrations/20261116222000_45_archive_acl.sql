-- Archived history is in a non-exposed schema and has no API grants to user roles.
-- RLS is unnecessary here; object and schema privileges remain the access boundary.
alter table app_private.security_alerts_retired_20261116 disable row level security;
revoke all on table app_private.security_alerts_retired_20261116 from public, anon, authenticated;
grant all on table app_private.security_alerts_retired_20261116 to service_role;
