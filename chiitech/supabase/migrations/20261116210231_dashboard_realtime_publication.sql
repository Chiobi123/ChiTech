-- Record the existing production Realtime publication setup in source control.
-- This migration is already applied to the production database as version 20261116210231.
do $$
declare t text;
begin
  foreach t in array array['audit_findings','audit_log','customers','debts','expenses','orders','products','sales'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
