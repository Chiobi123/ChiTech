/* ChiiTech application logic. `state` is the current company's business
   bucket (see data.js); `session`/`platform` come from auth.js. */

/* ============================================================
   CHIITECH APPLICATION LOGIC
   ------------------------------------------------------------
   This is the biggest file in the app. Read it top to bottom in
   this order and it should make sense as a whole:

   1. BOOT              — what runs when the page first loads
   2. NAVIGATION         — switching between sections, mobile menu
   3. AUDIT ENGINE       — the hash-chained log every action writes to
   4. PRODUCTS           — add product, edit price
   5. CUSTOMERS          — add customer, tier calculation (VIP etc.)
   6. ORDERS             — remote/non-visitor order pipeline
   7. SALES              — the shopping-cart-style sale flow
   8. EXPENSES           — logging + automatic flagging + root cause
   9. DASHBOARD          — today's numbers + the 3 dashboard charts
   10. TAX ANALYSIS       — VAT/WHT calculated from real records
   11. AUDIT PAGE         — glossary, trial balance, SoD matrix, Benford
   12. GROWTH ENGINE      — forecasts, chart switcher, 4-pillar plan
   13. TEAM & DEPARTMENTS — admin adds workers, assigns access
   14. SUPER ADMIN        — the platform-owner-only company directory
   15. AI ASSISTANT       — keyword-matched answers from live data

   `state` (declared below) holds ONE company's data at a time — see
   js/data.js for what's inside it, and js/auth.js for how `session`
   (who's currently logged in) and `platform` (the company directory)
   get set. js/charts.js is a separate, dependency-free chart-drawing
   library this file calls into (chiBar, chiLine, chiDoughnut, etc).
   ============================================================ */

let state = null;
let cart = [];
let currentSection = null;
let navStack = []; // section-name history for the Back button

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  platform = await loadPlatform();
  document.querySelectorAll('[data-target]').forEach(el=>{
    el.addEventListener('click', ()=> showSection(el.dataset.target));
  });
  document.querySelectorAll('#mode-select .chip-opt').forEach(el=>{
    el.addEventListener('click', ()=> setGrowthMode(el.dataset.mode));
  });
  document.querySelectorAll('#g-chart-type .chip-opt').forEach(el=>{
    el.addEventListener('click', ()=> setGrowthChartStyle(el.dataset.chart));
  });
  document.querySelectorAll('#d-chart-type .chip-opt').forEach(el=>{
    el.addEventListener('click', ()=> setDashboardChartType(el.dataset.chart));
  });
  document.querySelectorAll('#d-revcost-type .chip-opt').forEach(el=>{
    el.addEventListener('click', ()=> setRevCostChartType(el.dataset.chart));
  });
  document.querySelectorAll('#ac-mode-select .chip-opt').forEach(el=>{
    el.addEventListener('click', ()=> setAuditorAnalysisMode(el.dataset.mode));
  });

  session = loadSession();
  if(session){ await bootApp(); }
});

/** Escapes text before it's inserted into innerHTML, so a product name,
 *  customer name, or note typed by a user can never be interpreted as
 *  HTML/JS. Every place in this file that builds an HTML string from
 *  user-entered data runs it through this first — that's the app's main
 *  defence against stored XSS, since everything here renders client-side. */
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str===undefined || str===null ? '' : String(str);
  return div.innerHTML;
}

/** Animates a headline stat counting up (or down) to its new value
 *  instead of just snapping to it — a small, cheap bit of motion (one
 *  short run per render, not continuous) that makes the dashboard feel
 *  alive without touching layout or repainting anything else. Reads
 *  the element's own last-rendered value off a data attribute so it
 *  counts from wherever it actually was, not from zero every time.
 *  Respects prefers-reduced-motion by jumping straight to the target. */
function animateStatNumber(elId, target, format){
  const el = document.getElementById(elId);
  if(!el) return;
  const from = Number(el.dataset.rawValue) || 0;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion || from===target){ el.textContent = format(target); el.dataset.rawValue = target; return; }
  const duration = 500;
  const start = performance.now();
  function tick(now){
    const p = Math.min(1, (now-start)/duration);
    const eased = 1 - Math.pow(1-p, 3); // ease-out cubic
    const value = from + (target-from)*eased;
    el.textContent = format(value);
    if(p<1) requestAnimationFrame(tick);
    else { el.textContent = format(target); el.dataset.rawValue = target; }
  }
  requestAnimationFrame(tick);
}

function initials(name){
  return (name||'U').split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
}

async function bootApp(){
  navStack = [];
  currentSection = null;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  if(session.role==='super_admin'){
    document.querySelectorAll('.nav-link, .mobile-nav .nav-item').forEach(el=>el.classList.add('hidden'));
    document.getElementById('imp-banner').classList.add('hidden');
    document.getElementById('auditor-banner').classList.add('hidden');
    document.getElementById('sidebar-sub').textContent = 'Platform console';
    document.getElementById('sidebar-plan').textContent = 'Platform owner';
    document.getElementById('delete-account-link').classList.add('hidden');
    await renderSuperAdmin();
    showSection('superadmin');
    return;
  }

  if(session.role==='auditor'){
    const grant = await validateAuditorGrant();
    if(!grant){
      // Revoked or expired since the person signed in (or on reload).
      // There's no live push in this static build, so re-checking on
      // every boot is how a revoke actually takes effect for them.
      logout();
      setTimeout(()=> toastOnLogin('This auditor access is no longer valid — ask the company admin for a new code.'), 200);
      return;
    }
    document.querySelectorAll('.nav-link, .mobile-nav .nav-item').forEach(el=>{
      el.classList.toggle('hidden', el.dataset.nav!=='auditor');
    });
    document.getElementById('imp-banner').classList.add('hidden');
    document.getElementById('delete-account-link').classList.add('hidden');
    document.getElementById('sidebar-sub').textContent = session.companyName || 'Auditor access';
    document.getElementById('sidebar-plan').textContent = 'Auditor \u2014 read only';
    const banner = document.getElementById('auditor-banner');
    banner.classList.remove('hidden');
    banner.innerHTML = `\u{1F512} Read-only auditor access to <b>${escapeHtml(session.companyName||'')}</b>
      ${grant.expiresAt ? ' &nbsp;\u2022&nbsp; expires ' + new Date(grant.expiresAt).toLocaleDateString('en-NG') : ' &nbsp;\u2022&nbsp; no expiry set'}
      &nbsp;\u2022&nbsp; this visit has been logged`;
    renderAuditorCommandCenter();
    showSection('auditor');
    return;
  }

  document.getElementById('delete-account-link').classList.remove('hidden');
  const company = currentCompany();
  state = await loadBusiness(session.companyId);
  document.getElementById('sidebar-sub').textContent = company ? company.name : 'Business console';
  document.getElementById('sidebar-plan').textContent = (company ? company.plan : 'Founding') + ' plan';
  document.getElementById('d-avatar').textContent = initials(session.name);
  document.getElementById('d-role-chip').textContent = session.role==='worker'
    ? 'Worker — ' + session.departments.map(d=>deptLabel(d)).join(', ')
    : (company ? company.plan+' plan' : 'Admin');
  document.getElementById('d-greeting').textContent = 'Hi, ' + (session.name||'there');

  const banner = document.getElementById('imp-banner');
  document.getElementById('auditor-banner').classList.add('hidden');
  if(session.impersonating){
    banner.classList.remove('hidden');
    banner.innerHTML = `\u{1F441} Viewing <b>${escapeHtml(company.name)}</b> &nbsp;<a href="#" onclick="returnToPlatform();return false;">Exit</a>`;
  } else {
    banner.classList.add('hidden');
  }

  populateSelects();
  applyAccessControl();
  setupCollapsibleLists();
  makeDivCollapsible('audit-log');
  renderAll();

  const order = ['dashboard','sales','products','customers','orders','expenses','tax','audit','growth','ai','team','billing','auditoraccess'];
  const firstAllowed = order.find(name=>{
    const dept = SECTION_ACCESS[name];
    if(dept===null) return true;
    if(dept==='admin') return session.role==='company_admin';
    return canAccess(dept);
  });
  showSection(firstAllowed || 'dashboard');
}

function deptLabel(id){
  const d = DEPARTMENTS.find(x=>x.id===id);
  return d ? d.label : id;
}

async function impersonate(companyId){
  session = { email: session.email, role:'company_admin', companyId, name:'Platform admin (viewing)',
              departments:['all'], impersonating:true, superAdminEmail: session.email };
  saveSession(session);
  await bootApp();
}
async function returnToPlatform(){
  session = { email: session.superAdminEmail, role:'super_admin', companyId:null, name:'Platform Admin', departments:['all'] };
  saveSession(session);
  await bootApp();
}

function renderAll(){
  if(session.role==='super_admin'){ renderSuperAdmin(); return; }
  renderDashboard();
  renderSales();
  renderProducts();
  renderCustomers();
  renderOrders();
  renderExpenses();
  renderTax();
  renderAudit();
  renderGrowth();
  renderBilling();
  if(session.role==='company_admin'){ renderTeam(); renderAuditorAccess(); }
}

function showSection(name, fromBack){
  if(!fromBack && currentSection && currentSection!==name){ navStack.push(currentSection); }
  currentSection = name;
  document.getElementById('back-btn').classList.toggle('hidden', navStack.length===0);
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  const sec = document.getElementById('sec-'+name);
  if(sec) sec.classList.add('active');
  document.querySelectorAll('.nav-link, .mobile-nav .nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.target === name);
  });
  toggleMobileMenu(false);
  if(state) renderAll();
}

/** Returns to whichever section was open before the current one —
 *  a real "previous page" button, not just a shortcut back to Home. */
function goBack(){
  if(!navStack.length) return;
  const prev = navStack.pop();
  showSection(prev, true);
  document.getElementById('back-btn').classList.toggle('hidden', navStack.length===0);
}

function toggleMobileMenu(force){
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const open = typeof force==='boolean' ? force : !sidebar.classList.contains('mobile-open');
  sidebar.classList.toggle('mobile-open', open);
  backdrop.classList.toggle('show', open);
}

/** Generic "Show more / Show less" for long tables: collapses a list
 *  into a fixed-height, scrollable box, with a button to expand it to
 *  full length. Call once per list right after its HTML exists. */
/** Wraps a table's <tbody id="tbodyId"> ancestor <table> in a collapsible,
 *  scrollable box with a "Show more / Show less" button — done here at
 *  runtime with real DOM methods (not text/HTML string surgery) so it
 *  can never corrupt the page's markup the way editing raw HTML can.
 *  Safe to call multiple times; it only wraps a table once. */
function makeListCollapsible(tbodyId){
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  const table = tbody.closest('table');
  if(!table || table.parentElement.classList.contains('list-wrap')) return; // already wrapped

  const wrap = document.createElement('div');
  wrap.className = 'list-wrap';
  wrap.id = tbodyId + '-wrap';
  table.parentNode.insertBefore(wrap, table);
  wrap.appendChild(table);

  const row = document.createElement('div');
  row.className = 'show-more-row';
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.textContent = 'Show more';
  btn.onclick = ()=> toggleListWrap(wrap.id, btn);
  row.appendChild(btn);
  wrap.parentNode.insertBefore(row, wrap.nextSibling);
}

/** Called once after the app's HTML exists, to make every long list
 *  scrollable-and-collapsible instead of stretching the page forever. */
/** Same idea as makeListCollapsible() but for a plain <div> list (like
 *  the audit log) instead of a <table>. */
function makeDivCollapsible(innerId){
  const inner = document.getElementById(innerId);
  if(!inner || inner.parentElement.classList.contains('list-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'list-wrap';
  wrap.id = innerId + '-wrap';
  inner.parentNode.insertBefore(wrap, inner);
  wrap.appendChild(inner);

  const row = document.createElement('div');
  row.className = 'show-more-row';
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.textContent = 'Show more';
  btn.onclick = ()=> toggleListWrap(wrap.id, btn);
  row.appendChild(btn);
  wrap.parentNode.insertBefore(row, wrap.nextSibling);
}

function setupCollapsibleLists(){
  ['sales-table','products-table','customers-table','orders-table','expenses-table',
   'team-table','tax-sales-table','tax-expenses-table','g-churn-table'].forEach(makeListCollapsible);
}

function toggleListWrap(wrapId, btn){
  const el = document.getElementById(wrapId);
  const expanded = el.classList.toggle('expanded');
  btn.textContent = expanded ? 'Show less' : 'Show more';
}

function toast(msg, duration){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), duration||2400);
}

function fmtN(n){ return '\u20A6' + Math.round(n||0).toLocaleString('en-NG'); }
/** Every table's primary key in Supabase is a uuid, so new rows get a
 *  real UUID from the moment they're created in the browser — the same
 *  id is used for the insert once data.js's sync runs. That's what lets
 *  every add/edit/delete function below keep working completely
 *  unchanged against a real database: they never see the difference. */
function nextId(prefix){ return crypto.randomUUID(); }
function whoAmI(){ return session.name || session.email; }

/* ================= AUDIT ENGINE ================= */
function simpleHash(str){
  let h = 5381;
  for(let i=0;i<str.length;i++){ h = ((h*33) ^ str.charCodeAt(i)) >>> 0; }
  return h.toString(16).padStart(8,'0');
}
function addAuditLog(action, details){
  const prevHash = state.auditLog.length ? state.auditLog[state.auditLog.length-1].hash : '00000000';
  const time = Date.now();
  const payload = JSON.stringify({action, details, time, prevHash});
  const hash = simpleHash(payload);
  state.auditLog.push({ id: nextId('log'), time, action, details, prevHash, hash, user: whoAmI() });
  saveState();
}
function saveState(){ saveBusiness(session.companyId, state); }

/** Called once at the top of every auditor boot (fresh sign-in AND every
 *  page reload, since a revoke has to be re-checked somewhere — there's
 *  no live push in this static build). Both database functions this
 *  calls re-validate the grant fresh (not revoked, not expired) — see
 *  auditor_login()/auditor_fetch_data() in the database — so a revoke
 *  takes effect the moment the auditor's page next loads. Calling
 *  auditor_login() again here (not just at fresh sign-in) is what logs
 *  a visit on every reload, matching this app's original behavior.
 *  Returns null if the grant is gone/revoked/expired — the caller
 *  (bootApp) treats null as "sign this person out now". On success,
 *  `state` is filled in with everything the Command Center needs,
 *  read-only (see the missing `__synced` in data.js's saveBusiness —
 *  that's what makes writes a no-op for this session, not just hidden
 *  buttons). */
async function validateAuditorGrant(){
  const {error: loginError} = await sb.rpc('auditor_login', {
    p_company_code: session.companyCode, p_access_code: session.accessCode
  });
  if(loginError) return null;

  const {data, error} = await sb.rpc('auditor_fetch_data', {
    p_grant_id: session.grantId, p_access_code: session.accessCode
  });
  if(error || !data) return null;

  state = seedEmptyBusiness();
  state.products = data.products.map(SYNC_DEFS.products.fromRow);
  state.sales = data.sales.map(SYNC_DEFS.sales.fromRow);
  state.expenses = data.expenses.map(SYNC_DEFS.expenses.fromRow);
  state.sop = data.sop.map(SYNC_DEFS.sop.fromRow);
  state.auditLog = data.audit_log.map(INSERT_ONLY_DEFS.auditLog.fromRow);
  state.team = data.team.map(t=>({ name:t.name, role:t.role, departments:t.departments||[] }));
  state.findings = (data.findings||[]).map(SYNC_DEFS.findings.fromRow);
  state.materialityThreshold = data.materiality_threshold!=null ? Number(data.materiality_threshold) : 5000;
  // Deliberately no state.__synced here — saveBusiness() treats that as
  // "not a real, writable session" and refuses to sync anything back.
  return { name: session.name, expiresAt: session.expiresAt };
}

function flagExpense(amount, category){
  const sameCategory = state.expenses.filter(e=>e.category===category).map(e=>e.amount);
  const avg = sameCategory.length ? sameCategory.reduce((a,b)=>a+b,0)/sameCategory.length : amount;
  const isRound = amount % 10000 === 0 && amount >= 10000;
  const isOutlier = sameCategory.length >= 3 && amount > avg*3;
  if(isOutlier) return {flag:true, reason:`3x+ above your average ${category} expense (${fmtN(avg)})`};
  if(isRound) return {flag:true, reason:'suspiciously round figure'};
  return {flag:false, reason:null};
}

function rootCauseFor(expense){
  const advice = {
    'Transport': 'Compare delivery routes and fuel receipts; consider bulk fuel purchase or a fixed dispatch-rider rate to cap this cost.',
    'Rent': 'Confirm this matches your lease agreement exactly; check for any double-billing or renegotiate at renewal.',
    'Utilities': 'Check meter readings against the bill and review which appliances run outside business hours.',
    'Restock / supplies': 'Compare this supplier\u2019s price against at least one alternative before the next order; ask for a bulk discount.',
    'Staff': 'Review overtime hours and confirm this matches agreed pay — recurring spikes often mean understaffing at peak hours.',
    'Marketing': 'Check which channel this spend went to and whether it produced trackable orders in your Orders page.',
  };
  return advice[expense.category] || 'Ask for the original receipt and confirm the amount with whoever approved it before closing this out.';
}

/* ---------------- Products ---------------- */
function addProduct(){
  const name = document.getElementById('p-name').value.trim();
  const category = document.getElementById('p-category').value.trim() || 'General';
  const cost = Number(document.getElementById('p-cost').value)||0;
  const price = Number(document.getElementById('p-price').value)||0;
  const stock = Number(document.getElementById('p-stock').value)||0;
  const reorder = Number(document.getElementById('p-reorder').value)||0;
  if(!name){ toast('Enter a product name first'); return; }

  state.products.push({ id: nextId('p'), name, category, cost, price, stock, reorder, updatedBy: whoAmI() });
  addAuditLog('product.create', `Added "${name}" — opening stock ${stock} @ ${fmtN(price)}`);
  ['p-name','p-category'].forEach(id=>document.getElementById(id).value='');
  ['p-cost','p-price','p-stock'].forEach(id=>document.getElementById(id).value=0);
  document.getElementById('p-reorder').value=5;
  populateSelects();
  renderAll();
  toast('Product added');
}

function editProductPrice(id){
  const p = state.products.find(x=>x.id===id);
  if(!p) return;
  const newPrice = prompt(`New selling price for "${p.name}" (currently ${fmtN(p.price)}):`, p.price);
  if(newPrice===null) return;
  const val = Number(newPrice);
  if(isNaN(val) || val<0){ toast('Enter a valid number'); return; }
  const old = p.price;
  p.price = val;
  p.updatedBy = whoAmI();
  addAuditLog('product.price_change', `Changed "${p.name}" price from ${fmtN(old)} to ${fmtN(val)}`);
  renderAll();
  toast('Price updated');
}

function renderProducts(){
  const tbody = document.getElementById('products-table');
  tbody.innerHTML = state.products.map(p=>{
    const margin = p.price>0 ? Math.round((p.price-p.cost)/p.price*100) : 0;
    const low = p.stock <= p.reorder;
    return `<tr>
      <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td><td>${fmtN(p.cost)}</td>
      <td>${fmtN(p.price)} <button class="icon-btn" title="Edit price" aria-label="Edit price for ${escapeHtml(p.name)}" onclick="editProductPrice('${p.id}')"><i class="ti ti-pencil" aria-hidden="true"></i></button></td>
      <td>${margin}%</td><td>${p.stock}</td>
      <td>${low ? '<span class="badge badge-danger">Reorder</span>' : '<span class="badge badge-ok">Healthy</span>'}</td>
      <td class="text-muted">${escapeHtml(p.updatedBy||'—')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="text-muted">No products yet.</td></tr>`;
}

/* ---------------- Customers ---------------- */
function addCustomer(){
  const name = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  if(!name){ toast('Enter a customer name first'); return; }
  state.customers.push({ id: nextId('c'), name, phone, totalSpent:0, balanceDue:0, lastPurchase:null, visits:0, tier:'New' });
  addAuditLog('customer.create', `Added customer "${name}"`);
  document.getElementById('c-name').value=''; document.getElementById('c-phone').value='';
  populateSelects();
  renderAll();
  toast('Customer added');
}

function customerTier(c, now){
  if(!c.lastPurchase) return 'New';
  const days = (now-c.lastPurchase)/86400000;
  if(days>14) return 'AtRisk';
  if(c.totalSpent>=50000) return 'VIP';
  return 'Regular';
}

function renderCustomers(){
  const now = Date.now();
  const counts = {VIP:0, Regular:0, New:0, AtRisk:0};
  const tbody = document.getElementById('customers-table');
  tbody.innerHTML = state.customers.map(c=>{
    const tier = customerTier(c, now);
    counts[tier]++;
    const days = c.lastPurchase ? Math.floor((now-c.lastPurchase)/86400000) : null;
    const tierText = tier==='AtRisk' ? 'At risk' : tier;
    return `<tr>
      <td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phone||'—')}</td>
      <td><span class="tier-badge tier-${tier}">${tierText}</span></td>
      <td>${fmtN(c.totalSpent)}</td>
      <td>${c.balanceDue>0 ? '<span class="badge badge-warn">'+fmtN(c.balanceDue)+'</span>' : '—'}</td>
      <td>${days===null?'—':days+'d ago'}</td>
      <td>${c.visits||0}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="text-muted">No customers yet.</td></tr>`;

  document.getElementById('cu-vip').textContent = counts.VIP;
  document.getElementById('cu-regular').textContent = counts.Regular;
  document.getElementById('cu-new').textContent = counts.New;
  document.getElementById('cu-risk').textContent = counts.AtRisk;
}

/* ---------------- Orders (non-visitors) ---------------- */
function addOrder(){
  const channel = document.getElementById('o-channel').value;
  const customerName = document.getElementById('o-customer').value.trim();
  const items = document.getElementById('o-items').value.trim();
  const total = Number(document.getElementById('o-total').value)||0;
  const notes = document.getElementById('o-notes').value.trim();
  if(!customerName || !items){ toast('Enter customer and items'); return; }

  state.orders.push({ id: nextId('o'), channel, customerName, items, total, status:'Pending', placedAt: Date.now(), notes });
  addAuditLog('order.create', `${channel} order from ${customerName}: ${items} = ${fmtN(total)}`);
  ['o-customer','o-items','o-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('o-total').value=0;
  renderAll();
  toast('Order logged');
}

function updateOrderStatus(id, status){
  const o = state.orders.find(x=>x.id===id);
  if(!o) return;
  o.status = status;
  addAuditLog('order.status_change', `Order from ${o.customerName} moved to ${status}`);
  saveState();
  toast('Order updated');
}

function renderOrders(){
  const tbody = document.getElementById('orders-table');
  const rows = [...state.orders].reverse();
  const statuses = ['Pending','Processing','Delivered','Cancelled'];
  tbody.innerHTML = rows.map(o=>`<tr>
    <td>${new Date(o.placedAt).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})}</td>
    <td>${escapeHtml(o.channel)}</td><td>${escapeHtml(o.customerName)}</td><td>${escapeHtml(o.items)}</td><td>${fmtN(o.total)}</td>
    <td><select onchange="updateOrderStatus('${o.id}',this.value)" style="padding:4px 8px;font-size:12px;">
      ${statuses.map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}
    </select></td>
    <td>${o.notes ? '<span class="text-muted" style="font-size:11px;">'+escapeHtml(o.notes)+'</span>' : ''}</td>
  </tr>`).join('') || `<tr><td colspan="7" class="text-muted">No remote orders logged yet.</td></tr>`;
}

/** Auto-fills the "sold for" field with the catalog list price whenever
 *  the product or quantity changes, so the field always starts at "no
 *  discount" and the user only has to type over it if they're actually
 *  discounting this sale. */
function syncSoldPrice(){
  const product = state.products.find(p=>p.id===document.getElementById('sale-product').value);
  const qty = Number(document.getElementById('sale-qty').value)||1;
  const listTotal = product ? product.price*qty : 0;
  document.getElementById('sale-line-list').value = fmtN(listTotal);
  document.getElementById('sale-line-price').value = listTotal;
  previewLineDiscount();
}

/** Shows "discount: ₦X" or "markup: +₦X" under the price field the
 *  moment the user changes what they're actually selling for — this is
 *  the "discount shows automatically" behaviour, computed live rather
 *  than typed in separately. */
function previewLineDiscount(){
  const product = state.products.find(p=>p.id===document.getElementById('sale-product').value);
  const qty = Number(document.getElementById('sale-qty').value)||1;
  const listTotal = product ? product.price*qty : 0;
  const soldTotal = Number(document.getElementById('sale-line-price').value)||0;
  const diff = listTotal - soldTotal;
  const el = document.getElementById('sale-line-discount-preview');
  if(diff>0) el.innerHTML = `Discount applied: <b style="color:var(--warn)">${fmtN(diff)}</b>`;
  else if(diff<0) el.innerHTML = `Selling above list price: <b style="color:var(--neon)">+${fmtN(-diff)}</b>`;
  else el.textContent = 'No discount — selling at list price.';
}

/* ---------------- Sales (cart-based) ---------------- */
function populateSelects(){
  const ps = document.getElementById('sale-product');
  ps.innerHTML = state.products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${p.stock} in stock)</option>`).join('');
  const cs = document.getElementById('sale-customer');
  cs.innerHTML = '<option value="">Walk-in customer</option>' +
    state.customers.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  populateExpenseCategories();
  syncSoldPrice();
}

function populateExpenseCategories(){
  const sel = document.getElementById('e-category');
  if(!sel) return;
  sel.innerHTML = state.expenseCategories.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
}

function addToCart(){
  const productId = document.getElementById('sale-product').value;
  const qty = Number(document.getElementById('sale-qty').value)||0;
  const soldTotal = Number(document.getElementById('sale-line-price').value)||0;
  const product = state.products.find(p=>p.id===productId);
  if(!product){ toast('Add a product first'); return; }
  if(qty<=0){ toast('Enter a quantity'); return; }
  const alreadyInCart = cart.filter(c=>c.productId===productId).reduce((a,c)=>a+c.qty,0);
  if(qty+alreadyInCart>product.stock){ toast(`Only ${product.stock} in stock`); return; }
  const listTotal = product.price*qty;
  cart.push({
    productId, name: product.name, qty,
    listTotal, soldTotal, discount: Math.max(0, listTotal-soldTotal),
    price: product.price, cost: product.cost,
  });
  document.getElementById('sale-qty').value = 1;
  syncSoldPrice();
  renderCart();
}

function removeFromCart(index){
  cart.splice(index,1);
  renderCart();
}

function cartTotals(){
  const listTotal = cart.reduce((a,c)=>a+c.listTotal,0);
  const soldTotal = cart.reduce((a,c)=>a+c.soldTotal,0);
  const discount = Math.max(0, listTotal-soldTotal);
  const vatRate = state.taxSettings.vatRate;
  const vat = soldTotal*vatRate/100;
  const grand = soldTotal+vat;
  return {listTotal, soldTotal, discount, vat, grand, vatRate};
}

function renderCart(){
  const rowsEl = document.getElementById('cart-rows');
  if(!rowsEl) return;
  rowsEl.innerHTML = cart.map((c,i)=>`
    <div class="cart-row">
      <div>${escapeHtml(c.name)} ${c.discount>0?`<span class="badge badge-warn" style="margin-left:4px;">-${fmtN(c.discount)}</span>`:''}</div>
      <div>${c.qty}</div><div>${fmtN(c.soldTotal)}</div>
      <button class="icon-btn" aria-label="Remove ${escapeHtml(c.name)} from cart" onclick="removeFromCart(${i})"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>`).join('') || `<p class="text-muted" style="font-size:12px;">Cart is empty — add a product above.</p>`;

  const t = cartTotals();
  document.getElementById('cart-summary').innerHTML = cart.length ? `
    <div class="cart-total-row"><span>List price total</span><span>${fmtN(t.listTotal)}</span></div>
    <div class="cart-total-row"><span>Discount given</span><span>-${fmtN(t.discount)}</span></div>
    <div class="cart-total-row"><span>VAT (${t.vatRate}%)</span><span>${fmtN(t.vat)}</span></div>
    <div class="cart-total-row grand"><span>Total due</span><span>${fmtN(t.grand)}</span></div>
  ` : '';
}

function recordSale(){
  if(cart.length===0){ toast('Add at least one product to the cart'); return; }
  const customerId = document.getElementById('sale-customer').value;
  const payment = document.getElementById('sale-payment').value;
  const t = cartTotals();
  const customer = state.customers.find(c=>c.id===customerId);

  cart.forEach(c=>{
    const product = state.products.find(p=>p.id===c.productId);
    if(product) product.stock -= c.qty;
  });

  if(customer){
    customer.totalSpent += t.grand;
    customer.lastPurchase = Date.now();
    customer.visits = (customer.visits||0)+1;
    if(payment==='Credit / on account') customer.balanceDue += t.grand;
  }

  const invoiceNo = 'INV-' + (1000 + state.sales.length + 1);
  const itemsSummary = cart.map(c=>`${c.qty}x ${c.name}`).join(', ');
  state.sales.push({
    id: nextId('s'), invoiceNo, time: Date.now(), items: cart.slice(), itemsSummary,
    subtotal: t.soldTotal, discount: t.discount, vat: t.vat, total: t.grand,
    cost: cart.reduce((a,c)=>a+c.qty*c.cost,0),
    customerId: customerId||null, customerName: customer ? customer.name : 'Walk-in',
    payment, recordedBy: whoAmI()
  });

  addAuditLog('sale.create', `${invoiceNo}: sold ${itemsSummary} for ${fmtN(t.soldTotal)}${t.discount>0?` (${fmtN(t.discount)} discount off list)`:''} (${payment})`);
  cart = [];
  populateSelects();
  renderCart();
  renderAll();
  toast(`Sale recorded — ${invoiceNo}`);
}

function renderSales(){
  const tbody = document.getElementById('sales-table');
  const rows = [...state.sales].reverse().slice(0,25);
  tbody.innerHTML = rows.map(s=>`<tr>
    <td>${s.invoiceNo||'—'}</td>
    <td>${new Date(s.time).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})}</td>
    <td>${escapeHtml(s.itemsSummary||s.productName)}</td>
    <td>${fmtN(s.cost)}</td>
    <td>${fmtN(s.subtotal!==undefined?s.subtotal:s.total)}${s.discount>0?` <span class="badge badge-warn">-${fmtN(s.discount)}</span>`:''}</td>
    <td>${escapeHtml(s.customerName)}</td><td>${escapeHtml(s.payment)}</td><td class="text-muted">${escapeHtml(s.recordedBy||'—')}</td>
  </tr>`).join('') || `<tr><td colspan="8" class="text-muted">No sales recorded yet.</td></tr>`;
  renderCart();
}

/* ---------------- Expenses ---------------- */
function addExpense(){
  let category = document.getElementById('e-category').value;
  const newCategory = document.getElementById('e-new-category').value.trim();
  const amount = Number(document.getElementById('e-amount').value)||0;
  const note = document.getElementById('e-note').value.trim();
  if(amount<=0){ toast('Enter an amount'); return; }

  if(newCategory){
    category = newCategory;
    if(!state.expenseCategories.includes(newCategory)) state.expenseCategories.push(newCategory);
  }

  const {flag, reason} = flagExpense(amount, category);
  state.expenses.push({ id: nextId('e'), time: Date.now(), category, note, amount, flag, reason, loggedBy: whoAmI() });
  addAuditLog('expense.create', `${category} expense of ${fmtN(amount)}${note?': '+note:''}${flag?' — FLAGGED: '+reason:''}`);
  document.getElementById('e-amount').value=0;
  document.getElementById('e-note').value='';
  document.getElementById('e-new-category').value='';
  populateExpenseCategories();
  renderAll();
  toast(flag ? 'Expense logged — flagged for review' : 'Expense logged');
}

function renderExpenses(){
  const tbody = document.getElementById('expenses-table');
  const rows = [...state.expenses].reverse().slice(0,25);
  tbody.innerHTML = rows.map(e=>`<tr>
    <td>${new Date(e.time).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})}</td>
    <td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.note||'—')}</td><td>${fmtN(e.amount)}</td>
    <td class="text-muted">${escapeHtml(e.loggedBy||'—')}</td>
    <td>${e.flag
        ? (e.amount < (state.materialityThreshold||0)
            ? '<span class="badge badge-muted">Flagged (below materiality)</span>'
            : '<span class="badge badge-danger">Flagged</span>')
        : '<span class="badge badge-ok">Clear</span>'}</td>
  </tr>`).join('') || `<tr><td colspan="6" class="text-muted">No expenses logged yet.</td></tr>`;

  const flagged = [...state.expenses].reverse().filter(e=>e.flag).slice(0,5);
  document.getElementById('expense-rootcause').innerHTML = flagged.length ? `
    <div style="margin-top:14px;">
      <div class="card-title" style="font-size:13px;margin-bottom:8px;">Root-cause analysis for flagged expenses</div>
      ${flagged.map(e=>`
        <div class="rootcause">
          <b>${escapeHtml(e.category)} — ${fmtN(e.amount)}</b> (${escapeHtml(e.reason)})<br>
          Suggested fix: ${escapeHtml(rootCauseFor(e))}
        </div>
      `).join('')}
    </div>` : '';
}

/* ================= DASHBOARD ================= */
function todayRange(){ const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }

function computeHealthScore(){
  let score = 100;
  const lowStockCount = state.products.filter(p=>p.stock<=p.reorder).length;
  score -= Math.min(30, lowStockCount*6);
  const openFlags = state.expenses.filter(e=>e.flag).length;
  score -= Math.min(30, openFlags*10);
  if(state.sales.length===0) score -= 10;
  if(!state.sop || state.sop.length===0) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function setDashboardChartType(type){
  state.growth.dashboardChartType = type;
  saveState();
  renderDashboard();
}
function setRevCostChartType(type){
  state.growth.revCostChartType = type;
  saveState();
  renderDashboard();
}

/** A short, dynamic "what to do next" checklist so a brand-new user
 *  understands the app at a glance instead of facing an empty dashboard.
 *  Each step checks itself off against real data and disappears once
 *  every step is done. */
function renderGettingStarted(){
  const el = document.getElementById('getting-started-card');
  if(!el) return;
  const steps = [
    { done: state.products.length>0, label: 'Add your first product', action: ()=>showSection('products') },
    { done: state.sales.length>0, label: 'Record your first sale', action: ()=>showSection('sales') },
    { done: state.team.length>1, label: 'Invite a worker to your team', action: ()=>showSection('team') },
    { done: state.expenses.length>0, label: 'Log a business expense', action: ()=>showSection('expenses') },
  ];
  const remaining = steps.filter(s=>!s.done);
  if(!remaining.length || session.role==='worker'){ el.innerHTML=''; return; }
  el.innerHTML = `
    <div class="card" style="border-color:rgba(57,255,136,0.3);">
      <div class="card-head"><div class="card-title">Getting started (${steps.length-remaining.length}/${steps.length})</div></div>
      ${steps.map((s,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;${s.done?'opacity:0.5;':''}">
          <span style="width:18px;height:18px;border-radius:5px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;${s.done?'background:var(--neon);color:#052312;border-color:var(--neon);':''}">${s.done?'\u2713':''}</span>
          <span style="flex:1;${s.done?'text-decoration:line-through;':''}">${s.label}</span>
          ${!s.done?`<button class="btn btn-sm" data-step="${i}">Go</button>`:''}
        </div>
      `).join('')}
    </div>`;
  // wire up the "Go" buttons after insertion, by step index (safer than
  // stringifying a function reference into the HTML template above)
  el.querySelectorAll('button.btn-sm').forEach(btn=>{
    const step = steps[Number(btn.dataset.step)];
    if(step) btn.onclick = step.action;
  });
}

function renderDashboard(){
  renderGettingStarted();
  const start = todayRange();
  const todaySales = state.sales.filter(s=>s.time>=start);
  const todayExp = state.expenses.filter(e=>e.time>=start);
  const salesTotal = todaySales.reduce((a,s)=>a+s.total,0);
  const cost = todaySales.reduce((a,s)=>a+s.cost,0);
  const expTotal = todayExp.reduce((a,e)=>a+e.amount,0);
  const profit = salesTotal - cost - expTotal;

  animateStatNumber('d-sales', salesTotal, fmtN);
  animateStatNumber('d-profit', profit, fmtN);
  animateStatNumber('d-expenses', expTotal, fmtN);

  const lowStock = state.products.filter(p=>p.stock<=p.reorder).length;
  document.getElementById('d-lowstock').textContent = lowStock;
  document.getElementById('d-lowstock-card').className = 'stat ' + (lowStock>0?'warn':'pos');

  if(typeof mountHealthGauge==='function') mountHealthGauge(computeHealthScore());

  const days = [...Array(7)].map((_,i)=>{
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-(6-i));
    const next = d.getTime()+86400000;
    const daySales = state.sales.filter(s=>s.time>=d.getTime() && s.time<next);
    return {
      label: d.toLocaleDateString('en-NG',{weekday:'short'}),
      total: daySales.reduce((a,s)=>a+s.total,0),
      cost: daySales.reduce((a,s)=>a+s.cost,0),
    };
  });

  // --- Sales trend chart: bar / line / doughnut, switchable ---
  document.querySelectorAll('#d-chart-type .chip-opt').forEach(el=>el.classList.toggle('active', el.dataset.chart===state.growth.dashboardChartType));
  const chartType = state.growth.dashboardChartType || 'bar';
  if(chartType==='doughnut'){
    chiDoughnut('d-chart', { labels: days.map(d=>d.label), values: days.map(d=>d.total), centerLabel: fmtN(days.reduce((a,d)=>a+d.total,0)) });
  } else if(chartType==='line'){
    chiLine('d-chart', { labels: days.map(d=>d.label), series:[{label:'Sales', data: days.map(d=>d.total)}] });
  } else {
    chiBar('d-chart', { labels: days.map(d=>d.label), series:[{label:'Sales', data: days.map(d=>d.total)}] });
  }
  document.getElementById('d-trend-total').textContent = fmtN(days.reduce((a,d)=>a+d.total,0)) + ' this week';

  // --- Revenue vs cost of goods, switchable chart type ---
  document.querySelectorAll('#d-revcost-type .chip-opt').forEach(el=>el.classList.toggle('active', el.dataset.chart===(state.growth.revCostChartType||'bar')));
  const revCostType = state.growth.revCostChartType || 'bar';
  if(revCostType==='doughnut'){
    chiDoughnut('d-revcost-chart', {
      labels: ['Cost of goods','Gross profit'],
      values: [days.reduce((a,d)=>a+d.cost,0), days.reduce((a,d)=>a+Math.max(0,d.total-d.cost),0)],
      colors: [CHIITECH_CHART_COLORS.warn, CHIITECH_CHART_COLORS.neon],
    });
  } else if(revCostType==='line'){
    chiLine('d-revcost-chart', {
      labels: days.map(d=>d.label),
      series: [
        {label:'Cost of goods', data: days.map(d=>d.cost), color: CHIITECH_CHART_COLORS.warn},
        {label:'Revenue', data: days.map(d=>d.total), color: CHIITECH_CHART_COLORS.neon},
      ],
    });
  } else {
    chiBar('d-revcost-chart', {
      labels: days.map(d=>d.label),
      series: [
        {label:'Cost of goods', data: days.map(d=>d.cost), color: CHIITECH_CHART_COLORS.warn},
        {label:'Gross profit', data: days.map(d=>Math.max(0,d.total-d.cost)), color: CHIITECH_CHART_COLORS.neon},
      ],
      stacked: true,
    });
  }

  // --- Sales by payment method, doughnut ---
  const byPayment = {};
  state.sales.forEach(s=>{ byPayment[s.payment] = (byPayment[s.payment]||0) + s.total; });
  const paymentLabels = Object.keys(byPayment);
  chiDoughnut('d-payment-chart', {
    labels: paymentLabels.length?paymentLabels:['No sales yet'],
    values: paymentLabels.length?paymentLabels.map(l=>byPayment[l]):[1],
    centerLabel: paymentLabels.length ? fmtN(Object.values(byPayment).reduce((a,b)=>a+b,0)) : '—',
  });

  const score = computeHealthScore();
  document.getElementById('d-health-score').textContent = score;
  document.getElementById('d-health-ring').style.background =
    `conic-gradient(var(--neon) 0 ${score}%, var(--border) ${score}% 100%)`;
  const openFlags = state.expenses.filter(e=>e.flag).length;
  document.getElementById('d-health-text').innerHTML =
    `<b style="color:var(--text)">${lowStock===0?'Stock levels healthy.':lowStock+' product(s) need reordering.'}</b><br>` +
    `${state.sales.length} sales and ${state.expenses.length} expenses logged to the audit trail.`;
  document.getElementById('d-flag-pill').innerHTML = openFlags>0
    ? `<span class="flag-pill"><span class="flag-dot"></span>${openFlags} expense${openFlags>1?'s':''} flagged for review</span>`
    : '';
}

/* ================= TAX ANALYSIS ================= */
function saveTaxSettings(){
  state.taxSettings.vatRate = Number(document.getElementById('t-vat-rate').value)||0;
  state.taxSettings.whtRate = Number(document.getElementById('t-wht-rate').value)||0;
  state.taxSettings.whtThreshold = Number(document.getElementById('t-wht-threshold').value)||0;
  addAuditLog('tax.settings_change', `VAT ${state.taxSettings.vatRate}%, WHT ${state.taxSettings.whtRate}% above ${fmtN(state.taxSettings.whtThreshold)}`);
  renderAll();
  toast('Tax settings saved');
}

function renderTax(){
  document.getElementById('t-vat-rate').value = state.taxSettings.vatRate;
  document.getElementById('t-wht-rate').value = state.taxSettings.whtRate;
  document.getElementById('t-wht-threshold').value = state.taxSettings.whtThreshold;
  document.getElementById('tax-vat-header').textContent = `VAT (${state.taxSettings.vatRate}%)`;

  const vatTotal = state.sales.reduce((a,s)=>a+(s.vat||0),0);
  const whtExpenses = state.expenses.filter(e=>e.amount>=state.taxSettings.whtThreshold);
  const whtTotal = whtExpenses.reduce((a,e)=>a+e.amount*state.taxSettings.whtRate/100,0);

  document.getElementById('t-vat').textContent = fmtN(vatTotal);
  document.getElementById('t-wht').textContent = fmtN(whtTotal);
  document.getElementById('t-net').textContent = fmtN(vatTotal-whtTotal);

  document.getElementById('tax-sales-table').innerHTML = [...state.sales].reverse().slice(0,15).map(s=>`
    <tr><td>${s.invoiceNo||'—'}</td><td>${new Date(s.time).toLocaleDateString('en-NG')}</td>
    <td>${fmtN(s.total)}</td><td>${fmtN(s.vat||0)}</td></tr>
  `).join('') || `<tr><td colspan="4" class="text-muted">No sales yet.</td></tr>`;

  document.getElementById('tax-expenses-table').innerHTML = whtExpenses.slice(0,15).map(e=>`
    <tr><td>${new Date(e.time).toLocaleDateString('en-NG')}</td><td>${escapeHtml(e.category)}</td>
    <td>${fmtN(e.amount)}</td><td>${fmtN(e.amount*state.taxSettings.whtRate/100)}</td></tr>
  `).join('') || `<tr><td colspan="4" class="text-muted">No expenses above the WHT threshold yet.</td></tr>`;
}

function exportTaxSummary(){
  let csv = 'Type,Reference,Date,Amount,Tax\n';
  state.sales.forEach(s=>{ csv += `VAT,${s.invoiceNo},${new Date(s.time).toISOString()},${s.total},${s.vat||0}\n`; });
  state.expenses.filter(e=>e.amount>=state.taxSettings.whtThreshold).forEach(e=>{
    csv += `WHT,${e.category},${new Date(e.time).toISOString()},${e.amount},${(e.amount*state.taxSettings.whtRate/100).toFixed(2)}\n`;
  });
  downloadFile('chiitech-tax-summary.csv', csv, 'text/csv');
  addAuditLog('tax.export', 'Tax summary exported');
  toast('Tax summary downloaded');
}

function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

/* ================= AUDIT PAGE ================= */
const AUDIT_GLOSSARY = [
  {term:'SOP (Standard Operating Procedure)', def:'A written description of how something in the business is supposed to be done — e.g. how stock is bought, from whom, how often. Auditing checks whether real activity matches this, not just whether the numbers add up.'},
  {term:'Audit trail', def:'A complete, time-stamped record of every action taken in the business — who did what, and when — so nothing can be quietly changed without a trace.'},
  {term:'Hash chain', def:'Each log entry mathematically links to the one before it. Editing an old entry breaks that link, making tampering visible instead of invisible.'},
  {term:'Segregation of duties', def:'No single person should be able to both create a record and be the only one who can review it — reduces the risk of unnoticed errors or fraud.'},
  {term:'Materiality threshold', def:'The size an error or expense needs to reach before it is considered significant enough to flag for review.'},
  {term:"Benford's Law", def:'A statistical pattern that naturally-occurring numbers follow. Genuine transaction amounts follow it; invented or rounded figures often don\u2019t.'},
  {term:'Trial balance', def:"A check that money recorded as coming in and going out is internally consistent, before it's reconciled against a real bank statement."},
  {term:'Audit opinion', def:'A short verdict — Clean, Qualified, or Adverse — summarising how much an auditor (or this system) trusts the records overall.'},
  {term:'Reconciliation', def:'Matching your recorded sales/expenses against an external source (like a bank statement) to confirm they agree.'},
];

/** targetId defaults to the normal Audit page's element; the Auditor
 *  Command Center (a separate, locked-down section — see
 *  renderAuditorCommandCenter()) passes its own id so both pages can
 *  show the same data without sharing DOM ids. */
function renderAuditGlossary(targetId){
  document.getElementById(targetId||'audit-glossary').innerHTML = AUDIT_GLOSSARY.map(g=>`
    <div class="glossary-item"><div class="glossary-term">${g.term}</div>${g.def}</div>
  `).join('');
}

function auditOpinion(score){
  if(score>=85) return {label:'Clean', cls:'pos'};
  if(score>=60) return {label:'Qualified', cls:'warn'};
  return {label:'Adverse', cls:'danger'};
}

function renderTrialBalance(targetId){
  const cashSales = state.sales.filter(s=>s.payment!=='Credit / on account').reduce((a,s)=>a+s.total,0);
  const creditSales = state.sales.filter(s=>s.payment==='Credit / on account').reduce((a,s)=>a+s.total,0);
  const cogs = state.sales.reduce((a,s)=>a+s.cost,0);
  const expenses = state.expenses.reduce((a,e)=>a+e.amount,0);
  const impliedCash = cashSales - expenses;
  document.getElementById(targetId||'trial-balance').innerHTML = `
    <table>
      <tr><td>Cash &amp; transfer sales recorded</td><td style="text-align:right;">${fmtN(cashSales)}</td></tr>
      <tr><td>Credit sales (not yet collected)</td><td style="text-align:right;">${fmtN(creditSales)}</td></tr>
      <tr><td>Cost of goods sold</td><td style="text-align:right;">-${fmtN(cogs)}</td></tr>
      <tr><td>Recorded expenses</td><td style="text-align:right;">-${fmtN(expenses)}</td></tr>
      <tr style="font-weight:700;"><td>Implied cash position</td><td style="text-align:right;">${fmtN(impliedCash)}</td></tr>
    </table>
    <p class="text-muted" style="font-size:11px;margin-top:8px;">
      This is an internal consistency check on your own records, not a substitute for reconciling against a real
      bank statement — connect a bank feed (PRD Phase 2) for full reconciliation.
    </p>`;
}

function renderSoD(tableId, statId){
  const rows = state.team.map(m=>{
    const all = m.departments.includes('all');
    const canRecord = all || m.departments.some(d=>['sales','expenses'].includes(d));
    const canEditPrices = all || m.departments.some(d=>['sales','products'].includes(d));
    const canViewAudit = all || m.departments.includes('audit');
    const risk = all || m.role==='company_admin' ? 'Concentrated' : (canRecord && canViewAudit ? 'Review' : 'Segregated');
    const riskCls = risk==='Concentrated' ? 'badge-warn' : risk==='Review' ? 'badge-danger' : 'badge-ok';
    return `<tr>
      <td>${escapeHtml(m.name)}</td>
      <td>${canRecord?'<i class="ti ti-check" style="color:var(--neon)"></i>':'—'}</td>
      <td>${canEditPrices?'<i class="ti ti-check" style="color:var(--neon)"></i>':'—'}</td>
      <td>${canViewAudit?'<i class="ti ti-check" style="color:var(--neon)"></i>':'—'}</td>
      <td><span class="badge ${riskCls}">${risk}</span></td>
    </tr>`;
  });
  document.getElementById(tableId||'sod-table').innerHTML = rows.join('') || `<tr><td colspan="5" class="text-muted">No team members yet.</td></tr>`;
  document.getElementById(statId||'a-sod').textContent = state.team.length + (state.team.length===1?' user':' users');
}

/* ================= STANDARD OPERATING PROCEDURES (SOPs) ================= */
function addSOP(){
  const area = document.getElementById('sop-area').value;
  const description = document.getElementById('sop-description').value.trim();
  const frequency = document.getElementById('sop-frequency').value;
  const responsible = document.getElementById('sop-responsible').value.trim();
  if(!description){ toast('Describe the procedure first'); return; }
  state.sop.push({ id: nextId('sop'), area, description, frequency, responsible: responsible||whoAmI(), createdAt: Date.now(), lastReviewed: Date.now() });
  addAuditLog('sop.create', `Documented SOP for ${area}: reviewed ${frequency.toLowerCase()}`);
  document.getElementById('sop-description').value = '';
  document.getElementById('sop-responsible').value = '';
  renderAudit();
  toast('Procedure added');
}

function markSOPReviewed(id){
  const s = state.sop.find(x=>x.id===id);
  if(!s) return;
  s.lastReviewed = Date.now();
  addAuditLog('sop.review', `Reviewed SOP for ${s.area}`);
  renderAudit();
  toast('Marked as reviewed today');
}

function deleteSOP(id){
  const s = state.sop.find(x=>x.id===id);
  state.sop = state.sop.filter(x=>x.id!==id);
  if(s) addAuditLog('sop.delete', `Removed SOP for ${s.area}`);
  renderAudit();
}

const SOP_FREQUENCY_DAYS = { Daily:1, Weekly:7, Monthly:30, Quarterly:90 };

/** listId/coverageId let the Auditor Command Center reuse this with its
 *  own elements; readOnly drops the Mark reviewed/Remove buttons for
 *  that read-only, external-facing view. */
function renderSOPs(listId, coverageId, readOnly){
  const now = Date.now();
  document.getElementById(coverageId||'sop-coverage').textContent =
    state.sop.length ? `${state.sop.length} procedure(s) documented` : 'No procedures documented yet';

  document.getElementById(listId||'sop-list').innerHTML = state.sop.map(s=>{
    const dueDays = SOP_FREQUENCY_DAYS[s.frequency]||30;
    const overdue = (now - s.lastReviewed) > dueDays*86400000;
    return `<div class="sop-item">
      <div class="sop-item-head">
        <b>${escapeHtml(s.area)}</b>
        <span class="badge ${overdue?'badge-danger':'badge-ok'}">${overdue?'Review overdue':'Up to date'}</span>
      </div>
      <div class="text-muted" style="font-size:12.5px;margin:4px 0;">${escapeHtml(s.description)}</div>
      <div class="text-muted" style="font-size:11px;">
        Responsible: ${escapeHtml(s.responsible)} • Reviewed ${s.frequency.toLowerCase()} •
        Last reviewed ${new Date(s.lastReviewed).toLocaleDateString('en-NG')}
      </div>
      ${readOnly ? '' : `<div style="margin-top:8px;">
        <button class="btn btn-sm" onclick="markSOPReviewed('${s.id}')">Mark reviewed today</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSOP('${s.id}')" style="margin-left:6px;">Remove</button>
      </div>`}
    </div>`;
  }).join('') || `<p class="text-muted" style="font-size:12.5px;">No procedures documented yet${readOnly ? '.' : ' — add one above so there\'s a written standard to audit against.'}</p>`;
}

function renderAudit(){
  renderAuditGlossary();
  renderSOPs();
  const score = computeHealthScore();
  animateStatNumber('a-confidence', score, v=>Math.round(v)+'%');
  const openFlags = state.expenses.filter(e=>e.flag).length;
  document.getElementById('a-flags').textContent = openFlags;
  document.getElementById('a-flags-card').className = 'stat ' + (openFlags>0?'danger':'pos');

  const opinion = auditOpinion(score);
  document.getElementById('a-opinion').textContent = opinion.label;
  document.getElementById('a-opinion-card').className = 'stat ' + opinion.cls;

  renderTrialBalance();
  renderSoD();
  renderBenfordDistribution('benford-chart');
  renderAuditLogRows('audit-log');

  document.getElementById('materiality-input').value = state.materialityThreshold;
  renderFindings('findings-list', true);
}

/** Shared by the normal Audit page (editable) and the Auditor Command
 *  Center (read-only) — a finding below the materiality threshold is
 *  shown de-emphasized rather than hidden, matching how a real auditor
 *  would still note it, just not treat it as urgent. */
function renderFindings(targetId, editable){
  const el = document.getElementById(targetId);
  if(!el) return;
  const findings = state.findings || [];
  if(!findings.length){ el.innerHTML = `<p class="text-muted" style="font-size:12px;">No findings logged yet.</p>`; return; }
  const sevColor = { low:'badge-muted', medium:'badge-warn', high:'badge-danger' };
  el.innerHTML = findings.map(f=>`
    <div class="log-item" style="align-items:flex-start;">
      <div style="flex:1;">
        <div><b>${escapeHtml(f.title)}</b>
          <span class="badge ${sevColor[f.severity]||'badge-muted'}" style="margin-left:6px;">${escapeHtml(f.severity)}</span>
          <span class="badge ${f.status==='resolved'?'badge-ok':'badge-warn'}" style="margin-left:4px;">${f.status==='resolved'?'Resolved':'Open'}</span>
        </div>
        ${f.description ? `<div class="text-muted" style="font-size:12px;margin-top:3px;">${escapeHtml(f.description)}</div>` : ''}
        <div class="text-muted" style="font-size:11px;margin-top:3px;">
          Raised by ${escapeHtml(f.raisedBy||'—')} on ${new Date(f.createdAt).toLocaleDateString('en-NG')}
          ${f.status==='resolved' ? ` • resolved by ${escapeHtml(f.resolvedBy||'—')} on ${new Date(f.resolvedAt).toLocaleDateString('en-NG')}` : ''}
        </div>
      </div>
      ${editable && f.status!=='resolved' ? `<button class="btn btn-sm" onclick="resolveFinding('${f.id}')">Mark resolved</button>` : ''}
    </div>
  `).join('');
}

function addFinding(){
  const title = document.getElementById('finding-title').value.trim();
  const severity = document.getElementById('finding-severity').value;
  const description = document.getElementById('finding-description').value.trim();
  if(!title){ toast('Give the finding a title'); return; }
  state.findings.unshift({ id: nextId('finding'), title, description, severity, status:'open',
    raisedBy: whoAmI(), createdAt: Date.now(), resolvedAt:null, resolvedBy:null });
  addAuditLog('audit.finding_raised', `Logged a ${severity} finding: ${title}`);
  document.getElementById('finding-title').value = '';
  document.getElementById('finding-description').value = '';
  renderFindings('findings-list', true);
  toast('Finding logged');
}

function resolveFinding(id){
  const f = state.findings.find(x=>x.id===id);
  if(!f) return;
  f.status = 'resolved'; f.resolvedAt = Date.now(); f.resolvedBy = whoAmI();
  addAuditLog('audit.finding_resolved', `Marked finding resolved: ${f.title}`);
  renderFindings('findings-list', true);
}

function saveMaterialityThreshold(){
  const val = Number(document.getElementById('materiality-input').value)||0;
  state.materialityThreshold = val;
  addAuditLog('audit.materiality_set', `Set materiality threshold to ${fmtN(val)}`);
  toast('Materiality threshold saved');
}

/** Shared by the normal Audit page and the Auditor Command Center —
 *  computes the leading-digit distribution from real sales and draws it
 *  into whichever canvas id is passed in. */
function renderBenfordDistribution(canvasId){
  const leading = [0,0,0,0,0,0,0,0,0];
  state.sales.forEach(s=>{
    const digit = Number(String(Math.round(s.total)).replace(/^0+/,'')[0]);
    if(digit>=1 && digit<=9) leading[digit-1] += 1;
  });
  const totalCount = leading.reduce((a,b)=>a+b,0) || 1;
  const observedPct = leading.map(c=>+(c/totalCount*100).toFixed(1));
  const expectedPct = [30.1,17.6,12.5,9.7,7.9,6.7,5.8,5.1,4.6];
  renderBenfordChart(observedPct, expectedPct, canvasId);
}

function renderBenfordChart(observed, expected, canvasId){
  chiBarLineCombo(canvasId||'benford-chart', {
    labels: [1,2,3,4,5,6,7,8,9],
    bar: { label:'Observed %', data: observed },
    line: { label:'Expected %', data: expected },
  });
}

/** Shared by the normal Audit page and the Auditor Command Center. */
function renderAuditLogRows(targetId, limit){
  const rows = [...state.auditLog].reverse().slice(0, limit||30);
  document.getElementById(targetId||'audit-log').innerHTML = rows.map(l=>`
    <div class="log-item">
      <div style="flex:1;">
        <div>${escapeHtml(l.details)} <span class="text-muted">— ${escapeHtml(l.user)}</span></div>
        <div class="log-hash">hash ${l.hash} &larr; ${l.prevHash}</div>
      </div>
      <div class="log-time">${new Date(l.time).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'})}</div>
    </div>
  `).join('') || `<p class="text-muted" style="font-size:12.5px;">No activity logged yet — record a sale or expense to see the trail build.</p>`;
}

/* ================= AUDITOR COMMAND CENTER (read-only, external view) =================
   The exact same underlying audit data as the normal Audit page (glossary,
   trial balance, segregation-of-duties, Benford's Law, SOPs, activity log,
   export), rendered into a separate set of DOM ids so a session with
   role==='auditor' (see loginAuditor() in auth.js) can be shown this and
   nothing else — no write controls, no other section reachable at all
   (enforced in applyAccessControl() in auth.js). */
/** The auditor's choice between reading the sections below themselves
 *  ('manual') or having them read into a plain-language summary
 *  automatically ('ai'). This is purely a display preference for the
 *  person viewing — it lives in sessionStorage on their own browser,
 *  never in the company's shared business data, so choosing a mode is
 *  not a "change" of any kind and is not written to the audit log. */
let auditorAnalysisMode = null;
function getAuditorAnalysisMode(){
  if(auditorAnalysisMode) return auditorAnalysisMode;
  try{ return sessionStorage.getItem('chiitech_auditor_mode') || 'manual'; }
  catch(e){ return 'manual'; }
}
function setAuditorAnalysisMode(mode){
  auditorAnalysisMode = mode;
  try{ sessionStorage.setItem('chiitech_auditor_mode', mode); }catch(e){}
  renderAuditorCommandCenter();
}

/** Builds the same read of the business's numbers an auditor would do
 *  by hand, just written out automatically. Pure summary of data that's
 *  already on the page — computes nothing new, changes nothing. */
function renderAuditorAIAnalysis(score, opinion, openFlags, benfordFlag, overdueSOPs, concentratedCount){
  const lines = [];
  lines.push(opinion.label==='Clean'
    ? `Overall picture looks clean — audit confidence sits at ${score}%, which supports a Clean opinion.`
    : opinion.label==='Qualified'
      ? `Audit confidence is ${score}%, which lands this at a Qualified opinion — solid, but with points below worth a closer look before relying on it fully.`
      : `Audit confidence is only ${score}%, which lands this at an Adverse opinion — the points below should be checked before these records are relied on.`);
  lines.push(openFlags>0
    ? `${openFlags} expense${openFlags===1?' is':'s are'} currently flagged (unusually large or suspiciously round) and still open for review.`
    : `No expenses are currently flagged for review.`);
  lines.push(benfordFlag
    ? `The leading-digit distribution of sale amounts drifts from the natural Benford's Law pattern — worth a look at whether some sale figures were estimated or invented rather than recorded as-sold.`
    : `Sale amounts follow the natural Benford's Law distribution reasonably closely — no sign of invented or rounded figures there.`);
  lines.push(overdueSOPs>0
    ? `${overdueSOPs} documented standard operating procedure${overdueSOPs===1?' is':'s are'} overdue for review against actual practice.`
    : `Documented procedures are all within their review cadence (or none are documented yet to check).`);
  lines.push(concentratedCount>0
    ? `${concentratedCount} team member${concentratedCount===1?' holds':'s hold'} concentrated access (can both record and review) — a segregation-of-duties point to keep an eye on.`
    : `No single team member holds concentrated record-and-review access — duties look reasonably segregated.`);
  document.getElementById('ac-ai-summary').innerHTML = `
    <div class="card-sub" style="margin-bottom:10px;">Auto-generated from this company's live records — nothing below was entered by hand.</div>
    ${lines.map(l=>`<div class="log-item"><div style="flex:1;">${l}</div></div>`).join('')}
  `;
}

function renderAuditorCommandCenter(){
  renderAuditGlossary('ac-audit-glossary');

  const score = computeHealthScore();
  animateStatNumber('ac-confidence', score, v=>Math.round(v)+'%');
  const openFlags = state.expenses.filter(e=>e.flag).length;
  document.getElementById('ac-flags').textContent = openFlags;
  document.getElementById('ac-flags-card').className = 'stat ' + (openFlags>0?'danger':'pos');

  const opinion = auditOpinion(score);
  document.getElementById('ac-opinion').textContent = opinion.label;
  document.getElementById('ac-opinion-card').className = 'stat ' + opinion.cls;

  document.getElementById('ac-materiality').textContent = fmtN(state.materialityThreshold);
  renderFindings('ac-findings-list', false);

  renderTrialBalance('ac-trial-balance');
  renderSoD('ac-sod-table', 'ac-sod');
  renderBenfordDistribution('ac-benford-chart');
  renderSOPs('ac-sop-list', 'ac-sop-coverage', true);
  renderAuditLogRows('ac-audit-log', 30);

  const mode = getAuditorAnalysisMode();
  document.querySelectorAll('#ac-mode-select .chip-opt').forEach(el=>el.classList.toggle('active', el.dataset.mode===mode));
  document.getElementById('ac-ai-panel').classList.toggle('hidden', mode!=='ai');
  if(mode==='ai'){
    const now = Date.now();
    const overdueSOPs = (state.sop||[]).filter(s=>{
      const dueDays = SOP_FREQUENCY_DAYS[s.frequency]||30;
      return (now - s.lastReviewed) > dueDays*86400000;
    }).length;
    const concentratedCount = state.team.filter(m=>m.departments.includes('all') || m.role==='company_admin').length;
    const leading = [0,0,0,0,0,0,0,0,0];
    state.sales.forEach(s=>{
      const digit = Number(String(Math.round(s.total)).replace(/^0+/,'')[0]);
      if(digit>=1 && digit<=9) leading[digit-1] += 1;
    });
    const totalCount = leading.reduce((a,b)=>a+b,0) || 1;
    const observedPct = leading.map(c=>c/totalCount*100);
    const expectedPct = [30.1,17.6,12.5,9.7,7.9,6.7,5.8,5.1,4.6];
    const maxDrift = Math.max(...observedPct.map((v,i)=>Math.abs(v-expectedPct[i])));
    const benfordFlag = state.sales.length>=15 && maxDrift>10;
    renderAuditorAIAnalysis(score, opinion, openFlags, benfordFlag, overdueSOPs, concentratedCount);
  }
}

function exportAuditReport(format){
  if(format==='json'){
    const pkg = { generated_at: new Date().toISOString(), company: currentCompany()?.name,
      business_health_score: computeHealthScore(), products: state.products, sales: state.sales,
      expenses: state.expenses, customers: state.customers, audit_log: state.auditLog };
    downloadFile('chiitech-audit-package.json', JSON.stringify(pkg,null,2), 'application/json');
  } else if(format==='csv'){
    let csv = 'Type,Detail,User,Time,Hash,PrevHash\n';
    state.auditLog.forEach(l=>{ csv += `${l.action},"${l.details.replace(/"/g,'""')}",${l.user},${new Date(l.time).toISOString()},${l.hash},${l.prevHash}\n`; });
    downloadFile('chiitech-audit-log.csv', csv, 'text/csv');
  } else if(format==='html'){
    const score = computeHealthScore();
    const opinion = auditOpinion(score);
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>ChiiTech Audit Report — ${escapeHtml(currentCompany()?.name||'')}</title>
      <style>body{font-family:Arial,sans-serif;padding:32px;color:#111;} h1{color:#12A64C;} table{width:100%;border-collapse:collapse;margin-top:14px;} td,th{border:1px solid #ddd;padding:8px;font-size:13px;text-align:left;}</style>
      </head><body>
      <h1>ChiiTech Audit Report</h1>
      <p><b>Company:</b> ${escapeHtml(currentCompany()?.name||'')} &nbsp; <b>Generated:</b> ${new Date().toLocaleString()}</p>
      <p><b>Audit confidence:</b> ${score}% &nbsp; <b>Opinion:</b> ${opinion.label}</p>
      <h3>Activity log</h3>
      <table><tr><th>Time</th><th>Action</th><th>Detail</th><th>User</th><th>Hash</th></tr>
      ${state.auditLog.map(l=>`<tr><td>${new Date(l.time).toLocaleString()}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.details)}</td><td>${escapeHtml(l.user)}</td><td>${l.hash}</td></tr>`).join('')}
      </table>
      </body></html>`);
    win.document.close();
  }
  addAuditLog('audit.export', `Audit report exported (${format.toUpperCase()})`);
  toast('Export ready');
}

/* ================= GROWTH ENGINE ================= */
function setGrowthMode(mode){
  if(!canAccess('analytics')){ toast('Only admins or workers with Data analysis access can change this'); return; }
  state.growth.mode = mode;
  saveState();
  renderGrowth();
}
function setGrowthChartStyle(style){
  state.growth.chartStyle = style;
  saveState();
  renderGrowth();
}
function saveManualOverrides(){
  state.growth.manualCashflow = Number(document.getElementById('man-cashflow').value)||0;
  state.growth.manualCredit = document.getElementById('man-credit').value;
  addAuditLog('growth.manual_override', `Analyst set cash forecast to ${fmtN(state.growth.manualCashflow)}, credit readiness to ${state.growth.manualCredit}`);
  renderGrowth();
  toast('Analyst overrides saved');
}

function renderGrowth(){
  document.querySelectorAll('#mode-select .chip-opt').forEach(el=>el.classList.toggle('active', el.dataset.mode===state.growth.mode));
  document.querySelectorAll('#g-chart-type .chip-opt').forEach(el=>el.classList.toggle('active', el.dataset.chart===state.growth.chartStyle));
  document.getElementById('manual-panel').classList.toggle('hidden', state.growth.mode!=='manual');
  const modeAllowed = canAccess('analytics');
  document.getElementById('mode-select').style.pointerEvents = modeAllowed ? 'auto' : 'none';
  document.getElementById('mode-select').style.opacity = modeAllowed ? '1' : '0.5';

  const now = Date.now();
  const last7 = state.sales.filter(s=>s.time >= now - 7*86400000);
  const avgDaily = last7.reduce((a,s)=>a+s.total,0) / 7;
  const autoForecast = avgDaily * 30;
  const forecast30 = state.growth.mode==='manual' && state.growth.manualCashflow ? state.growth.manualCashflow : autoForecast;
  animateStatNumber('g-cashflow', forecast30, fmtN);

  const weeks = [1,2,3,4].map(w=>avgDaily*7*(1 + (w-1)*0.03));
  const weekLabels = ['Wk 1','Wk 2','Wk 3','Wk 4'];

  const wrapEl = document.getElementById('g-chart-canvas-wrap');
  const isoEl = document.getElementById('g-iso-chart');
  if(state.growth.chartStyle==='3d'){
    wrapEl.classList.add('hidden'); isoEl.classList.remove('hidden');
    renderIsoBars('g-iso-chart', weekLabels, weeks);
  } else {
    wrapEl.classList.remove('hidden'); isoEl.classList.add('hidden');
    if(state.growth.chartStyle==='doughnut'){
      chiDoughnut('g-chart', { labels: weekLabels, values: weeks, centerLabel: fmtN(weeks.reduce((a,b)=>a+b,0)) });
    } else if(state.growth.chartStyle==='line'){
      chiLine('g-chart', { labels: weekLabels, series:[{label:'Projected cash', data: weeks}] });
    } else {
      chiBar('g-chart', { labels: weekLabels, series:[{label:'Projected cash', data: weeks}] });
    }
  }

  const qtyByProduct = {};
  state.sales.forEach(s=>{ (s.items||[{name:s.productName,qty:s.qty}]).forEach(it=>{
    qtyByProduct[it.name] = (qtyByProduct[it.name]||0) + it.qty;
  })});
  const best = Object.entries(qtyByProduct).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('g-bestseller').textContent = best ? `${best[0]} (${best[1]} sold)` : 'Not enough data yet';

  const score = computeHealthScore();
  const daysActive = new Set(state.sales.map(s=>new Date(s.time).toDateString())).size;
  const autoReadiness = daysActive >= 5 && score >= 70 ? 'Bankable' : daysActive>=2 ? 'Building' : 'Not yet';
  const readiness = state.growth.mode==='manual' && state.growth.manualCredit ? state.growth.manualCredit : autoReadiness;
  document.getElementById('g-credit').textContent = readiness;

  renderGrowthPlaybooks(qtyByProduct, best, now);
  renderChurnTable(now);
  renderProductPerformanceChart();
}

/** Splits time into buckets for the given timeframe, each with a label
 *  and a [start,end) range in epoch ms. Used to bucket sales for the
 *  multi-product performance chart — the same shape of function works
 *  whether the "bucket" is a year or a second. */
function computeTimeframeBuckets(tf){
  const buckets = [];
  const push = (label, start, end) => buckets.push({label, start, end});
  const now = new Date();
  if(tf==='5y'){
    for(let i=4;i>=0;i--){
      const y = new Date(now); y.setFullYear(now.getFullYear()-i, 0, 1); y.setHours(0,0,0,0);
      const yEnd = new Date(y); yEnd.setFullYear(y.getFullYear()+1);
      push(String(y.getFullYear()), y.getTime(), yEnd.getTime());
    }
  } else if(tf==='1y'){
    for(let i=11;i>=0;i--){
      const d = new Date(now); d.setDate(1); d.setMonth(now.getMonth()-i); d.setHours(0,0,0,0);
      const dEnd = new Date(d); dEnd.setMonth(d.getMonth()+1);
      push(d.toLocaleDateString('en-NG',{month:'short'}), d.getTime(), dEnd.getTime());
    }
  } else if(tf==='month'){
    for(let i=29;i>=0;i--){
      const d = new Date(now); d.setHours(0,0,0,0); d.setDate(now.getDate()-i);
      push(String(d.getDate()), d.getTime(), d.getTime()+86400000);
    }
  } else if(tf==='day'){
    for(let i=23;i>=0;i--){
      const d = new Date(now); d.setMinutes(0,0,0); d.setHours(now.getHours()-i);
      push(d.getHours()+':00', d.getTime(), d.getTime()+3600000);
    }
  } else if(tf==='hour'){
    for(let i=59;i>=0;i--){
      const d = new Date(now); d.setSeconds(0,0); d.setMinutes(now.getMinutes()-i);
      push(':'+String(d.getMinutes()).padStart(2,'0'), d.getTime(), d.getTime()+60000);
    }
  } else if(tf==='minute'){
    for(let i=59;i>=0;i--){
      const t = now.getTime()-i*1000;
      push(String(new Date(t).getSeconds()).padStart(2,'0')+'s', t, t+1000);
    }
  } else { // 'week' default
    for(let i=6;i>=0;i--){
      const d = new Date(now); d.setHours(0,0,0,0); d.setDate(now.getDate()-i);
      push(d.toLocaleDateString('en-NG',{weekday:'short'}), d.getTime(), d.getTime()+86400000);
    }
  }
  return buckets;
}

function setProductTimeframe(tf){
  state.growth.productTimeframe = tf;
  saveState();
  renderProductPerformanceChart();
}

/** One line per product (top 6 by units sold, so the chart stays
 *  readable), showing units sold per bucket across whichever timeframe
 *  is selected. */
function renderProductPerformanceChart(){
  const tf = state.growth.productTimeframe || 'week';
  const sel = document.getElementById('g-product-timeframe');
  if(sel) sel.value = tf;
  const buckets = computeTimeframeBuckets(tf);

  const qtyByProduct = {};
  state.sales.forEach(s=>(s.items||[]).forEach(it=>{ qtyByProduct[it.name]=(qtyByProduct[it.name]||0)+it.qty; }));
  let names = Object.entries(qtyByProduct).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0]);
  if(!names.length) names = state.products.slice(0,6).map(p=>p.name);

  const series = names.map(name=>({
    label: name,
    fill: false,
    data: buckets.map(b=> state.sales.reduce((sum,s)=>{
      if(s.time<b.start || s.time>=b.end) return sum;
      const item = (s.items||[]).find(it=>it.name===name);
      return sum + (item ? item.qty : 0);
    },0))
  }));
  chiLine('g-product-chart', { labels: buckets.map(b=>b.label), series });
}

function renderGrowthPlaybooks(qtyByProduct, best, now){
  const sales=[], marketing=[], finance=[], operations=[];
  const lowStock = state.products.filter(p=>p.stock<=p.reorder);
  const worst = Object.entries(qtyByProduct).sort((a,b)=>a[1]-b[1])[0];

  if(best) sales.push(`Bundle your top seller "${escapeHtml(best[0])}" with a slower-moving item to lift average basket size.`);
  if(worst && worst[0]!==best?.[0]) sales.push(`"${escapeHtml(worst[0])}" is your slowest seller — consider a short discount or retiring it.`);
  if(!sales.length) sales.push('Record a few more sales to unlock sales-pillar suggestions.');

  const channels = {};
  state.orders.forEach(o=>{ channels[o.channel] = (channels[o.channel]||0)+1; });
  const topChannel = Object.entries(channels).sort((a,b)=>b[1]-a[1])[0];
  if(topChannel) marketing.push(`Most remote orders come through ${escapeHtml(topChannel[0])} — focus promotions there.`);
  const stale = state.customers.filter(c=>c.lastPurchase && (now-c.lastPurchase)/86400000>14);
  if(stale.length) marketing.push(`${stale.map(c=>escapeHtml(c.name)).join(', ')} haven't bought in 2+ weeks — a personal WhatsApp offer usually wins them back.`);
  if(!marketing.length) marketing.push('Log a few remote orders to unlock marketing-pillar suggestions.');

  const flagged = state.expenses.filter(e=>e.flag);
  if(flagged.length) finance.push(`${flagged.length} expense(s) are flagged — clearing these improves your audit confidence and credit readiness.`);
  const debts = state.customers.filter(c=>c.balanceDue>0);
  if(debts.length) finance.push(`${fmtN(debts.reduce((a,c)=>a+c.balanceDue,0))} is owed by ${debts.length} customer(s) — a same-week reminder recovers debt fastest.`);
  finance.push('Check the Tax page before month-end so VAT/WHT never comes as a surprise.');

  if(lowStock.length) operations.push(`Reorder ${lowStock.map(p=>escapeHtml(p.name)).join(', ')} before you run out and lose sales.`);
  if(state.team.length<=1) operations.push('You\u2019re running this alone — assigning a Sales or Expenses department to a worker frees you up for growth work.');
  if(!operations.length) operations.push('Operations look steady — no urgent restocking needed.');

  const section = (title, items) => `
    <div style="margin-bottom:16px;">
      <div class="card-title" style="font-size:12.5px;color:var(--neon);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">${title}</div>
      ${items.map(i=>`<div class="playbook">${i}</div>`).join('')}
    </div>`;
  document.getElementById('g-playbooks').innerHTML =
    section('Sales', sales) + section('Marketing', marketing) + section('Finance', finance) + section('Operations', operations);
}

function renderChurnTable(now){
  document.getElementById('g-churn-table').innerHTML = state.customers.map(c=>{
    const days = c.lastPurchase ? Math.floor((now-c.lastPurchase)/86400000) : null;
    const tier = customerTier(c, now);
    const risk = tier==='AtRisk' ? 'High' : tier==='New' ? 'New' : days!==null && days>7 ? 'Watch' : 'Low';
    const badge = risk==='High'?'badge-danger':risk==='Watch'?'badge-warn':'badge-ok';
    return `<tr><td>${escapeHtml(c.name)}</td><td>${fmtN(c.totalSpent)}</td><td>${days===null?'—':days}</td>
      <td><span class="badge ${badge}">${risk}</span></td></tr>`;
  }).join('') || `<tr><td colspan="4" class="text-muted">No customers yet.</td></tr>`;
}

/* ================= TEAM & DEPARTMENTS ================= */
/** Workers no longer get their account created by the admin (see
 *  joinAsWorker() in auth.js for why — a company_admin's browser can't
 *  safely create another Supabase Auth account without hijacking its
 *  own session). This just renders the checklist an admin uses to
 *  assign departments to someone who's already joined with the company
 *  code, via the "Edit access" control in renderTeam() below. */
function renderDeptChecklist(containerId, checked){
  const el = document.getElementById(containerId||'dept-checklist');
  if(!el) return;
  const checkedSet = new Set(checked||[]);
  el.innerHTML = DEPARTMENTS.map(d=>`
    <label class="dept-check"><input type="checkbox" value="${d.id}" ${checkedSet.has(d.id)?'checked':''}> <i class="ti ${d.icon}"></i> ${d.label}</label>
  `).join('');
}

/** Toggles the little inline department-editor under a worker's row
 *  open/closed, pre-checking whatever they currently have. */
function toggleDeptEditor(memberId){
  const row = document.getElementById('dept-editor-'+memberId);
  if(!row) return;
  const opening = row.classList.contains('hidden');
  document.querySelectorAll('[id^="dept-editor-"]').forEach(el=>el.classList.add('hidden'));
  if(opening){
    const m = state.team.find(x=>x.id===memberId);
    renderDeptChecklist('dept-checklist-'+memberId, m ? m.departments : []);
    row.classList.remove('hidden');
  }
}

function saveWorkerDepartments(memberId){
  const m = state.team.find(x=>x.id===memberId);
  if(!m) return;
  const departments = Array.from(document.querySelectorAll(`#dept-checklist-${memberId} input:checked`)).map(i=>i.value);
  if(!departments.length){ toast('Tick at least one department'); return; }
  m.departments = departments;
  addAuditLog('team.departments_change', `Set ${m.name}'s access to ${departments.map(deptLabel).join(', ')}`);
  document.getElementById('dept-editor-'+memberId).classList.add('hidden');
  renderTeam();
  toast('Access updated');
}

function toggleWorkerStatus(memberId){
  const m = state.team.find(x=>x.id===memberId);
  if(!m) return;
  m.active = !m.active;
  addAuditLog('team.status_change', `${m.name} ${m.active ? 'reactivated' : 'deactivated'}`);
  renderTeam();
}

function renderTeam(){
  const company = currentCompany();
  document.getElementById('team-code').textContent = company ? company.code : '—';
  document.getElementById('team-table').innerHTML = state.team.map(m=>`
    <tr>
      <td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.email)}</td>
      <td>${m.role==='company_admin'?'Admin':'Worker'}</td>
      <td>${m.departments.includes('all') ? '<span class="dept-badge on">All access</span>'
          : m.departments.length ? m.departments.map(d=>`<span class="dept-badge on">${escapeHtml(deptLabel(d))}</span>`).join('')
          : '<span class="text-muted" style="font-size:11px;">No access assigned yet</span>'}</td>
      <td>${m.active!==false ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-muted">Paused</span>'}</td>
      <td>${m.role!=='company_admin' ? `<button class="btn btn-sm" onclick="toggleDeptEditor('${m.id}')">Edit access</button> <button class="btn btn-sm" onclick="toggleWorkerStatus('${m.id}')" style="margin-left:4px;">${m.active!==false?'Pause':'Reactivate'}</button>` : ''}</td>
    </tr>
    ${m.role!=='company_admin' ? `<tr id="dept-editor-${m.id}" class="hidden"><td colspan="6">
      <div id="dept-checklist-${m.id}" class="dept-checklist"></div>
      <button class="btn btn-sm btn-primary" style="margin-top:8px;" onclick="saveWorkerDepartments('${m.id}')">Save access</button>
    </td></tr>` : ''}
  `).join('');
}

/* ================= AUDITOR ACCESS (admin-side grant management) =================
   Lets a company_admin issue/revoke standing (by default) read-only access for an
   external accountant or auditor. Each grant is company-scoped data
   (state.auditorGrants), not a platform.users account — see loginAuditor()
   in auth.js for how someone signs in with it, and
   renderAuditorCommandCenter() above for what they see once they do. */
async function grantAuditorAccess(){
  const name = document.getElementById('aud-grant-name').value.trim();
  const days = document.getElementById('aud-grant-expiry').value;

  if(!name){ toast('Give this access a label — e.g. the auditor\'s name or firm'); return; }

  const code = genAuditorCode();
  const expiresAt = days==='none' ? null : Date.now() + Number(days)*86400000;
  const grant = { id: nextId('aud'), name, code, createdAt: Date.now(), expiresAt, createdBy: whoAmI(), revoked:false, lastVisit:null };
  state.auditorGrants = state.auditorGrants || [];
  state.auditorGrants.push(grant);
  addAuditLog('auditor.grant_created', `Granted read-only auditor access to "${name}" (code ${code}${expiresAt ? ', expires '+new Date(expiresAt).toLocaleDateString('en-NG') : ', no expiry — can sign in any time'})`);

  document.getElementById('aud-grant-name').value = '';
  renderAuditorAccess();

  const company = currentCompany();
  alert(`Auditor access created for "${name}".\n\nShare BOTH of these with them — they'll need both to sign in:\n\nCompany code: ${company?company.code:'—'}\nAuditor access code: ${code}\n\nThey sign in under "Log in as Auditor" on the ChiiTech login screen. This code is shown here once — you can look it up again on this page any time, or revoke it if it's no longer needed.`);
}

function revokeAuditorGrant(id){
  const g = (state.auditorGrants||[]).find(x=>x.id===id);
  if(!g || g.revoked) return;
  if(!confirm(`Revoke auditor access for "${g.name}"? If they're currently viewing the Auditor Command Center, they'll be signed out the next time the page reloads or they navigate.`)) return;
  g.revoked = true;
  addAuditLog('auditor.grant_revoked', `Revoked auditor access for "${g.name}" (code ${g.code})`);
  renderAuditorAccess();
  toast('Auditor access revoked');
}

function renderAuditorAccess(){
  const company = currentCompany();
  document.getElementById('auditor-company-code').textContent = company ? company.code : '—';
  const now = Date.now();

  document.getElementById('auditor-grants-table').innerHTML = (state.auditorGrants||[]).map(g=>{
    const expired = g.expiresAt && now > g.expiresAt;
    const status = g.revoked ? 'Revoked' : expired ? 'Expired' : 'Active';
    const badgeCls = status==='Active' ? 'badge-ok' : status==='Expired' ? 'badge-muted' : 'badge-danger';
    return `<tr>
      <td>${escapeHtml(g.name)}</td>
      <td><code>${escapeHtml(g.code)}</code></td>
      <td>${new Date(g.createdAt).toLocaleDateString('en-NG')}</td>
      <td>${g.expiresAt ? new Date(g.expiresAt).toLocaleDateString('en-NG') : 'No expiry'}</td>
      <td><span class="badge ${badgeCls}">${status}</span></td>
      <td>${g.lastVisit ? new Date(g.lastVisit).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}) : 'Not yet visited'}</td>
      <td>${!g.revoked ? `<button class="btn btn-sm" onclick="revokeAuditorGrant('${g.id}')">Revoke</button>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="text-muted">No auditor access granted yet.</td></tr>`;

  const visits = [...(state.auditVisitLog||[])];

  // How regularly is the auditor actually checking in? Since access has
  // no time window by default, the useful question for an admin isn't
  // "has it expired" but "are they still looking" — so summarise the
  // last 7 and 30 days rather than just listing timestamps.
  const last7 = visits.filter(v=>v.time >= now - 7*86400000).length;
  const last30 = visits.filter(v=>v.time >= now - 30*86400000).length;
  const daysChecked = new Set(visits.filter(v=>v.time >= now - 30*86400000)
    .map(v=>new Date(v.time).toDateString())).size;
  const freqEl = document.getElementById('auditor-visit-summary');
  if(freqEl){
    freqEl.textContent = visits.length
      ? `${last7} visit${last7===1?'':'s'} in the last 7 days • ${last30} in the last 30, across ${daysChecked} separate day${daysChecked===1?'':'s'}`
      : 'No visits yet';
  }

  document.getElementById('auditor-visits-table').innerHTML = visits.slice(0,30).map(v=>`
    <tr><td>${escapeHtml(v.auditorName)}</td><td>${new Date(v.time).toLocaleString('en-NG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',year:'numeric'})}</td></tr>
  `).join('') || `<tr><td colspan="2" class="text-muted">No auditor visits logged yet.</td></tr>`;
}

/* ================= BILLING & PAYOUTS ================= */
function connectPaystack(){
  state.payoutConfig.paystackConnected = !state.payoutConfig.paystackConnected;
  addAuditLog('billing.paystack', state.payoutConfig.paystackConnected ? 'Paystack marked as connected (demo)' : 'Paystack disconnected');
  renderBilling();
  toast(state.payoutConfig.paystackConnected
    ? 'Marked as connected. Going live needs your real Paystack API keys wired in by a developer.'
    : 'Paystack disconnected.');
}

function saveBankTransfer(){
  const bank = document.getElementById('bill-bank-name').value.trim();
  const acct = document.getElementById('bill-bank-acct').value.trim();
  const holder = document.getElementById('bill-bank-holder').value.trim();
  if(!bank || !acct || !holder){ toast('Fill in bank name, account number and account name'); return; }
  if(!/^\d{10}$/.test(acct)){ toast('Account number should be 10 digits (NUBAN)'); return; }
  state.payoutConfig.bankTransfer = { bank, acct, holder };
  addAuditLog('billing.bank_transfer', `Bank transfer payout details saved (${bank}, acct ending ${acct.slice(-4)})`);
  renderBilling();
  toast('Bank transfer details saved');
}

function renderBilling(){
  const company = currentCompany();
  const price = PLAN_PRICES[company?.plan] || 0;
  document.getElementById('bill-plan-name').textContent = (company?.plan||'Founding') + ' plan';
  document.getElementById('bill-plan-price').textContent =
    (price ? fmtN(price) : '₦0') + '/month' + (company?.plan==='Founding' ? ' • locked in for your first 50–100 businesses' : '');

  const ps = state.payoutConfig.paystackConnected;
  document.getElementById('bill-paystack-status').innerHTML =
    `<span class="dot"></span> ${ps ? 'Connected (demo)' : 'Not connected yet'}`;
  document.getElementById('bill-paystack-status').className = 'payout-status' + (ps ? ' connected' : '');
  document.getElementById('bill-paystack-btn-label').textContent = ps ? 'Disconnect Paystack' : 'Connect Paystack';

  const bt = state.payoutConfig.bankTransfer;
  document.getElementById('bill-bank-status').innerHTML = bt
    ? `<span class="dot"></span> Saved: ${escapeHtml(bt.bank)} •••• ${escapeHtml(bt.acct.slice(-4))}`
    : `<span class="dot"></span> No bank transfer details saved yet`;
  document.getElementById('bill-bank-status').className = 'payout-status' + (bt ? ' connected' : '');
  if(bt){
    document.getElementById('bill-bank-name').value = bt.bank;
    document.getElementById('bill-bank-acct').value = bt.acct;
    document.getElementById('bill-bank-holder').value = bt.holder;
  }

  const rows = state.billingHistory||[];
  document.getElementById('bill-history-table').innerHTML = rows.length ? rows.map(b=>`
    <tr><td>${new Date(b.date).toLocaleDateString('en-NG')}</td><td>${escapeHtml(b.description)}</td>
    <td>${fmtN(b.amount)}</td><td><span class="badge ${b.status==='Paid'?'badge-ok':'badge-warn'}">${escapeHtml(b.status)}</span></td></tr>
  `).join('') : `<tr><td colspan="4" class="text-muted">
    No invoices yet — ChiiTech subscription billing isn't wired up to a real payment run in this build, so
    nothing has actually been charged. Real invoices will appear here once billing goes live.
  </td></tr>`;
}
/** Undoes a self-service company deletion — clears the flag set by
 *  soft_delete_company() (see migration 12) so the company, its admin,
 *  and all its data become visible again exactly as they were. Nothing
 *  was ever actually erased, so this is a full, clean restore. */
async function restoreCompany(companyId){
  if(!confirm('Restore this company? The admin and their whole team will regain access immediately.')) return;
  const {error} = await sb.rpc('restore_company', { p_company_id: companyId });
  if(error){ toast('Could not restore: ' + error.message, 4000); return; }
  toast('Company restored');
  await renderSuperAdmin();
}

async function renderSuperAdmin(){
  const companies = platform.companies;
  let totalWorkers=0, totalSales=0, mrr=0, foundingCount=0;
  const planCounts = {};

  // One query across every company's sales (RLS lets super_admin see all
  // of them) instead of a full loadBusiness() per row — this page only
  // needs each company's sales total, not its whole business bucket.
  const {data: allSales, error} = await sb.from('sales').select('company_id,total');
  if(error) console.error('renderSuperAdmin sales:', error);
  const salesByCompany = {};
  (allSales||[]).forEach(s=>{ salesByCompany[s.company_id] = (salesByCompany[s.company_id]||0) + Number(s.total); });

  const rows = companies.map(c=>{
    const workers = platform.users.filter(u=>u.companyId===c.id);
    totalWorkers += workers.length;
    const salesTotal = salesByCompany[c.id] || 0;
    totalSales += salesTotal;
    mrr += PLAN_PRICES[c.plan] || 0;
    planCounts[c.plan] = (planCounts[c.plan]||0) + 1;
    if(c.plan==='Founding') foundingCount++;
    return `<tr${c.deletedAt ? ' style="opacity:0.55;"' : ''}>
      <td>${escapeHtml(c.name)} ${c.deletedAt ? '<span class="badge badge-muted">Closed</span>' : ''}</td>
      <td>${escapeHtml(c.code)}</td><td>${escapeHtml(c.ownerEmail)}</td><td>${escapeHtml(c.plan)}</td>
      <td>${workers.length}</td><td>${new Date(c.createdAt).toLocaleDateString('en-NG')}</td>
      <td>${c.deletedAt
          ? `<button class="btn btn-sm btn-primary" onclick="restoreCompany('${c.id}')">Restore</button>`
          : `<button class="btn btn-sm" onclick="impersonate('${c.id}')">View as admin</button>`}</td>
    </tr>`;
  });
  document.getElementById('sa-companies').textContent = companies.length;
  document.getElementById('sa-workers').textContent = totalWorkers;
  document.getElementById('sa-sales').textContent = fmtN(totalSales);
  document.getElementById('sa-table').innerHTML = rows.join('') || `<tr><td colspan="7" class="text-muted">No companies yet.</td></tr>`;

  document.getElementById('sa-mrr').textContent = fmtN(mrr);
  document.getElementById('sa-arpc').textContent = fmtN(companies.length ? mrr/companies.length : 0);
  document.getElementById('sa-founding-count').textContent = foundingCount;

  const planLabels = Object.keys(planCounts);
  chiDoughnut('sa-revenue-chart', {
    labels: planLabels.length ? planLabels.map(p=>`${p} (${planCounts[p]})`) : ['No companies yet'],
    values: planLabels.length ? planLabels.map(p=>(PLAN_PRICES[p]||0)*planCounts[p]) : [1],
    centerLabel: fmtN(mrr),
  });
}

/* ================= AI ASSISTANT ================= */
function addMsg(role, text, isHtml){
  const win = document.getElementById('chat-window');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  // User-typed questions are always escaped (plain text only). Assistant
  // replies are allowed a little HTML (for <b> emphasis) because they're
  // built by answerQuestion() from our own template strings, never from
  // raw user input directly.
  div.innerHTML = isHtml ? text : escapeHtml(text);
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

function askAI(preset){
  const input = document.getElementById('ai-input');
  const question = (preset || input.value).trim();
  if(!question) return;
  addMsg('user', question, false);
  input.value = '';
  setTimeout(()=> addMsg('ai', answerQuestion(question), true), 350);
}

function answerQuestion(q){
  const ql = q.toLowerCase();
  const start = todayRange();
  const todaySales = state.sales.filter(s=>s.time>=start).reduce((a,s)=>a+s.total,0);
  const todayExp = state.expenses.filter(e=>e.time>=start).reduce((a,e)=>a+e.amount,0);

  if(ql.includes('restock') || ql.includes('low stock')){
    const low = state.products.filter(p=>p.stock<=p.reorder);
    return low.length ? `You should restock: ${low.map(p=>`<b>${escapeHtml(p.name)}</b> (${p.stock} left)`).join(', ')}.`
                       : 'Nothing urgent — all products are above their reorder level.';
  }
  if(ql.includes('vat') || (ql.includes('tax') && !ql.includes('taxi'))){
    const vatTotal = state.sales.reduce((a,s)=>a+(s.vat||0),0);
    const whtExpenses = state.expenses.filter(e=>e.amount>=state.taxSettings.whtThreshold);
    const whtTotal = whtExpenses.reduce((a,e)=>a+e.amount*state.taxSettings.whtRate/100,0);
    return `You've collected ${fmtN(vatTotal)} in VAT and have an estimated ${fmtN(whtTotal)} in withholding tax on qualifying expenses. See the Tax analysis page for the full breakdown.`;
  }
  if(ql.includes('pending') && ql.includes('order') || (ql.includes('order') && ql.includes('status'))){
    const pending = state.orders.filter(o=>o.status==='Pending' || o.status==='Processing');
    return pending.length ? `${pending.length} order(s) need attention: ${pending.map(o=>`${escapeHtml(o.customerName)} (${escapeHtml(o.channel)}, ${escapeHtml(o.status)})`).join('; ')}.` : 'No pending remote orders right now.';
  }
  if(ql.includes('confidence') || (ql.includes('audit') && ql.includes('score'))){
    const score = computeHealthScore();
    const op = auditOpinion(score);
    return `Audit confidence is ${score}%, which currently reads as a <b>${op.label}</b> opinion — it factors in low-stock count, flagged expenses, and whether sales are being recorded consistently.`;
  }
  if(ql.includes('audit') || ql.includes('ready')){
    const score = computeHealthScore();
    const flags = state.expenses.filter(e=>e.flag).length;
    return `Your audit confidence score is <b>${score}%</b>${flags?` with ${flags} flagged expense(s) to review before you'd call the books clean`:' and no open flags right now'}.`;
  }
  if(ql.includes('owe') || ql.includes('debt')){
    const debts = state.customers.filter(c=>c.balanceDue>0);
    return debts.length ? debts.map(c=>`<b>${escapeHtml(c.name)}</b> owes ${fmtN(c.balanceDue)}`).join('<br>') : 'No customer currently owes you money.';
  }
  if(ql.includes('profit') && ql.includes('fall')){
    const yesterdayStart = start - 86400000;
    const yesterdaySales = state.sales.filter(s=>s.time>=yesterdayStart && s.time<start).reduce((a,s)=>a+s.total,0);
    const diff = todaySales - yesterdaySales;
    return diff>=0
      ? `Sales are actually up ${fmtN(Math.abs(diff))} versus yesterday — profit shouldn't have fallen.`
      : `Today's sales are ${fmtN(Math.abs(diff))} lower than yesterday, which is the main driver if profit dipped. Expenses today total ${fmtN(todayExp)}.`;
  }
  if(ql.includes('doing today') || ql.includes('how is my business')){
    return `Today so far: ${fmtN(todaySales)} in sales and ${fmtN(todayExp)} in expenses. Business health score is ${computeHealthScore()}%.`;
  }
  if(ql.includes('best') || ql.includes('most money')){
    const byRevenue = {};
    state.sales.forEach(s=>{ (s.items||[]).forEach(it=>{ byRevenue[it.name] = (byRevenue[it.name]||0) + it.qty*it.price; }); });
    const best = Object.entries(byRevenue).sort((a,b)=>b[1]-a[1])[0];
    return best ? `<b>${escapeHtml(best[0])}</b> has brought in the most revenue: ${fmtN(best[1])}.` : 'Record a few sales first and I can tell you which product earns the most.';
  }
  if(ql.includes('team') || ql.includes('worker') || ql.includes('staff')){
    return `Your team has ${state.team.length} member(s). Add or manage workers from the Team &amp; departments page.`;
  }
  if(ql.includes('plan') || ql.includes('subscription') || ql.includes('billing')){
    return `You're on the ${currentCompany()?.plan||'Founding'} plan. Manage billing and payouts from the Billing &amp; payouts page.`;
  }
  if(ql.includes('vip') || ql.includes('tier') || (ql.includes('customer') && (ql.includes('best')||ql.includes('top')))){
    const now = Date.now();
    const vip = state.customers.filter(c=>customerTier(c,now)==='VIP');
    return vip.length ? `Your VIP customers: ${vip.map(c=>`<b>${escapeHtml(c.name)}</b> (${fmtN(c.totalSpent)} spent)`).join(', ')}.` : 'No customer has crossed the VIP spending threshold yet — check the Customers page for the full breakdown by tier.';
  }
  if(ql.includes('forecast') || ql.includes('cash flow') || ql.includes('cashflow') || ql.includes('grow')){
    const now = Date.now();
    const avgDaily = state.sales.filter(s=>s.time>=now-7*86400000).reduce((a,s)=>a+s.total,0)/7;
    return `Based on your last 7 days, your 30-day cash forecast is about ${fmtN(avgDaily*30)}. Full forecast, chart options and a growth plan are on the Growth engine page.`;
  }
  if(ql.includes('expense') && !ql.includes('flag')){
    const total = state.expenses.reduce((a,e)=>a+e.amount,0);
    const flagged = state.expenses.filter(e=>e.flag).length;
    return `You've logged ${fmtN(total)} in expenses in total${flagged?`, with ${flagged} flagged for review`:''}. See the Expenses page for the full list and root-cause notes on anything flagged.`;
  }
  if(ql.includes('customer') && (ql.includes('how many')||ql.includes('total'))){
    return `You have ${state.customers.length} customer(s) on record. See the Customers page for their tiers and lifetime value.`;
  }
  if(/^(hi|hello|hey)\b/.test(ql)){
    return `Hello! I can answer questions about sales, stock, customers, orders, tax, or your audit status — try one of the suggestions below, or just ask.`;
  }
  return `I can help with sales, stock, profit, tax, orders, customers, debts, team and audit-readiness questions — try one of the suggestions below, or ask me something specific.`;
}
