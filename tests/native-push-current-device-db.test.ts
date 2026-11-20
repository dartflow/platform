import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {closeDatabase} from '../lib/db';
import {integrationTransaction} from '../lib/integrations-core';
import {enqueueDomainMail} from '../lib/integrations-mail';
import {getNativePush,executeNativePushCommand,processNativePushBatch} from '../lib/native-push';
import {encryptPushToken,encryptPushTarget,decryptPushTarget,fcmTargetUnregistered} from '../lib/native-push-config';
try{process.loadEnvFile('.env.local');}catch{/* Explicit loopback only. */}
const local=(s?:string)=>{try{return !!s&&['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('new FID and legacy targets use authorized current-device tests with honest delivery diagnostics',{skip:!configured},async t=>{
 const keys=['DARTFLOW_FIREBASE_ANDROID_CONFIG','DARTFLOW_FCM_SERVICE_ACCOUNT_JSON','DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY'] as const,old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();const people=[randomUUID(),randomUUID()],[a,b]=people,installation=randomUUID(),fid='cSynthetiCFirebaseFID01',token='legacy-synthetic-token-0123456789';let device='',inbox='';
 const command=(actor:string,action:Record<string,unknown>,requestId=randomUUID())=>executeNativePushCommand(actor,{requestId,action});
 const config={projectId:'dartflow',applicationId:'1:123456789:android:abcdef',senderId:'123456789',apiKey:'synthetic-public-sdk-options-0123456789',packageName:'nl.dartflow.app.dev'};
 const enqueue=async()=>{const id='push-http-errors:'+randomUUID();await integrationTransaction(c=>enqueueDomainMail(c,{id,templateId:'challenge-invite',scope:'platform',recipientId:a,variables:{actionUrl:'/app'}}));return (await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[id])).rows[0].id;};
 const fake=(status:number,body:unknown,capture?:unknown[])=>async(url:Parameters<typeof fetch>[0],options?:Parameters<typeof fetch>[1])=>{if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-token',expires_in:3600});assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/dartflow/messages:send');capture?.push(JSON.parse(String(options?.body)));return Response.json(body,{status});};
 try{
  process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=Buffer.alloc(32,61).toString('base64');process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG=JSON.stringify([config]);delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;
  for(const id of people)await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed)values($1,$2,true)',[id,'pushfid'+id.slice(0,8)]);
  await t.test('encrypted FID kind is authenticated while legacy version-one remains supported',()=>{
   const target={kind:'FID' as const,value:fid},envelope=encryptPushTarget(target,a,installation,'26.0.2');assert.deepEqual(decryptPushTarget(envelope,a,installation),target);assert.throws(()=>decryptPushTarget({...envelope,kind:'TOKEN'},a,installation));assert.throws(()=>decryptPushTarget(envelope,b,installation));assert.deepEqual(decryptPushTarget(encryptPushToken(token,a,installation),a,installation),{kind:'TOKEN',value:token});
  });
  await t.test('registration accepts explicit FID and rejects ambiguous targets or other packages',async()=>{
   const registered=await command(a,{type:'device.register',installationId:installation,packageName:config.packageName,firebaseInstallationId:fid,sdkVersion:'26.0.2'})as{deviceId:string};device=registered.deviceId;
   await assert.rejects(command(a,{type:'device.register',installationId:installation,packageName:config.packageName,firebaseInstallationId:fid,token}),{code:'push_target'});
   assert.equal((await getNativePush(a)).devices.find(d=>d.id===device)?.targetKind,'FID');assert.ok(!JSON.stringify(await getNativePush(a)).includes(fid));assert.ok(!JSON.stringify((await admin.query('select token_cipher from dartflow_private.native_push_devices where id=$1',[device])).rows[0]).includes(fid));
  });
  await t.test('current-device test scopes actor, installation and idempotency before reporting missing configuration',async()=>{
   const action={type:'device.test',deviceId:device,installationId:installation},requestId=randomUUID();
   await assert.rejects(command(b,action),{code:'push_device'});await assert.rejects(command(a,{...action,installationId:randomUUID()}),{code:'push_device'});
   const first=await command(a,action,requestId)as unknown as{id:string;status:string};inbox=first.id;assert.equal(first.status,'configUnavailable');await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});assert.equal((await getNativePush(a)).diagnostics.find(d=>d.id===inbox)?.receivedAt,null);assert.equal((await command(a,action,requestId)as unknown as{id:string}).id,inbox);assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].n,1);
   const diagnostics=(await getNativePush(a)).diagnostics.find(d=>d.id===inbox);assert.equal(diagnostics?.providerAccepted,false);assert.equal(diagnostics?.receivedAt,null);assert.equal((await processNativePushBatch()).processed,0);
  });
  await t.test('HTTP v1 sends message.fid with opaque data and records provider acceptance before client receipt',async()=>{
   const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'dartflow',client_email:'synthetic@dartflow.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});const bodies:unknown[]=[];
   await processNativePushBatch(fake(200,{name:'projects/dartflow/messages/synthetic-fid'},bodies)as typeof fetch);
   const message=(bodies[0]as{message:Record<string,unknown>}).message;assert.equal(message.fid,fid);assert.equal(message.token,undefined);assert.deepEqual(Object.keys(message.data as object).sort(),['category','deviceId','id']);assert.ok(!JSON.stringify(message).includes(a));
   let d=(await getNativePush(a)).diagnostics.find(d=>d.id===inbox);assert.equal(d?.providerAccepted,true);assert.equal(d?.receivedAt,null);assert.equal(d?.openedAt,null);
   await command(b,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});assert.equal((await getNativePush(a)).diagnostics.find(d=>d.id===inbox)?.receivedAt,null);
   await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'opened'});await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});d=(await getNativePush(a)).diagnostics.find(d=>d.id===inbox);assert.equal(d?.status,'opened');assert.equal(d?.providerAccepted,true);assert.ok(d?.receivedAt);assert.ok(d?.openedAt);
  });
  await t.test('ordinary 404 and invalid payload do not disable a target; only structured UNREGISTERED does',async()=>{
   for(const [status,body]of[[404,{error:{status:'NOT_FOUND'}}],[400,{error:{details:[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'message.data'}]}]}}]]as const){const id=await enqueue();await processNativePushBatch(fake(status,body)as typeof fetch);assert.equal((await admin.query('select enabled from dartflow_private.native_push_devices where id=$1',[device])).rows[0].enabled,true);assert.equal((await getNativePush(a)).diagnostics.find(d=>d.id===id)?.status,'failed');}
   const unregistered={error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}};assert.equal(fcmTargetUnregistered(unregistered),true);const id=await enqueue();await processNativePushBatch(fake(404,unregistered)as typeof fetch);assert.equal((await admin.query('select enabled from dartflow_private.native_push_devices where id=$1',[device])).rows[0].enabled,false);assert.equal((await getNativePush(a)).diagnostics.find(d=>d.id===id)?.errorCategory,'target-unregistered');
  });
  await t.test('test rate limits cannot fan out and revoked devices cannot create tests',async()=>{
   await command(a,{type:'device.register',installationId:installation,packageName:config.packageName,firebaseInstallationId:fid,sdkVersion:'26.0.2'});
   for(let n=0;n<2;n++)await command(a,{type:'device.test',deviceId:device,installationId:installation});await assert.rejects(command(a,{type:'device.test',deviceId:device,installationId:installation}),{code:'rate_limited'});
   await command(a,{type:'device.revoke',installationId:installation});await assert.rejects(command(a,{type:'device.test',deviceId:device,installationId:installation}),{code:'push_device'});
   assert.equal((await getNativePush(b)).devices.length,0);assert.equal((await getNativePush(b)).diagnostics.length,0);
  });
 }finally{
  for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
  await admin.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>'user:'+id)]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await admin.end();await closeDatabase();
 }
});
