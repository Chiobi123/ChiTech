/**
 * Environment check: can this machine run, deploy and migrate ChiiTech?
 *
 *   npm run doctor
 *
 * Read-only. It never changes credentials or deploys anything.
 */
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const siteDir = join(root, 'chiitech');
const LIVE_URL = 'https://chiitech.pages.dev';

const rows = [];
const pass = (name, detail = '') => rows.push(['PASS', name, detail]);
const warn = (name, detail = '') => rows.push(['WARN', name, detail]);
const fail = (name, detail = '') => rows.push(['FAIL', name, detail]);

function capture(cmd, timeout = 20000) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') || err.message };
  }
}

function firstLine(text) {
  return (text || '').split(/\r?\n/).find((l) => l.trim().length) || '';
}

// --- toolchain -------------------------------------------------------------
const node = capture('node --version');
node.ok ? pass('node', node.out) : fail('node', 'not installed');

const git = capture('git --version');
git.ok ? pass('git', git.out) : fail('git', 'not installed');

const wrangler = capture('wrangler --version');
if (wrangler.ok && /\d/.test(wrangler.out)) {
  pass('wrangler', firstLine(wrangler.out));
} else {
  fail('wrangler CLI', 'run: npm i -g wrangler');
}

const supabase = capture('supabase --version');
if (supabase.ok && /\d/.test(supabase.out)) {
  pass('supabase CLI', firstLine(supabase.out));
} else {
  warn('supabase CLI', 'needed for db:status. Either: npm i -g supabase');
}

for (const [name, cmd, required] of [
  ['python', 'python --version', false],
  ['k6 (load test)', 'k6 version', false],
]) {
  const r = capture(cmd);
  if (r.ok) pass(name, firstLine(r.out));
  else if (required) fail(name, 'not installed');
  else warn(name, 'not installed (optional)');
}

// --- credentials -----------------------------------------------------------
const cf = capture('wrangler whoami', 25000);
if (/not authenticated/i.test(cf.out)) {
  warn('Cloudflare auth', 'run: npm run login:cf  (opens browser)');
} else if (cf.ok) {
  const account = firstLine(cf.out.split(/getting user settings/i)[1] || cf.out);
  pass('Cloudflare auth', account);
} else {
  warn('Cloudflare auth', 'could not determine; run: npm run login:cf');
}

// The Supabase CLI keeps its token per user; no network call needed to detect it.
const sbToken = process.env.SUPABASE_ACCESS_TOKEN;
if (sbToken) pass('Supabase auth', 'SUPABASE_ACCESS_TOKEN is set');
else warn('Supabase auth', 'run: npm run login:supabase  (or set SUPABASE_ACCESS_TOKEN)');

// --- repo / site ------------------------------------------------------------
const remote = capture('git ls-remote --heads origin', 30000);
if (remote.ok && remote.out) pass('git remote', 'origin reachable');
else fail('git remote', 'cannot reach origin');

try {
  const indexHtml = await readFile(join(siteDir, 'index.html'), 'utf8');
  const version = (indexHtml.match(/\?v=([0-9A-Za-z]+)/) || [])[1] || 'none';
  pass('local asset version', version);

  const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(15000) });
  const live = await res.text();
  const liveVersion = (live.match(/\?v=([0-9A-Za-z]+)/) || [])[1] || 'none';
  if (liveVersion === version) pass('deployed asset version', liveVersion + ' (in sync)');
  else warn('deployed asset version', `${liveVersion} live vs ${version} local -> npm run deploy`);
} catch (err) {
  warn('deployed site', `could not check ${LIVE_URL}: ${err.message}`);
}

// --- report ----------------------------------------------------------------
const width = Math.max(...rows.map((r) => r[1].length));
console.log('\nChiiTech doctor\n');
for (const [status, name, detail] of rows) {
  console.log(`${status.padEnd(4)}  ${name.padEnd(width)}  ${detail}`);
}
const problems = rows.filter((r) => r[0] !== 'PASS').length;
console.log(`\n${rows.length - problems}/${rows.length} checks passed.`);
console.log('WARN is usually fine; FAIL blocks the corresponding workflow.\n');
