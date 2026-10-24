-- ChiiTech migration 42 -- deep LLM analysis of import batches (spec 9).
-- Extends the import pipeline so the LLM layer can see staged rows and
-- company history for pattern detection beyond deterministic rules.
-- The deterministic analysis (client + analyse_import_batch) remains the
-- audited baseline; the LLM output is advisory only.

create or replace function public.deep_analyse_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_type text;
  v_rows jsonb;
  v_history jsonb;
  v_result jsonb;
begin
  -- Verify access: must be company_admin and own the batch
  select company_id, source_type into v_company, v_type
  from public.import_batches where id = p_batch_id;
  if v_company is null or app_private.my_role() <> 'company_admin'
     or v_company <> app_private.my_company_id() then
    raise exception 'Not authorised';
  end if;

  -- Fetch staged rows (normalized_data) — cap at 200 for LLM context window
  select jsonb_agg(
    jsonb_build_object(
      'row_number', row_number,
      'normalized', normalized_data,
      'validation_status', validation_status,
      'validation_errors', validation_errors
    ) order by row_number
  ) into v_rows
  from (
    select row_number, normalized_data, validation_status, validation_errors
    from public.import_rows
    where batch_id = p_batch_id
    order by row_number
    limit 200
  ) r;

  -- Fetch relevant company history for cross-referencing
  -- (last 90 days of sales, expenses, top customers/products)
  select jsonb_build_object(
    'sales_last_90d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', time::date,
        'total', total,
        'customer', customer_name,
        'items', items
      ) order by time desc)
      from public.sales
      where company_id = v_company
        and time >= (now() - interval '90 days')
      limit 100
    ), '[]'::jsonb),
    'expenses_last_90d', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', time::date,
        'category', category,
        'amount', amount,
        'note', note
      ) order by time desc)
      from public.expenses
      where company_id = v_company
        and time >= (now() - interval '90 days')
      limit 50
    ), '[]'::jsonb),
    'top_customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name,
        'total_spent', total_spent,
        'visits', visits
      ) order by total_spent desc)
      from public.customers
      where company_id = v_company
      limit 20
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name,
        'price', price,
        'cost', cost,
        'stock', stock
      ) order by price desc)
      from public.products
      where company_id = v_company
      limit 20
    ), '[]'::jsonb)
  ) into v_history;

  -- Build the payload the Edge Function will use
  select jsonb_build_object(
    'batch_id', p_batch_id,
    'record_type', v_type,
    'company_id', v_company,
    'staged_rows', v_rows,
    'company_history', v_history,
    'analysis_timestamp', now()
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.deep_analyse_import_batch(uuid) from public;
grant execute on function public.deep_analyse_import_batch(uuid) to authenticated;