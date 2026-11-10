import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const standalone = resolve(root, '.next/standalone');
const revision = process.env.DARTFLOW_RELEASE_SHA || 'local-uncommitted';
assert.ok(revision === 'local-uncommitted' || /^[0-9a-f]{40}$/.test(revision), 'Invalid release SHA');
const runId = process.env.GITHUB_RUN_ID || 'local';
assert.match(runId, /^(local|[0-9]+)$/, 'Invalid run ID');
const output = resolve(root, 'artifacts');
const stage = resolve(output, 'standalone');
await readFile(resolve(standalone, 'server.js')); // Fail when next.config lacks output: standalone.
await mkdir(output, { recursive: true });
await rm(stage, { force: true, recursive: true });
await mkdir(stage);
const withoutEnvironmentFiles = (path) => !basename(path).startsWith('.env')
  && !path.split(sep).some((part) => part === '.local' || part === '.git');
await cp(standalone, stage, { recursive: true, filter: withoutEnvironmentFiles });
await cp(resolve(root, 'public'), resolve(stage, 'public'), { recursive: true, filter: withoutEnvironmentFiles });
await cp(resolve(root, '.next/static'), resolve(stage, '.next/static'), { recursive: true });
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = await readFile(resolve(root, 'package-lock.json'));
const manifest = {
  format: 'dartflow-next-standalone-v1',
  sourceSha: revision,
  sourceVerified: revision !== 'local-uncommitted' && !!process.env.GITHUB_RUN_ID,
  runId,
  runUrl: process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}` : null,
  createdAt: new Date().toISOString(),
  node: process.version,
  next: packageJson.dependencies?.next,
  lockfileSha256: createHash('sha256').update(lock).digest('hex'),
  dataMode: process.env.DARTFLOW_DATA_MODE || 'local',
  appOrigin: process.env.DARTFLOW_APP_ORIGIN || 'http://localhost:3000',
  // These are populated by the approved host-side release adapter, never guessed.
  hostId: null,
  baselineRevision: null,
  wrapperRevision: null,
};
await writeFile(resolve(stage, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const archiveName = `dartflow-${revision}-${runId}.tgz`;
const archive = resolve(output, archiveName);
assert.ok(archive.startsWith(output + sep));
const tar = spawnSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit' });
assert.equal(tar.status, 0, 'tar packaging failed');
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${checksum}  ${archiveName}\n`);
await rm(stage, { recursive: true });
console.log(`Created artifacts/${archiveName} (no runtime environment file included)`);
