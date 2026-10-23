# Database migrations

## Status (2026-10-23)

This folder holds **41** files, `01` → `41_drop_legacy_functions`.

The live project's migration history was last verified on **2026-09-25 at 21 entries**.
That means up to 20 migrations may not yet be applied live. Before any schema change,
query the live project (or read the Supabase migration list) and record the actual count
in `../../STATE.md`.

Do not assume this folder and the live database agree. Do not `db reset`.

## History notes

Live history at last verification was 21 entries (2026-09-25 against `ChiTech b`,
ref `qmypqghktxlscibgxgxo`):
01–18 as named, then 20260922222101_19_super_admin_privacy_and_fraud_signals,
20260923203256_20_imports_and_security_alerts,
20260923203310_21_security_detection_rules.

This folder holds 01–18 verbatim plus:
- 20260922222101_19_super_admin_privacy_and_fraud_signals.sql —
  RECONSTRUCTED from live pg_get_functiondef (bootstrap_super_admin,
  compute_fraud_signals, platform_fraud_overview); functionally
  equivalent, not byte-perfect original.
- 20260923000100_imports_security_superadmin.sql and
  20260923000200_security_detection_rules.sql — ChatGPT-authored files
  whose objects cover live 20/21 (verified: 3 tables, 3 policies,
  9 functions, 3 triggers, can_access_company isolated, no super_admin
  bypass as of 2026-09-25).

If you use the Supabase CLI, `supabase db push` against this folder
will apply them in order. Otherwise, paste each file's contents into
the SQL Editor in the Supabase dashboard, in filename order.
