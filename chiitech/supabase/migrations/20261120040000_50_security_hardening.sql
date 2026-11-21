-- ChiiTech migration: security hardening from the 2026-11-20 audit.
-- Idempotent: safe to re-run.
--
-- 1) lookup_company_by_email: SECURITY DEFINER, was executable by anon and
--    authenticated. The whole app was searched (js/, html/, css/, functions/):
--    nothing calls it any more — only migration 11 defines/grants it and
--    STATE.md mentions it. Revoke execution; the function stays in place so
--    nothing that still references it breaks at definition time.
-- 2) make_invite_token: mutable search_path advisor finding. It is a plain
--    (non SECURITY DEFINER) function used as the column DEFAULT for
--    worker_invitations.token and auditor_invitations.token (migration 34).
--    Give it a fixed search_path; behaviour is unchanged (it only calls
--    builtins: substr/floor/random/length).

revoke execute on function public.lookup_company_by_email(text) from public;
revoke execute on function public.lookup_company_by_email(text) from anon;
revoke execute on function public.lookup_company_by_email(text) from authenticated;

alter function public.make_invite_token() set search_path = public;
