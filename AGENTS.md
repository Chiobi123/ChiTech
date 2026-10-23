# ChiiTech — working agreement

This is the operating manual for anyone (human or AI) continuing work on ChiiTech.
Read this file first, then `STATE.md` for where the project currently stands.

## 1. What this project is

ChiiTech is a business-management and audit web app for small Nigerian businesses:
sales, expenses, products, customers, orders, tax, an append-only audit trail, an
external-auditor read-only console, and a platform super-admin console.

- **Frontend:** static HTML/CSS/JS, single page (`index.html` + `js/*.js`), no build step.
- **Backend:** Supabase (Postgres + Auth + RLS + Edge Functions).
- **Hosting:** Cloudflare Pages, project name `chiitech`, deploy directory `chiitech/`.

## 2. Repository layout

```
ChiiTech_Professional 10/          <- git repo root (github.com/Chiobi123/ChiTech)
  AGENTS.md                        <- this file: the workflow rules
  STATE.md                         <- current status, gaps, next actions
  .gitignore
  chiitech/                        <- THE deployable site (runtime)
    index.html                     <- every screen as a <section>
    css/style.css                  <- design system + responsive rules
    js/
      app.js                       <- most UI/feature logic (numbered TOC at top)
      data.js                      <- storage layer / Supabase table access
      auth.js                      <- login, roles, department access, auditor grant
      charts.js                    <- dependency-free canvas chart engine
      health-gauge.js              <- dashboard SVG gauge
      imports.js                   <- CSV/JSON/XLSX import + analysis UI
      supabase-config.js           <- project URL + publishable key only
      vendor/supabase.min.js       <- self-hosted Supabase client (2.118.0)
    supabase/
      migrations/                  <- 41 SQL files, applied in filename order
      functions/ai-assist/         <- Edge Function (server-side LLM layer)
    loadtest/k6-staging.js         <- k6 load test (not deployed)
    _headers                       <- CSP + cache policy (not a doc)
    .pagesignore                   <- what must never be published
    *.md, *.pdf                    <- internal docs, excluded from deploy
```

Historical note: until 2026-10-23 the repo tracked a duplicated copy under
`ChiiTech_Professional 10/chiitech/` while the real working copy at `./chiitech/`
was gitignored. That is fixed. Never reintroduce a nested project folder.

## 3. Source of truth

- **Code and migrations:** this repository. Not a ZIP. Not an older download.
- **Database schema history:** `chiitech/supabase/migrations/`, in filename order.
- **Live database:** the existing Supabase project `qmypqghktxlscibgxgxo`.
  Do not create a second project. Do not create a staging project unless the owner
  explicitly asks for one.
- **Runtime config:** `chiitech/js/supabase-config.js` (URL + publishable key only).

If a ZIP and the repository disagree, the repository wins. If the live database and
the migrations folder disagree, stop and report it before changing anything.

> **They currently disagree.** The live project records 22 migrations while this folder
> holds 42 files, and several objects were applied directly in the SQL Editor. Read the
> "Database reality check" in `STATE.md` before touching schema or running `db push`.

## 4. Hard rules

1. **Never run `supabase db reset`** or any operation that drops/recreates the live
   database. There is no complete data backup behind it.
2. **Never edit a migration that may already be applied.** Add a new dated file
   instead. Filenames are `YYYYMMDDHHMMSS_NN_description.sql`.
3. **Never commit secrets:** no service-role key, no database password, no SMTP or
   LLM API key, no `.env`, no `.pem`/`.key`. Only the publishable anon key belongs in
   client code, and it must be safe under RLS.
4. **Never put service-role credentials in the browser.** Server-side work goes in a
   `SECURITY DEFINER` RPC or an Edge Function.
5. **Never weaken RLS to make a screen work.** Fix the query or add a scoped RPC.
6. **Super Admin is not a superuser of company data.** `can_access_company()` means
   "the signed-in user's own company". Platform reads go through the dedicated RPCs
   (`platform_overview`, `restore_company`, `restore_profile`, `resolve_security_alert`,
   `ensure_super_admin`). No impersonation, no "view as admin".
7. **Super Admin password lives only in Supabase Auth.** It is never written into JS,
   SQL, docs, or git. Reserved account: `igbanichiobiebere@gmail.com`.
8. **Imports are staged, reviewed, then committed.** Never write straight from an
   uploaded file into `sales`/`expenses`/`products`/`customers`.
9. **Do not commit build artifacts or archives** (`*.zip` is ignored; keep it that way).
10. **Do not publish internal docs or Supabase source.** Anything new that is internal
    must be added to `chiitech/.pagesignore`.

## 5. The working loop

For every change:

1. **State the change and its acceptance criteria** in one or two lines before coding.
2. **Read the relevant code.** `js/app.js` has a numbered table of contents at the top;
   use it instead of grepping blindly.
3. **Decide where the change belongs:**
   - display/layout/copy → `index.html`, `css/style.css`
   - behaviour → `js/app.js` or the specific module (`auth.js`, `data.js`, `imports.js`)
   - schema/permissions → a **new** migration file
   - privileged server logic → new `SECURITY DEFINER` RPC or Edge Function
4. **Implement narrowly.** No drive-by refactors, no reformatting unrelated code.
5. **Verify locally** (section 7).
6. **Bump the asset version** in `index.html` (`?v=YYYYMMDDx`) whenever any file in
   `css/` or `js/` changes. Static assets are cached immutably; without the bump,
   users keep the old code.
7. **Commit** with a scoped message (section 8).
8. **Deploy** only when the owner asks (section 6.3).

## 6. Commands

The repo root has a `package.json` with no dependencies; everything runs on Node itself.

```powershell
npm run doctor        # is this machine able to run/deploy/migrate? read-only
npm run dev           # serve chiitech/ at http://localhost:8080
npm run version:bump  # bump the ?v= tag in index.html
npm run deploy        # wrangler pages deploy chiitech --project-name chiitech
npm run db:status     # local migrations vs live Supabase project
npm run login:cf      # Cloudflare OAuth (once per machine)
npm run login:supabase # Supabase access token (once per machine)
```

### 6.1 Run locally

```powershell
npm run dev
# open http://localhost:8080
```

Equivalent without npm: `cd chiitech; python -m http.server 8080`.
Opening `index.html` via `file://` will break Supabase auth (origin/session rules).

### 6.2 Apply migrations

Supabase dashboard → SQL Editor → paste each file in **filename order**:

```
20260919215645_01_core_and_profiles.sql
...
20261014000400_41_drop_legacy_functions.sql
```

Or, with the Supabase CLI linked to the existing project, `supabase db push`.
Take a database backup first. Never reset.

### 6.3 Deploy the frontend

```powershell
npm run version:bump   # if js/ or css/ changed
npm run deploy
```

`npm run deploy` builds a whitelisted `dist/` (only `index.html`, `_headers`, `css/`,
`js/`), deploys that, and deletes it afterwards. It refuses to run if anything internal
(`.md`, `.sql`, `.pdf`, `.zip`, `.toml`, `.ts`, `.json`) would be published.

**Never run `wrangler pages deploy chiitech` directly.** `wrangler pages deploy` uploads
the directory as-is and ignores `.pagesignore`; doing that once already published
`README.md`, the Supabase migrations and the load tests. `.pagesignore` only governs
Pages' own git-connected build.

`chiitech/` has a Pages catch-all, so a missing file returns the app shell (200) rather
than 404 — check the response body, not just the status code, when verifying.

### 6.4 Load test

```powershell
k6 run chiitech/loadtest/k6-staging.js
```

`k6` is not installed on this machine yet (`npm run doctor` flags it). Optional.
Use a staging/test account, never a real company's live data.

## 7. Verification before committing

Minimum for any UI/data change:

- [ ] Sign-in works: company admin, worker, auditor, super admin.
- [ ] The changed screen renders on desktop and at 360px width.
- [ ] A worker without the relevant department permission cannot see the section.
- [ ] RLS still holds: a signed-in user of company A cannot read company B.
- [ ] No new console errors; no new network 401/403.
- [ ] `index.html` asset version bumped if `js/` or `css/` changed.

For a migration:

- [ ] Backup taken.
- [ ] File runs cleanly on the live project (SQL Editor), no `DROP ... CASCADE` on data.
- [ ] Re-running it is refused or harmless (idempotent guard: `if not exists` / `create or replace`).
- [ ] Policies and grants re-checked for the affected tables.
- [ ] The change is reflected in `STATE.md`.

For an import change:

- [ ] Small CSV first, analysis shown before commit.
- [ ] Rows land in the intended table only.
- [ ] A security alert is created.
- [ ] Bad file (missing column, bad date, negative amount) is rejected with a clear message.

## 8. Commit messages

Scoped prefix, imperative, specific:

```
feat: add existing business import and analysis
security: isolate super admin from company data
fix: repair super admin authentication
perf: cut sign-in load time
ui: add import and security center
docs: refresh handoff to migration 41
chore: ...
```

One logical change per commit. Do not bundle a doc rewrite with a behaviour change.

## 9. Known gaps (do not re-litigate, these are decisions)

- Import analysis is **deterministic and rule-based** on purpose. No LLM in the import
  path yet; if added, it must read staged rows server-side, never with a service key in
  the browser.
- Security alerts are **review signals**, not fraud verdicts. Wording matters.
- Alerting is database-only. No email/SMS/push delivery yet.
- No automated frontend tests. Verification is manual plus the k6 load test.

## 10. Multi-tool handoff

Only one tool edits code for a given change at a time.

| Tool | Use for |
|---|---|
| ChatGPT | architecture/security review, RLS reasoning, migration design, test plans, patch prep |
| Claude | multi-file refactors, deep debugging, implementing an approved change set |
| Lovable | UI/UX polish and responsive layout, connected to this GitHub repo |
| Any agent | must work from the current repository state, never a stale ZIP |

Sequence: define change + acceptance criteria → implement → commit → optional UI polish
→ commit → review → next change. See `chiitech/CHIITECH_AI_HANDOFF.md` for the longer
tool-specific notes.
