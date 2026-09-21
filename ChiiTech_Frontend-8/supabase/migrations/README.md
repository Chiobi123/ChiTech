# Database migrations

These 13 files are the exact SQL that built the live Supabase project
(`ChiTech b`, ref `qmypqghktxlscibgxgxo`), pulled directly from
Supabase's own migration history and verified byte-for-byte against
what's actually applied — not retyped from memory. Run them in order
(01 → 13) against a fresh Supabase project to rebuild the entire
database: every table, every Row Level Security policy, every function,
the audit hash-chain trigger, the soft-delete/restore system — all of
it. This is the core asset referenced in the disaster-recovery plan.

If you use the Supabase CLI, `supabase db push` against this folder
will apply them in order. Otherwise, paste each file's contents into
the SQL Editor in the Supabase dashboard, in filename order.
