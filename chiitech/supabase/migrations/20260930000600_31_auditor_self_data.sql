-- ChiiTech migration 31 — auditor self-read RPC.
-- Auditors cannot see their own profiles row via RLS (policy is admin-only),
-- which made loadBusiness() throw and bounced them to sign-in. This RPC
-- returns exactly what the Command Center renders, scoped to the caller's
-- own company, read-only.

create or replace function public.auditor_self_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := app_private.my_company_id();
  v_role text := app_private.my_role();
begin
  if v_role <> 'auditor' or v_company is null then raise exception 'Not authorised'; end if;

  return (
    select jsonb_build_object(
      'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'category',p.category,'cost',p.cost,'price',p.price,
        'stock',p.stock,'reorder',p.reorder,'updatedBy',p.updated_by
      )) from public.products p where p.company_id = v_company),'[]'::jsonb),
      'sales', coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'invoiceNo',s.invoice_no,'time',s.time,'items',s.items,'itemsSummary',s.items_summary,
        'subtotal',s.subtotal,'discount',s.discount,'vat',s.vat,'total',s.total,'cost',s.cost,
        'customerId',s.customer_id,'customerName',s.customer_name,'payment',s.payment,'recordedBy',s.recorded_by
      )) from public.sales s where s.company_id = v_company),'[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'time',e.time,'category',e.category,'note',e.note,'amount',e.amount,
        'flag',e.flag,'reason',e.reason,'loggedBy',e.logged_by
      )) from public.expenses e where e.company_id = v_company),'[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id',o.id,'channel',o.channel,'customerName',o.customer_name,'items',o.items,
        'total',o.total,'status',o.status,'placedAt',o.placed_at,'notes',o.notes
      )) from public.orders o where o.company_id = v_company),'[]'::jsonb),
      'sop', coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'area',s.area,'description',s.description,'frequency',s.frequency,
        'responsible',s.responsible,'createdAt',s.created_at,'lastReviewed',s.last_reviewed
      )) from public.sop s where s.company_id = v_company),'[]'::jsonb),
      'auditLog', coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'time',a.time,'action',a.action,'details',a.details,'hash',a.hash,'prevHash',a.prev_hash,"user",a."user"
      ) order by a.time) from public.audit_log a where a.company_id = v_company),'[]'::jsonb),
      'team', coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'role',p.role,'departments',p.departments,'active',p.active
      )) from public.profiles p where p.company_id = v_company),'[]'::jsonb),
      'findings', coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.id,'title',f.title,'description',f.description,'severity',f.severity,'status',f.status,
        'raisedBy',f.raised_by,'createdAt',f.created_at,'resolvedAt',f.resolved_at,'resolvedBy',f.resolved_by
      )) from public.audit_findings f where f.company_id = v_company),'[]'::jsonb),
      'settings', (select jsonb_build_object(
        'expenseCategories',s.expense_categories,'taxSettings',s.tax_settings,'growth',s.growth,
        'materialityThreshold',s.materiality_threshold
      ) from public.company_settings s where s.company_id = v_company)
    )
  );
end;
$$;
revoke all on function public.auditor_self_data() from public;
grant execute on function public.auditor_self_data() to authenticated;
