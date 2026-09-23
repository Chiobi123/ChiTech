
-- RLS policies decide WHICH rows a query can touch, but Postgres checks
-- the base table-level GRANT before it ever evaluates RLS. Every table
-- here was created via raw SQL, not Supabase's own table editor (which
-- issues these grants automatically) — so `authenticated` had zero
-- privileges on any table, and every real query from the app was
-- blocked outright regardless of how correct the RLS policies
-- underneath were. This is what was actually breaking login/signup.
--
-- Granted at full CRUD per table; RLS still does the real narrowing to
-- "your own company" / "your own department" / etc. `anon` is
-- deliberately NOT granted anything — the auditor's entire path goes
-- through SECURITY DEFINER RPCs (auditor_login, auditor_fetch_data),
-- which don't need direct table access and shouldn't have it.
grant select, insert, update, delete on
  public.companies,
  public.profiles,
  public.company_settings,
  public.products,
  public.customers,
  public.sales,
  public.expenses,
  public.orders,
  public.sop,
  public.audit_findings,
  public.auditor_grants
to authenticated;

-- audit_log and audit_visit_log are select+insert only from the client
-- by design — no UPDATE/DELETE policy exists for either, which is what
-- makes the hash chain append-only. Only granting what RLS allows.
grant select, insert on public.audit_log to authenticated;
grant select on public.audit_visit_log to authenticated;
