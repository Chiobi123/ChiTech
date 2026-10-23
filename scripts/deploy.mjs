/**
 * Deploy the frontend to Cloudflare Pages.
 *
 *   npm run deploy
 *
 * Deploy root is chiitech/; .pagesignore keeps docs, Supabase source and load tests out
 * of the published site. Remember to bump the asset version first:
 *
 *   npm run version:bump
 */
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(join(root, 'chiitech', 'index.html'), 'utf8');
const version = (indexHtml.match(/\?v=([0-9A-Za-z]+)/) || [])[1] || 'none';

console.log(`\nChiiTech deploy — asset version ${version}\n`);

if (version === 'none') {
  console.error('No ?v= asset version found in chiitech/index.html. Refusing to deploy.');
  process.exit(1);
}

try {
  execSync('wrangler pages deploy chiitech --project-name chiitech', {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  console.error('\nDeploy failed.');
  console.error('If this is an auth error, run: npm run login:cf');
  console.error('If it is a permissions error, the Cloudflare account must own the');
  console.error('"chiitech" Pages project.\n');
  process.exit(1);
}

console.log('\nDeployed. Now verify:');
console.log('  1. Open https://chiitech.pages.dev and hard-reload.');
console.log('  2. Confirm the version in the network tab is', version + '.');
console.log('  3. Confirm https://chiitech.pages.dev/README.md returns the app shell,');
console.log('     not the markdown file (that would mean .pagesignore stopped working).\n');
