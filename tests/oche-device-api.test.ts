import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import pg from 'pg';
import {handleOcheDeviceApi} from '../lib/oche-device-api';
import {closeDatabase} from '../lib/db';
import {secretHash} from '../lib/oche-device-crypto';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback fixture */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('Oche public API enforces cookie CSRF, native auth, no-store, payload limits and persistent cooldown',{skip:!configured},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();const ip=`synthetic-${randomUUID()}`,requests:string[]=[],installs:string[]=[];const origin=process.env.DARTFLOW_APP_ORIGIN??'http://localhost:3000';
 const call=async(path:string,method='GET',input?:unknown,headers:Record<string,string>={})=>{
  const request=new NextRequest(`${origin}/api/oche/v1/${path}`,{method,headers:{host:new URL(origin).host,'x-forwarded-for':ip,...(input!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(input!==undefined?{body:JSON.stringify(input)}:{})});
  const response=await handleOcheDeviceApi(request,['oche','v1',path]);assert.ok(response);assert.equal(response.headers.get('cache-control'),'private, no-store');return response;
 };
 try{
  const capabilities=await call('capabilities');assert.equal(capabilities.status,200);assert.deepEqual((await capabilities.json()).permissions,{read:true,score:false,extend:false});
  assert.equal((await call('status')).status,401);assert.equal((await call('snapshot')).status,401);
  assert.equal((await call('start','POST',{platform:'browser',requestId:randomUUID()},{origin:'https://evil.example'})).status,403);
  assert.equal((await call('start','POST',{platform:'android',requestId:randomUUID(),padding:'x'.repeat(9000)})).status,413);
  const requestId=randomUUID();requests.push(requestId);const created=await call('start','POST',{platform:'android-tv',requestId});assert.equal(created.status,201);const pairing=await created.json();installs.push(pairing.installationId);assert.ok(pairing.installationSecret);assert.equal(created.headers.has('set-cookie'),false);
  assert.equal((await call('status','GET',undefined,{'x-oche-installation':pairing.installationId,'x-oche-secret':pairing.installationSecret})).status,401);
  const status=await call('status','GET',undefined,{authorization:`OcheInstall ${pairing.installationId}.${pairing.installationSecret}`});assert.equal(status.status,200);const state=await status.json();assert.equal(state.state,'pending');assert.equal(state.pairing.code,pairing.code);assert.equal(JSON.stringify(state).includes(pairing.installationSecret),false);
  const browserId=randomUUID();requests.push(browserId);const browser=await call('start','POST',{platform:'browser',requestId:browserId},{origin});assert.equal(browser.status,201);const browserPairing=await browser.json();installs.push(browserPairing.installationId);assert.equal('installationSecret'in browserPairing,false);assert.match(browser.headers.get('set-cookie')??'',/HttpOnly/i);assert.match(browser.headers.get('set-cookie')??'',/SameSite=strict/i);assert.match(browser.headers.get('set-cookie')??'',/Path=\/api\/oche\/v1/);
  let limited=false;for(let index=0;index<22;index++){
   const key=randomUUID();requests.push(key);const response=await call('start','POST',{platform:'android',requestId:key});
   if(response.status===429){limited=true;assert.ok(Number(response.headers.get('retry-after'))>0);assert.equal((await response.json()).code,'rate_limited');break;}
   assert.equal(response.status,201);installs.push((await response.json()).installationId);
  }assert.equal(limited,true);
  await admin.query("update dartflow_private.auth_limits set reset_at=clock_timestamp()-interval '1 second' where key=$1",[`oche:start:${secretHash(ip)}`]);
  const restored=randomUUID();requests.push(restored);const recovery=await call('start','POST',{platform:'android',requestId:restored});assert.equal(recovery.status,201);installs.push((await recovery.json()).installationId);
 }finally{
  await admin.query('delete from dartflow_private.oche_device_receipts where request_id=any($1::uuid[])',[requests]);await admin.query('delete from dartflow_private.oche_installations where id=any($1::uuid[])',[installs]);
  await admin.query('delete from dartflow_private.auth_limits where key=any($1::text[])',[[`oche:ip:${secretHash(ip)}`,`oche:start:${secretHash(ip)}`,`oche:access:${secretHash('')}`,`oche:installation:${secretHash('')}`,...installs.map(id=>`oche:installation:${secretHash(id)}`)]]);await admin.end();await closeDatabase();
 }
});
