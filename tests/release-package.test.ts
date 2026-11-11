import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packager=resolve('ops/package-release.mjs');
const publicConfig={DARTFLOW_DATA_MODE:'supabase',DARTFLOW_APP_ORIGIN:'https://staging.dartflow.nl',NEXT_PUBLIC_SUPABASE_URL:'https://staging-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_fixture_only',DARTFLOW_BUILD_CONFIG_ID:'staging-config-0001',DARTFLOW_RUNTIME_CONFIG_ID:'staging-config-0001'};
async function fixture(config:Record<string,string>={}) {
  const root=await mkdtemp(join(tmpdir(),'dartflow-release-'));
  for(const path of ['.next/standalone/nested/.local','.next/static','public']) await mkdir(join(root,path),{recursive:true});
  await writeFile(join(root,'.next/standalone/server.js'),'// Standalone fixture, never started.\n');
  await writeFile(join(root,'.next/standalone/nested/.env.runtime'),'DO_NOT_PACKAGE=runtime-fixture\n');
  await writeFile(join(root,'.next/standalone/nested/.local/session.key'),'DO_NOT_PACKAGE');
  await writeFile(join(root,'.next/static/client.js'),'// client fixture\n');
  await writeFile(join(root,'.next/static/.env.accidental'),'DO_NOT_PACKAGE');
  await writeFile(join(root,'public/logo.svg'),'<svg/>');
  await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{next:'16.4.6'}}));
  await writeFile(join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));
  await writeFile(join(root,'.gitignore'),'.next/\nartifacts/\n');
  await mkdir(join(root,'scripts'));
  await writeFile(join(root,'scripts/prepare-standalone.mjs'),await readFile(resolve('scripts/prepare-standalone.mjs')));
  prepare(root,config);
  return root;
}
function environment(extra:Record<string,string>={}) {
  const env={...process.env};
  for(const name of Object.keys(env)) if(name.startsWith('DARTFLOW_') || name.startsWith('NEXT_PUBLIC_') || name.startsWith('GITHUB_')) delete env[name];
  return {...env,...extra};
}
function prepare(root:string,extra:Record<string,string>={}) {
  const result=spawnSync(process.execPath,[join(root,'scripts/prepare-standalone.mjs')],{cwd:root,env:environment(extra),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
function run(root:string,extra:Record<string,string>={}) {
  return spawnSync(process.execPath,[packager],{cwd:root,env:environment(extra),encoding:'utf8'});
}
function git(root:string,args:string[]) {
  const command=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  assert.equal(command.status,0,command.stderr);
  return command.stdout.trim();
}

test('standalone package includes assets, strips nested private files and records public configuration without values',async()=>{
  const root=await fixture(publicConfig);
  try {
    const result=run(root,publicConfig); assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(root,'artifacts/release-manifest.json'),'utf8'));
    assert.equal(manifest.sourceVerified,false); assert.equal(manifest.configId,'staging-config-0001'); assert.equal(manifest.runtimeConfigId,manifest.configId); assert.match(manifest.buildConfigSha256,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(manifest).includes(publicConfig.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
    const archive=join(root,'artifacts/dartflow-local-uncommitted-local.tgz');
    const entries=spawnSync('tar',['-tzf',archive],{encoding:'utf8'}); assert.equal(entries.status,0,entries.stderr);
    for(const path of ['./server.js','./public/logo.svg','./.next/static/client.js','./release-manifest.json']) assert.ok(entries.stdout.split('\n').includes(path),`Missing ${path}`);
    assert.doesNotMatch(entries.stdout,/(?:^|\/)\.env|(?:^|\/)\.local(?:\/|$)|(?:^|\/)\.git(?:\/|$)/m);
    const firstHash=manifest.buildConfigSha256;
    const changedConfig={...publicConfig,NEXT_PUBLIC_SUPABASE_URL:'https://different-staging.supabase.co'};
    const mismatch=run(root,changedConfig); assert.notEqual(mismatch.status,0); assert.match(mismatch.stderr,/does not match the completed build/);
    prepare(root,changedConfig);
    const changed=run(root,changedConfig); assert.equal(changed.status,0,changed.stderr);
    const second=JSON.parse(await readFile(join(root,'artifacts/release-manifest.json'),'utf8'));
    assert.notEqual(firstHash,second.buildConfigSha256);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('packaging refuses runtime credentials and mismatched release configuration versions',async()=>{
  const root=await fixture(publicConfig);
  try {
    const secret='runtime-credential-must-never-be-printed';
    const inherited=run(root,{...publicConfig,DARTFLOW_DATABASE_URL:`postgresql://dartflow_app:${secret}@localhost/db`});
    assert.notEqual(inherited.status,0); assert.match(inherited.stderr,/Runtime database credentials must not enter/); assert.ok(!inherited.stderr.includes(secret));
    const mismatch=run(root,{...publicConfig,DARTFLOW_RUNTIME_CONFIG_ID:'staging-config-0002'});
    assert.notEqual(mismatch.status,0); assert.match(mismatch.stderr,/matching immutable build and runtime configuration IDs/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('release source identity must match a clean Git checkout and cannot be inferred from run variables',async()=>{
  const root=await fixture(publicConfig);
  try {
    git(root,['init','--quiet']); git(root,['add','.']); git(root,['-c','user.name=Release fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture']);
    const sha=git(root,['rev-parse','HEAD']);
    const mismatch=run(root,{...publicConfig,DARTFLOW_RELEASE_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123'});
    assert.notEqual(mismatch.status,0); assert.match(mismatch.stderr,/does not match the completed build/);
    prepare(root,{...publicConfig,DARTFLOW_RELEASE_SHA:sha});
    const matched=run(root,{...publicConfig,DARTFLOW_RELEASE_SHA:sha,GITHUB_RUN_ID:'123'}); assert.equal(matched.status,0,matched.stderr);
    const manifest=JSON.parse(await readFile(join(root,'artifacts/release-manifest.json'),'utf8')); assert.equal(manifest.sourceVerified,true); assert.equal(manifest.sourceSha,sha);
    await writeFile(join(root,'public/logo.svg'),'<svg>modified</svg>');
    const dirty=run(root,{...publicConfig,DARTFLOW_RELEASE_SHA:sha,GITHUB_RUN_ID:'123'}); assert.notEqual(dirty.status,0);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('release archive refuses links that escape the package boundary',async()=>{
  const root=await fixture();
  try {
    await symlink('/etc/passwd',join(root,'public/escape'));
    const result=run(root); assert.notEqual(result.status,0); assert.match(result.stderr,/escaping or invalid symbolic link/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('standalone preparation copies public assets and removes nested private build files before startup',async()=>{
  const root=await fixture();
  try {
    const script=join(root,'scripts/prepare-standalone.mjs');
    await writeFile(script,await readFile(resolve('scripts/prepare-standalone.mjs')));
    const prepared=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'}); assert.equal(prepared.status,0,prepared.stderr);
    assert.equal(await readFile(join(root,'.next/standalone/public/logo.svg'),'utf8'),'<svg/>');
    assert.equal(await readFile(join(root,'.next/standalone/.next/static/client.js'),'utf8'),'// client fixture\n');
    for(const path of ['nested/.env.runtime','nested/.local/session.key','.next/static/.env.accidental']) await assert.rejects(readFile(join(root,'.next/standalone',path)),{code:'ENOENT'});
  } finally { await rm(root,{recursive:true,force:true}); }
});
