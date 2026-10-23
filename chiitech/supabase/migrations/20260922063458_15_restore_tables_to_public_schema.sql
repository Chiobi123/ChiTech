
-- audit_log, audit_visit_log and auditor_grants were found living in
-- app_private instead of public — no tracked migration ever moved them
-- there (only four FUNCTIONS were ever intentionally moved to that
-- schema, in migration 05). Every RLS policy and RPC function in this
-- project references them as `public.*`, so this is not a matter of
-- taste — it's restoring them to where the rest of the system already
-- assumes they are. ALTER TABLE SET SCHEMA preserves the table's OID,
-- so its RLS policies, indexes, and the audit hash trigger all come
-- back with it unchanged.
-- (Idempotent 2026-10-02: the local 01–14 files already create these in
-- public, so on a fresh rebuild there is nothing to move. The original
-- move is preserved conditionally for databases that still have them.)
do $$ begin
  if exists (select 1 from pg_tables where schemaname='app_private' and tablename='audit_log') then
    alter table app_private.audit_log set schema public;
  end if;
  if exists (select 1 from pg_tables where schemaname='app_private' and tablename='audit_visit_log') then
    alter table app_private.audit_visit_log set schema public;
  end if;
  if exists (select 1 from pg_tables where schemaname='app_private' and tablename='auditor_grants') then
    alter table app_private.auditor_grants set schema public;
  end if;
end $$;
