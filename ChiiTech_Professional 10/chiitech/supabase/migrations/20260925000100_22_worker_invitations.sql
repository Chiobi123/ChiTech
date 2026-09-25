-- ChiiTech migration 22 — secure worker invitation workflow (spec sections 4+5).
-- Replaces code-only self-join as the authorization path. Company codes stay
-- visible as identifiers but no longer grant membership by themselves.
-- Additive only: no existing tables/rows modified, no data deleted.

create table if not exists public.worker_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'pending'
    check (status in ('pending','accepted','revoked','expired')),
  departments jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);
create index if not exists worker_invitations_company_idx
  on public.worker_invitations(company_id, status, created_at desc);
create index if not exists worker_invitations_token_idx
  on public.worker_invitations(token);

alter table public.worker_invitations enable row level security;

drop policy if exists worker_invitations_access on public.worker_invitations;
create policy worker_invitations_access on public.worker_invitations for all
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin')
  with check (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin');

grant select, insert, update, delete on public.worker_invitations to authenticated;

-- Admin creates (or re-issues) an invitation. Email-bound, 7-day expiry.
create or replace function public.invite_worker(p_email text, p_departments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_id uuid;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'Invalid email'; end if;

  insert into public.worker_invitations(company_id, email, departments, created_by)
  values (v_company, lower(trim(p_email)), coalesce(p_departments, '[]'::jsonb), auth.uid())
  returning id into v_id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.invite_sent', 'Invitation sent to ' || lower(trim(p_email)) || '.',
    (select email from public.profiles where id = auth.uid()));
  return v_id;
end;
$$;
revoke all on function public.invite_worker(text, jsonb) from public;
grant execute on function public.invite_worker(text, jsonb) to authenticated;

-- Admin revokes a pending invitation (single-use enforcement + explicit revoke).
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  update public.worker_invitations set status = 'revoked'
  where id = p_invitation_id and company_id = v_company and status = 'pending';
  if not found then raise exception 'Invitation not found or not pending'; end if;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.invite_revoked', 'Invitation revoked.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- Admin resends: fresh single-use token + fresh 7-day expiry on same row.
create or replace function public.resend_invitation(p_invitation_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  update public.worker_invitations
  set token = v_token, status = 'pending', expires_at = now() + interval '7 days'
  where id = p_invitation_id and company_id = v_company and status in ('pending', 'revoked');
  if not found then raise exception 'Invitation not found or already used'; end if;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.invite_resent', 'Invitation re-sent with a fresh token.',
    (select email from public.profiles where id = auth.uid()));
  return v_token;
end;
$$;
revoke all on function public.resend_invitation(uuid) from public;
grant execute on function public.resend_invitation(uuid) to authenticated;

-- Invited worker accepts with the token. Email-bound: the signed-in user's
-- auth email must match the invitation email, so a shared/forwarded token
-- cannot be reused by another person. Marks the token used (single use).
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.worker_invitations%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;

  select * into v_inv from public.worker_invitations where token = p_token;
  if v_inv.id is null then raise exception 'Invalid invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'Invitation is no longer valid'; end if;
  if v_inv.expires_at < now() then
    update public.worker_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(trim(v_inv.email)) <> v_email then raise exception 'This invitation was sent to a different email'; end if;

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, v_inv.company_id, v_email, split_part(v_email, '@', 1), 'worker',
    array['all'], false, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    role = 'worker',
    active = false;
  -- NOTE: active=false until the admin assigns departments (approval step).

  update public.worker_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_inv.company_id, 'team.invite_accepted', 'Invitation accepted by ' || v_email || '; awaiting department assignment.', v_email);
  return v_inv.company_id;
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- Admin approves (activates) a worker after assigning departments, or
-- pauses/reactivates. Department edits continue through the existing
-- profiles_admin_update path; both emit audit events (status changes also
-- raise security review signals via the existing audit trigger).
create or replace function public.set_worker_active(p_profile_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  update public.profiles set active = p_active
  where id = p_profile_id and company_id = v_company and role = 'worker';
  if not found then raise exception 'Worker not found'; end if;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.status_change',
    'Worker ' || (select email from public.profiles where id = p_profile_id)
    || (case when p_active then ' reactivated.' else ' deactivated.' end),
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.set_worker_active(uuid, boolean) from public;
grant execute on function public.set_worker_active(uuid, boolean) to authenticated;

-- Admin removes a worker from the company. Row is deactivated and unlinked
-- from departments, never hard-deleted, so history stays intact.
create or replace function public.remove_worker(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_email text;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  select email into v_email from public.profiles
  where id = p_profile_id and company_id = v_company and role = 'worker';
  if v_email is null then raise exception 'Worker not found'; end if;

  update public.profiles set active = false, departments = array[]::text[]
  where id = p_profile_id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.status_change', 'Worker ' || v_email || ' removed from company.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.remove_worker(uuid) from public;
grant execute on function public.remove_worker(uuid) to authenticated;
