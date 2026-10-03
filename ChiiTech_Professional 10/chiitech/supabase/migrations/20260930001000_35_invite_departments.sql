-- ChiiTech migration 35 — invitations carry departments (forensic fix).
-- accept_invitation() hardcoded departments=array['all'], so EVERY invited
-- worker silently received full department access regardless of what the
-- admin ticked. The invitation's own departments column was written but
-- never applied. Now the invited departments are assigned; empty stays
-- empty until the admin assigns (approval step unchanged).

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.worker_invitations%rowtype;
  v_depts text[];
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

  v_depts := coalesce(
    (select array_agg(x order by x) from jsonb_array_elements_text(v_inv.departments) as x),
    '{}'::text[]);

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, v_inv.company_id, v_email, split_part(v_email, '@', 1), 'worker',
    v_depts, false, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    role = 'worker',
    departments = excluded.departments,
    active = false;

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
