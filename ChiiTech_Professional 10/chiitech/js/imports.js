/* ChiiTech existing-business import pipeline.
   UI first stages + analyses the file; only an explicit Import action writes
   normalized records into the company's existing Supabase tables. */
let importDraft = null;

function importEsc(v){ return escapeHtml(String(v ?? '')); }
function importNorm(s){ return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
function importNum(v){
  if(v===null || v===undefined || v==='') return null;
  const n=Number(String(v).replace(/[₦,$, ]/g,''));
  return Number.isFinite(n)?n:null;
}
function importDate(v){
  if(!v) return null;
  const d=new Date(v);
  return Number.isNaN(d.getTime())?null:d.toISOString();
}

const IMPORT_ALIASES = {
  sales:{
    date:['date','time','sale_date','sold_at','transaction_date','created_at'],
    invoice_no:['invoice','invoice_no','invoice_number','receipt','receipt_no'],
    product:['product','product_name','item','item_name'],
    qty:['qty','quantity','units','units_sold'],
    price:['price','unit_price','selling_price','sale_price'],
    subtotal:['subtotal','sub_total'], discount:['discount'], vat:['vat','tax'], total:['total','amount','sale_amount','revenue'],
    cost:['cost','cost_price','total_cost'], customer_name:['customer','customer_name','client'], payment:['payment','payment_method','method']
  },
  expenses:{
    date:['date','time','expense_date','created_at'], category:['category','expense_category','type'], note:['note','description','details'], amount:['amount','expense','expense_amount','total']
  },
  products:{
    name:['name','product','product_name','item','item_name'], category:['category','type'], cost:['cost','cost_price','unit_cost'], price:['price','selling_price','sale_price'], stock:['stock','quantity','qty','stock_qty'], reorder:['reorder','reorder_level','minimum_stock']
  },
  customers:{
    name:['name','customer','customer_name','client'], phone:['phone','mobile','telephone'], total_spent:['total_spent','spent','lifetime_value','sales'], balance_due:['balance','balance_due','debt','amount_due'], last_purchase:['last_purchase','last_sale','last_visit'], visits:['visits','orders','purchases']
  }
};

function guessMapping(headers,type){
  const normalized=headers.map(h=>({raw:h,n:importNorm(h)}));
  const map={};
  Object.entries(IMPORT_ALIASES[type]).forEach(([field,aliases])=>{
    const hit=normalized.find(h=>aliases.includes(h.n));
    if(hit) map[field]=hit.raw;
  });
  return map;
}

function parseCSV(text){
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'){
      if(quoted && n==='"'){cell+='"';i++;}
      else quoted=!quoted;
    } else if(c===',' && !quoted){ row.push(cell);cell=''; }
    else if((c==='\n' || c==='\r') && !quoted){
      if(c==='\r' && n==='\n') i++;
      row.push(cell);cell=''; if(row.some(x=>String(x).trim()!=='')){rows.push(row);} row=[];
    } else cell+=c;
  }
  if(cell!=='' || row.length){row.push(cell);if(row.some(x=>String(x).trim()!==''))rows.push(row);}
  if(!rows.length) return [];
  const headers=rows[0].map(x=>String(x).trim()||'Column');
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

async function readImportFile(file){
  const ext=file.name.toLowerCase().split('.').pop();
  if(ext==='csv') return {type:'csv',rows:parseCSV(await file.text())};
  if(ext==='json'){
    const raw=JSON.parse(await file.text());
    const rows=Array.isArray(raw)?raw:(Array.isArray(raw.records)?raw.records:(Array.isArray(raw.data)?raw.data:[]));
    if(!rows.length) throw new Error('JSON must contain an array of records (or a records/data array).');
    return {type:'json',rows};
  }
  if(ext==='xlsx' || ext==='xls'){
    if(!window.XLSX){
      await new Promise((resolve,reject)=>{
        const sc=document.createElement('script'); sc.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        sc.onload=resolve; sc.onerror=()=>reject(new Error('Excel reader could not load. Use CSV/JSON or allow the SheetJS library to load.')); document.head.appendChild(sc);
      });
    }
    const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
    return {type:'xlsx',rows};
  }
  throw new Error('Unsupported file type. Use CSV, JSON or Excel.');
}

function analyseRows(rows,type,map){
  const fields=Object.keys(IMPORT_ALIASES[type]);
  const missingByField={}; fields.forEach(f=>missingByField[f]=0);
  let missing=0,warnings=0,negative=0,badDates=0;
  const amounts=[];
  rows.forEach(r=>{
    fields.forEach(f=>{ const v=map[f]?r[map[f]]:''; if(v===undefined || String(v).trim()===''){missingByField[f]++;missing++;} });
    if(map.date && r[map.date] && !importDate(r[map.date])){badDates++;warnings++;}
    const amountField=type==='expenses'?'amount':type==='sales'?'total':null;
    if(amountField && map[amountField]){
      const n=importNum(r[map[amountField]]); if(n!==null){amounts.push(n);if(n<0){negative++;warnings++;}}
      else if(String(r[map[amountField]]).trim()!==''){warnings++;}
    }
  });
  const sorted=[...amounts].sort((a,b)=>a-b); const q1=sorted[Math.floor((sorted.length-1)*.25)]||0,q3=sorted[Math.floor((sorted.length-1)*.75)]||0; const iqr=q3-q1;
  const outliers=amounts.filter(x=>iqr>0 && (x<q1-1.5*iqr || x>q3+1.5*iqr)).length;
  warnings += outliers;
  const seen=new Map(); rows.forEach(r=>{const k=JSON.stringify(r);seen.set(k,(seen.get(k)||0)+1);});
  const duplicates=[...seen.values()].reduce((a,n)=>a+(n>1?n-1:0),0); warnings+=duplicates;
  const strengths=[],weaknesses=[],recommendations=[];
  if(rows.length) strengths.push(`${rows.length.toLocaleString()} record${rows.length===1?'':'s'} were successfully read from the file.`);
  const coverage=fields.length ? fields.filter(f=>missingByField[f]<rows.length).length/fields.length : 0;
  if(coverage>=.8) strengths.push('Most expected business fields are present, giving ChiiTech a useful base for analysis.');
  if(duplicates) weaknesses.push(`${duplicates} duplicate row${duplicates===1?'':'s'} detected. Duplicates can distort revenue, expense and customer totals.`);
  if(missing) weaknesses.push(`${missing} missing field value${missing===1?'':'s'} detected. Missing dates, amounts or identifiers reduce audit confidence.`);
  if(badDates) weaknesses.push(`${badDates} date value${badDates===1?'':'s'} could not be interpreted reliably.`);
  if(negative) weaknesses.push(`${negative} negative amount${negative===1?'':'s'} detected. These may be valid refunds/credits, but should be reviewed.`);
  if(outliers) weaknesses.push(`${outliers} unusually large/small amount${outliers===1?'':'s'} detected using an IQR outlier check. This is a review signal, not proof of fraud.`);
  if(coverage<.8) recommendations.push('Improve record structure so future exports consistently include dates, amounts and identifiers.');
  if(duplicates) recommendations.push('Remove or reconcile duplicate rows before relying on totals.');
  if(badDates) recommendations.push('Standardise dates to one format such as YYYY-MM-DD.');
  if(outliers) recommendations.push('Review outlier transactions against receipts, invoices or bank records.');
  if(!recommendations.length) recommendations.push('Keep the same structured export format for future reviews and compare the next period against this baseline.');
  return {total_rows:rows.length,missing_values:missing,missing_by_field:missingByField,duplicate_rows:duplicates,warnings,bad_dates:badDates,negative_amounts:negative,outliers,strengths,weaknesses,recommendations};
}

async function prepareImport(){
  if(!session || session.role!=='company_admin'){toast('Only the company admin can import existing business records.');return;}
  const file=document.getElementById('import-file').files[0]; const type=document.getElementById('import-type').value;
  if(!file){toast('Choose a file first.');return;}
  const status=document.getElementById('import-status'); status.textContent='Reading and staging file…';
  try{
    const parsed=await readImportFile(file); let rows=parsed.rows.filter(r=>r && typeof r==='object');
    if(!rows.length) throw new Error('No records were found.');
    const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))]; const mapping=guessMapping(headers,type);
    const {data:batch,error:bErr}=await sb.from('import_batches').insert({company_id:session.companyId,file_name:file.name,source_type:parsed.type,row_count:rows.length,columns:headers,created_by:(await sb.auth.getUser()).data.user?.id}).select().single();
    if(bErr) throw bErr;
    const draftBase={batchId:batch.id,fileName:file.name,type,rows,mapping};
    for(let i=0;i<rows.length;i+=250){
      const chunk=rows.slice(i,i+250).map((r,j)=>{
        const nr=normalizedRow(r,draftBase);
        const errors=[];
        if((type==='products'||type==='customers') && !nr.name) errors.push('Missing name');
        if(type==='expenses' && !Number.isFinite(Number(nr.amount))) errors.push('Invalid amount');
        if(type==='sales' && !Number.isFinite(Number(nr.total))) errors.push('Invalid total');
        return {batch_id:batch.id,row_number:i+j+1,raw_data:r,normalized_data:nr,validation_status:errors.length?'invalid':'valid',validation_errors:errors};
      });
      const {error}=await sb.from('import_rows').insert(chunk); if(error) throw error;
    }
    const {data:serverAnalysis,error:aErr}=await sb.rpc('analyse_import_batch',{p_batch_id:batch.id}); if(aErr) throw aErr;
    const analysis={...(serverAnalysis||{}),...analyseRows(rows,type,mapping)};
    await sb.rpc('save_import_analysis',{p_batch_id:batch.id,p_analysis:analysis});
    importDraft={...draftBase,analysis};
    renderImportReview(); status.textContent=`Staged ${rows.length.toLocaleString()} records. Review everything before importing.`;
    document.getElementById('import-review').classList.remove('hidden');
  }catch(err){console.error(err);status.textContent='';toast('Import preparation failed: '+(err.message||err),5000);}
}

function renderImportReview(){
  const d=importDraft,a=d.analysis; document.getElementById('imp-rows').textContent=a.total_rows.toLocaleString();document.getElementById('imp-missing').textContent=a.missing_values.toLocaleString();document.getElementById('imp-dupes').textContent=a.duplicate_rows.toLocaleString();document.getElementById('imp-warnings').textContent=a.warnings.toLocaleString();
  document.getElementById('imp-findings').innerHTML=`<div style="margin-bottom:12px;"><b>Strengths</b>${a.strengths.map(x=>`<div class="playbook">✓ ${importEsc(x)}</div>`).join('')}</div><div style="margin-bottom:12px;"><b>Weaknesses / disadvantages</b>${a.weaknesses.length?a.weaknesses.map(x=>`<div class="playbook">⚠ ${importEsc(x)}</div>`).join(''):'<div class="text-muted" style="margin-top:8px;">No major structural weakness was detected by the automated checks.</div>'}</div><div><b>Recommended actions</b>${a.recommendations.map(x=>`<div class="playbook">→ ${importEsc(x)}</div>`).join('')}</div>`;
  document.getElementById('imp-mapping').innerHTML=Object.entries(d.mapping).map(([f,h])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>${importEsc(f)}</span><code>${importEsc(h)}</code></div>`).join('') || '<div class="text-muted">No fields could be mapped automatically. Change the spreadsheet headings and try again.</div>';
  const headers=[...new Set(d.rows.flatMap(r=>Object.keys(r)))].slice(0,8); document.getElementById('imp-preview-head').innerHTML='<tr>'+headers.map(h=>`<th>${importEsc(h)}</th>`).join('')+'</tr>'; document.getElementById('imp-preview-body').innerHTML=d.rows.slice(0,25).map(r=>'<tr>'+headers.map(h=>`<td>${importEsc(r[h])}</td>`).join('')+'</tr>').join('');
}

function normalizedRow(r,d){
  const m=d.mapping,t=d.type;
  const get=f=>m[f]?r[m[f]]:'';
  if(t==='products') return {name:String(get('name')).trim(),category:String(get('category')||'').trim()||null,cost:importNum(get('cost'))??0,price:importNum(get('price'))??0,stock:Math.round(importNum(get('stock'))??0),reorder:Math.round(importNum(get('reorder'))??0),updated_by:session.name};
  if(t==='customers') return {name:String(get('name')).trim(),phone:String(get('phone')||'').trim()||null,total_spent:importNum(get('total_spent'))??0,balance_due:importNum(get('balance_due'))??0,last_purchase:importDate(get('last_purchase')),visits:Math.round(importNum(get('visits'))??0),tier:'Imported'};
  if(t==='expenses') return {time:importDate(get('date'))||new Date().toISOString(),category:String(get('category')||'Other').trim(),note:String(get('note')||'').trim()||null,amount:importNum(get('amount'))??0,flag:false,reason:null,logged_by:session.name};
  const total=importNum(get('total'))??0,qty=importNum(get('qty'))??1,price=importNum(get('price'))??(qty?total/qty:total);
  return {invoice_no:String(get('invoice_no')||'').trim()||null,time:importDate(get('date'))||new Date().toISOString(),items:get('product')?[{name:String(get('product')).trim(),qty,price}]:[],subtotal:importNum(get('subtotal'))??total,discount:importNum(get('discount'))??0,vat:importNum(get('vat'))??0,total,cost:importNum(get('cost'))??0,customer_name:String(get('customer_name')||'').trim()||null,payment:String(get('payment')||'').trim()||null,recorded_by:session.name};
}

async function commitImport(){
  if(!importDraft || !session || session.role!=='company_admin') return;
  const d=importDraft; const table=d.type==='sales'?'sales':d.type;
  const rows=d.rows.map(r=>normalizedRow(r,d)).filter(r=>d.type==='products'?r.name:d.type==='customers'?r.name:true).map(r=>({id:crypto.randomUUID(),company_id:session.companyId,...r}));
  if(!rows.length){toast('Nothing valid to import.');return;}
  if(d.analysis.duplicate_rows || d.analysis.warnings){ if(!confirm(`ChiiTech found ${d.analysis.warnings} warning(s). Import the reviewed records anyway?`)) return; }
  try{
    const {data:importedCount,error:commitError}=await sb.rpc('commit_import_batch',{p_batch_id:d.batchId,p_record_type:d.type});
    if(commitError) throw commitError;
    const actualCount=Number(importedCount||0);
    await sb.rpc('create_security_alert',{p_company_id:session.companyId,p_severity:'low',p_event_type:'business_import',p_title:'Existing business records imported',p_description:`${actualCount} ${d.type} records imported from ${d.fileName}.`,p_metadata:{batch_id:d.batchId,record_type:d.type,row_count:actualCount,analysis:d.analysis}});
    if(typeof addAuditLog==='function') addAuditLog('import.completed',`Imported ${rows.length} ${d.type} records from ${d.fileName}`);
    toast(`Imported ${actualCount.toLocaleString()} records successfully.`,5000); cancelImport(); state=await loadBusiness(session.companyId); renderAll();
  }catch(err){console.error(err);toast('Import failed. The staged records were not promoted into the business tables. Review the import batch and try again. '+(err.message||''),7000);}
}
function cancelImport(){importDraft=null;document.getElementById('import-review').classList.add('hidden');document.getElementById('import-status').textContent='';document.getElementById('import-file').value='';}
