/* ChiiTech auth layer — now backed by real Supabase Auth. Session details
   the rest of the app needs synchronously are still cached in
   sessionStorage as `session` (same shape as before), rebuilt from a real
   Supabase Auth session + the matching `profiles` row on sign-in. */

/* ============================================================
   CHIITECH AUTH LAYER
   ------------------------------------------------------------
   FOUR ROLES EXIST IN THIS APP:
     - 'super_admin'   → one reserved account (see SUPER_ADMIN_EMAIL in
                          data.js). Sees every company. Gets that role by
                          matching that exact email — see
                          bootstrap_super_admin() in the database and the
                          call to it in loginAdmin() below.
     - 'company_admin' → owns one company. Full access to everything
                          inside it, plus Team & Billing pages.
     - 'worker'         → belongs to one company. Only sees the sections
                          listed in their `departments` array (see
                          DEPARTMENTS in data.js and SECTION_ACCESS
                          below). Joins with a company code via
                          joinAsWorker() below — the admin assigns
                          departments afterward from the Team page (a
                          real signed-in worker's account never has its
                          password touched by anyone but themself; see
                          the note on that in joinAsWorker()).
     - 'auditor'        → an external accountant/auditor given standing,
                          read-only access to ONE company's Auditor
                          Command Center. Not a Supabase Auth user at
                          all, by design — signs in with a company code
                          plus a separate auditor access code, validated
                          fresh by the auditor_login()/auditor_fetch_data()
                          database functions every time (see
                          loginAuditor() and validateAuditorGrant() in
                          app.js). Every sign-in is logged server-side.

   `session` (declared below) holds whoever is currently signed in and is
   what the rest of the app checks before showing UI. It's kept in
   sessionStorage — see js/supabase-config.js, which also points
   Supabase's own token storage at sessionStorage, so both share the
   same "closing the tab signs you out" lifetime.
   ============================================================ */

/** Basic client-side login throttling: after repeated failed attempts
 *  for the same email, force a short cool-down before trying again.
 *  Supabase Auth has its own real server-side rate limiting underneath
 *  this now — this is just an extra, harmless speed bump in the UI. */
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 30000;
function loginAttemptsKey(email){ return 'chiitech_attempts_'+email; }
function checkLoginThrottle(email){
  const raw = sessionStorage.getItem(loginAttemptsKey(email));
  if(!raw) return {blocked:false};
  const data = JSON.parse(raw);
  if(data.count>=LOGIN_ATTEMPT_LIMIT && Date.now()-data.last<LOGIN_LOCKOUT_MS){
    return {blocked:true, waitSec: Math.ceil((LOGIN_LOCKOUT_MS-(Date.now()-data.last))/1000)};
  }
  return {blocked:false};
}
function recordLoginFailure(email){
  const raw = sessionStorage.getItem(loginAttemptsKey(email));
  const data = raw ? JSON.parse(raw) : {count:0, last:0};
  data.count = (Date.now()-data.last>LOGIN_LOCKOUT_MS) ? 1 : data.count+1;
  data.last = Date.now();
  sessionStorage.setItem(loginAttemptsKey(email), JSON.stringify(data));
}
function clearLoginThrottle(email){ sessionStorage.removeItem(loginAttemptsKey(email)); }

let session = null; // { email, role, companyId, name, departments, grantId?, accessCode? }
let platform = null;

function currentCompany(){
  if(!session || !session.companyId) return null;
  return platform.companies.find(c=>c.id===session.companyId) || null;
}

function loadSession(){
  const raw = sessionStorage.getItem('chiitech_session');
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(e){ return null; }
}
function saveSession(s){ sessionStorage.setItem('chiitech_session', JSON.stringify(s)); }
function clearSession(){ sessionStorage.removeItem('chiitech_session'); }

/** Fetches the signed-in Supabase Auth user's own profiles row and
 *  builds it into the same `session` shape the rest of the app expects.
 *  Returns null if there's no matching profile yet (shouldn't normally
 *  happen — register/join flows always create one in the same step as
 *  the auth account — but is handled rather than left to throw). */
async function buildSessionFromProfile(){
  const {data:{user}} = await sb.auth.getUser();
  if(!user) return null;
  const {data:profile, error} = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(error || !profile) return null;
  if(profile.deleted_at) return 'deleted';
  return {
    email: profile.email, role: profile.role, companyId: profile.company_id,
    name: profile.name, departments: profile.departments||[]
  };
}

/* ---------------- Admin: register a new company ---------------- */
async function registerCompany(){
  const companyName = document.getElementById('reg-company').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;

  if(!companyName || !name || !email || !password){
    authError('Fill in every field to register your company.'); return;
  }
  if(password.length < 6){ authError('Password must be at least 6 characters.'); return; }

  const {data, error} = await sb.auth.signUp({ email, password });
  if(error){ authError(error.message); return; }
  if(!data.session){
    authError('Check your email to confirm your account, then sign in.'); return;
  }

  const {data:rpcData, error:rpcError} = await sb.rpc('register_company', {
    p_company_name: companyName, p_admin_name: name
  });
  if(rpcError){ authError(rpcError.message); return; }
  const {company_id, company_code} = rpcData[0];

  session = { email, role:'company_admin', companyId:company_id, name, departments:['all'] };
  saveSession(session);
  await bootApp();
  setTimeout(()=> toast(`Company created! Your company code is ${company_code} — find it any time on the Team page.`, 6000), 400);
}

/* ---------------- Admin sign-in ---------------- */
async function loginAdmin(){
  const email = document.getElementById('login-admin-email').value.trim().toLowerCase();
  const password = document.getElementById('login-admin-pass').value;

  const throttle = checkLoginThrottle(email);
  if(throttle.blocked){ authError(`Too many attempts — try again in ${throttle.waitSec}s.`); return; }

  const {data, error} = await sb.auth.signInWithPassword({ email, password });
  if(error){ recordLoginFailure(email); authError('No account matches that email/password.'); return; }

  if(isSuperAdmin(email)){
    await sb.rpc('ensure_super_admin'); // reserved platform account; password stays in Supabase Auth
  }

  const built = await buildSessionFromProfile();
  if(built==='deleted'){
    await sb.auth.signOut();
    authError('This account has been closed. Contact support if you believe this is a mistake.'); return;
  }
  if(!built || (built.role!=='company_admin' && built.role!=='super_admin')){
    await sb.auth.signOut();
    authError('No admin account matches that email/password.'); return;
  }
  clearLoginThrottle(email);
  session = built;
  saveSession(session);
  await bootApp();
}

/* ---------------- Worker: join a company (self-service, code-based) ----------------
   Replaces the old "admin types in a password for you" flow — with real
   Supabase Auth, an admin's own browser session can't safely create
   another user's account from inside the app (doing so would swap the
   admin's active session for the new user's). So a worker creates their
   own account here with a company code the admin shares, same pattern
   as the auditor access code. The admin assigns departments afterward
   from the Team page. */
async function joinAsWorker(){
  const code = document.getElementById('join-worker-code').value.trim().toUpperCase();
  const name = document.getElementById('join-worker-name').value.trim();
  const email = document.getElementById('join-worker-email').value.trim().toLowerCase();
  const password = document.getElementById('join-worker-pass').value;

  if(!code || !name || !email || !password){ authError('Fill in every field to join.'); return; }
  if(password.length < 6){ authError('Password must be at least 6 characters.'); return; }

  const {data, error} = await sb.auth.signUp({ email, password });
  if(error){ authError(error.message); return; }
  if(!data.session){ authError('Check your email to confirm your account, then sign in.'); return; }

  const {data:rpcData, error:rpcError} = await sb.rpc('join_company_as_worker', {
    p_company_code: code, p_name: name
  });
  if(rpcError){ authError(rpcError.message); return; }

  session = { email, role:'worker', companyId:rpcData[0].company_id, name, departments:[] };
  saveSession(session);
  await bootApp();
  setTimeout(()=> toast(`Welcome to ${rpcData[0].company_name} — your admin will assign your access shortly.`, 6000), 400);
}

/* ---------------- Worker sign-in ---------------- */
async function loginWorker(){
  const code = document.getElementById('login-worker-code').value.trim().toUpperCase();
  const email = document.getElementById('login-worker-email').value.trim().toLowerCase();
  const password = document.getElementById('login-worker-pass').value;

  const throttle = checkLoginThrottle(email);
  if(throttle.blocked){ authError(`Too many attempts — try again in ${throttle.waitSec}s.`); return; }

  const {error} = await sb.auth.signInWithPassword({ email, password });
  if(error){ recordLoginFailure(email); authError('No worker account matches those details.'); return; }

  const built = await buildSessionFromProfile();
  if(built==='deleted'){
    await sb.auth.signOut();
    authError('This account has been closed. Contact your admin if you believe this is a mistake.'); return;
  }
  if(!built || built.role!=='worker'){ await sb.auth.signOut(); authError('No worker account matches those details.'); return; }

  const {data:company} = await sb.from('companies').select('code,name').eq('id', built.companyId).maybeSingle();
  if(!company || company.code!==code){
    await sb.auth.signOut();
    authError('Company code doesn\'t match this account, or the company account has been closed — check with your admin.'); return;
  }

  clearLoginThrottle(email);
  session = built;
  saveSession(session);
  await bootApp();
}

/* ---------------- Auditor sign-in ----------------
   No Supabase Auth account — a company code plus a one-off auditor
   access code a company_admin generates on the "Auditor access" page.
   auditor_login() validates the grant and logs the visit server-side in
   one call; the access code itself is kept in `session` (not shown
   anywhere) so later re-fetches (on reload) can re-validate through
   auditor_fetch_data() the same way — see validateAuditorGrant() in
   app.js. */
async function loginAuditor(){
  const code = document.getElementById('login-auditor-code').value.trim().toUpperCase();
  const accessCode = document.getElementById('login-auditor-access').value.trim().toUpperCase();

  if(!code || !accessCode){ authError('Enter the company code and your auditor access code.'); return; }

  const {data, error} = await sb.rpc('auditor_login', { p_company_code: code, p_access_code: accessCode });
  if(error){ authError(error.message); return; }
  const grant = data[0];

  session = { email:null, role:'auditor', companyId:grant.company_id, companyName:grant.company_name,
    companyCode:code, name:grant.grant_name, departments:[], grantId:grant.grant_id, accessCode,
    expiresAt:grant.expires_at };
  saveSession(session);
  await bootApp();
}

/** Switches which login-screen pane is showing (admin/worker/join/
 *  auditor/forgot). Note: this was referenced by the login screen's
 *  markup everywhere but was never actually defined anywhere in the
 *  app — meaning none of the tabs, the register button, or the forgot-
 *  password links could have worked before now. */
function showAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach(el=>el.classList.toggle('active', el.dataset.tab===tab));
  document.querySelectorAll('.auth-pane').forEach(el=>el.classList.toggle('active', el.id==='auth-'+tab));
  const err = document.getElementById('auth-error');
  if(err) err.classList.add('hidden');
}
function showAuthSub(sub){
  document.querySelectorAll('.auth-subtab').forEach(el=>el.classList.toggle('active', el.dataset.sub===sub));
  document.getElementById('auth-signin').classList.toggle('hidden', sub!=='signin');
  document.getElementById('auth-register').classList.toggle('hidden', sub!=='register');
}

function showAbout(){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('about-screen').classList.remove('hidden');
}
function hideAbout(){
  document.getElementById('about-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function authError(msg){
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/** Self-service "delete my account." Nothing is actually erased from the
 *  database — see soft_delete_company()/soft_delete_my_profile() in the
 *  database, which just flag the row as closed. From this point on:
 *  - the person themself can never see or sign back into it (RLS and
 *    the deleted-account checks in loginAdmin()/loginWorker() above
 *    both enforce that — not just this button being hidden)
 *  - a super_admin can still find and restore it from the Super Admin
 *    console if asked to
 *  A company_admin closes the WHOLE company (everyone in it loses
 *  access, all its data goes with it); a worker only closes their own
 *  individual access — the company and their colleagues are untouched. */
async function deleteMyAccount(){
  if(!session) return;
  const isAdmin = session.role==='company_admin';
  const warning = isAdmin
    ? 'This closes your ENTIRE company account — every worker loses access, and all products, sales, expenses and records become invisible to everyone at your company. Nothing is permanently erased; it can only be restored by the platform admin if you contact them. Continue?'
    : 'This closes your own account. You will no longer be able to sign in, and your access to this company ends. Nothing is permanently erased; it can only be restored by the platform admin if you contact them. Continue?';
  if(!confirm(warning)) return;
  if(!confirm('Are you absolutely sure? This takes effect immediately.')) return;

  const {error} = await sb.rpc(isAdmin ? 'soft_delete_company' : 'soft_delete_my_profile');
  if(error){ alert('Could not close the account: ' + error.message); return; }
  await sb.auth.signOut();
  clearSession();
  window.location.reload();
}

async function logout(){
  clearSession();
  session = null;
  if(sb.auth.getSession){ await sb.auth.signOut(); }
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  showAuthTab('admin');
  showAuthSub('signin');
}

/* ---------------- Legal screen (unchanged) ---------------- */
function showLegal(which){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('legal-screen').classList.remove('hidden');
  document.querySelectorAll('[data-legal]').forEach(el=>el.classList.toggle('active', el.dataset.legal===which));
}
function hideLegal(){
  document.getElementById('legal-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

/** Real self-service password reset, sent by Supabase's own email
 *  service — works the same for an admin or a worker account, since
 *  Supabase Auth doesn't distinguish our app-level roles. Replaces the
 *  old instant, no-email-server workaround now that real email sending
 *  is available. */
async function resetAdminPassword(){
  const email = document.getElementById('forgot-admin-email').value.trim().toLowerCase();
  if(!email){ authError('Enter the email on your account.'); return; }
  const {error} = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if(error){ authError(error.message); return; }
  authError('');
  document.getElementById('auth-error').classList.add('hidden');
  toastOnLogin('If that email has an account, a reset link is on its way — check your inbox.');
}

/** Looks up which company an email belongs to and shows the company
 *  code right on the page, via lookup_company_by_email() — works before
 *  signing in, for anyone (admin or worker) who's forgotten their code. */
async function lookupCompanyCode(){
  const email = document.getElementById('forgot-lookup-email').value.trim().toLowerCase();
  const result = document.getElementById('forgot-lookup-result');
  const {data, error} = await sb.rpc('lookup_company_by_email', { p_email: email });
  if(error || !data || !data.length){
    result.innerHTML = `<p class="auth-error" style="margin-top:10px;">No account found with that email.</p>`; return;
  }
  const {company_name, company_code} = data[0];
  result.innerHTML = `<div class="forgot-result">
    Company: <b>${escapeHtmlSafe(company_name||'—')}</b><br>
    Company code: <b style="color:var(--neon);font-size:16px;letter-spacing:1px;">${escapeHtmlSafe(company_code||'—')}</b><br>
    <span class="text-muted" style="font-size:11px;">Share this code with workers so they can join under "Log in as Worker".</span>
  </div>`;
}

// A tiny local copy of escapeHtml for use before app.js has loaded/on the
// login screen (app.js's escapeHtml is the canonical one used everywhere
// else once the app itself is running).
function escapeHtmlSafe(str){
  const div = document.createElement('div');
  div.textContent = str===undefined || str===null ? '' : String(str);
  return div.innerHTML;
}

function toastOnLogin(msg){
  // Minimal inline confirmation for the login screen (the real #toast
  // element only exists once you're inside the app).
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.background = 'var(--neon-dim)';
  el.style.color = 'var(--neon)';
  el.classList.remove('hidden');
  setTimeout(()=>{ el.classList.add('hidden'); el.style.background=''; el.style.color=''; }, 3500);
}

/* ---------------- Department / role gating ---------------- */
function canAccess(dept){
  if(!session) return false;
  if(session.role==='super_admin' || session.role==='company_admin') return true;
  return session.departments.includes('all') || session.departments.includes(dept);
}

/* Sections and the department each requires. 'admin' means company_admin
   only (super_admin gets its own dedicated console and never sees these).
   'auditor_only' means the reverse of 'admin' — visible ONLY to the
   'auditor' role, since it's the Command Center built specifically for
   that locked-down, read-only session. */
const SECTION_ACCESS = {
  dashboard: null,
  sales: 'sales',
  products: 'products',
  customers: 'customers',
  orders: 'orders',
  expenses: 'expenses',
  tax: 'tax',
  audit: 'audit',
  growth: 'analytics',
  team: 'admin',
  billing: 'admin',
  auditoraccess: 'admin',
  imports: 'admin',
  ai: null,
  auditor: 'auditor_only',
};

function applyAccessControl(){
  document.querySelectorAll('[data-nav]').forEach(el=>{
    const dept = SECTION_ACCESS[el.dataset.nav];
    let allowed;
    if(dept==='auditor_only'){
      allowed = session.role==='auditor';
    } else if(session.role==='auditor'){
      // An auditor session can only ever see its own Command Center —
      // never any of the normal admin/worker sections, regardless of
      // what dept says.
      allowed = false;
    } else if(dept===null || dept==='admin'){
      allowed = dept==='admin' ? (session.role==='company_admin') : true;
    } else {
      allowed = canAccess(dept);
    }
    el.classList.toggle('hidden', !allowed);
  });
  document.querySelectorAll('[data-qa]').forEach(el=>{
    el.classList.toggle('hidden', !canAccess(el.dataset.qa));
  });
}
