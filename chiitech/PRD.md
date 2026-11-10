# ChiiTech — Product Requirements Document

Internal document. Not deployed (`.pagesignore` excludes `*.md`).
Last updated: 2026-11-01 (asset `20261101f`). Source of truth for *what is built*:
this file + `STATE.md`. Source of truth for *code*: the repository.

## 1. Product

ChiiTech is a business-management and audit web app for small Nigerian businesses.
One company = one workspace. The owner/admin runs the business; workers record
daily activity inside the departments they are granted; an external auditor gets a
read-only console; a platform super-admin manages company accounts without ever
seeing a company's data.

- **Frontend:** static HTML/CSS/JS, single page, no build step, no framework, no CDN.
- **Backend:** Supabase (Postgres, Auth, RLS, Storage, Edge Functions).
- **Hosting:** Cloudflare Pages, project `chiitech`, deploy root `chiitech/`.

## 2. Users and roles

| Role | Access |
|---|---|
| `company_admin` | Everything in their company: all sections, team management, imports, billing, audit page, month close. |
| `worker` | Only the departments granted to them (Sales, Products, Expenses, Customers, Orders, Tax, Audit-view, Analytics). Enforced in the UI **and** refused by RLS. |
| `auditor` (external) | Read-only Command Center: audit trail, trial balance, findings, opinion, exports. Invited by code; deactivated on revoke. |
| `super_admin` (platform) | Company directory, restore soft-deleted companies/profiles, security-alert queue, platform overview RPCs. Never reads company business data — no impersonation, no "view as". |

Department access is stored per profile and checked on every section render and
every query path; a worker without a permission cannot see the section.

## 3. Screens (single page, `index.html`)

Auth/landing (`#login-screen`: sign-in, register, join-by-invite, reset) then the
app shell with sections:

1. **Dashboard** (`sec-dashboard`) — KPI row, charts (native canvas), money-pulse
   cards, onboarding card, business-health SVG gauge.
2. **Sales** (`sec-sales`) — cart-style sale flow, receipts upload, stock deduction.
3. **Products** (`sec-products`) — CRUD, price edit, slow-stock detection.
4. **Customers** (`sec-customers`) — CRUD, balances, tiers (VIP etc.).
5. **Orders** (`sec-orders`) — remote/non-visitor order pipeline.
6. **Expenses** (`sec-expenses`) — logging, automatic flagging, root-cause view.
7. **Tax** (`sec-tax`) — VAT/WHT from real records, exports.
8. **Audit** (`sec-audit`) — hash-chained trail, trial balance, segregation-of-duties
   matrix, Benford's Law, materiality/findings, audit opinion, close-the-month,
   export HTML/CSV/JSON.
9. **Growth** (`sec-growth`) — forecast, best-sellers, LTV/churn, loan readiness,
   4-pillar plan, chart switcher.
10. **AI Assistant** (`sec-ai`) — keyword-matched answers from live data; also the
    import deep-analysis renderer.
11. **Team & Departments** (`sec-team`) — admin adds workers, assigns departments,
    invitations.
12. **Auditor access** (`sec-auditoraccess`) — invite codes, status.
13. **Billing** (`sec-billing`) — plan/paywall status display.
14. **Imports & Analysis** (`sec-imports`) — staged CSV/JSON/XLSX import.
15. **Super Admin** (`sec-superadmin`) — platform console.
16. **Auditor console** (`sec-auditor`) — read-only external auditor view.

Plus legal pages (privacy/terms), the boot veil, and toasts.

## 4. Functional requirements (as built)

### 4.1 Auth and accounts
- Email/password sign-in, company registration, join-by-invite with `?token=`
  prefilled and immediately scrubbed from the URL.
- Soft delete: `soft_delete_company()` / `soft_delete_my_profile()` flag rows;
  login blocked with a plain explanation; super-admin can restore.
- Google OAuth configured (client in `GOOGLE_AUTH_SETUP.md`).

### 4.2 Core business data
- CRUD for products, customers, sales, expenses, orders.
- VAT/WHT computed from real records; stock deduction on sale; customer credit
  and tiers; receipts photo upload (compressed on device → private `receipts`
  bucket, signed URLs).

### 4.3 Audit engine
- Every action writes to an append-only, hash-chained `audit_log`
  (trigger + `digest()` in `extensions` schema).
- Analysis: trial balance, SoD matrix, Benford's Law, materiality, findings,
  audit opinion; exports to HTML/CSV/JSON.

### 4.4 Imports (staged, never direct)
- Upload → `import_batches` + `import_rows` staging → deterministic analysis
  (missing values, duplicates, invalid dates, negatives, statistical outliers,
  strengths/weaknesses/recommended actions) → review → **transactional RPC**
  `commit_import_batch()` writes the real tables. A bad file is rejected with a
  clear message. A security alert is created on commit.
- Column auto-detection for sales/expenses/products/customers. XLSX via lazily
  loaded SheetJS (only when an `.xlsx` is chosen).
- Optional LLM deep analysis: server-side `deep_analyse_import_batch()` RPC
  (capped 200 rows + last 90d company history) → Edge Function `ai-assist`
  (`import_deep` mode, Groq) → structured JSON (anomalies, patterns,
  cross-references, prioritized recommendations). Deterministic analysis remains
  the audited baseline; LLM output is advisory and falls back to prose if the AI
  is unavailable.

### 4.5 Security controls
- RLS on every table; `app_private.can_access_company()` = own company only,
  no super-admin bypass.
- `security_alerts` table + detection rules (admin actions, flagged records,
  large expenses/sales, completed imports); resolve action in the console.
  Alerts are review signals, not fraud verdicts.
- Super Admin platform operations only through `SECURITY DEFINER` RPCs:
  `platform_overview`, `restore_company`, `restore_profile`,
  `resolve_security_alert`, `ensure_super_admin`.
- Flight recorder: capped audit queries, latency indexes.

### 4.6 Growth and insights
- Forecast, best-sellers, LTV/churn, loan readiness, playbooks; dashboard
  money-pulse (daily target, owe/owed, budget bars, slow stock, regulars vs
  quiet customers, staff scoreboard); business-health gauge.

## 5. Data model (summary)

42 migration files in `supabase/migrations/`, applied in filename order. Main
tables: `profiles`, `companies`, department-permission grants, `products`,
`customers`, `sales`/`sale_items`, `expenses`, `orders`, `audit_log`,
`import_batches`/`import_rows`, `security_alerts`, `worker_invitations`,
`auditor_invites`, `accounting_periods`, `debts`, `budgets`, `receipts`,
`plans`, `ai_usage`, `audit_findings`, `sop`, plus `app_private.*` helpers.

**Live database caveat:** the live project records 25 applied migrations while
the repo holds 42 files; several objects were applied directly in the SQL Editor.
`supabase db push` is unsafe until reconciled. See "Database reality check" in
`STATE.md`. Never run `db reset`.

## 6. Non-functional requirements

| Area | Requirement | Status |
|---|---|---|
| Responsive | Sign-in shows hero copy **and** card with no scrolling from 320×568 to 1440×900 and in landscape; PC keeps side-by-side layout. Verified by iframe measurement on 19 viewports. | Done (`20261101f`) |
| Dashboard | Admin sees a clean panel layout: KPI row, chart, paired cards — no unnecessary content; 2-column grid ≥901px, single column below. | Done |
| Performance | Deferred scripts, self-hosted Supabase client, no CDN, immutable `?v=` asset caching, preconnect to Supabase, single render on boot. Sign-in ~12s → sub-second on repeat visits. | Done |
| Security | No secrets in the repo or client bundle; service-role work only in RPCs/Edge Functions; RLS never weakened for a screen. | Standing rule |
| Accessibility | Reduced-motion honoured (auth pulse, animations); semantic colour use (red/amber for status only). | Partial — no formal WCAG audit |
| Offline/PWA | Not required yet. | Not done |
| Automated tests | None; verification is manual + k6 load script (`loadtest/k6-staging.js`). | Not done |

## 7. Current round (2026-11-01)

1. Re-theme to the owner's reference look: near-black indigo (`#080A16`), one
   violet accent (`#8B7CF6`), hairline surfaces, white-on-accent fills.
2. One-screen auth on phones/tablets/landscape (no scrolling to see both hero
   and card); landscape lays hero and card side by side like desktop.
3. Admin dashboard panel layout at ≥901px: header/onboarding/KPI row full width,
   cards paired two across, 16px gaps, compact stat cards — scoped to
   `#sec-dashboard.section.active` so it cannot defeat `.section{display:none}`.
4. PRD + workflow documentation (this file, `WORKFLOW.md`).

Not deployed — deploy only on the owner's explicit instruction.

## 8. Known gaps / out of scope

- Alert delivery (email/SMS/push) — database center ready, no provider chosen.
- Password-reset emails — Supabase has no SMTP configured.
- Bank/POS statement reconciliation; accounting-software import.
- Excel formula provenance (values read, formulas not traced).
- Real payment collection (needs Paystack/Flutterwave + KYC).
- Automated test suite; PWA/native packaging.
