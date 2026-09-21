
-- Powers the "forgot your company code?" box on the login screen, which
-- runs before anyone is signed in. Deliberately returns almost nothing —
-- just the company name and code for the email's own company, nothing
-- that would let someone enumerate other accounts.
create or replace function public.lookup_company_by_email(p_email text)
returns table(company_name text, company_code text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.name, c.code from public.profiles p
    join public.companies c on c.id = p.company_id
    where lower(p.email) = lower(trim(p_email))
    limit 1;
end;
$$;
revoke all on function public.lookup_company_by_email(text) from public;
grant execute on function public.lookup_company_by_email(text) to anon, authenticated;
