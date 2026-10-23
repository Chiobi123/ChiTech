/**
 * Deploy the frontend to Cloudflare Pages.
 *
 *   npm run deploy
 *
 * IMPORTANT: `wrangler pages deploy` uploads the directory as-is and IGNORES
 * chiitech/.pagesignore — that file only applies to Pages' own git build.
 * Deploying chiitech/ directly therefore publishes README.md, the Supabase
 * migrations and the load tests. This script builds a whitelisted `dist/`
 * containing only what the browser needs, deploys that, and removes it.
 *
 * Remember to bump the asset version first:  npm run version:bump
 */
import { execSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = join(root, 'chiitech');
const dist = join(root, 'dist');

// Runtime files only. Anything not listed here is internal and stays unpublished.
const RUNTIME = ['index.html', '_headers', 'css', 'js'];

const indexHtml = await readFile(join(site, 'index.html'), 'utf8');
const version = (indexHtml.match(/\?v=([0-9A-Za-z]+)/) || [])[1] || 'none';

if (version === 'none') {
  console.error('No ?v= asset version found in chiitech/index.html. Refusing to deploy.');
  process.exit(1);
}

console.log(`\nChiiTech deploy — asset version ${version}\n`);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of RUNTIME) {
  await cp(join(site, entry), join(dist, entry), { recursive: true });
}

// Refuse to ship anything internal, even if RUNTIME drifts later.
const forbidden = [];
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) await scan(full);
    else if (/\.(md|sql|pdf|zip|toml|ts|json)$/i.test(item.name)) forbidden.push(relative(dist, full));
  }
}
await scan(dist);
if (forbidden.length) {
  console.error('Refusing to deploy: internal files would be published:');
  forbidden.forEach((f) => console.error('  ' + f));
  process.exit(1);
}

try {
  execSync('wrangler pages deploy dist --project-name chiitech', { cwd: root, stdio: 'inherit' });
} catch {
  console.error('\nDeploy failed.');
  console.error('If this is an auth error, run: npm run login:cf\n');
  process.exit(1);
} finally {
  await rm(dist, { recursive: true, force: true });
}

console.log('\nDeployed. Now verify:');
console.log('  1. Open https://chiitech.pages.dev and hard-reload.');
console.log('  2. Confirm the asset version in the network tab is', version + '.');
console.log('  3. Confirm https://chiitech.pages.dev/README.md returns the app shell,');
console.log('     not the markdown file.\n');
