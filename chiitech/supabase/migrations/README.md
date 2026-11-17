# Database migrations

## Status (2026-11-17, verified against live)

This folder holds **50** SQL files, including the current AI quota migrations
47 and 48. The live Supabase project records **47** applied migrations; the
latest recorded version is `20261117070004`.

Migrations 47 and 48 were applied successfully to the existing production
project. Migration 47 creates daily platform/company/user AI usage accounting.
Migration 48 restricts quota reservations to the trusted server role so
end-user sessions cannot directly drain the shared AI allowance.

The historical migration-history discrepancies below still matter: do not
assume every repository SQL file maps one-to-one to a recorded live migration.
Do not run `supabase db push` or `db reset` without reconciling the complete
history first. See the "Database reality check" section in `../../STATE.md`.

**The folder and the live history do not correspond, on purpose of accident:**

- Live `20_imports_and_security_alerts` (`20260923203256`) and
  `21_security_detection_rules` (`20260923203310`) were applied under those versions, but
  the repo stores different files for them (`20260923000100_…`, `20260923000200_…`).
  The live SQL is the older permissive super-admin model; the repo SQL is the isolated
  model. The isolated model **is** what is actually running, applied out of band.
- Objects from local 22–39 exist live but were never recorded as migrations.
- Genuinely missing live: the `receipts` storage bucket (39), `company_summary()` (40),
  and the legacy function drops (41).

**Do not run `supabase db push` or `db reset` against this folder until the history is
reconciled.** See the "Database reality check" section in `../../STATE.md`.

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
