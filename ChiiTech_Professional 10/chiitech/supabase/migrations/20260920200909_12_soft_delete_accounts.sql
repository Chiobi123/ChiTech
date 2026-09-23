
alter table public.companies add column deleted_at timestamptz;
alter table public.profiles add column deleted_at timestamptz;

create or replace function public.can_access_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    ( cid = app_private.my_company_id()
      and not exists (select 1 from public.companies where id = cid and deleted_at is not null) )
    or app_private.my_role() = 'super_admin';
$$;

create or replace function public.soft_delete_my_profile()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'company_admin' then
    raise exception 'A company admin should close the whole company account, not just their own profile — use soft_delete_company() instead';
  end if;
  update public.profiles set deleted_at = now(), active = false where id = v_uid;
end;
$$;
revoke all on function public.soft_delete_my_profile() from public;
grant execute on function public.soft_delete_my_profile() to authenticated;

create or replace function public.soft_delete_company()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_company uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select role, company_id into v_role, v_company from public.profiles where id = v_uid;
  if v_role <> 'company_admin' then raise exception 'Only a company admin can close the company account'; end if;
  update public.companies set deleted_at = now() where id = v_company;
  update public.profiles set deleted_at = now(), active = false where id = v_uid;
end;
$$;
revoke all on function public.soft_delete_company() from public;
grant execute on function public.soft_delete_company() to authenticated;

create or replace function public.restore_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  update public.companies set deleted_at = null where id = p_company_id;
  update public.profiles set deleted_at = null, active = true where company_id = p_company_id and role = 'company_admin';
end;
$$;
revoke all on function public.restore_company(uuid) from public;
grant execute on function public.restore_company(uuid) to authenticated;

create or replace function public.restore_profile(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app_private.my_role() <> 'super_admin' then raise exception 'Not authorised'; end if;
  update public.profiles set deleted_at = null, active = true where id = p_profile_id;
end;
$$;
revoke all on function public.restore_profile(uuid) from public;
grant execute on function public.restore_profile(uuid) to authenticated;
