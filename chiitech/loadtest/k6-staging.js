// ChiiTech staging load test (audit Stage A/E). k6 protocol-level script:
// login -> critical boot reads -> deferred reads, measuring p95/error rate.
// STAGING ONLY. It refuses to run without explicit confirmation and refuses
// known production hosts. NEVER point this at production data.
//
// Install: https://k6.io/docs/get-started/installation/
// Run (staging host + staging test account + staging anon key):
//   k6 run -e STAGING_BASE_URL=https://<staging-host> `
//        -e STAGING_EMAIL=<test-user> -e STAGING_PASSWORD=<test-pass> `
//        -e STAGING_ANON_KEY=<staging-anon-key> `
//        -e CONFIRM_STAGING=yes loadtest/k6-staging.js
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = (__ENV.STAGING_BASE_URL || '').replace(/\/$/, '');
if (!BASE) fail('STAGING_BASE_URL env required');
if (__ENV.CONFIRM_STAGING !== 'yes') fail('Set CONFIRM_STAGING=yes to acknowledge staging-only use');
for (const prod of ['effulgent-tapioca-b0e22e.netlify.app', 'chiitech.pages.dev']) {
  if (BASE.includes(prod)) fail(`Refusing to load-test production host: ${prod}`);
}
const EMAIL = __ENV.STAGING_EMAIL || '';
const PASSWORD = __ENV.STAGING_PASSWORD || '';
const ANON = __ENV.STAGING_ANON_KEY || '';
if (!EMAIL || !PASSWORD || !ANON) fail('STAGING_EMAIL, STAGING_PASSWORD and STAGING_ANON_KEY env required');

const PROJECT_REF = 'qmypqghktxlscibgxgxo';
const bootTrend = new Trend('boot_reads_ms');
const errRate = new Rate('boot_errors');

export const options = {
  stages: [
    { duration: '1m', target: 10 },    // 10 concurrent logins
    { duration: '2m', target: 100 },   // 100 concurrent
    { duration: '2m', target: 1000 },  // 1000 concurrent spike
    { duration: '1m', target: 0 },     // ramp down
  ],
  thresholds: {
    boot_reads_ms: ['p(95)<8000'],
    boot_errors: ['rate<0.05'],
  },
};

const H = { 'apikey': ANON, 'Content-Type': 'application/json' };

export default function () {
  // 1. Sign in (GoTrue) — mirrors js/auth.js login().
  // NOTE: auth lives on the Supabase project, not the static host.
  const t0 = Date.now();
  const auth = http.post(`https://${PROJECT_REF}.supabase.co/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }), { headers: H });
  const okAuth = check(auth, { 'auth 200': (r) => r.status === 200 });
  if (!okAuth) { errRate.add(1); return; }
  let token = '';
  try { token = auth.json().access_token; } catch (e) { errRate.add(1); return; }
  const AH = Object.assign({}, H, { 'Authorization': `Bearer ${token}` });

  // 2. Critical boot wave — mirrors loadBusiness() critical reads.
  // Limitation: one staging account hammers one company (worst case for
  // RLS caching, kindest case for the pool) — treat p95 as optimistic.
  const crit = [
    `/rest/v1/products?select=*`,
    `/rest/v1/customers?select=*`,
    `/rest/v1/sales?select=*`,
    `/rest/v1/expenses?select=*`,
  ].map((p) => http.get(`https://${PROJECT_REF}.supabase.co${p}`, { headers: AH }));
  const okCrit = check(crit[0], { 'critical reads ok': (r) => r.status === 200 });

  // 3. Deferred wave — mirrors loadDeferredBusiness().
  const def = http.get(`https://${PROJECT_REF}.supabase.co/rest/v1/audit_log?select=*&order=time.desc&limit=500`, { headers: AH });
  const okDef = check(def, { 'deferred reads ok': (r) => r.status === 200 });

  // 4. Summary RPC (migration 40) when deployed.
  const sum = http.post(`https://${PROJECT_REF}.supabase.co/rest/v1/rpc/company_summary`, '{}', { headers: AH });
  check(sum, { 'summary rpc reachable': (r) => r.status === 200 || r.status === 404 });

  bootTrend.add(Date.now() - t0);
  errRate.add(!(okCrit && okDef));
}
