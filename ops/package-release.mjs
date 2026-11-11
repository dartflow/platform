import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const standalone = resolve(root, '.next/standalone');
const revision = process.env.DARTFLOW_RELEASE_SHA || 'local-uncommitted';
assert.ok(revision === 'local-uncommitted' || /^[0-9a-f]{40}$/.test(revision), 'Invalid release SHA');
const runId = process.env.GITHUB_RUN_ID || 'local';
assert.match(runId, /^(local|[0-9]+)$/, 'Invalid run ID');
const dataMode = process.env.DARTFLOW_DATA_MODE || 'local';
const configId = process.env.DARTFLOW_BUILD_CONFIG_ID || null;
const runtimeConfigId = process.env.DARTFLOW_RUNTIME_CONFIG_ID || null;
const validConfigId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
assert.ok(configId === null || validConfigId.test(configId), 'Invalid build configuration ID');
assert.ok(runtimeConfigId === null || validConfigId.test(runtimeConfigId), 'Invalid runtime configuration ID');
if (dataMode === 'supabase') {
  assert.ok(configId && runtimeConfigId && configId === runtimeConfigId, 'Staging requires matching immutable build and runtime configuration IDs');
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Staging public build configuration is incomplete');
}
// No runtime credential is necessary for packaging. Reject accidental inheritance
// rather than risk placing credentials in a child process or its build output.
assert.ok(!Object.entries(process.env).some(([name, value]) => name.startsWith('DARTFLOW_DATABASE_') && value), 'Runtime database credentials must not enter the packaging environment');
const publicBuildConfig = {
  DARTFLOW_DATA_MODE: dataMode,
  DARTFLOW_APP_ORIGIN: process.env.DARTFLOW_APP_ORIGIN || 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
};
const buildConfigSha256 = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(publicBuildConfig).sort(([a],[b]) => a.localeCompare(b))))).digest('hex');
const builtConfig = JSON.parse(await readFile(resolve(standalone, 'build-config.json'), 'utf8'));
assert.ok(builtConfig.format === 'dartflow-build-config-v1' && builtConfig.sourceSha === revision && builtConfig.configId === configId && builtConfig.publicConfigHash === buildConfigSha256, 'Packaging configuration or source does not match the completed build');
let sourceVerified = false;
if (revision !== 'local-uncommitted') {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
  assert.ok(head.status === 0 && head.stdout.trim() === revision && status.status === 0 && status.stdout.trim() === '', 'Release SHA must identify the clean checked-out source');
  sourceVerified = true;
}
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
await cp(resolve(root, '.next/static'), resolve(stage, '.next/static'), { recursive: true, filter: withoutEnvironmentFiles });
// The native wrapper extracts as an unprivileged account. Still refuse an
// archive containing links that could later reach outside its own release.
async function verifyLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await realpath(path);
      assert.ok(target === stage || target.startsWith(stage + sep), 'Release contains an escaping or invalid symbolic link');
    } else if (stat.isDirectory()) await verifyLinks(path);
  }
}
await verifyLinks(stage);
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = await readFile(resolve(root, 'package-lock.json'));
const manifest = {
  format: 'dartflow-next-standalone-v1',
  sourceSha: revision,
  sourceVerified,
  runId,
  runUrl: process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}` : null,
  createdAt: new Date().toISOString(),
  node: process.version,
  next: packageJson.dependencies?.next,
  lockfileSha256: createHash('sha256').update(lock).digest('hex'),
  dataMode,
  appOrigin: publicBuildConfig.DARTFLOW_APP_ORIGIN,
  configId,
  buildConfigSha256,
  runtimeConfigId,
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
