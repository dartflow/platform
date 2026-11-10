import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { loadEnv } from './db-shared.mjs';
await loadEnv();
const connectionString = process.env.DARTFLOW_DATABASE_ADMIN_URL;
if (process.env.DARTFLOW_DATA_MODE !== 'local' || !connectionString || !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname) || !process.argv.includes('--confirm-local-reset')) {
  throw new Error('Reset is alleen beschikbaar voor lokale loopbackdata: DARTFLOW_DATA_MODE=local node scripts/db-reset.mjs --confirm-local-reset. Hosted staging kan hiermee niet worden gewist.');
}
const client = new pg.Client({ connectionString });
await client.connect();
try { await client.query('drop schema if exists dartflow_private cascade'); } finally { await client.end(); }
for (const script of ['scripts/db-migrate.mjs', 'scripts/db-seed.mjs']) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Lokale pilotdata gereset.');
