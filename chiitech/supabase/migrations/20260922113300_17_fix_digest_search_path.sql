
-- pgcrypto (and its digest() function) lives in Supabase's `extensions`
-- schema by default, not `public`. Migration 05 hardened this trigger's
-- search_path down to just `public` for security — correct instinct,
-- wrong result: it made digest() unreachable, so every single
-- audit_log insert has failed since then. `extensions` is a system
-- schema, not writable by anon/authenticated, so adding it here is
-- safe — this isn't reopening the hijack risk migration 05 was
-- closing.
alter function public.audit_log_set_hash() set search_path = public, extensions;
