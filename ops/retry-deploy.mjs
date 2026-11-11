import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {basename} from 'node:path';
export function brokerForInstalledName(name) {
  if(name==='dartflow-production-retry-deploy.mjs')return '/usr/local/bin/dg-dartflow-production-deploy';
  if(['retry-deploy.mjs','dartflow-retry-deploy.mjs'].includes(name))return '/usr/local/bin/dg-dartflow-deploy';
  throw new Error('Unknown fixed DartFlow retry installation');
}
export async function withLockRetry(run,{delays=[15000,30000,45000],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onBusy=()=>{}}={}) {
  for(let attempt=0;;attempt++) {const code=await run();if(code!==75 || attempt>=delays.length)return code;onBusy(attempt+1,delays[attempt]);await sleep(delays[attempt]);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);const [operation,sha,run,configId]=args;
  const validDeploy=operation==='deploy' && args.length===4 && /^[a-f0-9]{40}$/.test(sha || '') && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(run || '') && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(configId || '') && process.env.GH_TOKEN;
  const validRollback=operation==='rollback' && args.length===2 && /^[a-f0-9]{12}-[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(sha || '');
  if(!validDeploy && !validRollback) {console.error('Invalid fixed DartFlow deployment invocation');process.exitCode=64;}
  else {
    const token=process.env.GH_TOKEN;
    const runOnce=()=>new Promise(resolve=>{
      const child=spawn(brokerForInstalledName(basename(fileURLToPath(import.meta.url))),args,{env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8'},stdio:['pipe','inherit','inherit']});
      child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code ?? 1));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(operation==='deploy'?{githubToken:token}:{}));
    });
    process.exitCode=await withLockRetry(runOnce,{onBusy:(attempt,delay)=>console.log(`DG build lock busy; bounded retry ${attempt} after ${delay/1000}s`)});
  }
}
