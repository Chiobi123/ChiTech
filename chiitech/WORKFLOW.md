# ChiiTech — Workflow & Process Documentation

Internal document. Not deployed (`.pagesignore` excludes `*.md`).
Last updated: 2026-11-01. Read with `PRD.md` (what) and `STATE.md` (where we are).

## 1. Roles and tools

One tool edits code for a given change at a time (see §7).

| Tool | Used for |
|---|---|
| ChatGPT | architecture/security review, RLS reasoning, migration design, test plans |
| Claude / OpenCode | multi-file refactors, deep debugging, implementing approved change sets |
| Lovable | UI/UX polish, connected to the GitHub repo |
| Human owner | decisions, credentials, deploy approval |

## 2. The working loop (every change)

1. **State the change and its acceptance criteria** in 1–2 lines before coding.
2. **Read the code first.** `js/app.js` has a numbered TOC (BOOT → NAVIGATION →
   AUDIT ENGINE → … → AI ASSISTANT); use it instead of blind grepping.
3. **Place the change:**
   - display/layout/copy → `index.html`, `css/style.css`
   - behaviour → `js/app.js` or a module (`auth.js`, `data.js`, `imports.js`, `charts.js`, `health-gauge.js`)
   - schema/permissions → a **new** migration file (never edit an applied one)
   - privileged server logic → new `SECURITY DEFINER` RPC or Edge Function
4. **Implement narrowly.** No drive-by refactors, no reformatting unrelated code.
5. **Verify locally** (§4).
6. **Bump the asset version** `?v=YYYYMMDDx` in `index.html` whenever `css/` or
   `js/` changes (`npm run version:bump`), else users keep cached old code.
7. **Commit** with a scoped message (§6). Deploy only when the owner asks (§5).

## 3. Roles, permissions and data rules (standing)

- Department access enforced in UI **and** refused by data (RLS).
- RLS never weakened to make a screen work — fix the query or add a scoped RPC.
- Super Admin is not a superuser of company data; platform reads go through the
  dedicated RPCs only. No impersonation.
- Super Admin password lives only in Supabase Auth (reserved account in `STATE.md`).
- Imports are staged → analysed → reviewed → committed via transactional RPC.
  Never a direct table write from an uploaded file.
- Security alerts are review signals, not fraud verdicts — wording matters.
- No secrets in git, JS, SQL, docs or logs. Only the publishable anon key in
  client code. Server-side work stays in `SECURITY DEFINER` RPCs / Edge Functions.

## 4. Verification matrix (before every commit)

Minimum for any UI/data change:

- [ ] Sign-in works: company admin, worker, auditor, super admin.
- [ ] Changed screen renders on desktop and at 360px width.
- [ ] A worker without the relevant department permission cannot see the section.
- [ ] RLS holds: a signed-in user of company A cannot read company B.
- [ ] No new console errors; no new network 401/403.
- [ ] `?v=` asset version bumped if `css/` or `js/` changed.

For a **migration**:

- [ ] Backup taken first.
- [ ] File runs cleanly on the live project (SQL Editor), no `DROP … CASCADE` on data.
- [ ] Idempotent (`if not exists` / `create or replace`) — re-running is harmless.
- [ ] Policies and grants re-checked for affected tables.
- [ ] Change reflected in `STATE.md`.

For an **import change**:

- [ ] Small CSV first, analysis shown before commit.
- [ ] Rows land in the intended table only.
- [ ] A security alert is created.
- [ ] Bad file (missing column, bad date, negative amount) rejected with a clear message.

For **responsive/layout** work (this round's method): load the page in hidden
iframes at each target size, assert `documentElement.scrollHeight <= viewport`
and no horizontal overflow, and read computed styles for the layout under test.
Viewports used 2026-11-01: 320×568, 360×640, 375×667, 390×844, 412×915,
430×932, 600×900, 768×1024, 800×900, 1024×768, 1280×720, 1366×768, 1440×900,
landscape 667×375, 768×400, 844×390, 896×412, 932×430, 1024×500.

Local server: `npm run dev` → http://localhost:8080 (`npm.cmd run dev` in
PowerShell; opening `index.html` via `file://` breaks Supabase auth).

## 5. Deploy pipeline

```powershell
npm run doctor        # read-only machine check
npm run version:bump  # if js/ or css/ changed
npm run deploy        # builds whitelisted dist/, deploys, cleans up
```

- `npm run deploy` publishes **only** `index.html`, `_headers`, `css/`, `js/`
  and refuses if internal files (`.md`, `.sql`, `.pdf`, `.zip`, `.toml`, `.ts`,
  `.json`) would be included.
- **Never** run `wrangler pages deploy chiitech` directly — it uploads the
  directory as-is and ignores `.pagesignore`; doing that once already published
  internal docs, migrations and load tests.
- `.pagesignore` excludes `*.md`, `*.pdf`, `*.zip`, `supabase/`, `loadtest/`,
  `.pgdata/`. New internal artifacts must be added there.
- `chiitech/` has a Pages catch-all: a missing file returns the app shell (200),
  so verify the response **body**, not just the status code.
- Deploy only on the owner's explicit instruction.

## 6. Git workflow

- Repo: `github.com/Chiobi123/ChiTech`, deploy root `chiitech/`.
- One logical change per commit; scoped imperative message:

  ```
  ui: fit sign-in on every viewport and panel the admin dashboard
  security: isolate super admin from company data
  fix: repair super admin authentication
  docs: add PRD and workflow documentation
  chore: ...
  ```

- Never commit secrets, build artifacts, or archives (`*.zip` ignored).
- Do not commit or stage anything the user did not ask to commit.
- `supabase/.temp/*` is local CLI state — leave it unstaged.

## 7. Database change process

1. Backup first (external dashboard — done 2026-10-23, confirm before next change).
2. Write a **new** file `supabase/migrations/YYYYMMDDHHMMSS_NN_description.sql`.
   Never edit a migration that may already be applied.
3. Apply via Supabase dashboard → SQL Editor, in filename order, or
   `supabase db push` **only** once history is reconciled.
4. Idempotent guards; re-running must be refused or harmless.
5. Record it in `STATE.md`.

**Current constraint:** live records 25 applied migrations vs 42 repo files
(several applied directly in the SQL Editor). `db push` would replay 22–41 on
existing objects — unsafe. Never run `db reset`. Reconciliation plan lives in
`STATE.md` ("Database reality check").

## 8. Multi-tool handoff

Sequence: define change + acceptance criteria → implement → commit → optional UI
polish → commit → review → next change.

- Work from the current repository state, never a stale ZIP (two stale ZIPs sit
  in the repo root; do not hand them to another tool).
- `STATE.md` is the handoff document: status, last asset version, decisions,
  open risks, next actions. Update it with every committed change.
- Longer tool-specific notes: `CHIITECH_AI_HANDOFF.md`; release history:
  `CHIIETECH_RELEASE_NOTES.md`; disaster recovery: `DISASTER_RECOVERY.md`.

## 9. Incident / failure handling

1. Diagnose with evidence (console, network, exit codes, HTTP status) — never guess.
2. Root cause in one line, then the smallest fix that removes it.
3. Re-run the verification matrix for the affected area.
4. Record in `STATE.md` if it changes status or reveals a risk.
