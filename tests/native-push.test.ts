import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {closeDatabase} from '../lib/db';
import {integrationTransaction} from '../lib/integrations-core';
import {enqueueDomainMail} from '../lib/integrations-mail';
import {getNativePush,executeNativePushCommand,processNativePushBatch,pushSafeText} from '../lib/native-push';
import {publicPushConfig,encryptPushToken,decryptPushToken,pushMessage} from '../lib/native-push-config';
import {requestAccountDeletion} from '../lib/account-removal';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback credentials. */}
const local=(value?:string)=>{try{return!!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
const keys=['DARTFLOW_FIREBASE_ANDROID_CONFIG','DARTFLOW_FCM_SERVICE_ACCOUNT_JSON','DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY'] as const;
test('native push lifecycle uses opaque notifications, current ACL, device binding, preferences and actual receipt stages',{skip:!configured},async t=>{
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]])),admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const [a,b]=[randomUUID(),randomUUID()],installation=randomUUID(),otherInstallation=randomUUID();let device='',inbox='';
 const command=(actor:string,action:Record<string,unknown>)=>executeNativePushCommand(actor,{requestId:randomUUID(),action});
 const token='test-fcm-token-opaque-no-real-device-0123456789';
 const event=(id:string,recipientId=a,expiresAt?:string)=>({id,templateId:'friend-request',scope:'platform',recipientId,expiresAt,variables:{actorName:'Private Person',actionUrl:'/app/friends'}});
 const enqueue=(id:string,recipientId=a,expiresAt?:string)=>integrationTransaction(client=>enqueueDomainMail(client,event(id,recipientId,expiresAt)));
 try{
  process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=Buffer.alloc(32,37).toString('base64');
  process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG=JSON.stringify([{projectId:'dartflow',applicationId:'1:123456789:android:abcdef',senderId:'123456789',apiKey:'test-public-sdk-options-0123456789',packageName:'nl.dartflow.app.dev'}]);
  delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;
  for(const id of[a,b])await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$2,true)',[id,'Push_'+id.slice(0,8)]);
  await t.test('exact package/config and encrypted account-bound tokens',async()=>{
   assert.equal(publicPushConfig()?.packageName,'nl.dartflow.app.dev');
   const envelope=encryptPushToken(token,a,installation);assert.equal(decryptPushToken(envelope,a,installation),token);assert.ok(!JSON.stringify(envelope).includes(token));assert.throws(()=>decryptPushToken(envelope,b,installation));
   await assert.rejects(command(a,{type:'device.register',installationId:installation,packageName:'nl.dartflow.app',token}),{code:'push_configuration'});
   const registered=await command(a,{type:'device.register',installationId:installation,packageName:'nl.dartflow.app.dev',token});device=String((registered as{deviceId:string}).deviceId);
   assert.equal((await command(a,{type:'device.register',installationId:installation,packageName:'nl.dartflow.app.dev',token})as{deviceId:string}).deviceId,device);
   const raw=(await admin.query('select token_cipher from dartflow_private.native_push_devices where id=$1',[device])).rows[0];assert.ok(!JSON.stringify(raw).includes(token));assert.ok(!JSON.stringify(await getNativePush(a)).includes(token));
  });
  await t.test('retention purges expired token envelopes and inbox deliveries while FCM is unconfigured',async()=>{
   const expiredDevice=await command(b,{type:'device.register',installationId:randomUUID(),packageName:'nl.dartflow.app.dev',token:'expired-test-token-'+randomUUID()})as{deviceId:string};
   const id='native-push-retention:'+randomUUID();await enqueue(id,b,new Date(Date.now()-31*24*60*60*1000).toISOString());
   const oldInbox=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[id])).rows[0].id;
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[oldInbox])).rows[0].n,1);
   await admin.query("update dartflow_private.native_push_devices set expires_at=now()-interval '1 day' where id=$1",[expiredDevice.deviceId]);
   assert.equal((await processNativePushBatch()).processed,0);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_devices where id=$1',[expiredDevice.deviceId])).rows[0].n,0);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_inbox where id=$1',[oldInbox])).rows[0].n,0);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[oldInbox])).rows[0].n,0);
  });
  await t.test('domain event dedupe queues once even without an email address; disabled preference suppresses',async()=>{
   const id='native-push-proof:'+randomUUID();await enqueue(id);await enqueue(id);inbox=(await admin.query('select id from dartflow_private.native_push_inbox where recipient_id=$1 and event_id=$2',[a,id])).rows[0].id;
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].n,1);
   await command(a,{type:'preference',category:'Sociaal',enabled:false});await enqueue('native-push-disabled:'+randomUUID());assert.equal((await getNativePush(a)).items.find(i=>i.id===inbox)?.available,false);await command(a,{type:'preference',category:'Sociaal',enabled:true});
   assert.equal((await processNativePushBatch()).processed,0);assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].status,'queued');
  });
  await t.test('mock transport acceptance is separate from device receipt and open; no private content in provider payload',async()=>{
   const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
   process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'dartflow',client_email:'mock-test@dartflow.iam.gserviceaccount.com',private_key:pair.privateKey});
   const bodies:Record<string,unknown>[]=[];const fake=(async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mocked-oauth-token',expires_in:3600});
    assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/dartflow/messages:send');assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');bodies.push(JSON.parse(String(init?.body)));return Response.json({name:'projects/dartflow/messages/mock-provider-accepted'});
   })as typeof fetch;
   await processNativePushBatch(fake);assert.equal(bodies.length,1);assert.deepEqual(bodies[0],pushMessage(inbox,device,'Sociaal',token));assert.ok(!JSON.stringify(bodies).includes('Private Person'));assert.ok(!JSON.stringify(bodies).includes('/app/friends'));
   await admin.query("update dartflow_private.native_push_outbox set status='processing',claim_token=$2,lease_until=now()-interval '1 second' where inbox_id=$1",[inbox,randomUUID()]);await Promise.all([processNativePushBatch(fake),processNativePushBatch(fake)]);assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].n,1);
   assert.equal((await admin.query('select status,received_at from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].status,'accepted');assert.equal((await admin.query('select received_at from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].received_at,null);
   await command(b,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].status,'accepted');
   await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].status,'received');
   await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'opened'});await command(a,{type:'delivery.ack',id:inbox,deviceId:device,stage:'received'});assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[inbox])).rows[0].status,'opened');
   assert.deepEqual(await command(a,{type:'notification.open',id:inbox}),{ok:true,available:true,href:'/app/friends'});await assert.rejects(command(b,{type:'notification.open',id:inbox}),{code:'push_not_found'});
  });
  await t.test('each dispatch batch bounds three concurrent provider requests and leaves later jobs queued',async()=>{
   const ids:string[]=[];for(let index=0;index<5;index++){const id='native-push-batch:'+randomUUID();ids.push(id);await enqueue(id);}
   let concurrent=0,maximum=0,calls=0;
   const fake=(async(url:Parameters<typeof fetch>[0])=>{
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mocked-oauth-token',expires_in:3600});
    concurrent++;maximum=Math.max(maximum,concurrent);calls++;await new Promise(resolve=>setTimeout(resolve,20));concurrent--;return Response.json({name:'projects/dartflow/messages/mock-bounded-batch'});
   })as typeof fetch;
   assert.equal((await processNativePushBatch(fake)).processed,3);assert.equal(calls,3);assert.ok(maximum>0&&maximum<=3);
   assert.equal((await admin.query("select count(*)::int n from dartflow_private.native_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.event_id=any($1) and o.status='queued'",[ids])).rows[0].n,2);
   assert.equal((await processNativePushBatch(fake)).processed,2);assert.equal(calls,5);assert.ok(maximum>0&&maximum<=3);
  });
  await t.test('expired/current source checks reject stale notifications and switched account bindings',async()=>{
   const id='native-push-expired:'+randomUUID();await enqueue(id,a,new Date(Date.now()-1000).toISOString());const expired=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[id])).rows[0].id;assert.equal((await command(a,{type:'notification.open',id:expired})as{available:boolean}).available,false);
   const changed=await command(b,{type:'device.register',installationId:installation,packageName:'nl.dartflow.app.dev',token});assert.notEqual((changed as{deviceId:string}).deviceId,device);assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where device_id=$1',[device])).rows[0].n,0);
   await command(b,{type:'device.revoke',installationId:installation});assert.equal((await admin.query('select enabled from dartflow_private.native_push_devices where installation_id=$1',[installation])).rows[0].enabled,false);
  });
  await t.test('soft deletion immediately erases token envelopes, inbox and leased deliveries through real deletion command',async()=>{
   await command(a,{type:'device.register',installationId:otherInstallation,packageName:'nl.dartflow.app.dev',token:token+'-new'});await enqueue('native-push-deletion:'+randomUUID());await admin.query("update dartflow_private.native_push_outbox set status='processing',claim_token=$2,lease_until=now()+interval '1 minute' where recipient_id=$1",[a,randomUUID()]);
   await requestAccountDeletion(a,{requestId:randomUUID(),confirmation:'VERWIJDEREN'},{recentAuth:true});for(const [table,column]of[['native_push_devices','user_id'],['native_push_inbox','recipient_id'],['native_push_outbox','recipient_id']])assert.equal((await admin.query(`select count(*)::int n from dartflow_private.${table} where ${column}=$1`,[a])).rows[0].n,0);
   await assert.rejects(command(a,{type:'device.register',installationId:otherInstallation,packageName:'nl.dartflow.app.dev',token}),{code:'account_deleted'});
   for(const table of['native_push_devices','native_push_inbox','native_push_outbox'])assert.equal((await admin.query("select exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl)x where c.oid=$1::regclass and x.grantee=0)allowed",[`dartflow_private.${table}`])).rows[0].allowed,false);
  });
  await t.test('safe lockscreen text never interpolates source variables',()=>{for(const category of['Sociaal','Wedstrijden','Competitie','Toernooien']){const text=JSON.stringify(pushSafeText(category));assert.ok(!text.includes('Private Person'));assert.ok(!text.includes(token));}});
 }finally{
  for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
  await admin.query('delete from dartflow_private.account_deletion_jobs where actor_id=any($1::uuid[])',[[a,b]]);for(const table of['mail_outbox','mail_events'])await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[[a,b].map(id=>'user:'+id)]);await admin.query('delete from dartflow_private.mail_preferences where user_id=any($1::uuid[])',[[a,b]]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[[a,b]]);await admin.end();await closeDatabase();
 }
});
