# ChiiTech — Disaster Recovery Plan

*Last written: 21 September 2026, alongside the Supabase migration to
`supabase/migrations/`. Keep this file, the migrations folder, and this
whole project zip somewhere outside Supabase and outside your laptop —
a copy in cloud storage (Google Drive, Dropbox) and a copy with whoever
else has admin access is the minimum.*

## 1. The one thing to fix before anything else

**Your Supabase project is currently on the Free tier, which takes
zero automated backups.** If the database is lost, corrupted, or
someone fat-fingers a destructive query, there is nothing to restore
from except what you've manually exported yourself. This is the
single biggest gap in this plan, and it's not a code problem — it's a
plan/billing decision:

- **Supabase Pro ($25/mo)** adds 7 days of daily automated backups.
- **Point-in-Time Recovery (PITR)** is a separate paid add-on on top
  of Pro, and lets you restore to almost any specific moment (not just
  the last daily snapshot) — worth it once real customer data is in
  the system.
- Until you upgrade, do a **manual export monthly at minimum, weekly
  once you have real users**: Supabase dashboard → Database → Backups
  → or run `pg_dump` against the connection string under Project
  Settings → Database. Store the export file the same places you store
  this document.

Everything else below assumes you've done at least the manual export
step — without it, "recover data" in a full database-loss scenario
is not possible, full stop.

## 2. What actually needs to exist to rebuid ChiiTech from nothing

| Piece | Where it lives | Recovery source |
|---|---|---|
| Database schema (every table, RLS policy, function, trigger) | Supabase project `qmypqghktxlscibgxgxo` | `supabase/migrations/` in this project — 13 files, verified byte-for-byte against what's live |
| Database **data** (actual products/sales/customers/etc.) | Same Supabase project | **Only** a Supabase backup or your own manual export — not covered by the migrations folder |
| Frontend (HTML/CSS/JS) | Wherever it's hosted (Netlify/Vercel/etc. — not fixed by this plan) | This project zip's `index.html`, `css/`, `js/` |
| Supabase project URL + publishable key | `js/supabase-config.js` | Already in this project zip; regenerate from Supabase dashboard if the project itself is rebuilt fresh (a new project = a new URL and key) |
| Auth accounts (who can log in) | Supabase Auth (`auth.users`) | **Not covered by the migrations folder at all.** If the Supabase project is destroyed and rebuilt fresh, every admin/worker has to sign up again — their `profiles` row rebuilds from a fresh signup, but their old password does not carry over, and old data won't reappear unless it was in a backup |
| Reserved super-admin access | `bootstrap_super_admin()` in migration 07, keyed to one hardcoded email | Works automatically the moment that email signs up again on a rebuilt project |

## 3. Recovery scenarios, in order of how bad they are

### Scenario A — Frontend hosting is lost (Supabase is fine)
**Impact: low. Recovery time: under 30 minutes.**
Nothing about your data or backend changed. Re-deploy `index.html`,
`css/`, and `js/` (unmodified, they already point at the same
Supabase project) to any static host. Done.

### Scenario B — Supabase project is lost/deleted, but you have a
recent backup (or the manual export from Section 1)
**Impact: medium. Recovery time: roughly 1–2 hours.**
1. Create a new Supabase project.
2. Restore your backup/export into it (Supabase's own restore flow if
   it was a Pro backup; `psql` import if it was a manual `pg_dump`).
3. Update `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in
   `js/supabase-config.js` to the new project's values (Project
   Settings → API).
4. Re-deploy the frontend (Scenario A).
5. Spot-check: log in as an existing admin, confirm their company's
   data is intact, confirm RLS still blocks a worker from seeing a
   department they don't have.

### Scenario C — Supabase project is lost with **no** backup at all
**Impact: high — this is the scenario Section 1 exists to prevent.**
**Recovery time for structure: under an hour. Data: unrecoverable.**
1. Create a new Supabase project.
2. Run every file in `supabase/migrations/` in order (01 through 13)
   — this rebuilds every table, policy, and function exactly as they
   are today. See that folder's own README for the two ways to run
   them.
3. Update `js/supabase-config.js` with the new project's URL and key.
4. Re-deploy the frontend.
5. **Every company has to register again from scratch.** All products,
   sales, expenses, customers, audit history — gone. This is exactly
   what upgrading to Pro (or doing regular manual exports) prevents.

### Scenario D — A single company's data is deleted or corrupted (not
the whole platform)
**Impact: low if it was self-service, otherwise medium.**
- If an admin used the "Delete account" feature: nothing is actually
  gone. Ask the super_admin to open the Super Admin console and click
  **Restore** next to that company — instant, full recovery.
- If data was deleted some other way (a bad manual query, for
  example): this needs a database-level restore from a backup
  covering that point in time — which is exactly what Point-in-Time
  Recovery (Section 1) is for. Without PITR or a recent backup, this
  data is not recoverable.

### Scenario E — Credentials are compromised (Supabase login, or the
publishable key looks like it leaked)
**Impact: depends on what leaked.**
- The **publishable key** in `js/supabase-config.js` is not a secret
  by design — Row Level Security is what actually protects data, not
  keeping that key hidden. A leaked publishable key alone is not a
  breach.
- If the **Supabase account password** or a **service_role key** (a
  different, genuinely secret key — not currently used anywhere in
  this frontend) is compromised: rotate it immediately from the
  Supabase dashboard, and review the project's logs (Advisors → Logs)
  for anything unexpected in the window it may have been exposed.

## 4. Recovery time / recovery point summary

| Scenario | Recovery time (RTO) | Data loss (RPO) |
|---|---|---|
| Frontend only | ~30 min | None |
| Backend lost, backup available | ~1–2 hrs | Up to 24 hrs (daily backup) or near-zero (PITR) |
| Backend lost, no backup | ~1 hr for structure | **Everything** — all business data |
| Single company deleted via the app | Minutes | None (soft-delete, fully reversible) |

The gap between row 2 and row 3 is entirely the free-tier backup gap
in Section 1. That's the one action item in this whole document worth
doing today rather than "eventually."

## 5. Before you need this document

- [ ] Upgrade to Supabase Pro, or set a recurring reminder to export
      the database manually (monthly now, weekly once there are real
      customers).
- [ ] Store this file, the `supabase/migrations/` folder, and the
      frontend zip somewhere outside Supabase and outside one person's
      laptop.
- [ ] Make sure more than one person has Supabase project access —
      a disaster where the only admin is also unreachable is its own
      disaster.
- [ ] Re-run this plan's Scenario B or C once, on a throwaway Supabase
      project, before you actually need it for real. A recovery plan
      that's never been tried is a guess, not a plan.
