import { access, chmod, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { loadEnv } from './db-shared.mjs';
await loadEnv();
const runtime = path.resolve(process.env.DARTFLOW_LOCAL_PG_ROOT || '.local/postgres');
const port = Number(process.env.DARTFLOW_LOCAL_PG_PORT || 55432);
const exists = async p => access(p).then(() => true, () => false);
const run = (bin, args, cwd) => { const result = spawnSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); if (result.status !== 0) throw new Error(`${path.basename(bin)}: ${result.stderr || result.stdout || result.error}`); return result.stdout; };
await mkdir(runtime, { recursive: true, mode: 0o700 });
let bin = process.env.DARTFLOW_PG_BIN || '/usr/lib/postgresql/16/bin';
if (!await exists(path.join(bin, 'initdb'))) {
  bin = path.join(runtime, 'package/usr/lib/postgresql/16/bin');
  if (!await exists(path.join(bin, 'initdb'))) {
    if (process.env.DARTFLOW_DOWNLOAD_LOCAL_POSTGRES !== '1') throw new Error('Postgres 16 server ontbreekt. Installeer postgresql-16 of stel DARTFLOW_PG_BIN in. Optioneel: DARTFLOW_DOWNLOAD_LOCAL_POSTGRES=1 npm run db:start downloadt het Ubuntu-pakket zonder root.');
    console.log('Download en pak het Postgres 16-serverpakket uit voor lokale loopback-staging.');
    run('apt-get', ['download', 'postgresql-16'], runtime);
    const { readdir } = await import('node:fs/promises');
    const deb = (await readdir(runtime)).find(name => /^postgresql-16_.*\.deb$/.test(name));
    if (!deb) throw new Error('Postgres serverpakket niet gevonden.');
    run('dpkg-deb', ['-x', path.join(runtime, deb), path.join(runtime, 'package')]);
    await rm(path.join(runtime, deb));
  }
}
const data = path.join(runtime, 'data');
if (process.argv[2] === 'stop') {
  if (await exists(path.join(data, 'postmaster.pid'))) run(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log('Lokale Postgres gestopt.');
  process.exit(0);
}
const credentialsPath = path.join(runtime, 'credentials.json');
let credentials;
if (await exists(credentialsPath)) credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
else { credentials = { owner: randomBytes(24).toString('hex'), app: randomBytes(24).toString('hex') }; await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 }); }
if (!await exists(path.join(data, 'PG_VERSION'))) {
  const passwordPath = path.join(runtime, 'init-password');
  await writeFile(passwordPath, credentials.owner, { mode: 0o600 });
  const args = ['-D', data, '-U', 'dartflow_owner', '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile', passwordPath, '--encoding=UTF8', '--locale=C'];
  const share = path.join(runtime, 'package/usr/share/postgresql/16');
  if (await exists(share)) args.push('-L', share);
  try { run(path.join(bin, 'initdb'), args); } finally { await rm(passwordPath); }
}
if (!await exists(path.join(data, 'postmaster.pid'))) run(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(runtime, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${runtime}`, '-w', 'start']);
let env = await readFile('.env.local', 'utf8').catch(() => '');
const values = {
  DARTFLOW_LOCAL_PG_ROOT: runtime,
  DARTFLOW_DATABASE_URL: `postgresql://dartflow_app:${credentials.app}@127.0.0.1:${port}/postgres`,
  DARTFLOW_DATABASE_ADMIN_URL: `postgresql://dartflow_owner:${credentials.owner}@127.0.0.1:${port}/postgres`,
  DARTFLOW_DATABASE_APP_PASSWORD: credentials.app,
};
for (const [key, value] of Object.entries(values)) {
  env = env.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
  env += `${env.endsWith('\n') || env.length === 0 ? '' : '\n'}${key}=${value}\n`;
}
await writeFile('.env.local', env, { mode: 0o600 }); await chmod('.env.local', 0o600);
console.log(`Postgres luistert op 127.0.0.1:${port}. Lokale databasecredentials staan alleen in .env.local (0600). Draai npm run db:migrate en npm run db:seed.`);
