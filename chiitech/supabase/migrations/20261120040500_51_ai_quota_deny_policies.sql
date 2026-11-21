-- ChiiTech migration: explicit deny policies for the backend-only AI quota
-- tables. Idempotent: safe to re-run.
--
-- Advisor 0008 (rls_enabled_no_policy): RLS is enabled on these four tables
-- with no policies. They are deliberately backend-only: no table grants to
-- anon or authenticated (verified in the 2026-11-20 audit), and the only
-- writer/reader is the SECURITY DEFINER RPC reserve_ai_quota(), which runs as
-- its owner. Supabase's own remediation for an intentional lockout is an
-- explicit rejection policy, so the intent is documented in the schema
-- instead of being an accident-looking gap. service_role (BYPASSRLS) and the
-- definer RPC are unaffected.

drop policy if exists none_shall_pass on public.ai_quota_config;
create policy none_shall_pass on public.ai_quota_config
  for all to anon, authenticated using (false) with check (false);

drop policy if exists none_shall_pass on public.ai_usage;
create policy none_shall_pass on public.ai_usage
  for all to anon, authenticated using (false) with check (false);

drop policy if exists none_shall_pass on public.ai_usage_platform_daily;
create policy none_shall_pass on public.ai_usage_platform_daily
  for all to anon, authenticated using (false) with check (false);

drop policy if exists none_shall_pass on public.ai_usage_user_daily;
create policy none_shall_pass on public.ai_usage_user_daily
  for all to anon, authenticated using (false) with check (false);
