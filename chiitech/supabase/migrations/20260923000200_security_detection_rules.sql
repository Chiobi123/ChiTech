-- ChiiTech Phase 20
-- Server-side review signals. These are risk indicators, not accusations of fraud.

create or replace function public.security_alert_from_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_severity text := 'medium';
  v_title text;
begin
  if auth.uid() is null then return new; end if;

  if new.action in ('team.departments_change','team.status_change','tax.settings_change','billing.bank_transfer') then
    v_severity := case when new.action in ('billing.bank_transfer','tax.settings_change') then 'high' else 'medium' end;
    v_title := 'High-risk administrative activity requires review';
    insert into public.security_alerts(company_id,severity,event_type,title,description,metadata,created_by,source)
    values(new.company_id,v_severity,'high_risk_admin_action',v_title,
      coalesce(new.details,'A sensitive administrative action was recorded.'),
      jsonb_build_object('audit_log_id',new.id,'action',new.action),auth.uid(),'audit_rule');
  elsif position('FLAGGED:' in upper(coalesce(new.details,''))) > 0 then
    insert into public.security_alerts(company_id,severity,event_type,title,description,metadata,created_by,source)
    values(new.company_id,'medium','flagged_business_record','Flagged business record requires review',new.details,
      jsonb_build_object('audit_log_id',new.id,'action',new.action),auth.uid(),'audit_rule');
  end if;
  return new;
end;
$$;

drop trigger if exists security_alert_audit_trigger on public.audit_log;
create trigger security_alert_audit_trigger
after insert on public.audit_log
for each row execute function public.security_alert_from_audit();

create or replace function public.security_alert_large_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_threshold numeric;
begin
  select greatest(coalesce(materiality_threshold,5000)*20,500000) into v_threshold
  from public.company_settings where company_id=new.company_id;
  if new.amount >= coalesce(v_threshold,500000) then
    insert into public.security_alerts(company_id,severity,event_type,title,description,metadata,created_by,source)
    values(new.company_id,'high','large_expense','Large expense requires review',
      'An expense exceeded the automated review threshold. Confirm the supporting invoice, approval and payment record.',
      jsonb_build_object('expense_id',new.id,'amount',new.amount,'threshold',v_threshold),auth.uid(),'transaction_rule');
  end if;
  return new;
end;
$$;

drop trigger if exists security_alert_large_expense_trigger on public.expenses;
create trigger security_alert_large_expense_trigger
after insert on public.expenses
for each row execute function public.security_alert_large_expense();

create or replace function public.security_alert_large_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_threshold numeric;
begin
  select greatest(coalesce(materiality_threshold,5000)*20,1000000) into v_threshold
  from public.company_settings where company_id=new.company_id;
  if new.total >= coalesce(v_threshold,1000000) then
    insert into public.security_alerts(company_id,severity,event_type,title,description,metadata,created_by,source)
    values(new.company_id,'medium','large_sale','Large sale requires review',
      'A sale exceeded the automated review threshold. Confirm the invoice, customer/payment record and supporting evidence.',
      jsonb_build_object('sale_id',new.id,'amount',new.total,'threshold',v_threshold),auth.uid(),'transaction_rule');
  end if;
  return new;
end;
$$;

drop trigger if exists security_alert_large_sale_trigger on public.sales;
create trigger security_alert_large_sale_trigger
after insert on public.sales
for each row execute function public.security_alert_large_sale();

revoke all on function public.security_alert_from_audit() from public;
revoke all on function public.security_alert_large_expense() from public;
revoke all on function public.security_alert_large_sale() from public;
