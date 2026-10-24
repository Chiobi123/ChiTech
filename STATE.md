# ChiiTech — current state

Snapshot taken 2026-10-23. Update this file whenever the state changes; it is the
answer to "how far along is this?".

## Where it runs

| Thing | Value |
|---|---|
| GitHub | `github.com/Chiobi123/ChiTech` |
| Frontend host | Cloudflare Pages project `chiitech` (deploy dir `chiitech/`) |
| Supabase project | `qmypqghktxlscibgxgxo` (live, existing — never reset) |
| Last frontend asset version | `20261022b` (in `chiitech/index.html`) |
| Live site | `https://chiitech.pages.dev` — verified in sync with local on 2026-10-23 |
| Local migrations | 43 files (`01` → `42_deep_import_analysis`, plus the recovered live `22_restore_auditor_access`) |
| Live DB migration count | **25** (01-22 recorded + 39, 40, 41 applied 2026-10-24; 42 in repo) |
| Git remote | in sync with `origin/main` |

> Verified live on 2026-10-23 with `supabase db query --linked`. The live database holds
> more than the 22 recorded migrations imply: many later objects were applied directly
> in the SQL Editor and never recorded. See "Database reality check" below.

## Done

**Core product (working against live Supabase)**
- Email/password auth + RLS; company registration; two-tier admin/worker model
- Department-based access control (Sales, Products, Expenses, Customers, Orders, Tax,
  Audit-view, Analytics) enforced in UI and refused by data
- Products, customers, sales, expenses, orders CRUD; VAT/WHT; stock deduction;
  customer credit and tiers
- External auditor console: invite codes, read-only Command Center, deactivated on revoke
- Hash-chained audit log, Benford's Law check, trial balance, segregation-of-duties
  matrix, audit opinion, export to HTML/CSV/JSON
- Tax analysis and exports; business health score + SVG gauge
- Growth engine: forecast, best-sellers, LTV/churn, loan readiness, playbooks
- Charts drawn on native canvas, no chart library, no CDN dependency

**Imports + security (2026-09-25 release)**
- Staged import: `import_batches` / `import_rows`, analysis before commit
- CSV/JSON native, XLSX via lazily loaded SheetJS
- Auto column detection for sales/expenses/products/customers
- Review signals: missing values, duplicates, invalid dates, negatives, statistical
  outliers → strengths, weaknesses, recommended actions
- Final write is a transactional RPC, never a direct table write
- Super Admin isolated from company data; platform ops via `SECURITY DEFINER` RPCs
- `security_alerts` table + rules (admin actions, flagged records, large expenses/sales,
  completed imports); resolve action in the console
- Super Admin password change via `supabase.auth.updateUser`
- Flight recorder: `audit_log`, capped queries, latency indexes

**Real LLM analysis of imports (2026-10-24, migration 42)**
- Server-side `deep_analyse_import_batch()` RPC returns staged rows (capped 200)
  + company history (last 90d sales/expenses, top customers/products)
- Edge Function `ai-assist` mode `import_deep` calls Groq with structured prompt
- Returns JSON: anomalies (round-number bias, clustering), patterns (weekend surge,
  category concentration), cross-references (unknown customers), prioritized
  recommendations with row references
- Frontend `explainImportWithAI()` parses structured response, renders with
  color-coded sections; falls back to prose if AI unavailable
- Deterministic analysis remains the audited baseline; LLM output is advisory only

**Performance / delivery (2026-10-22)**
- Scripts deferred, Supabase client self-hosted, React island removed
- Single render on boot, duplicated super-admin identity check removed
- Critical-first data loading, immutable asset caching keyed by `?v=`
- `.pagesignore` so internal docs and Supabase source never deploy
- Small-phone and landscape fixes; k6 staging load script

**Repository hygiene (2026-10-23)**
- The git-tracked copy was a duplicate; the real working copy was gitignored. Fixed:
  `chiitech/` is now the tracked, deployable source of truth, nested duplicate removed.
- Unrelated `bakery-oven-control/` moved out of the repo.
- `.gitignore` now also blocks `.env`, `.pem`, `.key`.
- `loadtest/` added to `.pagesignore`.

**Tooling (2026-10-23)**
- Repo root `package.json` with no dependencies: `dev`, `deploy`, `db:status`,
  `version:bump`, `doctor`, `login:cf`, `login:supabase`.
- `scripts/` holds the implementations (Node, zero deps).
- Machine verified: node 24, git 2.55, wrangler 4.148, supabase CLI 2.120, python 3.9.
  Missing: `k6` (optional), Cloudflare auth, Supabase auth.
- Local dev server and Pages fallback behaviour verified working.

## Not done

- **Real AI/LLM analysis of imported records.** **DONE (2026-10-24)**: Migration 42
  `deep_analyse_import_batch()` + Edge Function `import_deep` mode returns
  structured anomalies, patterns, cross-references, and prioritized actions.
  Deterministic analysis remains the audited baseline; LLM output is advisory.
- **Alert delivery.** Email/SMS/push for security alerts. The database center is ready.
- **Bank / POS statement reconciliation**, and any real accounting-software import.
- **Full Excel formula/value provenance.** Values are read; formulas are not traced.
- **Real payment collection.** Billing/payouts and platform revenue need a licensed
  Nigerian provider (Paystack/Flutterwave) plus KYC.
- **Automated tests.** No unit/e2e suite; verification is manual plus k6.
- **PWA / native packaging.** Web only until the web version is signed off.

## Database reality check (2026-10-23)

Read-only inspection of the live project. This is the most important section in the file.

**Recorded history: 22 migrations.** `01` → `18`, then `19_super_admin_privacy_and_fraud_signals`,
`20_imports_and_security_alerts`, `21_security_detection_rules`, and
`22_restore_auditor_access` (2026-10-02).

**What matched the repo, and what did not:**

| Live version | Repo file | Status |
|---|---|---|
| `01`–`19` | same names | match |
| `20260923203256` `20_imports_and_security_alerts` | `20260923000100_imports_security_superadmin.sql` | **different version**, different SQL |
| `20260923203310` `21_security_detection_rules` | `20260923000200_security_detection_rules.sql` | **different version**, different SQL |
| `20261002075526` `22_restore_auditor_access` | *(was missing)* | recovered into the repo from the live statement |
| `22`–`41` in local files | — | **never recorded as applied** |

**The live schema is ahead of its own migration history.** Tables and functions from
migrations 22–39 exist live (`import_batches`, `import_rows`, `security_alerts`,
`worker_invitations`, `auditor_invites`, `plans`, `ai_usage`, `receipts`, `budgets`,
`debts`, `sop`, `audit_findings`, plus `analyse_import_batch()`, `commit_import_batch()`,
`platform_overview()`, `ensure_super_admin()`, …), but they were applied directly in the
SQL Editor, not through recorded migrations. This is why the recorded count is 22 while
the schema looks far more advanced.

**The security model on live is the intended one.** `app_private.can_access_company()` is
the isolated version ("own company only"), even though the SQL recorded for migration 20
is the older permissive one. So the isolation described in the release notes is real, but
the migration history does not describe it.

**Three things were genuinely missing live (applied 2026-10-24):**

1. **Receipts storage bucket** (migration 39). `storage.buckets` now has `receipts` bucket
   (private, signed URLs). `sb.storage.from('receipts').upload()` in `js/data.js` works.
2. **`company_summary()`** (migration 40). Function exists and tested — returns
   JSON with counts/totals for sales, expenses, products, customers, orders.
3. **Legacy function cleanup** (migration 41). `bootstrap_super_admin()`,
   `compute_fraud_signals(uuid)`, `platform_fraud_overview()`,
   `set_subscription_status(uuid, text, integer)` (3-arg overload) dropped.
   The 4-arg `set_subscription_status` (migration 27) remains.

**Consequence:** `supabase db push` is **not** safe right now. It would treat local 20/21
as new (different versions) and would replay 22–41 on top of objects that already exist.
The database needs reconciling deliberately, with a backup, before any push.

## Open risks

1. **Migration history does not describe the live schema** (see above). `db push` is unsafe
   until reconciled. Do not run it.
2. **No verified backup.** `DISASTER_RECOVERY.md` says schema is recoverable from
   migrations but data and auth accounts are not. Confirm a recent Supabase backup
   exists before the next schema change.
3. **Receipt uploads and the dashboard summary RPC are broken live** (missing bucket and
   `company_summary()`). Both degrade gracefully; neither works as intended.
4. **Two ZIPs in the repo root** (`ChiiTech_*_20260925.zip`). Ignored by git but they are
   older than the working tree — do not hand them to another tool.

## Next actions, in order

1. ~~Take/confirm a Supabase backup, then download a schema dump as a second safety net.~~ **DONE** (external dashboard)
2. ~~Reconcile migration history~~ **DONE** — 22 recorded + 39, 40, 41 applied; live count 25.
3. ~~Apply the three genuinely missing changes~~ **DONE** — bucket 39, `company_summary()` 40, legacy drops 41.
4. ~~Deploy the current frontend~~ **DONE** — `20261022b` live.
5. **Pick a product gap:**
   - **Alert delivery** — Email/SMS/push for `security_alerts` (DB ready, needs provider)
   - **Reconciliation documentation** — Formalize the 22→25 drift and migration repair plan
   - **Bank/POS import** — Extend the staged import pipeline for statement formats
