-- Quota reservation is safe for authenticated users because the function derives
-- company/user identity from auth.uid() and enforces a hard per-company allocation.
-- Calling it directly can only consume the caller's own company's allowance.
drop function if exists public.reserve_ai_quota(uuid,uuid,numeric);
grant execute on function public.reserve_ai_quota(numeric) to authenticated;
revoke all on function public.reserve_ai_quota(numeric) from public, anon;
