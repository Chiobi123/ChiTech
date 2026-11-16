-- ChiiTech migration 46 — use the verified Google profile name when an invited
-- worker or auditor accepts an email-bound invitation. Role assignment,
-- invitation checks, department scoping and approval behavior are unchanged.
-- raw_user_meta_data is used only as a display name, never for authorization.

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_inv public.worker_invitations%rowtype;
  v_depts text[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select lower(email),
         coalesce(
           nullif(btrim(raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(raw_user_meta_data->>'name'), ''),
           split_part(lower(email), '@', 1)
         )
    into v_email, v_name
    from auth.users
   where id = v_uid;

  if v_email is null then raise exception 'Authenticated user not found'; end if;

  select * into v_inv
    from public.worker_invitations
   where token = p_token;

  if v_inv.id is null then raise exception 'Invalid invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'Invitation is no longer valid'; end if;
  if v_inv.expires_at < now() then
    update public.worker_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(trim(v_inv.email)) <> v_email then
    raise exception 'This invitation was sent to a different email';
  end if;

  v_depts := coalesce(
    (select array_agg(x order by x)
       from jsonb_array_elements_text(v_inv.departments) as x),
    '{}'::text[]
  );

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, v_inv.company_id, v_email, v_name, 'worker', v_depts, false, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    name = excluded.name,
    role = 'worker',
    departments = excluded.departments,
    active = false;

  update public.worker_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.audit_log(company_id, action, details, "user")
  values (
    v_inv.company_id,
    'team.invite_accepted',
    'Invitation accepted by ' || v_email || '; awaiting department assignment.',
    v_email
  );
  return v_inv.company_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;


create or replace function public.accept_auditor_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_inv public.auditor_invites%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select lower(email),
         coalesce(
           nullif(btrim(raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(raw_user_meta_data->>'name'), ''),
           split_part(lower(email), '@', 1)
         )
    into v_email, v_name
    from auth.users
   where id = v_uid;

  if v_email is null then raise exception 'Authenticated user not found'; end if;

  select * into v_inv
    from public.auditor_invites
   where token = p_token;

  if v_inv.id is null then raise exception 'Invalid invitation'; end if;
  if v_inv.status <> 'pending' then raise exception 'Invitation is no longer valid'; end if;
  if v_inv.expires_at < now() then
    update public.auditor_invites set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(trim(v_inv.email)) <> v_email then
    raise exception 'This invitation was sent to a different email';
  end if;

  insert into public.profiles(id, company_id, email, name, role, departments, active, deleted_at)
  values (v_uid, v_inv.company_id, v_email, v_name, 'auditor', array[]::text[], true, null)
  on conflict (id) do update set
    company_id = excluded.company_id,
    name = excluded.name,
    role = 'auditor',
    active = true;

  update public.auditor_invites
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.audit_log(company_id, action, details, "user")
  values (
    v_inv.company_id,
    'auditor.invite_accepted',
    'Auditor invitation accepted by ' || v_email || '; access active immediately (no approval gate).',
    v_email
  );
  return v_inv.company_id;
end;
$$;

revoke all on function public.accept_auditor_invite(text) from public;
grant execute on function public.accept_auditor_invite(text) to authenticated;
