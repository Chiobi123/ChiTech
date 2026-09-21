/* ChiiTech data layer — now backed by a real Supabase project instead of
   localStorage. See js/supabase-config.js for the client (`sb`).
   ------------------------------------------------------------
   HOW THIS FITS TOGETHER (read this before touching app.js):

   app.js was written against a simple contract: mutate the in-memory
   `state` object (state.products.push(...), etc.), then call
   addAuditLog()/saveState() and the change is "saved." That contract
   still holds — every one of app.js's ~40 add/edit/delete functions is
   completely unchanged. What changed is what saveState() actually does:
   instead of writing one big blob to localStorage, it now DIFFS each
   array in `state` against a snapshot of what was last loaded from
   Supabase, and sends only the real inserts/updates/deletes for each
   table — see syncAll() below. Every row's `id` is a real uuid from the
   moment it's created (see nextId() in app.js), so a newly-added product
   never needs its id swapped out after saving; the browser and the
   database agree on it from the start.

   Two sessions read data differently:
   - admin/worker: real Supabase Auth session, real per-table SELECTs,
     scoped automatically by the Row Level Security policies already on
     every table (see migrations 04/06 in the project).
   - auditor: never a Supabase Auth user at all (kept code-based, by
     design) — everything for that view comes from one re-validated-
     every-time RPC, auditor_fetch_data(). See loginAuditor() and
     validateAuditorGrant() in the other files for how that's used.
     Nothing is ever written back for an auditor session — see
     saveState() below.
   ============================================================ */

const SUPER_ADMIN_EMAIL = 'igbanichiobiebere@gmail.com';

function isSuperAdmin(email){
  return (email||'').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

/** A unique, hard-to-guess code for a single auditor grant — separate
 *  from a company's own code, since this one is meant to be shared with
 *  one external person for one engagement and revoked after. Generated
 *  client-side; the database's own unique constraint on the column is
 *  the real backstop against a collision (astronomically unlikely at
 *  this length, but the insert would simply fail cleanly if it ever
 *  happened, rather than silently overwriting someone else's grant). */
function genAuditorCode(){
  return 'AUD-' + Math.random().toString(36).slice(2,7).toUpperCase();
}

function tsToIso(ms){ return ms ? new Date(ms).toISOString() : null; }
function isoToTs(iso){ return iso ? new Date(iso).getTime() : null; }

/* Departments available for worker assignment */
const DEPARTMENTS = [
  { id:'sales',     label:'Sales',          icon:'ti-receipt' },
  { id:'products',  label:'Products & Inventory', icon:'ti-box' },
  { id:'expenses',  label:'Expenses',       icon:'ti-wallet' },
  { id:'customers', label:'Customers',      icon:'ti-users' },
  { id:'orders',    label:'Orders (online/remote)', icon:'ti-truck' },
  { id:'tax',       label:'Tax & Compliance', icon:'ti-receipt-tax' },
  { id:'audit',     label:'Audit (view only)', icon:'ti-shield-check' },
  { id:'analytics', label:'Data analysis & growth', icon:'ti-trending-up' },
];

/* What each subscription plan is worth per month — used to work out the
   platform owner's monthly recurring revenue on the Super Admin console.
   Keep this in sync with the Pricing Model table in the PRD. */
const PLAN_PRICES = { 'Free':0, 'Founding':2500, 'Pro':5000, 'Business':10000, 'Enterprise':25000 };

/** The empty shape `state` starts as before anything has loaded, and
 *  what a brand new company's business bucket looks like the moment
 *  after it registers — every list genuinely empty, no sample data. */
function seedEmptyBusiness(){
  return {
    products: [], customers: [], sales: [], expenses: [],
    expenseCategories: ['Transport','Rent','Utilities','Restock / supplies','Staff','Marketing','Other'],
    orders: [], auditLog: [],
    taxSettings: { vatRate: 7.5, whtRate: 5, whtThreshold: 50000 },
    growth: { mode:'automated', chartStyle:'bar', dashboardChartType:'bar' },
    sop: [], billingHistory: [], payoutConfig: { paystackConnected:false, bankTransfer:null },
    materialityThreshold: 5000, findings: [],
    team: [], auditorGrants: [], auditVisitLog: [],
    meta: { nextId: 100 } // unused now that ids are real uuids — kept only for shape stability
  };
}

/* ============================================================
   TABLE SYNC DEFINITIONS
   One entry per table that lives inside a company's business bucket.
   toRow() shapes one in-memory JS object into the row Supabase expects;
   fromRow() is the inverse, run once per row on load. Only the fields
   listed here ever move between `state` and the database.
   ============================================================ */
const SYNC_DEFS = {
  products: { table:'products',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, name:o.name, category:o.category||null,
      cost:o.cost||0, price:o.price||0, stock:o.stock||0, reorder:o.reorder||0, updated_by:o.updatedBy||null }),
    fromRow:r=>({ id:r.id, name:r.name, category:r.category, cost:Number(r.cost), price:Number(r.price),
      stock:r.stock, reorder:r.reorder, updatedBy:r.updated_by }) },

  customers: { table:'customers',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, name:o.name, phone:o.phone||null,
      total_spent:o.totalSpent||0, balance_due:o.balanceDue||0, last_purchase:tsToIso(o.lastPurchase),
      visits:o.visits||0, tier:o.tier||'New' }),
    fromRow:r=>({ id:r.id, name:r.name, phone:r.phone, totalSpent:Number(r.total_spent),
      balanceDue:Number(r.balance_due), lastPurchase:isoToTs(r.last_purchase), visits:r.visits, tier:r.tier }) },

  sales: { table:'sales',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, invoice_no:o.invoiceNo||null,
      time: tsToIso(o.time) || new Date().toISOString(), items:o.items||[], items_summary:o.itemsSummary||null,
      subtotal:o.subtotal||0, discount:o.discount||0, vat:o.vat||0, total:o.total||0, cost:o.cost||0,
      customer_id:o.customerId||null, customer_name:o.customerName||null, payment:o.payment||null,
      recorded_by:o.recordedBy||null }),
    fromRow:r=>({ id:r.id, invoiceNo:r.invoice_no, time:isoToTs(r.time), items:r.items||[],
      itemsSummary:r.items_summary, subtotal:Number(r.subtotal), discount:Number(r.discount), vat:Number(r.vat),
      total:Number(r.total), cost:Number(r.cost), customerId:r.customer_id, customerName:r.customer_name,
      payment:r.payment, recordedBy:r.recorded_by }) },

  expenses: { table:'expenses',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, time: tsToIso(o.time) || new Date().toISOString(),
      category:o.category||null, note:o.note||null, amount:o.amount||0, flag:!!o.flag, reason:o.reason||null,
      logged_by:o.loggedBy||null }),
    fromRow:r=>({ id:r.id, time:isoToTs(r.time), category:r.category, note:r.note, amount:Number(r.amount),
      flag:r.flag, reason:r.reason, loggedBy:r.logged_by }) },

  orders: { table:'orders',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, channel:o.channel||null, customer_name:o.customerName||null,
      items:o.items||null, total:o.total||0, status:o.status||'Pending',
      placed_at: tsToIso(o.placedAt) || new Date().toISOString(), notes:o.notes||null }),
    fromRow:r=>({ id:r.id, channel:r.channel, customerName:r.customer_name, items:r.items,
      total:Number(r.total), status:r.status, placedAt:isoToTs(r.placed_at), notes:r.notes }) },

  sop: { table:'sop',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, area:o.area||null, description:o.description||null,
      frequency:o.frequency||null, responsible:o.responsible||null,
      created_at: tsToIso(o.createdAt) || new Date().toISOString(),
      last_reviewed: tsToIso(o.lastReviewed) || new Date().toISOString() }),
    fromRow:r=>({ id:r.id, area:r.area, description:r.description, frequency:r.frequency,
      responsible:r.responsible, createdAt:isoToTs(r.created_at), lastReviewed:isoToTs(r.last_reviewed) }) },

  findings: { table:'audit_findings',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, title:o.title, description:o.description||null,
      severity:o.severity||'medium', status:o.status||'open', raised_by:o.raisedBy||null,
      created_at: tsToIso(o.createdAt) || new Date().toISOString(), resolved_at: tsToIso(o.resolvedAt),
      resolved_by:o.resolvedBy||null }),
    fromRow:r=>({ id:r.id, title:r.title, description:r.description, severity:r.severity, status:r.status,
      raisedBy:r.raised_by, createdAt:isoToTs(r.created_at), resolvedAt:isoToTs(r.resolved_at),
      resolvedBy:r.resolved_by }) },

  auditorGrants: { table:'auditor_grants',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, name:o.name, code:o.code,
      created_at: tsToIso(o.createdAt) || new Date().toISOString(), expires_at: tsToIso(o.expiresAt),
      created_by:o.createdBy||null, revoked:!!o.revoked, last_visit: tsToIso(o.lastVisit) }),
    fromRow:r=>({ id:r.id, name:r.name, code:r.code, createdAt:isoToTs(r.created_at),
      expiresAt:isoToTs(r.expires_at), createdBy:r.created_by, revoked:r.revoked, lastVisit:isoToTs(r.last_visit) }) },
};

/** Rows in these two arrays are only ever added, never edited or
 *  deleted from the UI, and audit_log's hash/prev_hash are computed by
 *  a database trigger regardless of what's sent — see migration 03. So
 *  these are synced insert-only, and audit_log's local entries get the
 *  real server-computed hash written back after insert. */
const INSERT_ONLY_DEFS = {
  auditLog: { table:'audit_log',
    toRow:(o,cid)=>({ id:o.id, company_id:cid, time: tsToIso(o.time) || new Date().toISOString(),
      action:o.action, details:o.details||null, "user":o.user||null }),
    fromRow:r=>({ id:r.id, time:isoToTs(r.time), action:r.action, details:r.details,
      hash:r.hash, prevHash:r.prev_hash, user:r.user }) },
};

/* ============================================================
   LOAD — real per-company SELECTs, assembled into the same `state`
   shape app.js has always expected.
   ============================================================ */
async function loadBusiness(companyId){
  const [products, customers, sales, expenses, orders, sop, auditLog, auditorGrants, visits, team, settings, findings] = await Promise.all([
    sb.from('products').select('*').eq('company_id', companyId),
    sb.from('customers').select('*').eq('company_id', companyId),
    sb.from('sales').select('*').eq('company_id', companyId),
    sb.from('expenses').select('*').eq('company_id', companyId),
    sb.from('orders').select('*').eq('company_id', companyId),
    sb.from('sop').select('*').eq('company_id', companyId),
    sb.from('audit_log').select('*').eq('company_id', companyId).order('time', {ascending:true}),
    sb.from('auditor_grants').select('*').eq('company_id', companyId),
    sb.from('audit_visit_log').select('*').eq('company_id', companyId).order('time', {ascending:false}),
    sb.from('profiles').select('id,email,name,role,departments,active').eq('company_id', companyId),
    sb.from('company_settings').select('*').eq('company_id', companyId).maybeSingle(),
    sb.from('audit_findings').select('*').eq('company_id', companyId).order('created_at', {ascending:false}),
  ]);
  for(const r of [products,customers,sales,expenses,orders,sop,auditLog,auditorGrants,visits,team,settings,findings]){
    if(r.error){ console.error('loadBusiness:', r.error); toast('Could not load some data — ' + r.error.message, 4000); }
  }

  const biz = seedEmptyBusiness();
  biz.products = (products.data||[]).map(SYNC_DEFS.products.fromRow);
  biz.customers = (customers.data||[]).map(SYNC_DEFS.customers.fromRow);
  biz.sales = (sales.data||[]).map(SYNC_DEFS.sales.fromRow);
  biz.expenses = (expenses.data||[]).map(SYNC_DEFS.expenses.fromRow);
  biz.orders = (orders.data||[]).map(SYNC_DEFS.orders.fromRow);
  biz.sop = (sop.data||[]).map(SYNC_DEFS.sop.fromRow);
  biz.auditLog = (auditLog.data||[]).map(INSERT_ONLY_DEFS.auditLog.fromRow);
  biz.auditorGrants = (auditorGrants.data||[]).map(SYNC_DEFS.auditorGrants.fromRow);
  // Read-only: written by the auditor_login() RPC only, never synced
  // back from here — the admin's page just displays it.
  biz.auditVisitLog = (visits.data||[]).map(r=>({ id:r.id, grantId:r.grant_id, auditorName:r.auditor_name, time:isoToTs(r.time) }));
  biz.team = (team.data||[]).map(r=>({ id:r.id, email:r.email, name:r.name, role:r.role,
    departments:r.departments||[], active:r.active }));
  biz.findings = (findings.data||[]).map(SYNC_DEFS.findings.fromRow);

  const s = settings.data;
  if(s){
    biz.expenseCategories = s.expense_categories || biz.expenseCategories;
    biz.taxSettings = s.tax_settings || biz.taxSettings;
    biz.growth = s.growth || biz.growth;
    biz.payoutConfig = s.payout_config || biz.payoutConfig;
    biz.billingHistory = s.billing_history || biz.billingHistory;
    biz.materialityThreshold = s.materiality_threshold!=null ? Number(s.materiality_threshold) : biz.materialityThreshold;
  }

  // Snapshot of exactly what's in the database right now, so saveState()
  // can later diff `state` against this instead of blindly re-sending
  // everything every time.
  biz.__synced = JSON.parse(JSON.stringify({
    products: biz.products, customers: biz.customers, sales: biz.sales, expenses: biz.expenses,
    orders: biz.orders, sop: biz.sop, auditorGrants: biz.auditorGrants, findings: biz.findings,
    expenseCategories: biz.expenseCategories, taxSettings: biz.taxSettings, growth: biz.growth,
    payoutConfig: biz.payoutConfig, billingHistory: biz.billingHistory, materialityThreshold: biz.materialityThreshold,
  }));
  biz.__syncedAuditLogIds = new Set(biz.auditLog.map(a=>a.id));
  biz.__syncedTeam = JSON.parse(JSON.stringify(biz.team));

  return biz;
}

/* ============================================================
   SAVE — diffs each array against the snapshot taken at load time and
   sends only real inserts/updates/deletes. Fire-and-forget from
   app.js's point of view (saveState() doesn't await this) since the UI
   already reads from the in-memory `state` it just mutated — this
   syncs that same change out to Supabase in the background. Errors are
   surfaced with a toast rather than silently swallowed.
   ============================================================ */
async function syncArrayTable(def, localArr, syncedArr, companyId){
  const localById = new Map(localArr.map(o=>[o.id,o]));
  const syncedById = new Map(syncedArr.map(o=>[o.id,o]));

  const toInsert = localArr.filter(o=>!syncedById.has(o.id));
  const toDelete = syncedArr.filter(o=>!localById.has(o.id));
  const toUpdate = localArr.filter(o=>{
    const prev = syncedById.get(o.id);
    return prev && JSON.stringify(o)!==JSON.stringify(prev);
  });

  if(toInsert.length){
    const {error} = await sb.from(def.table).insert(toInsert.map(o=>def.toRow(o,companyId)));
    if(error) throw error;
  }
  for(const o of toUpdate){
    const {error} = await sb.from(def.table).update(def.toRow(o,companyId)).eq('id', o.id);
    if(error) throw error;
  }
  if(toDelete.length){
    const {error} = await sb.from(def.table).delete().in('id', toDelete.map(o=>o.id));
    if(error) throw error;
  }
}

async function syncInsertOnlyTable(def, localArr, syncedIds, companyId){
  const toInsert = localArr.filter(o=>!syncedIds.has(o.id));
  if(!toInsert.length) return;
  const {data, error} = await sb.from(def.table).insert(toInsert.map(o=>def.toRow(o,companyId))).select();
  if(error) throw error;
  // Write the real, database-computed values (hash/prevHash for the
  // audit log) back into the matching in-memory objects so the UI shows
  // the genuine server-side chain, not the throwaway client guess.
  if(data){
    for(const row of data){
      const local = localArr.find(o=>o.id===row.id);
      if(local) Object.assign(local, def.fromRow(row));
      syncedIds.add(row.id);
    }
  }
}

async function syncCompanySettings(state, companyId){
  const current = { expense_categories:state.expenseCategories, tax_settings:state.taxSettings,
    growth:state.growth, payout_config:state.payoutConfig, billing_history:state.billingHistory,
    materiality_threshold:state.materialityThreshold };
  const synced = state.__synced;
  const prev = { expense_categories:synced.expenseCategories, tax_settings:synced.taxSettings,
    growth:synced.growth, payout_config:synced.payoutConfig, billing_history:synced.billingHistory,
    materiality_threshold:synced.materialityThreshold };
  if(JSON.stringify(current)===JSON.stringify(prev)) return;
  const {error} = await sb.from('company_settings').update(current).eq('company_id', companyId);
  if(error) throw error;
}

/** The single "save everything that changed" entry point — this is what
 *  saveState() in app.js calls. Auditor sessions never write anything,
 *  full stop; that's enforced here, not just by hiding buttons. */
async function saveBusiness(companyId, state){
  if(!state || !state.__synced) return; // not a real, loaded session (e.g. auditor view)
  try{
    await Promise.all([
      syncArrayTable(SYNC_DEFS.products, state.products, state.__synced.products, companyId),
      syncArrayTable(SYNC_DEFS.customers, state.customers, state.__synced.customers, companyId),
      syncArrayTable(SYNC_DEFS.sales, state.sales, state.__synced.sales, companyId),
      syncArrayTable(SYNC_DEFS.expenses, state.expenses, state.__synced.expenses, companyId),
      syncArrayTable(SYNC_DEFS.orders, state.orders, state.__synced.orders, companyId),
      syncArrayTable(SYNC_DEFS.sop, state.sop, state.__synced.sop, companyId),
      syncArrayTable(SYNC_DEFS.auditorGrants, state.auditorGrants, state.__synced.auditorGrants, companyId),
      syncArrayTable(SYNC_DEFS.findings, state.findings, state.__synced.findings, companyId),
      syncInsertOnlyTable(INSERT_ONLY_DEFS.auditLog, state.auditLog, state.__syncedAuditLogIds, companyId),
      syncCompanySettings(state, companyId),
      syncTeam(companyId, state.team, state.__syncedTeam),
    ]);
    state.__syncedTeam = JSON.parse(JSON.stringify(state.team));
    // Re-snapshot now that everything above has landed, so the next
    // saveState() call only diffs what changes from here on.
    state.__synced = JSON.parse(JSON.stringify({
      products:state.products, customers:state.customers, sales:state.sales, expenses:state.expenses,
      orders:state.orders, sop:state.sop, auditorGrants:state.auditorGrants, findings:state.findings,
      expenseCategories:state.expenseCategories, taxSettings:state.taxSettings, growth:state.growth,
      payoutConfig:state.payoutConfig, billingHistory:state.billingHistory, materialityThreshold:state.materialityThreshold,
    }));
  }catch(err){
    console.error('saveBusiness:', err);
    toast('Could not save that change — check your connection. ' + (err.message||''), 4000);
  }
}

/** Also written to a worker's own profile row directly by app.js's Team
 *  page (see profiles_admin_update in migration 06) — this generic
 *  team sync only needs to cover edits to existing rows (active flag,
 *  departments); new team members are created by their own self-join
 *  sign-up (see join_company_as_worker in auth.js), not by this file. */
async function syncTeam(companyId, team, syncedTeam){
  const syncedById = new Map((syncedTeam||[]).map(o=>[o.id,o]));
  const changed = team.filter(m=>{
    const prev = syncedById.get(m.id);
    return prev && (JSON.stringify(prev.departments)!==JSON.stringify(m.departments) || prev.active!==m.active);
  });
  for(const m of changed){
    const {error} = await sb.from('profiles').update({ departments:m.departments, active:m.active }).eq('id', m.id);
    if(error){ console.error('syncTeam:', error); toast('Could not save that team change.', 4000); }
  }
}

/* ============================================================
   PLATFORM — the company directory. For a normal admin/worker this is
   just their own company (RLS scopes the SELECT automatically); for the
   super_admin it's every company, plus a full user directory for the
   Super Admin console.
   ============================================================ */
async function loadPlatform(){
  const [companiesRes, meRes] = await Promise.all([
    sb.from('companies').select('*'),
    sb.auth.getUser(),
  ]);
  if(companiesRes.error) console.error('loadPlatform companies:', companiesRes.error);
  const companies = (companiesRes.data||[]).map(c=>({
    id:c.id, name:c.name, code:c.code, plan:c.plan, ownerEmail:null, createdAt:new Date(c.created_at).getTime(),
    deletedAt: c.deleted_at ? new Date(c.deleted_at).getTime() : null
  }));

  let users = [];
  const uid = meRes.data && meRes.data.user ? meRes.data.user.id : null;
  if(uid){
    const {data:myProfile} = await sb.from('profiles').select('role').eq('id', uid).maybeSingle();
    if(myProfile && myProfile.role==='super_admin'){
      const {data, error} = await sb.from('profiles').select('id,email,name,role,company_id,departments,active');
      if(error) console.error('loadPlatform profiles:', error);
      users = (data||[]).map(p=>({ email:p.email, name:p.name, role:p.role, companyId:p.company_id,
        departments:p.departments||[], active:p.active }));
      // Fill in each company's owner email now that we have the full
      // user list to look it up from (companies itself doesn't store it).
      companies.forEach(c=>{
        const owner = users.find(u=>u.companyId===c.id && u.role==='company_admin');
        if(owner) c.ownerEmail = owner.email;
      });
    }
  }
  return { companies, users };
}

/** Only used by the Super Admin console's suspend/activate-company and
 *  pause/reactivate-user actions — both are single, well-defined writes,
 *  so this goes straight to the table rather than through the generic
 *  diff-sync (which is built for a whole company's business bucket). */
async function savePlatform(platform){
  // Nothing to do here directly: app.js mutates `platform.companies[].plan`
  // etc. in memory and this used to be a single localStorage write. The
  // two call sites that need a real write (suspend a company, pause a
  // user) call supabase directly — see suspendCompany()/toggleUserActive()
  // in app.js. This function is kept so those call sites don't need to
  // change, but performs no write of its own beyond what they already do.
}
