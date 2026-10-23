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
| Local migrations | 41 files, `01` → `41_drop_legacy_functions` |
| Live DB migration count | **verify** — last recorded as 21 on 2026-09-25 |

> The gap between 41 local migrations and a last-verified live count of 21 is the
> single biggest open question in this project. Confirm what is applied before any
> new schema work. Do not assume.

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

- **Real AI/LLM analysis of imported records.** Current analysis is deterministic and
  rule-based. Any LLM layer must read staged rows through a server-side function; no
  service-role key in the browser.
- **Alert delivery.** Email/SMS/push for security alerts. The database center is ready.
- **Bank / POS statement reconciliation**, and any real accounting-software import.
- **Full Excel formula/value provenance.** Values are read; formulas are not traced.
- **Real payment collection.** Billing/payouts and platform revenue need a licensed
  Nigerian provider (Paystack/Flutterwave) plus KYC.
- **Automated tests.** No unit/e2e suite; verification is manual plus k6.
- **PWA / native packaging.** Web only until the web version is signed off.

## Open risks

1. **Live DB vs migrations drift.** 20 migrations may be unapplied. Verify first.
2. **No verified backup.** `DISASTER_RECOVERY.md` says schema is recoverable from
   migrations but data and auth accounts are not. Confirm a recent Supabase backup
   exists before the next schema change.
3. **Stale prose in `chiitech/README.md`.** Its "Next steps to make this
   production-ready" section still talks about replacing `data.js` with a FastAPI
   backend and adding auth — both were superseded by Supabase Auth + RLS. Historical
   sections are accurate; that one section is not.
4. **Two ZIPs in the repo root** (`ChiiTech_*_20260925.zip`). Ignored by git but they are
   older than the working tree — do not hand them to another tool.

## Next actions, in order

1. Verify the applied migration count on the live Supabase project and record it here.
2. Confirm a current database backup exists.
3. Reconcile the applied migrations with the 41 local files; apply only what is missing.
4. Deploy the current frontend (`20261022b`) and smoke-test the checklist in `AGENTS.md`.
5. Then pick a product gap: LLM analysis, alert delivery, or reconciliation.
