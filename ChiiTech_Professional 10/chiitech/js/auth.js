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
     - 'auditor'        → invited by email, accepts a single-use token with their own Supabase Auth account, approved by the admin. Read-only Command Center (SELECT-only RLS + client write refusal).

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
let myCompany = null; // own company row for company roles (platform_overview is super_admin-only)

async function loadMyCompany(){
  myCompany = null;
  if(!session || !session.companyId) return;
  try {
    const {data, error} = await sb.from('companies').select('id,name,code,plan').eq('id', session.companyId).maybeSingle();
    if(!error && data) myCompany = data;
  } catch(e){}
}

function currentCompany(){
  if(myCompany && (!session || !session.companyId || myCompany.id===session.companyId)) return myCompany;
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

/** Boot-time revalidation (Section 1 fix): never trust the cached session
 *  alone. Compares the stored session against the live Supabase Auth user
 *  + profiles row. Returns {ok:true, session} or {ok:false, reason}.
 *  Clears stale storage whenever the identity changed, signed out, or was
 *  closed — so switching accounts in one browser can never briefly render
 *  the previous account's dashboard. Transient network/DB errors return
 *  reason 'transient' WITHOUT clearing storage, so a refresh during a
 *  network blip never signs a valid user out. */
async function validateStoredSession(){
  const stored = loadSession();
  // Auditors sign in with their own Supabase Auth accounts (invitation
  // model), so they revalidate exactly like every other role below.
  let user = null;
  try {
    const res = await sb.auth.getUser();
    user = res.data.user;
  } catch(e){ return {ok:false, reason:'transient'}; }
  if(!user){ if(stored) clearSession(); return {ok:false, reason:'no-auth-user'}; }
  let profile = null, perr = null;
  try {
    const res = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = res.data; perr = res.error;
  } catch(e){ perr = e; }
  if(perr){ return {ok:false, reason:'transient'}; }
  if(!profile){ clearSession(); return {ok:false, reason:'no-profile'}; }
  if(profile.deleted_at){ clearSession(); return {ok:false, reason:'deleted'}; }
  const fresh = {
    email: profile.email, role: profile.role, companyId: profile.company_id,
    name: profile.name, departments: profile.departments||[],
    active: profile.active !== false
  };
  if((fresh.role==='worker' || fresh.role==='auditor') && fresh.active===false){ clearSession(); return {ok:false, reason:'not-approved', role:fresh.role}; }
  const same = stored
    && String(stored.email||'').trim().toLowerCase()===String(fresh.email||'').trim().toLowerCase()
    && stored.role===fresh.role
    && String(stored.companyId||'')===String(fresh.companyId||'');
  if(!same){
    clearSession();
    if(!stored) return {ok:false, reason:'no-stored-session'};
    return {ok:false, reason:'identity-changed'};
  }
  return {ok:true, session:fresh};
}

/** Fetches the signed-in Supabase Auth user's own profiles row and
 *  builds it into the same `session` shape the rest of the app expects.
 *  Returns null if there's no matching profile yet (shouldn't normally
 *  happen — register/join flows always create one in the same step as
 *  the auth account — but is handled rather than left to throw). */
async function buildSessionFromProfile(){
  let user = null;
  try {
    const res = await sb.auth.getUser();
    user = res && res.data ? res.data.user : null;
  } catch(e){ return null; }
  if(!user) return null;
  const {data:profile, error} = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(error || !profile) return null;
  if(profile.deleted_at) return 'deleted';
  return {
    email: profile.email, role: profile.role, companyId: profile.company_id,
    name: profile.name, departments: profile.departments||[],
    active: profile.active !== false
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
  if(password.length < 8){ authError('Password must be at least 8 characters.'); return; }
  if(!document.getElementById('reg-consent').checked){ authError('Please accept the Terms & Privacy Policy to continue.'); return; }

  const {data, error} = await sb.auth.signUp({ email, password });
  if(error){ authError(error.message); return; }
  if(!data.session){
    authError('Check your email to confirm your account, then sign in.'); return;
  }

  const {data:rpcData, error:rpcError} = await sb.rpc('register_company', {
    p_company_name: companyName, p_admin_name: name
  });
  if(rpcError){ authError(rpcError.message); return; }
  if(!rpcData || !rpcData[0]){ authError('Company record was not created — try signing in, or contact support.'); return; }
  const {company_id, company_code} = rpcData[0];

  session = { email, role:'company_admin', companyId:company_id, name, departments:['all'] };
  clearSession(); saveSession(session);
  await bootApp();
  setTimeout(()=> toast(`Company created! Your company code is ${company_code} — find it any time on the Team page.`, 6000), 400);
}

/* ---------------- Unified sign-in (single front door) ----------------
   Email + password only — no codes, no roles on screen. Supabase
   authenticates; the profiles table (via RLS) decides who this is and
   bootApp routes to the right console. Authorization stays in the
   database, never in a client-side role value. */
async function login(){
  const btn = document.getElementById('login-btn');
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-pass').value;

  const throttle = checkLoginThrottle(email);
  if(throttle.blocked){ authError(`Too many attempts — try again in ${throttle.waitSec}s.`); return; }

  if(btn){ btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
  const {data, error} = await sb.auth.signInWithPassword({ email, password });
  if(error){ recordLoginFailure(email); authError('No account matches that email/password.'); return; }

  if(isSuperAdmin(email)){
    try {
      await sb.rpc('ensure_super_admin'); // reserved platform account; password stays in Supabase Auth
    } catch(e){ authError('Platform check failed — try again.'); return; }
  }

  const built = await buildSessionFromProfile();
  if(built==='deleted'){
    await sb.auth.signOut();
    authError('This account has been closed. Contact support if you believe this is a mistake.'); return;
  }
  if(!built || !['super_admin','company_admin','worker','auditor'].includes(built.role)){
    await sb.auth.signOut();
    authError('No account matches that email/password.'); return;
  }
  if(built.active===false){
    await sb.auth.signOut();
    if(built.role==='company_admin'){ authError('This account is paused. Contact support.'); return; }
    showWaitingRoom(built.role);
    return;
  }
  clearLoginThrottle(email);
  hideOAuthSignup();
  session = built;
  clearSession(); saveSession(session);
  await bootApp();
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Sign in'; }
  }
}

/* Last-resort error surfacing: any uncaught runtime error shows its message
   as a toast so failures are never silent blank screens. */
window.addEventListener('error', (e)=>{
  try { toast('Something went wrong: ' + (e.message || 'unknown error'), 5000); } catch(_){}
});

/* ---------------- Worker: join via invitation token ----------------
   The company code is only an identifier — membership requires a
   single-use, expiring, email-bound invitation (see migration 22).
   The worker creates their own Supabase Auth account, then the token
   links that identity to the company as an inactive worker the admin
   must approve (assign departments + activate). */
async function joinAsWorker(){
  const token = document.getElementById('join-worker-token').value.trim();
  const name = document.getElementById('join-worker-name').value.trim();
  const email = document.getElementById('join-worker-email').value.trim().toLowerCase();
  const password = document.getElementById('join-worker-pass').value;

  if(!token || !name || !email || !password){ authError('Fill in every field, including your invitation token.'); return; }
  if(password.length < 8){ authError('Password must be at least 8 characters.'); return; }

  // Already signed in (e.g. via Google): skip account creation and accept
  // the invitation directly with this identity.
  const {data:{user:existing}} = await sb.auth.getUser();
  if(!existing){
    const {data, error} = await sb.auth.signUp({ email, password });
    if(error){ authError(error.message); return; }
    if(!data.session){ authError('Check your email to confirm your account, then sign in and accept the invitation.'); return; }
  }

  // One token field serves both invitation kinds: worker tokens first,
  // then auditor tokens. The database decides which (and rejects both).
  let rpcData = null, rpcError = null, kind = 'worker';
  ({data:rpcData, error:rpcError} = await sb.rpc('accept_invitation', { p_token: token }));
  if(rpcError){
    ({data:rpcData, error:rpcError} = await sb.rpc('accept_auditor_invite', { p_token: token }));
    kind = 'auditor';
  }
  if(rpcError){ await sb.auth.signOut(); authError(rpcError.message); return; }

  const built = await buildSessionFromProfile();
  if(!built || (kind==='worker' ? built.role!=='worker' : built.role!=='auditor')){ await sb.auth.signOut(); authError('Invitation accepted but the profile could not be loaded. Ask your admin.'); return; }
  session = built;
  clearSession(); saveSession(session);
  await bootApp();
  setTimeout(()=> toast(kind==='auditor'
    ? 'Auditor invitation accepted — your admin will approve you shortly, then sign in on the main screen.'
    : 'Invitation accepted — your admin will assign your access and approve you shortly.', 6000), 400);
}

/* ---------------- Google sign-in (optional OAuth method) ----------------
   Uses Supabase Auth OAuth — no Google secrets in this file. Google users
   NEVER auto-receive privileges: after redirect, an identity with no
   profiles row lands on the unlinked-account notice, never a dashboard. */
async function loginWithGoogle(){
  const {error} = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if(error) authError(error.message);
}

/** Shown when a signed-in OAuth identity has no ChiiTech profile:
 *  no dashboard, no role — onboarding form plus guidance. */
function showUnlinkedNotice(email){
  clearSession(); session = null; myCompany = null;
  try{ document.getElementById('app').classList.add('hidden'); }catch(e){}
  try{ document.getElementById('login-screen').classList.remove('hidden'); }catch(e){}
  try{
    document.getElementById('oauth-email').textContent = email;
    document.getElementById('oauth-signup').classList.remove('hidden');
  }catch(e){}
  authError(`Signed in with Google as ${email}, but that address isn't linked to any company yet. Register your company above, or ask your admin for a worker invitation and accept it below. Your existing email/password login still works.`);
}

/** Waiting room: invite accepted but admin hasn't approved yet. The login
 *  screen stays, showing where to return — no dashboard, no data. */
function showWaitingRoom(who){
  clearSession(); session = null;
  try{ document.getElementById('app').classList.add('hidden'); }catch(e){}
  try{ document.getElementById('login-screen').classList.remove('hidden'); }catch(e){}
  try{
    document.getElementById('waiting-text').textContent =
      `Your ${who||'worker'} account is created. Ask your company admin to assign your access and approve you, then sign in again on this screen.`;
  }catch(e){}
  showAuthView('waiting');
}

function hideOAuthSignup(){ try{ document.getElementById('oauth-signup').classList.add('hidden'); }catch(e){} }

/** Google sign-up for owners: creates the company under the current OAuth
 *  identity (no password involved) and signs them in as company_admin. */
async function registerCompanyWithOAuth(){
  const companyName = document.getElementById('oauth-company').value.trim();
  const name = document.getElementById('oauth-name').value.trim();
  if(!companyName || !name){ authError('Enter your company name and your name.'); return; }
  const {data:{user}} = await sb.auth.getUser();
  if(user && isSuperAdmin(user.email)){ authError('That address is reserved — sign in normally instead.'); return; }
  const {data:rpcData, error:rpcError} = await sb.rpc('register_company', {
    p_company_name: companyName, p_admin_name: name
  });
  if(rpcError){ authError(rpcError.message); return; }
  const built = await buildSessionFromProfile();
  if(!built){ authError('Company created but profile lookup failed — sign in again.'); return; }
  clearSession(); session = built; saveSession(session);
  hideOAuthSignup();
  await bootApp();
  setTimeout(()=> toast(`Company created! Your company code is ${rpcData[0].company_code}.`, 6000), 400);
}

/** Google login for already-linked accounts: role comes from the profiles
 *  table only — OAuth never grants a role by itself. */
async function finishOAuthLogin(){
  const {data:{user}} = await sb.auth.getUser();
  if(!user){ clearSession(); return; }
  const built = await buildSessionFromProfile();
  if(built === 'deleted'){ await sb.auth.signOut(); hideOAuthSignup(); authError('This account has been closed.'); return; }
  if(!built){ showUnlinkedNotice(user.email || 'unknown address'); return; }
  if(built.active===false){ await sb.auth.signOut(); hideOAuthSignup(); authError('Your account is waiting for your admin to approve it. Ask them to assign your access first.'); return; }
  clearSession(); session = built; saveSession(session);
  hideOAuthSignup();
  await bootApp();
}

/* ---------------- Worker sign-in (dedicated screen) ----------------
   Email + password only. The profile's company binding (via RLS) is
   authoritative — no company code needed at sign-in. */
async function loginAsWorker(){
  const email = document.getElementById('login-worker-email').value.trim().toLowerCase();
  const password = document.getElementById('login-worker-pass').value;
  const throttle = checkLoginThrottle(email);
  if(throttle.blocked){ authError(`Too many attempts — try again in ${throttle.waitSec}s.`); return; }
  const {error} = await sb.auth.signInWithPassword({ email, password });
  if(error){ recordLoginFailure(email); authError('No worker account matches that email/password.'); return; }
  const built = await buildSessionFromProfile();
  if(built==='deleted'){ await sb.auth.signOut(); authError('This account has been closed.'); return; }
  if(!built || built.role!=='worker'){ await sb.auth.signOut(); authError('That account is not a worker account — use the main sign in.'); return; }
  if(built.active===false){ await sb.auth.signOut(); showWaitingRoom('worker'); return; }
  clearLoginThrottle(email);
  hideOAuthSignup();
  session = built;
  clearSession(); saveSession(session);
  await bootApp();
}

/* ---------------- Auditor sign-in ----------------
   Two separate doors, never mixed:
   - loginAuditorReturning: approved auditors, email + password + code.
   - acceptAuditorInvite: first visit with company code + name + invited
     email + token + new password. Invitation tokens are single-use and
     email-bound in the database, so a used token cleanly reports
     "no longer valid" instead of the confusing "account exists". */
async function loginAuditorReturning(){
  const code = (document.getElementById('login-auditor-code').value||'').replace(/\s+/g,'').toUpperCase();
  const email = document.getElementById('login-auditor-email').value.trim().toLowerCase();
  const password = document.getElementById('login-auditor-pass').value;
  if(!code || !email || !password){ authError('Enter your company code, email and password.'); return; }
  const {error} = await sb.auth.signInWithPassword({ email, password });
  if(error){ authError('No auditor account matches those details. First visit? Use “First visit — accept invitation” above.'); return; }
  await finishAuditorSignIn(code);
}

async function acceptAuditorInvite(){
  const code = (document.getElementById('accept-auditor-code').value||'').replace(/\s+/g,'').toUpperCase();
  const name = document.getElementById('accept-auditor-name').value.trim();
  const email = document.getElementById('accept-auditor-email').value.trim().toLowerCase();
  const token = (document.getElementById('accept-auditor-token').value||'').trim();
  const password = document.getElementById('accept-auditor-pass').value;
  if(!code || !name || !email || !token || !password){ authError('Fill in every field, including your invitation token.'); return; }
  if(password.length < 8){ authError('Password must be at least 8 characters.'); return; }
  const {data:{user:existing}} = await sb.auth.getUser();
  if(!existing){
    const {data, error} = await sb.auth.signUp({ email, password });
    if(error){
      if(/already|exists|registered/i.test(error.message)){
        authError('That email already has an account — use “Sign in” above instead (no token needed).');
      } else authError(error.message);
      return;
    }
    if(!data.session){ authError('Check your email to confirm your account, then accept again.'); return; }
  }
  const {error:rpcError} = await sb.rpc('accept_auditor_invite', { p_token: token });
  if(rpcError){
    if(/no longer valid|expired/i.test(rpcError.message||'')){
      await sb.auth.signOut();
      authError('That invitation was already used or expired — ask your admin for a fresh one, then sign in normally.');
    } else { await sb.auth.signOut(); authError(rpcError.message); }
    return;
  }
  await finishAuditorSignIn(code, true);
}

/** Shared tail: build the auditor session, verify the company code against
 *  the auditor's own company, enforce approval, boot the Command Center. */
async function finishAuditorSignIn(code, firstVisit){
  const built = await buildSessionFromProfile();
  if(!built || built==='deleted' || built.role!=='auditor'){ await sb.auth.signOut(); authError('That account is not an auditor account.'); return; }
  clearSession(); session = built; saveSession(session);
  await loadMyCompany();
  const mine = currentCompany();
  if(!mine || (mine.code||'').toUpperCase()!==code){
    await sb.auth.signOut(); clearSession(); session = null;
    authError('That company code does not match this auditor account — check it with your admin.'); return;
  }
  if(built.active===false){ await sb.auth.signOut(); clearSession(); session = null; showWaitingRoom('auditor'); return; }
  await bootApp();
  if(firstVisit) setTimeout(()=> toast('Invitation accepted — welcome to your read-only Command Center.', 5000), 400);
}

function showAuditorSub(which){
  document.querySelectorAll('#auth-view-auditor .auth-subtab').forEach(el=>el.classList.toggle('active', el.dataset.sub===(which==='accept'?'aud-accept':'aud-signin')));
  document.getElementById('aud-signin').classList.toggle('hidden', which!=='signin');
  document.getElementById('aud-accept').classList.toggle('hidden', which!=='accept');
}

/* Legacy alias (retired grant-code flow called this). */
async function loginAuditor(){
  return showAuditorSub('signin'), loginAuditorReturning();
}

/** Switches which login-screen view is showing
 *  (signin/register/invite/auditor/forgot). Single simple front door —
 *  roles, codes and setup live behind it, never on it. */
function showAuthView(view){
  document.querySelectorAll('.auth-pane').forEach(el=>el.classList.toggle('active', el.id==='auth-view-'+view));
  const err = document.getElementById('auth-error');
  if(err) err.classList.add('hidden');
}
// Legacy aliases (old markup called these; kept so nothing breaks).
function showAuthTab(tab){
  showAuthView({admin:'signin', worker:'signin', join:'invite', auditor:'auditor', forgot:'forgot'}[tab] || 'signin');
}
function showAuthSub(sub){
  showAuthView(sub === 'register' ? 'register' : 'signin');
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
  myCompany = null;
  hideOAuthSignup();
  veilOff();
  // UI first so sign-out feels instant; the server sign-out finishes behind.
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  showAuthView('signin');
  try{ if(sb.auth.getSession){ await sb.auth.signOut(); } }catch(e){}
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

/* ---------------- Department / role gating ----------------
   (Retired 2026-10: the Free/Pro tier gate. Every feature is open to every
   paying company now; only subscription STATUS gates via billingLocked()
   below. Role checks stay the authority for who sees what.) */

/* ---------------- Pay-to-use gate ----------------
   Every feature is open to every paying company. Only the subscription
   STATUS can lock a company out (past_due/cancelled → Billing only).
   Trials and active subscriptions pass. Super_admin is exempt. */
function billingLocked(){
  if(!session || session.role==='super_admin' || session.role==='auditor') return false;
  if(typeof state==='undefined' || !state || !state.subscription) return false;
  const s = state.subscription.status;
  return s==='past_due' || s==='cancelled';
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
    // Paywall: locked companies navigate Billing only.
    if(allowed && billingLocked() && el.dataset.nav!=='billing') allowed = false;
    el.classList.toggle('hidden', !allowed);
  });
  document.querySelectorAll('[data-qa]').forEach(el=>{
    el.classList.toggle('hidden', !canAccess(el.dataset.qa));
  });
}
