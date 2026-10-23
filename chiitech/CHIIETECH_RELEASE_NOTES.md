# ChiiTech Release Notes — Existing Business Import + Super Admin Isolation

## Implemented in this working copy

### Frontend
- Added **Import & analysis** page for company admins.
- Supports CSV and JSON directly; XLS/XLSX through SheetJS loaded only when needed.
- Stages files before changing business tables.
- Automatic column detection for Sales, Expenses, Products and Customers.
- Preview before import.
- Automated review of missing values, duplicate rows, invalid dates, negative amounts and statistical outliers.
- Produces strengths, weaknesses/disadvantages and recommended actions.
- Final import uses a server-side transactional RPC.
- Added Super Admin password-change control through Supabase Auth.
- Removed Super Admin "View as admin" impersonation.
- Super Admin console now displays security alerts and only platform metadata/aggregates.

### Backend
- Added `import_batches` and `import_rows` staging tables.
- Added `security_alerts` table.
- Added `platform_overview()` RPC.
- Added `ensure_super_admin()` RPC.
- Added `create_security_alert()` and `resolve_security_alert()` RPCs.
- Added `analyse_import_batch()` and `save_import_analysis()` RPCs.
- Added `commit_import_batch()` transactional import RPC.
- Changed `app_private.can_access_company()` so Super Admin no longer directly satisfies company-data RLS.
- Added server-side review signals for high-risk administrative activity, flagged records, large expenses and large sales.

## Deliberate security decisions

1. The Super Admin password is never stored in source code.
2. Super Admin authentication remains Supabase Auth.
3. Super Admin platform reads use dedicated SECURITY DEFINER RPCs.
4. Super Admin cannot impersonate a company admin through the frontend.
5. Fraud alerts are described as review signals, not proof of fraud.
6. Imported records are staged and reviewed before promotion.
7. Database writes for the final import are transactional.
8. No `supabase db reset` is required.

## Not yet included

- Real AI/LLM analysis of imported records. The current analysis is deterministic/rule-based and auditable. A future AI layer should read the stored analysis/normalized records through a controlled server-side function rather than exposing service-role credentials to the browser.
- Real-time security notifications such as email/SMS/push. The database alert center is ready for this later.
- Automated reconciliation against bank statements or accounting software.
- Full Excel formula/value provenance.

## Deployment order

1. Back up the existing Supabase database.
2. Run migration `20260923000100_imports_security_superadmin.sql`.
3. Run migration `20260923000200_security_detection_rules.sql`.
4. Deploy the updated frontend files.
5. Confirm the reserved Super Admin account can sign in.
6. Test a small import before using a large historical file.
7. Confirm company admins still only see their own company.
8. Confirm Super Admin cannot access company business tables through the frontend.
