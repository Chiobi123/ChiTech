# ChiiTech — frontend prototype

A working, click-through frontend for the ChiiTech product blueprint: multi-company
admin/worker/auditor accounts, a super-admin console, dashboard, sales, products, customers,
orders, expenses, tax analysis, an audit trail engine, a growth engine, team management,
billing, and an AI assistant (rule-based for this demo).

## Run it

No build step needed. Open `index.html` in a browser, or serve the folder locally:

```
cd chiitech-app
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. Sign in with the demo admin (owner@chiitech.demo /
demo1234), register a new company from the login screen, or sign in as the platform
super admin using the email in `SUPER_ADMIN_EMAIL` (see `js/data.js`).

## Latest round: account deletion, disaster recovery, audit materiality/findings, a React island

**1. Soft-delete for accounts.** A company_admin can close their whole company's
account, or a worker their own individual access, from a "Delete account" link in
the sidebar. Nothing is ever actually erased — `soft_delete_company()` /
`soft_delete_my_profile()` just flag the row, which (via `can_access_company()`) makes
it invisible to everyone but the platform's super_admin, who can fully restore it
from the Super Admin console. Login is blocked cleanly for a closed account with a
plain explanation, not a confusing error.

**2. `supabase/migrations/` now exists as a real, verified asset.** All 14 migrations
that built the live database were pulled from Supabase's own migration history and
checked byte-for-byte (via hash) against what's actually applied — not retyped from
memory, which caught a real transcription slip on the first attempt. Running these
in order against a fresh Supabase project rebuilds the entire schema, every RLS
policy, every function, and the audit hash-chain trigger, exactly as they exist
today.

**3. `DISASTER_RECOVERY.md`** — an actual runbook, not just a note. It's blunt about
the one real gap worth fixing now: this project is on Supabase's Free tier, which
takes **zero automated backups** — the migrations folder rebuilds structure, not
data. Covers recovery time/data-loss estimates for five concrete scenarios (frontend
lost, backend lost with/without a backup, one company's data gone, credentials
compromised), and a short pre-disaster checklist.

**4. Two things real audit practice does that this app didn't yet:**
- **Materiality threshold** — a naira amount below which a discrepancy isn't worth
  chasing, admin-editable on the Audit page. A flagged expense below it now shows
  "Flagged (below materiality)" instead of reading as urgent as a real problem.
- **Findings log** — a place to record a documented conclusion ("we looked at X,
  here's what we found," with a severity and open/resolved status), separate from
  the raw immutable activity log. This is what audit working papers exist to
  capture. Visible read-only to the auditor role too, via the same
  `auditor_fetch_data()` RPC as everything else in their Command Center — they can
  see what the company's own team documented, but (like everywhere else) can never
  write to it themselves.

**5. One React island, not a rewrite.** `js/react-widgets.js` adds a single animated
health-score gauge to the Dashboard (React 18 + ReactDOM via CDN, no build step,
plain `React.createElement` since there's no Babel in the page to compile JSX). It
reads one number handed to it and renders itself — nothing else in the app changed
to make room for it, and nothing else needs to change to add another one later the
same way, in a specific container, reading specific data it's given. A full
framework migration for the rest of the app is a much larger, separate undertaking
and wasn't attempted here.

**1. The auditor is no longer on a clock.** Previously every auditor grant defaulted to a
7-day window, which is wrong for the actual job — an auditor's value is checking in
*regularly* (daily, if they want) to confirm the business is doing what it's supposed to,
not sprinting through one review before a timer runs out. Changes:

- **"No expiry" is now the default** when an admin generates an access code. The auditor can
  sign in any time, as often as they like, indefinitely.
- The fixed windows (3/7/14/30 days) are still there as options, just no longer the default —
  an admin who genuinely wants a one-off Q3 review can still time-box it.
- **Revoke is now the primary control**, not expiry: access lasts until the admin ends it,
  which is both simpler to reason about and safer (an admin who wants access gone acts
  deliberately rather than waiting for a timer).
- **None of this weakens the read-only guarantee.** Unlimited *time* is not unlimited
  *permission* — the auditor session still cannot write, edit, or delete anything anywhere in
  the app, and still can't reach any section other than the Command Center. Standing access
  and read-only access are independent, and only the first one changed.
- **The admin's Visit log now summarises frequency** — visits in the last 7 days, the last 30,
  and how many separate days were checked. With no expiry date to watch, "are they still
  actually looking?" is the question an admin needs answered, so the page answers it.

**2. Manual vs. AI analysis, in the auditor's own environment.** The Command Center now has an
Analysis mode switcher mirroring the one on the Growth engine:

- **Manual review** — the default. The auditor reads the trial balance, segregation-of-duties
  matrix, Benford's Law check, SOPs and activity log themselves, as before.
- **AI automatic analysis** — the same underlying records read through automatically into a
  plain-language summary: where audit confidence sits and what opinion it supports, how many
  expenses are flagged and open, whether sale amounts drift from the Benford distribution, how
  many SOPs are overdue for review, and how many team members hold concentrated
  record-and-review access.
- **Choosing a mode is not a change to the business.** The preference lives in the auditor's
  own browser session, never in the company's data, and is deliberately *not* written to the
  audit log — how someone chooses to read the books isn't an action taken on the books. The
  read-only guarantee is intact in both modes.
- Consistent with the rest of this build, the "AI" here is rule-based, computed from the
  company's real records. Swapping in a real LLM call is the same single-point change
  described under "Next steps" — it would read the same data.

**3. The interface feels alive now.** Motion was added carefully, because an earlier round of
this project caused real lag with a continuously-animating full-viewport background. The rule
followed here: *animate small elements, or animate once — never repaint the whole screen
forever.*

- Sections fade and rise in when you switch between them.
- Headline numbers (sales, profit, expenses, audit confidence, cash forecast) count up to their
  new value rather than snapping, so a recorded sale visibly lands.
- Cards and stats lift slightly on hover; buttons press in when clicked; nav items shift on
  hover; inputs get a soft green focus ring; table rows highlight as you read down them.
- Stat cards carry a thin accent bar along the top, tinted to their own state — green, amber or
  red — so the dashboard reads before you read a number.
- A small pulsing "live" dot marks the dashboard and the Auditor Command Center as live data.
- **Cost:** the only continuously-running animation in the app is that 7px dot. Everything else
  is one-shot or hover-triggered, so the page still costs nothing at idle.
- **`prefers-reduced-motion` is respected** — a visitor whose system asks for reduced motion
  gets all of it switched off automatically, including the counting numbers.

## Earlier round: auditor access (Phase 2 feature from the PRD)

The PRD's "Auditor collaboration mode" — read-only access for an external accountant or
auditor — is implemented end to end. (This section describes it as first built, when access
was time-boxed by default; see the round above for why that default was dropped.)

- **A fourth role, `auditor`**, alongside super_admin/company_admin/worker (see the role
  doc comment at the top of `js/auth.js`). It isn't a `platform.users` account at all —
  it's a grant living inside that one company's own business bucket
  (`state.auditorGrants`, see the shape comment in `js/data.js`), so it can be issued and
  revoked entirely by that company's admin, with no platform-level signup.
- **"Auditor access" admin page** (Team & departments' new neighbour in the sidebar): an
  admin picks a label (e.g. "ABC Accounting — Q3 review") and an expiry (3/7/14/30 days,
  or none), and gets a one-time auditor access code to share alongside the company's
  existing code. Grants can be revoked at any time from the same table, which also shows
  each grant's status and last visit.
- **"Log in as Auditor"**, a third tab on the login screen — company code + auditor
  access code, no email/password.
- **Auditor Command Center**, a locked-down, read-only mirror of the Audit page (audit
  confidence, opinion, trial balance, segregation-of-duties matrix, Benford's Law check,
  SOPs, the immutable activity log, and the same HTML/CSV/JSON export) — and the *only*
  section an auditor session can ever reach; every other nav item is hidden for that
  role regardless of what it would normally require (see `applyAccessControl()` in
  `js/auth.js`).
- **Visit logging**: every auditor sign-in writes to `state.auditVisitLog` (shown to the
  admin on the Auditor access page) and to the company's own immutable activity log, so
  it's visible in context alongside every other action too.
- **Honest limit** (unchanged, and now more relevant since revoke is the main control): a
  revoked or expired grant is only re-checked on the next boot
  (sign-in, or page reload) — there's no live push in a static, backend-less build, so an
  auditor mid-session won't be kicked out instantly the moment an admin clicks Revoke.
  The real backend from the PRD's roadmap would enforce this server-side, immediately.

## Fixed in this round

- **Charts weren't showing.** The previous build loaded a charting library from a CDN;
  on a blocked or offline network that request silently fails and every chart stays
  blank. `js/charts.js` now draws every chart itself with the native Canvas API — no
  CDN, no dependency, works offline. Icons got the same fix (CSS-only Unicode glyphs
  instead of an icon-font CDN).
- **Only 5 of 12 sections were reachable on mobile.** The sidebar is now a proper
  slide-in drawer (hamburger menu), reaching every section on any screen size.
- **Page looked stuck in the top-left corner when zoomed out / on very wide screens.**
  Content now centres itself in the space next to the sidebar instead of hugging the left.
- **Company registration was easy to miss.** There's now a highlighted callout on the
  sign-in screen pointing new users to the registration tab, not just a small subtab link.
- **Stored XSS risk.** Anywhere a name, note, or category you typed gets displayed again
  (tables, the audit log, AI chat), it's now escaped through `escapeHtml()` before being
  inserted into the page, so it can never be interpreted as code.

## Fixed in this round

- **Critical bug: new companies inherited demo data.** Registering a new company silently gave it the same
  sample products, customers, and orders as the built-in demo account — including identical fake orders. This
  is why order data from one company appeared to "leak" into another; they weren't leaking, they were both
  seeded with the same canned content. Fixed: real registrations now start on a genuinely blank slate
  (`seedEmptyBusiness()` in `js/data.js`), and this was the root cause of the login/company-code confusion
  reported too.
- **Fixed a file-corrupting bug in a table-wrapping script** that briefly broke page layout across most
  sections during this round's work — caught, diagnosed, and repaired with a safer runtime (JS-based) approach
  instead of fragile HTML text editing. Every section was re-verified afterward.
- **Chart legend overlap.** A multi-series chart's legend (e.g. the Benford's Law check) could render on top
  of the text below it. Charts now reserve their own space properly.
- **Impersonation banner** replaced a full-width, hard-to-miss yellow strip with a small corner badge.
- **Sign-in form** no longer ships with the demo password pre-filled in the password box, which could cause a
  freshly-registered admin's real sign-in attempt to silently fail against the leftover demo value.
- **Billing page** no longer shows fabricated "Paid" invoice history — it honestly shows "no invoices yet"
  since billing isn't wired to a real payment run, and now names Paystack + bank transfer specifically as the
  two payout methods instead of generic "a provider."

## New in this round

- **Forgot password / find your company code** flow on the login screen (self-service password reset for
  admins, a company-code lookup by email for anyone, and an admin-side "Reset password" button for workers).
- **CT → ChiiTech hover logo** in the sidebar (full wordmark stays on the login screen).
- **A real "Back" button** that returns to whichever section you were on before, not just Home.
- **An About/Contact page**, reachable from the login screen, explaining the problem ChiiTech solves and who
  it's for.
- **Sales: enter the final price, see the discount automatically** — instead of typing a discount amount, you
  type what you actually sold it for and the discount is computed and shown live.
- **Multi-product performance chart** on the Growth engine — one line per product, with a timeframe selector
  from "last 60 seconds" up to "last 5 years."
- **Chart type switcher** added to the Dashboard's Revenue vs. Cost chart (stacked bar / line / doughnut).
- **Standard Operating Procedures (SOPs)** section on the Audit page — document how the business is supposed
  to run (procurement, evaluation, reporting cadence) so there's a written standard to audit against, with
  review-frequency tracking and an "overdue" flag.
- **Collapsible "Show more / Show less"** on every long list/table, implemented by wrapping tables at runtime
  with JavaScript (not by editing raw HTML) specifically so this kind of change can't corrupt the page again.
- **A subtle decorative background** (soft glows + a faint grid, pure CSS, slowly drifting) instead of flat
  black, across every page.

## Fixed: performance (the lag)

The decorative background added in an earlier round had a continuous 34-second CSS animation running across
a full-viewport, gradient-heavy layer. That forces the browser to repaint constantly for as long as the page
is open — the direct cause of the general lag and the delay between typing and seeing it on screen. The
background is now fully static (painted once, costs nothing at idle) and also now shows through on the login
page, which previously had an opaque background hiding it.

## Security & legal checklist — what was done, and what's honestly out of scope

Two handwritten checklists came in as photos: one for not getting hacked, one for not getting sued. Going
through both:

**Implemented:**
- Passwords are now hashed (SHA-256 + per-user random salt via the browser's Web Crypto API) before being
  stored, instead of as plain text. Honest caveat below.
- Basic client-side login throttling (5 failed attempts locks that email out for 30 seconds).
- Input sanitization: every place user-entered text is displayed back on screen is escaped (`escapeHtml()` in
  `app.js`) — already in place from the previous round, reconfirmed here.
- Accessibility: keyboard-focusable info tooltips, `aria-label`s on icon-only buttons, the hamburger menu is
  now keyboard-operable (Tab + Enter/Space).
- Legal pages added: Privacy Policy, Terms & Conditions, Cookie & Data Policy, Refund Policy — reachable from
  the login and About screens. **These are templates, not legal advice** — have a Nigerian lawyer review them
  before relying on them for a live product, and fill in your real business details, launch dates, and (once
  Paystack is actually connected) real refund terms.

**Not applicable to this build, and why:** items like "protect admin routes," "secure API endpoints," "CORS
settings," "secure DB access," "rate limiting" (server-side), "SQL/NoSQL injection protection," "check exposed
files," and "check git for secrets" are all things that only exist once there's a real server and database.
This is currently a static, client-only frontend — there is no API, no database, and no server to secure.
They become real, necessary work items the moment the FastAPI/PostgreSQL backend from the PRD gets built, not
before.

**Honest limits of what *was* done:** the password hashing happens in your browser, in code anyone can read
via dev tools — it stops a casual glance at localStorage from revealing a real password, but it is not
equivalent to server-side authentication. Department permissions are still enforced by hiding menu items, not
by a server refusing data. A real launch needs the backend to do these properly.

## How it's built

- **`index.html`** — every screen as a `<section>`, shown/hidden by `app.js` (single-page app).
- **`css/style.css`** — the dark background / neon-green design system from the PRD,
  including all mobile-responsive rules at the bottom of the file.
- **`js/data.js`** — the storage layer: the platform-wide company/user directory, and a
  separate data bucket per company (products, sales, expenses, etc.), all via
  `localStorage`. Replace `loadPlatform`/`loadBusiness`/`save*` with real API calls when
  you connect the FastAPI/PostgreSQL backend from the PRD — nothing else needs to change.
- **`js/auth.js`** — login, company registration, session handling, and department-based
  access control (`canAccess()`, `SECTION_ACCESS`), plus the auditor grant sign-in
  (`loginAuditor()`).
- **`js/charts.js`** — the dependency-free chart engine (see "Fixed in this round" above).
- **`js/app.js`** — everything else: recording sales/expenses/orders, the audit
  hash-chain, Benford's Law check, tax calculations, growth forecasts and playbooks,
  team management, auditor grant management (`grantAuditorAccess()`,
  `revokeAuditorGrant()`) and the read-only Command Center it unlocks
  (`renderAuditorCommandCenter()`), the super-admin console, and the AI assistant's
  answers. Start at the top of this file — it has a numbered table of contents in its
  opening comment.

## What's implemented vs. simulated

Implemented and working in the browser:
- Two-tier login (Admin / Worker) with self-serve company registration, plus a separate
  code-based "Log in as Auditor" flow for standing (or optionally time-boxed) read-only
  external access (see above)
- A single super-admin account (fixed email) that sees every registered company, can view any company's dashboard, and sees platform-wide subscription revenue (MRR, revenue by plan)
- Department-based worker access control (Sales, Products, Expenses, Customers, Orders, Tax, Audit-view, Analytics) — Team & departments page lets an admin add workers and tick exactly what they can see
- Full CRUD for products, customers, sales, expenses, orders
- Cart-based sales with discount, automatic VAT, and invoice numbers
- Editable product prices with audit attribution
- Custom expense categories and a root-cause suggestion panel on flagged expenses
- Stock deduction on sale, customer balance/credit tracking, customer tiers (VIP/Regular/New/At risk)
- An append-only, hash-chained audit log, Benford's Law check, trial balance check, segregation-of-duties matrix, and a Clean/Qualified/Adverse audit opinion
- Three audit export formats: browser-viewable HTML report, CSV, or JSON
- Tax analysis (VAT + WHT) computed from real records, with a CSV export
- A **self-contained chart engine** (`js/charts.js`) — bar, stacked bar, line, doughnut, and a combo bar+line chart, all drawn with the native Canvas API. No CDN, no external library, so charts always render, online or offline. Used across the Dashboard (3 charts), Growth engine (switchable bar/line/doughnut/3D-style), the Super Admin revenue breakdown, and the Benford's Law check.
- A dynamic "Getting started" checklist on the Dashboard for first-time users
- A growth engine with a bar/line/doughnut/3D-style chart switcher, automated vs. manual analyst mode (available to admins and to any worker granted "Data analysis & growth" access), and a four-pillar (Sales/Marketing/Finance/Operations) growth plan
- A keyword-matching AI assistant that answers from your actual local data across sales, stock, tax, orders, customers, team and audit questions
- A mobile hamburger-drawer navigation reaching every section, tested down to 360px wide, with a centred layout on very wide/zoomed-out screens
- Basic XSS hardening: every place user-entered text (names, notes, categories) gets shown back on screen, it's escaped first — see `escapeHtml()` in `app.js`

Simulated for the prototype (needs real backend/integrations to go live):
- Authentication (any email/password combination works; passwords are stored in plain text in the browser — a real build must hash them server-side)
- Department permissions are enforced by hiding UI, not by a server refusing data — a determined user with dev tools open could still see restricted data client-side
- Bank/POS statement reconciliation (no bank feed connected yet — the trial balance check is an internal consistency check, not a substitute)
- The AI assistant's language understanding (swap in an LLM API call — `answerQuestion()` in `app.js` is the single place to change)
- Real payment collection on the Billing & payouts page, and platform-owner revenue collection on the Super Admin page (both need a licensed Nigerian payment provider such as Paystack or Flutterwave, plus KYC)
- Installing as a native app on desktop/mobile (this build is web-only, as requested, until you sign off on the web version)

## Advanced audit intelligence added in this version

- **Hash-chained audit log** — every action's log entry embeds the previous entry's
  hash, so an edited or deleted history entry breaks the chain and is visible.
- **Benford's Law check** — flags when the distribution of leading digits in sale
  amounts drifts from the natural pattern real transactions follow, a common signal
  of invented figures.
- **Anomaly rule on expenses** — flags expenses that are 3x+ above the running average,
  or suspiciously round, for review before they're trusted.
- **Audit confidence score** — separate from the general business health score, shown
  on the Audit page.
- **Exportable audit package** — one click produces a JSON package (health score, full
  ledger, audit log) an accountant or lender could review.

## Growth engine added in this version

- **Cash-flow forecast** — projects the next 30 days from the last 7 days of sales.
- **Best-seller detection** — by revenue and by units sold.
- **Customer lifetime value & churn risk** — flags customers who haven't purchased
  recently.
- **Loan/credit readiness score** — a simple "bankable / building / not yet" read on
  whether the business's records are currently strong enough to support a loan or
  grant application.
- **Auto-generated growth playbooks** — restocking, bundling, win-back and collections
  suggestions generated from the business's own data, not generic tips.

## Next steps to make this production-ready

1. Replace `data.js` with real API calls to the FastAPI backend.
2. Move the hash-chain and Benford's Law checks server-side so they can't be bypassed
   by editing the client.
3. Replace the rule-based AI assistant with an LLM API call, passing it the same
   business data already used to compute the dashboard.
4. Add real authentication (JWT + hashed passwords), and proper server-side
   enforcement of department permissions (today they're enforced in the browser only).
5. Connect a real payment provider (e.g. Paystack, Flutterwave) for the Billing &
   payouts page before it can move real money.
6. Package as an installable app (PWA manifest + service worker for desktop/mobile
   "Add to Home Screen", or wrap with Capacitor/Electron) once the web version is signed off.
