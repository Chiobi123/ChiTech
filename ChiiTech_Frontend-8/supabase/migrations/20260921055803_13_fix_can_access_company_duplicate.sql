
-- Migration 12 accidentally created a second, stray copy of
-- can_access_company() in the public schema (it had already been moved
-- to app_private back in migration 05) — this was fixed by hand at the
-- time, but wasn't captured as a tracked migration. This makes that fix
-- part of the real migration history, idempotently, so replaying every
-- migration from scratch reproduces today's actual state exactly.
drop function if exists public.can_access_company(uuid);

create or replace function app_private.can_access_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    ( cid = app_private.my_company_id()
      and not exists (select 1 from public.companies where id = cid and deleted_at is not null) )
    or app_private.my_role() = 'super_admin';
$$;

revoke execute on function public.restore_company(uuid) from anon;
revoke execute on function public.restore_profile(uuid) from anon;
