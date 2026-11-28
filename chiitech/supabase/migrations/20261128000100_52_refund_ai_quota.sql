-- ChiiTech migration: AI quota refund mechanism
-- Allows refunding consumed quota when AI responses are empty/invalid
-- Idempotent: safe to re-run
-- Creates a refund function that reverses quota consumption from
-- the daily usage tables. Must be called with the same parameters
-- as reserve_ai_quota had originally consumed.
-- Usage: select public.refund_ai_quota(p_company_id, p_user_id, p_day, p_estimated_neurons);
--
-- This is critical because reserve_ai_quota debits quota before AI inference,
-- and there was no path to refund if the model returned empty/invalid response.

create or replace function public.refund_ai_quota(
  p_company_id uuid,
  p_user_id uuid,
  p_day date,
  p_estimated_neurons numeric default 40
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_global_used numeric(14,2);
  v_company_used numeric(14,2);
  v_user_used numeric(14,2);
  v_budget numeric(14,2);
  v_reserve numeric(14,2);
  v_user_share numeric(5,4);
  v_shared_threshold numeric(5,4);
  v_company_budget numeric(14,2);
begin
  -- Reverse platform daily usage
  update public.ai_usage_platform_daily set requests = greatest(0, requests - 1), estimated_neurons = greatest(0, estimated_neurons - p_estimated_neurons) where day = p_day;
  
  -- Reverse company usage
  update public.ai_usage set estimated_neurons = greatest(0, estimated_neurons - p_estimated_neurons) where company_id = p_company_id and day = p_day;
  
  -- Reverse user usage
  update public.ai_usage_user_daily set estimated_neurons = greatest(0, estimated_neurons - p_estimated_neurons) where company_id = p_company_id and user_id = p_user_id and day = p_day;
  
  -- Return the updated state for verification
  select estimated_neurons into v_global_used from public.ai_usage_platform_daily where day = p_day;
  select estimated_neurons into v_company_used from public.ai_usage where company_id = p_company_id and day = p_day;
  select estimated_neurons into v_user_used from public.ai_usage_user_daily where company_id = p_company_id and user_id = p_user_id and day = p_day;
  
  select daily_neuron_budget, reserve_neurons, user_share, shared_pool_threshold into v_budget, v_reserve, v_user_share, v_shared_threshold from public.ai_quota_config where id = 1;
  
  return jsonb_build_object(
    'refunded', true,
    'neurons_refunded', p_estimated_neurons,
    'global_remaining', greatest(0, v_budget - v_reserve - v_global_used),
    'company_remaining', greatest(0, v_budget - v_company_used),
    'user_remaining', greatest(0, v_budget * v_user_share - v_user_used),
    'reset_at', (p_day + 1)::text || 'T00:00:00Z'
  );
end;
$$;
revoke all on function public.refund_ai_quota(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.refund_ai_quota(uuid, uuid, date, numeric) to authenticated;

-- Add comment explaining the refund mechanism
comment on function public.refund_ai_quota(uuid, uuid, date, numeric) is 'Refunds AI quota consumed by reserve_ai_quota when model response is empty/invalid. Critical for quota fairness. Must be called with same parameters as original reservation.';