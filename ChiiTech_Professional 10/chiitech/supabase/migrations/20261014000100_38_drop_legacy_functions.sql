-- ChiiTech migration 38 — drop legacy duplicate functions (audit P2).
-- Verified 2026-10-14 against live frontend code, before dropping:
--   * bootstrap_super_admin() — zero sb.rpc callers in js/ (only a stale
--     comment, fixed in the same round). Live login calls
--     ensure_super_admin() (js/auth.js). No trigger references it.
--   * platform_fraud_overview() + compute_fraud_signals(uuid) — zero js/
--     callers. The app calls platform_overview() (js/data.js), whose
--     current definition (migration 27) does not use compute_fraud_signals
--     internally, so nothing live depends on either.
--   * set_subscription_status(uuid, text, integer) — 3-arg overload from
--     migration 25, superseded by the 4-arg version with defaults
--     (p_renew_days default 30, p_plan_id default null) from migration 27.
--     js/app.js calls it with 3 args (covered by the defaults) and 4 args.
-- All drops are IF EXISTS so re-running is safe. After applying, confirm:
--   select proname from pg_proc where proname in
--     ('bootstrap_super_admin','platform_fraud_overview',
--      'compute_fraud_signals','set_subscription_status');

drop function if exists public.bootstrap_super_admin();
drop function if exists public.platform_fraud_overview();
drop function if exists public.compute_fraud_signals(uuid);
drop function if exists public.set_subscription_status(uuid, text, integer);
