# Database migrations

Live history is 21 entries (verified 2026-09-25 against `ChiTech b`,
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
