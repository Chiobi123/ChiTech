-- ChiiTech migration 28 — auditor invitations + auditor read-only policies.
-- Auditors join exactly like workers: company code (identifier) + emailed
-- single-use token + their own Supabase Auth account. Legacy grant codes
-- keep working untouched. Auditors are SELECT-only everywhere by RLS.

create table if not exists public.auditor_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'pending'
    check (status in ('pending','accepted','revoked','expired')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);
create index if not exists auditor_invites_company_idx
  on public.auditor_invites(company_id, status, created_at desc);
create index if not exists auditor_invites_token_idx
  on public.auditor_invites(token);

alter table public.auditor_invites enable row level security;

drop policy if exists auditor_invites_access on public.auditor_invites;
create policy auditor_invites_access on public.auditor_invites for all
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin')
  with check (company_id = app_private.my_company_id() and app_private.my_role() = 'company_admin');

grant select, insert, update, delete on public.auditor_invites to authenticated;

create or replace function public.invite_auditor(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_id uuid;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'Invalid email'; end if;
  insert into public.auditor_invites(company_id, email, created_by)
  values (v_company, lower(trim(p_email)), auth.uid())
  returning id into v_id;
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'auditor.invite_sent', 'Auditor invitation sent to ' || lower(trim(p_email)) || '.',
    (select email from public.profiles where id = auth.uid()));
  return v_id;
end;
$$;
revoke all on function public.invite_auditor(text) from public;
grant execute on function public.invite_auditor(text) to authenticated;

create or replace function public.revoke_auditor_invite(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  update public.auditor_invites set status = 'revoked'
  where id = p_invitation_id and company_id = v_company and status = 'pending';
  if not found then raise exception 'Invitation not found or not pending'; end if;
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'auditor.invite_revoked', 'Auditor invitation revoked.',
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.revoke_auditor_invite(uuid) from public;
grant execute on function public.revoke_auditor_invite(uuid) to authenticated;

-- Accept an auditor invitation: email-bound, single-use, expiring.
-- Creates an INACTIVE auditor profile the admin must approve.
create or replace function public.accept_auditor_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.auditor_invites%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;

  select * into v_inv from public.auditor_invites where token = p_token;
  if v_inv.id is null then raise exception 'Invalid invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'Invitation is no longer valid'; end if;
  if v_inv.expires_at < now() then
    update public.auditor_invites set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(trim(v_inv.email)) <> v_email then raise exception 'This invitation was sent to a different email'; end if;

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, v_inv.company_id, v_email, split_part(v_email, '@', 1), 'auditor',
    array[]::text[], false, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    role = 'auditor',
    active = false;

  update public.auditor_invites
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_inv.company_id, 'auditor.invite_accepted', 'Auditor invitation accepted by ' || v_email || '; awaiting approval.', v_email);
  return v_inv.company_id;
end;
$$;
revoke all on function public.accept_auditor_invite(text) from public;
grant execute on function public.accept_auditor_invite(text) to authenticated;

-- Approval switch now serves workers AND auditors (was workers-only).
create or replace function public.set_worker_active(p_profile_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_role text;
begin
  if app_private.my_role() <> 'company_admin' then raise exception 'Not authorised'; end if;
  select role into v_role from public.profiles where id = p_profile_id and company_id = v_company;
  if v_role is null or v_role not in ('worker','auditor') then raise exception 'Team member not found'; end if;
  update public.profiles set active = p_active where id = p_profile_id;
  insert into public.audit_log(company_id, action, details, "user")
  values (v_company, 'team.status_change',
    v_role || ' ' || (select email from public.profiles where id = p_profile_id)
    || (case when p_active then ' reactivated.' else ' deactivated.' end),
    (select email from public.profiles where id = auth.uid()));
end;
$$;
revoke all on function public.set_worker_active(uuid, boolean) from public;
grant execute on function public.set_worker_active(uuid, boolean) to authenticated;

-- Read-only mirror for profile-based auditors: SELECT on exactly what the
-- Command Center renders. No INSERT/UPDATE/DELETE anywhere, so even a
-- compromised auditor session cannot write company data.
drop policy if exists sales_auditor_read on public.sales;
create policy sales_auditor_read on public.sales for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists expenses_auditor_read on public.expenses;
create policy expenses_auditor_read on public.expenses for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists products_auditor_read on public.products;
create policy products_auditor_read on public.products for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists customers_auditor_read on public.customers;
create policy customers_auditor_read on public.customers for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists orders_auditor_read on public.orders;
create policy orders_auditor_read on public.orders for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists sop_auditor_read on public.sop;
create policy sop_auditor_read on public.sop for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists findings_auditor_read on public.audit_findings;
create policy findings_auditor_read on public.audit_findings for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists audit_log_auditor_read on public.audit_log;
create policy audit_log_auditor_read on public.audit_log for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
drop policy if exists settings_auditor_read on public.company_settings;
create policy settings_auditor_read on public.company_settings for select
  using (company_id = app_private.my_company_id() and app_private.my_role() = 'auditor');
