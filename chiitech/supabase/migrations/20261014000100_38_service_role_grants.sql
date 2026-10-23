-- ChiiTech migration 38 — grant service_role table privileges.
-- service_role bypasses RLS but still needs explicit GRANTs. Without them,
-- the ai-assist Edge Function (which uses the service key) cannot read
-- profiles, and any service-level access fails with 42501. This changes
-- nothing for anon/authenticated roles or RLS policies.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO service_role', r.sequencename);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO service_role;
