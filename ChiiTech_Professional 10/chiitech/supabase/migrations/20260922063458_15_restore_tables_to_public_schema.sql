
-- audit_log, audit_visit_log and auditor_grants were found living in
-- app_private instead of public — no tracked migration ever moved them
-- there (only four FUNCTIONS were ever intentionally moved to that
-- schema, in migration 05). Every RLS policy and RPC function in this
-- project references them as `public.*`, so this is not a matter of
-- taste — it's restoring them to where the rest of the system already
-- assumes they are. ALTER TABLE SET SCHEMA preserves the table's OID,
-- so its RLS policies, indexes, and the audit hash trigger all come
-- back with it unchanged.
alter table app_private.audit_log set schema public;
alter table app_private.audit_visit_log set schema public;
alter table app_private.auditor_grants set schema public;
