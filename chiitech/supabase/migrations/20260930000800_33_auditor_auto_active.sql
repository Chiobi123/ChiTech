-- ChiiTech migration 33 — auditors active on accept, no approval gate.
-- Audit independence: the company invites, but must not hold approval power
-- over its own reviewer. accept_auditor_invite now creates an ACTIVE
-- auditor profile. The admin keeps suspend/reactivate (set_worker_active)
-- for genuine cause, fully audit-logged either way.

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
    array[]::text[], true, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    role = 'auditor',
    active = true;

  update public.auditor_invites
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  insert into public.audit_log(company_id, action, details, "user")
  values (v_inv.company_id, 'auditor.invite_accepted', 'Auditor invitation accepted by ' || v_email || '; access active immediately (no approval gate).', v_email);
  return v_inv.company_id;
end;
$$;
revoke all on function public.accept_auditor_invite(text) from public;
grant execute on function public.accept_auditor_invite(text) to authenticated;
