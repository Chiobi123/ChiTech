/**
 * Bump the static asset version in chiitech/index.html.
 *
 *   npm run version:bump
 *
 * css/ and js/ are served with `Cache-Control: immutable` (see chiitech/_headers), so
 * every code change needs a new ?v= tag or browsers keep the old files. The tag looks
 * like 20261022b: today's date plus a letter, incrementing within the same day.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexPath = join(root, 'chiitech', 'index.html');

const now = new Date();
const today =
  String(now.getFullYear()) +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0');

const html = await readFile(indexPath, 'utf8');
const matches = [...html.matchAll(/\?v=([0-9A-Za-z]+)/g)].map((m) => m[1]);

if (!matches.length) {
  console.error('No ?v= asset version found in chiitech/index.html.');
  process.exit(1);
}

const current = matches.sort().at(-1);
let next;

const sameDay = current.match(/^(\d{8})([a-z]+)$/);
if (sameDay && sameDay[1] === today) {
  const letters = sameDay[2];
  const last = letters.charCodeAt(letters.length - 1);
  next = today + String.fromCharCode(last + 1);
} else {
  next = today + 'a';
}

const updated = html.replace(/\?v=[0-9A-Za-z]+/g, `?v=${next}`);
await writeFile(indexPath, updated, 'utf8');

const distinct = new Set(matches);
console.log(`\nAsset version: ${[...distinct].join(', ')} -> ${next}`);
console.log(`Updated ${matches.length} reference(s) in chiitech/index.html.\n`);
console.log('Next: commit, then `npm run deploy`.\n');
