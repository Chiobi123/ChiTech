# ChiiTech — AI / GitHub / Supabase Handoff Protocol

## Source of truth

**GitHub repository:** `ChiiTech`

The repository is the source of truth for frontend code and Supabase migration history.

**Backend:** the existing ChiiTech Supabase project configured in `js/supabase-config.js`.

Do not create a second Supabase project unless the owner explicitly decides to create a staging environment.

## Roles of each tool

### ChatGPT
Use for:
- architecture and security review
- Supabase/RLS reasoning
- migration design and review
- debugging authentication/data-flow problems
- test plans and acceptance criteria
- reviewing changes from Claude/Lovable
- preparing safe implementation patches

### Claude
Use for:
- deeper code refactors
- multi-file implementation
- database debugging when a task requires extended code investigation
- implementing an approved change set

Claude must work from the current GitHub repository, not an older ZIP.

### Lovable
Use for:
- UI/UX implementation
- visual preview
- responsive layout work
- frontend polish

Lovable must connect to the **existing GitHub repository**. Do not allow it to create/reset/replace the existing Supabase database without explicit review.

## Handoff rule

Only one tool should be the active code editor for a particular change at a time.

Recommended sequence:

1. ChatGPT defines the change and acceptance criteria.
2. Claude or ChatGPT implements the change.
3. Commit to GitHub with a clear commit message.
4. Lovable previews/polishes the UI if needed.
5. Commit Lovable's approved UI changes.
6. ChatGPT reviews the resulting repository and backend migration before the next database change.

Never pass an old ZIP to another AI after newer commits already exist in GitHub.

## Supabase migration rule

The existing production/live database must never be reset just to make migrations work.

Every database change should be a new migration file under:

`supabase/migrations/`

For this release:

- `20260923000100_imports_security_superadmin.sql`
- `20260923000200_security_detection_rules.sql`

Review these migrations in the Supabase SQL Editor before execution.

## Current architecture changes

### 1. Existing business import

The frontend stages CSV/JSON/XLSX records in:

- `import_batches`
- `import_rows`

The file is analyzed before business tables are modified.

After review, normalized records can be inserted into:

- `sales`
- `expenses`
- `products`
- `customers`

The analysis records:

- missing values
- duplicates
- invalid dates
- negative amounts
- statistical outliers
- strengths
- weaknesses/disadvantages
- recommended actions

The analysis is a review signal, not proof of fraud.

### 2. Super Admin isolation

The old architecture allowed `super_admin` to satisfy `can_access_company()` and therefore directly read company rows. It also had a client-side impersonation function.

The new architecture removes that model.

`app_private.can_access_company()` now means **the signed-in user's own company only**.

Super Admin platform operations use dedicated `SECURITY DEFINER` RPCs instead:

- `platform_overview()`
- `restore_company()`
- `restore_profile()`
- `resolve_security_alert()`
- `ensure_super_admin()`

The Super Admin cannot enter another company's admin dashboard through the frontend.

### 3. Super Admin credentials

The reserved Super Admin email is:

`igbanichiobiebere@gmail.com`

The password is managed exclusively by Supabase Auth.

It must never be written into JavaScript, SQL migrations, GitHub, or documentation.

The Super Admin console now provides a password-change action using:

`supabase.auth.updateUser({ password })`

### 4. Security alerts

`security_alerts` stores review signals.

Server-side rules currently create alerts for:

- sensitive administrative actions
- flagged business records
- unusually large expenses
- unusually large sales
- completed business imports

These are deliberately described as **review signals**, not automatic fraud determinations.

## Before deploying the current release

1. Back up the existing Supabase database.
2. Review migration 19.
3. Review migration 20.
4. Run migrations against the existing project.
5. Verify the Super Admin email in Supabase Auth.
6. Sign in as Super Admin.
7. Confirm the platform console loads.
8. Confirm there is no "View as admin" action.
9. Confirm a Super Admin cannot query another company's business tables through the client.
10. Sign in as a company admin and verify their normal dashboard still works.
11. Test import with a small CSV first.
12. Confirm analysis appears before import.
13. Confirm imported rows appear in the selected business table.
14. Confirm a security alert is created.
15. Test restore/resolve actions.

## Commit naming

Use explicit commits such as:

- `feat: add existing business import and analysis`
- `security: isolate super admin from company data`
- `feat: add platform security alerts`
- `fix: repair super admin authentication`
- `ui: add import and security center`

## If Claude or Lovable is used next

Give the tool this instruction:

> Work only from the current GitHub repository state. Do not create a new Supabase project. Do not reset or replace the existing database. Preserve the existing migration history. Before changing a database schema, inspect the latest migration files and add a new migration rather than editing old migrations. Do not hard-code passwords or service-role keys. Commit all approved changes to GitHub and describe the files changed and any Supabase SQL that must be executed.
