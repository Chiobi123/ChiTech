/**
 * Compare local migration files with the live Supabase project.
 *
 *   npm run db:status
 *
 * Needs a Supabase login once:  npm run login:supabase
 * or an access token in the environment:  $env:SUPABASE_ACCESS_TOKEN = "..."
 *
 * If the CLI cannot connect, the script prints a read-only SQL query you can paste into
 * the Supabase SQL Editor instead. It never writes to the database.
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'qmypqghktxlscibgxgxo';
const root = fileURLToPath(new URL('..', import.meta.url));
const migrationsDir = join(root, 'chiitech', 'supabase', 'migrations');

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => {
    const m = file.match(/^(\d{14})_(\d+)_(.+)\.sql$/);
    return m ? { file, version: m[1], index: Number(m[2]), name: m[3] } : { file, version: null };
  });

console.log(`\nLocal migrations: ${files.length}`);
console.log(`First: ${files[0]?.file}`);
console.log(`Last:  ${files[files.length - 1]?.file}\n`);

const unnumbered = files.filter((f) => !f.version);
if (unnumbered.length) {
  console.log('WARNING — files not matching YYYYMMDDHHMMSS_NN_name.sql:');
  unnumbered.forEach((f) => console.log('  ' + f.file));
  console.log('');
}

console.log(`Live project: ${PROJECT_REF}\n`);

try {
  execSync(`supabase migration list --project-ref ${PROJECT_REF}`, {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('\nCompare the Local and Remote columns above.');
  console.log('Rows with a Local version and an empty Remote column are NOT applied.\n');
} catch {
  console.log('Could not read the remote migration list (not logged in, offline, or the');
  console.log('CLI needs the database password).\n');
  console.log('Run the Supabase SQL Editor and execute this read-only query:\n');
  console.log('  select version, name');
  console.log('  from supabase_migrations.schema_migrations');
  console.log('  order by version;\n');
  console.log('Then record the count in STATE.md and apply only the missing files,');
  console.log('in filename order. Never `supabase db reset`.\n');
  process.exitCode = 1;
}
