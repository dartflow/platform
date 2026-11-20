import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {PoolClient} from 'pg';
import {database,closeDatabase} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
import {integrationTransaction} from '../lib/integrations-core';
import {enqueueDomainMail,legacySocialMailPreview,renderMail,templateById,domainMailApplicable,recoverDeferredNativePushEnqueues} from '../lib/integrations-mail';
import {mailIdentityVariables,resolveMailActorId} from '../lib/mail-identity';
try{process.loadEnvFile('.env.local');}catch{/* Explicit loopback only. */}
const local=(s?:string)=>{try{return !!s&&['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('social mail uses actual actor and public recipient roles with private-name isolation and legacy audit recovery',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const [actor,recipient,unclaimed]=[randomUUID(),randomUUID(),randomUUID()],people=[actor,recipient,unclaimed],suffix=randomUUID().slice(0,8),requests:string[]=[];
 const command=(who:string,type:string,userId:string)=>{const requestId=randomUUID();requests.push(requestId);return executePlatformCommand(who,{requestId,action:{type,userId}});};
 const queued=async(template:string)=>(await admin.query('select * from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]) and template_id=$2 order by created_at desc',[people,template])).rows[0];
 try{
  await admin.query('insert into dartflow_private.profiles(id,name,display_name,full_name,display_name_confirmed,email,email_verified)values($1,$2,$3,$4,true,$5,true)',[actor,'actor'+suffix,'Zoë & <Darts>','Private Actor Name',`synthetic-${actor}@example.invalid`]);
  await admin.query('insert into dartflow_private.profiles(id,name,display_name,full_name,display_name_confirmed,email,email_verified)values($1,$2,$3,$4,true,$5,true)',[recipient,'recipient'+suffix,'De Ontvanger','Private Recipient Name',`synthetic-${recipient}@example.invalid`]);
  await admin.query("insert into dartflow_private.profiles(id,name,full_name,display_name_confirmed)values($1,'Nieuwe speler','Private Legacy Name',false)",[unclaimed]);
  await t.test('actual friend request and accept persist distinct actor ids and escaped public labels',async()=>{
   await command(actor,'friend.request',recipient);
   let row=await queued('friend-request');assert.ok(row.snapshot.text.includes('Hoi De Ontvanger,'));assert.ok(row.snapshot.text.includes(`Zoë & <Darts> (@actor${suffix})`));assert.ok(row.snapshot.html.includes('Zoë &amp; &lt;Darts&gt;'));assert.ok(!JSON.stringify(row.snapshot).includes('Private Actor Name'));assert.ok(!JSON.stringify(row.snapshot).includes('Private Recipient Name'));assert.ok(!row.snapshot.text.includes('—'));
   assert.equal((await admin.query('select actor_id from dartflow_private.mail_events where event_id=$1',[row.event_id])).rows[0].actor_id,actor);const before=Number((await admin.query("select count(*) n from dartflow_private.mail_outbox where recipient_id=$1 and template_id='friend-request'",[recipient])).rows[0].n);await command(actor,'friend.request',recipient);assert.equal(Number((await admin.query("select count(*) n from dartflow_private.mail_outbox where recipient_id=$1 and template_id='friend-request'",[recipient])).rows[0].n),before);
   await command(recipient,'friend.accept',actor);row=await queued('friend-accepted');assert.ok(row.snapshot.text.includes('Hoi Zoë & <Darts>,'));assert.ok(row.snapshot.text.includes(`De Ontvanger (@recipient${suffix})`));assert.equal(row.snapshot.renderContext.actorId,recipient);
   // The request source was consumed, while the accepted friendship remains authoritative.
   const request=await queued('friend-request');assert.equal(await domainMailApplicable(admin,{templateId:'friend-request',eventId:request.event_id,recipientId:recipient,actorId:actor}),false);
  });
  await t.test('legacy audit recovers exactly one actor and leaves the stored accepted snapshot untouched',async()=>{
   const row=await queued('friend-accepted'),legacy={...row,snapshot:{subject:'Je bent nu bevriend met —',text:'Hoi DartFlow,\n—',html:'<p>Hoi DartFlow,</p>'}};
   await admin.query('update dartflow_private.mail_events set actor_id=null where event_id=$1',[row.event_id]);
   const recovered=await resolveMailActorId(admin,{id:row.event_id,templateId:row.template_id,recipientId:row.recipient_id});assert.equal(recovered,recipient);
   const preview=await legacySocialMailPreview(admin,legacy);assert.ok(String(preview.text).includes('De Ontvanger'));assert.ok(!String(preview.text).includes('—'));assert.equal(legacy.snapshot.text,'Hoi DartFlow,\n—');assert.equal((await admin.query('select snapshot from dartflow_private.mail_outbox where id=$1',[row.id])).rows[0].snapshot.text,row.snapshot.text);
   const requestId=String(row.event_id).split(':')[1];await admin.query("insert into dartflow_private.platform_audit(actor_id,action,detail)values($1,'friend.accept',$2)",[unclaimed,JSON.stringify({requestId})]);assert.equal(await resolveMailActorId(admin,{id:row.event_id,templateId:row.template_id,recipientId:row.recipient_id}),null);
   const neutral=await legacySocialMailPreview(admin,legacy);assert.ok(String(neutral.text).toLowerCase().includes('een speler'));assert.ok(!String(neutral.text).includes('Dartmaatje:'));assert.ok(!String(neutral.text).includes('Private Legacy Name'));
  });
  await t.test('unclaimed recipient greeting stays neutral and known username is used when display is absent',async()=>{
   const event={id:'identity-neutral:'+randomUUID(),templateId:'friend-request',recipientId:unclaimed,actorId:actor,scope:'platform',variables:{name:'Private Legacy Name',actorName:'DartFlow',actionUrl:'/app/friends'}};
   const id=await integrationTransaction(c=>enqueueDomainMail(c,event));const row=(await admin.query('select snapshot from dartflow_private.mail_outbox where id=$1',[id])).rows[0];assert.ok(row.snapshot.text.includes('Hoi,'));assert.ok(!row.snapshot.text.includes('Private Legacy Name'));assert.ok(!row.snapshot.text.includes('Hoi DartFlow'));
   await admin.query('update dartflow_private.profiles set display_name=null where id=$1',[recipient]);const resolved=await mailIdentityVariables(admin,{...event,recipientId:recipient},{});assert.equal(resolved.variables.name,'recipient'+suffix);
  });
  await t.test('a real push-queue SQL failure preserves the friend action and source, then recovers the same inbox once',async()=>{
   await command(actor,'friend.remove',recipient);const pool=database(),original=pool.connect.bind(pool);let injected=false;
   Object.defineProperty(pool,'connect',{configurable:true,writable:true,value:async()=>{const client=await original();return new Proxy(client,{get(target,key){if(key==='query')return (...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('insert into dartflow_private.native_push_inbox')&&!injected){injected=true;return target.query('select 1/0');}return Reflect.apply(target.query,target,args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})as PoolClient;}});
   try{await command(actor,'friend.request',recipient);}finally{Object.defineProperty(pool,'connect',{configurable:true,writable:true,value:original});}
   assert.equal(injected,true);assert.equal((await admin.query("select 1 from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='request'",[actor,recipient])).rowCount,1);
   const row=await queued('friend-request');assert.equal((await admin.query('select 1 from dartflow_private.mail_events where event_id=$1',[row.event_id])).rowCount,1);assert.equal((await admin.query('select 1 from dartflow_private.native_push_inbox where event_id=$1',[row.event_id])).rowCount,0);
   const deferred=(await admin.query("select id from dartflow_private.integration_audit where operation='push-enqueue-deferred' and detail->>'eventId'=$1",[row.event_id])).rows[0];assert.ok(deferred);
   await Promise.all([recoverDeferredNativePushEnqueues(),recoverDeferredNativePushEnqueues()]);assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_inbox where event_id=$1',[row.event_id])).rows[0].n,1);assert.equal((await admin.query("select count(*)::int n from dartflow_private.integration_audit where operation='push-enqueue-recovered' and detail->>'deferredId'=$1",[deferred.id])).rows[0].n,1);
  });
  await t.test('all person templates preserve source roles, omit unknown blocks and use absolute compatible PNG',async()=>{
   for(const template of ['friend-request','friend-accepted','room-invite','club-invite','club-request','challenge-invite','challenge-accepted','competition-lobby-ready']){
    const resolved=await mailIdentityVariables(admin,{id:'synthetic:'+randomUUID(),templateId:template,recipientId:recipient,actorId:actor},{roomName:'Kamer & Co',clubName:'Onze vereniging',eventName:'Clubcompetitie',startScore:'501',bestOf:'5'});
    const preview=renderMail(template,templateById(template).fields,resolved.variables,'https://dartflow.nl');assert.ok(preview.html.includes('https://dartflow.nl/assets/dartflow-logo.png'));assert.ok(preview.html.includes('height="38"'));assert.ok(!preview.html.includes('Private '));assert.ok(!preview.text.includes('—'));
   }
   const neutral=renderMail('friend-request',templateById('friend-request').fields,{},'https://dartflow.nl');assert.ok(neutral.text.includes('Hoi,'));assert.ok(neutral.text.includes('Een speler wil'));assert.ok(!neutral.text.includes('Van:'));assert.ok(!neutral.html.includes('{{'));
  });
  await t.test('a revoked account cannot receive a queued event and new mail has no deliverable address',async()=>{
   const row=await queued('friend-request');assert.equal(await domainMailApplicable(admin,{templateId:row.template_id,eventId:row.event_id,recipientId:recipient,actorId:actor}),true);
   await admin.query('update dartflow_private.profiles set deletion_requested_at=clock_timestamp()where id=$1',[recipient]);assert.equal(await domainMailApplicable(admin,{templateId:row.template_id,eventId:row.event_id,recipientId:recipient,actorId:actor}),false);
   const id=await integrationTransaction(c=>enqueueDomainMail(c,{id:'identity-revoked:'+randomUUID(),templateId:'friend-request',scope:'platform',actorId:actor,recipientId:recipient,variables:{}}));const skipped=(await admin.query('select recipient,status from dartflow_private.mail_outbox where id=$1',[id])).rows[0];assert.equal(skipped.recipient,null);assert.equal(skipped.status,'skipped');
  });
 }finally{
  await admin.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]))',[people]);
  await admin.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>'user:'+id)]);
  await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);await admin.query("delete from dartflow_private.integration_audit where detail->>'recipientId'=any($1::text[]) or detail->>'deferredId' in(select id::text from dartflow_private.integration_audit where detail->>'recipientId'=any($1::text[]))",[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await admin.end();await closeDatabase();
 }
});
