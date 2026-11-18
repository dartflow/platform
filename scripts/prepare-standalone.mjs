import {cp,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const target=new URL('../.next/standalone/',import.meta.url);
await cp(new URL('../public/',import.meta.url),new URL('public/',target),{recursive:true});
await cp(new URL('../.next/static/',import.meta.url),new URL('.next/static/',target),{recursive:true});
async function removePrivateFiles(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
    if(entry.name.startsWith('.env') || entry.name==='.local' || entry.name==='.git') await rm(path,{recursive:true,force:true});
    else if(entry.isDirectory()) await removePrivateFiles(path);
  }
}
await removePrivateFiles(target);
// The privacy timer has a separate identity and environment; no runtime admin key
// is traced into the web server. Bundle only its code, with existing runtime deps.
await build({entryPoints:[new URL('account-removal-worker.ts',import.meta.url).pathname],outfile:new URL('account-removal-worker.mjs',target).pathname,bundle:true,platform:'node',target:'node24',format:'esm',packages:'external'});
const publicBuildConfig={
  DARTFLOW_DATA_MODE:process.env.DARTFLOW_DATA_MODE || 'local',
  DARTFLOW_APP_ORIGIN:process.env.DARTFLOW_APP_ORIGIN || 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
};
await writeFile(new URL('build-config.json',target),JSON.stringify({
  format:'dartflow-build-config-v1',
  sourceSha:process.env.DARTFLOW_RELEASE_SHA || 'local-uncommitted',
  configId:process.env.DARTFLOW_BUILD_CONFIG_ID || null,
  publicConfigHash:createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(publicBuildConfig).sort(([a],[b])=>a.localeCompare(b))))).digest('hex'),
},null,2)+'\n');
console.log('Standalone server en publieke assets gereed; runtime-env wordt apart aangeleverd.');
