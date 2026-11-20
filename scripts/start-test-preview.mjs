// Playwright owns this local-only process and its ordinary HTTP worker together.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {loadEnv} from './db-shared.mjs';
await loadEnv();
const local=v=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(v).hostname);}catch{return false;}};
if(process.env.DARTFLOW_DATA_MODE!=='local'||!local(process.env.DARTFLOW_DATABASE_URL)||!local(process.env.DARTFLOW_DATABASE_ADMIN_URL)||!local(process.env.DARTFLOW_APP_ORIGIN??'http://localhost:3000'))throw Error('Test preview requires an isolated loopback application and database.');
const token=randomBytes(48).toString('base64url'),env={...process.env,DARTFLOW_MAIL_WORKER_TOKEN:token,DARTFLOW_MAIL_MAX_MODE:'log'};
delete env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;
const server=spawn(process.execPath,['scripts/start.mjs'],{env,stdio:'inherit'});
let stopping=false;
async function work(){
 if(stopping)return;
 try{await fetch('http://localhost:3000/api/mail/process',{method:'POST',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{/* Server startup and shutdown are retried by the same bounded timer. */}
 if(!stopping)timer=setTimeout(work,1000);
}
let timer=setTimeout(work,500);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);server.kill(signal);});
server.on('error',()=>{stopping=true;clearTimeout(timer);process.exitCode=1;});
server.on('exit',(code,signal)=>{stopping=true;clearTimeout(timer);process.exitCode=code??(signal?1:0);});
