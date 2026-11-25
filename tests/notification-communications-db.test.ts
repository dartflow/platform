import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createECDH,randomBytes,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {integrationTransaction} from '../lib/integrations-core';
import {notificationChannelState,effectiveNotificationChannel} from '../lib/notification-core';
import {executeNotificationCommand,executeNotificationAdminCommand,getNotificationSettings,getNotificationInbox,getNotificationAdmin} from '../lib/notifications';
import {executeProductReleaseCommand,getProductRelease,getProductReleases} from '../lib/product-releases';
import {processCommunicationCampaigns,campaignSummary,getPlatformMessage} from '../lib/notification-campaigns';
import {enqueueDomainMail,processMailBatch} from '../lib/integrations-mail';
import {executeNativePushCommand,processNativePushBatch} from '../lib/native-push';
import {validateWebPushSubscription,processWebPushBatch,getWebPushDelivery} from '../lib/web-push';
import type {NotificationAdminAction,NotificationAction,NotificationMode,NotificationChannel} from '../lib/notification-types';
try{process.loadEnvFile('.env.local');}catch{/* CI passes loopback credentials. */}
const loopback=(v?:string)=>{try{return!!v&&['127.0.0.1','localhost','[::1]'].includes(new URL(v).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('channel overrides, editorial publications and durable campaigns use current account and destination rights',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();const people=[randomUUID(),randomUUID(),randomUUID()],[owner,player,other]=people;
 const oldKey=process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY,oldSdk=process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG;const savedKeys=(await admin.query("select * from dartflow_private.web_push_keys where environment='development'")).rows;
 const act=(actor:string,action:NotificationAction,id=randomUUID())=>executeNotificationCommand(actor,{requestId:id,action});
 const manage=(action:NotificationAdminAction,id=randomUUID(),actor=owner)=>executeNotificationAdminCommand(actor,{requestId:id,action});
 const revisions:Record<string,number>={};
 const rule=async(channel:NotificationChannel,mode:NotificationMode,eventId='friend-request')=>{const k=`${eventId}:${channel}`,r=revisions[k]??0;await manage({type:'policy.set',eventId,channel,mode,expectedRevision:r});revisions[k]=r+1;};
 const selected={kind:'selected' as const,userIds:[player]},draft={kind:'platform' as const,title:'Bericht van DartFlow',body:'Er staat een gecontroleerde update voor je klaar.',audience:selected};
 let releaseId='',campaignId='',webInbox='',subscriptionId='';const installation=randomUUID();
 try{
  process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=Buffer.alloc(32,79).toString('base64');
  process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG=JSON.stringify([{projectId:'dartflow',applicationId:'1:123456789:android:abcdef',senderId:'123456789',apiKey:'synthetic-public-sdk-options-0123456789',packageName:'nl.dartflow.app.dev'}]);
  await admin.query("delete from dartflow_private.web_push_keys where environment='development'");
  for(const id of people)await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed,email,email_verified)values($1,$2,$2,true,$3,true)',[id,`communication${id.slice(0,8)}`,`synthetic-${id}@example.invalid`]);
  await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[owner]);
  await t.test('missing channel choices default on; explicit legacy choices remain effective',async()=>{
   assert.equal(await effectiveNotificationChannel(database(),player,'friend-request','email'),true);
   const settings=await getNotificationSettings(player,'web');assert.equal(settings.subscriptions.length,4);for(const channel of ['web','android']as const)assert.equal(settings.subscriptions.find(s=>s.product==='oche-live'&&s.channel===channel)?.enabled,false);
   await act(player,{type:'product.subscribe',product:'oche-live',channel:'android',enabled:true});const opted=await getNotificationSettings(player,'web');assert.equal(opted.subscriptions.find(s=>s.product==='oche-live'&&s.channel==='android')?.enabled,true);assert.equal(opted.subscriptions.find(s=>s.product==='oche-live'&&s.channel==='web')?.enabled,false);
   await admin.query("insert into dartflow_private.mail_preferences(user_id,category,enabled)values($1,'Sociaal',false)",[other]);
   for(const channel of ['inbox','email','push'] as const)assert.equal(await effectiveNotificationChannel(database(),other,'friend-request',channel),false);
  });
  for(const channel of ['inbox','email','push'] as const)for(const personal of [false,true])for(const mode of ['follow','on','off'] as const)await t.test(`${channel}: personal ${personal}, platform ${mode}`,async()=>{
   await act(player,{type:'preference.set',category:'Sociaal',channel,enabled:personal});await rule(channel,mode);
   const state=await notificationChannelState(database(),player,'friend-request',channel);assert.equal(state.personalEnabled,personal);assert.equal(state.effectiveEnabled,mode==='on'||mode==='follow'&&personal);
   await rule(channel,'follow');assert.equal(await effectiveNotificationChannel(database(),player,'friend-request',channel),personal);
  });
  await t.test('rule changes are revision checked, audited, authorized and receipt replay cannot revive a role',async()=>{
   await assert.rejects(manage({type:'policy.set',eventId:'friend-request',channel:'push',mode:'off',expectedRevision:0}),{code:'revision_conflict'});
   const action={type:'policy.set' as const,eventId:'friend-request',channel:'push' as const,mode:'on' as const,expectedRevision:revisions['friend-request:push']},id=randomUUID();
   await manage(action,id);revisions['friend-request:push']++;await manage(action,id);assert.equal((await admin.query('select count(*)::int n from dartflow_private.notification_rule_audit where actor_id=$1 and event_id=$2 and channel=$3',[owner,'friend-request','push'])).rows[0].n,revisions['friend-request:push']);
   await admin.query('delete from dartflow_private.platform_roles where user_id=$1',[owner]);await assert.rejects(manage(action,id),{code:'forbidden'});await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[owner]);await rule('push','follow');
   await assert.rejects(getNotificationAdmin(player),{code:'forbidden'});
  });
  await t.test('inbox, email and push creation use independent choices, with inbox retained when device push is off',async()=>{
   await act(player,{type:'preference.set',category:'Sociaal',channel:'inbox',enabled:true});await act(player,{type:'preference.set',category:'Sociaal',channel:'email',enabled:false});await act(player,{type:'preference.set',category:'Sociaal',channel:'push',enabled:false});
   await executeNativePushCommand(player,{requestId:randomUUID(),action:{type:'device.register',installationId:randomUUID(),packageName:'nl.dartflow.app.dev',token:'synthetic-native-token-communications-123456789'}});
   const id=`communications:${randomUUID()}`,event={id,templateId:'friend-request',scope:'platform',recipientId:player,variables:{actionUrl:'/app/friends'}};
   await integrationTransaction(c=>enqueueDomainMail(c,event));await integrationTransaction(c=>enqueueDomainMail(c,event));
   const row=(await admin.query('select id,inbox_allowed from dartflow_private.native_push_inbox where event_id=$1',[id])).rows[0];assert.equal(row.inbox_allowed,true);assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[row.id])).rows[0].n,0);
   assert.equal((await admin.query('select status from dartflow_private.mail_outbox where event_id=$1',[id])).rows[0].status,'suppressed');assert.equal((await getNotificationInbox(player,'web')).items.find(i=>i.id===row.id)?.available,true);
  });
  await t.test('queued email is suppressed by a changed effective rule before the ordinary worker delivers',async()=>{
   const oldFcm=process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON,oldMode=process.env.DARTFLOW_MAIL_MAX_MODE;delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;process.env.DARTFLOW_MAIL_MAX_MODE='log';
   try{await act(player,{type:'preference.set',category:'Sociaal',channel:'email',enabled:true});const id=`communications-email-recheck:${randomUUID()}`;
    await integrationTransaction(c=>enqueueDomainMail(c,{id,templateId:'friend-request',scope:'platform',recipientId:player,variables:{actionUrl:'/app/friends'}}));assert.equal((await admin.query('select status from dartflow_private.mail_outbox where event_id=$1',[id])).rows[0].status,'queued');
    await rule('email','off');await processMailBatch();assert.equal((await admin.query('select status from dartflow_private.mail_outbox where event_id=$1',[id])).rows[0].status,'suppressed');await rule('email','follow');
   }finally{if(oldFcm===undefined)delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;else process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=oldFcm;if(oldMode===undefined)delete process.env.DARTFLOW_MAIL_MAX_MODE;else process.env.DARTFLOW_MAIL_MAX_MODE=oldMode;}
  });
  await t.test('editorial save is private and idempotent; publishing queues no communication',async()=>{
   const action={type:'release.save' as const,expectedRevision:0,product:'dartflow' as const,channel:'all' as const,version:`0.6.0-fixture-${owner.slice(0,8)}`,title:'Gecontroleerde release',body:'Nieuwe functies in deze synthetische release.'},id=randomUUID(),first=await executeProductReleaseCommand(owner,{requestId:id,action});releaseId=first.id;
   assert.deepEqual(await executeProductReleaseCommand(owner,{requestId:id,action}),first);await assert.rejects(getProductRelease(player,releaseId),{code:'not_found'});
   await assert.rejects(executeProductReleaseCommand(owner,{requestId:randomUUID(),action}),{code:'release_duplicate'});
   await assert.rejects(executeProductReleaseCommand(player,{requestId:randomUUID(),action}),{code:'forbidden'});
   await executeProductReleaseCommand(owner,{requestId:randomUUID(),action:{type:'release.publish',id:releaseId,expectedRevision:1}});
   assert.equal((await getProductReleases(player,'dartflow','web')).items.some(r=>r.id===releaseId),true);assert.equal((await getProductReleases(player,'oche-live','web')).items.some(r=>r.id===releaseId),false);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.notification_campaigns where release_id=$1',[releaseId])).rows[0].n,0);
   await assert.rejects(executeProductReleaseCommand(owner,{requestId:randomUUID(),action:{type:'release.publish',id:releaseId,expectedRevision:2}}),{code:'published_release'});
  });
  await t.test('test sends reach only their selected recipient and do not become campaigns',async()=>{
   const before=(await admin.query('select count(*)::int n from dartflow_private.notification_campaigns')).rows[0].n;
   const test=await manage({type:'campaign.test',draft,testRecipientId:other});assert.ok(test.id);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.notification_campaigns')).rows[0].n,before);
   const rows=(await admin.query("select recipient_id from dartflow_private.native_push_inbox where event_id=$1",[`campaign-test:${test.id}`])).rows;assert.deepEqual(rows.map(r=>r.recipient_id),[other]);
   assert.equal((await getPlatformMessage(other,test.id!)).title,draft.title);await assert.rejects(getPlatformMessage(player,test.id!),{code:'not_found'});
  });
  await t.test('confirmed campaign survives double clicks and worker retries without a second recipient delivery',async()=>{
   const preview=(await manage({type:'campaign.preview',draft})).preview!;assert.equal(preview.recipientCount,1);assert.equal(preview.inboxCount,1);
   await assert.rejects(manage({type:'campaign.send',previewId:preview.id,confirmation:'no' as 'VERSTUREN'}),{code:'campaign_confirmation'});
   const responses=await Promise.all([manage({type:'campaign.send',previewId:preview.id,confirmation:'VERSTUREN'}),manage({type:'campaign.send',previewId:preview.id,confirmation:'VERSTUREN'})]);assert.equal(responses[0].id,responses[1].id);campaignId=preview.id;
   await processCommunicationCampaigns();await processCommunicationCampaigns();
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${campaignId}`])).rows[0].n,1);
   const summary=await campaignSummary(database(),campaignId);assert.equal(summary.recipientCount,1);assert.ok(summary.actorName);assert.ok(summary.audienceLabel);
   const row=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${campaignId}`])).rows[0];
   await assert.rejects(act(other,{type:'notification.open',id:row.id}),{code:'push_not_found'});const opened=await act(player,{type:'notification.open',id:row.id});assert.equal(opened.href,`/app/platform-messages/${campaignId}`);assert.equal((await getNotificationInbox(player,'web')).items.find(i=>i.id===row.id)?.opened,true);
  });
  await t.test('a changed audience or channel choice requires a fresh preview; admin-only destinations have no player reach',async()=>{
   const preview=(await manage({type:'campaign.preview',draft})).preview!;await act(player,{type:'preference.set',category:'Platformberichten',channel:'inbox',enabled:false});await assert.rejects(manage({type:'campaign.send',previewId:preview.id,confirmation:'VERSTUREN'}),{code:'campaign_audience_changed'});await act(player,{type:'preference.set',category:'Platformberichten',channel:'inbox',enabled:true});
   const blocked=(await manage({type:'campaign.preview',draft:{...draft,href:'/app/admin/notifications'}})).preview!;assert.equal(blocked.recipientCount,0);
   await assert.rejects(manage({type:'campaign.preview',draft:{...draft,href:'https://evil.example/app'}}),{code:'notification_destination'});
  });
  await t.test('product/channel subscriptions preserve explicit opt-out during ordinary app use',async()=>{
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'web',enabled:false});const settings=await getNotificationSettings(player,'web');assert.equal(settings.subscriptions.find(s=>s.product==='dartflow'&&s.channel==='web')?.enabled,false);
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'android',enabled:false});
   const p=(await manage({type:'campaign.preview',draft:{...draft,kind:'release',releaseId}})).preview!;assert.equal(p.recipientCount,0);
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'web',enabled:true});
  });
  await t.test('a device test uses the current personal push choice and rechecks it before transport',async()=>{
   const device=(await admin.query('select id,installation_id from dartflow_private.native_push_devices where user_id=$1 and enabled',[player])).rows[0];assert.ok(device);
   const action={type:'device.test',deviceId:device.id,installationId:device.installation_id};
   await act(player,{type:'preference.set',category:'Sociaal',channel:'push',enabled:false});const off=await executeNativePushCommand(player,{requestId:randomUUID(),action})as unknown as{id:string;status:string};assert.equal(off.status,'suppressed');
   await act(player,{type:'preference.set',category:'Sociaal',channel:'push',enabled:true});const on=await executeNativePushCommand(player,{requestId:randomUUID(),action})as unknown as{id:string;status:string};assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[on.id])).rows[0].status,'queued');
   await act(player,{type:'preference.set',category:'Sociaal',channel:'push',enabled:false});
   const oldFcm=process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON,{privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'dartflow',client_email:'synthetic@dartflow.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
   try{const sent:string[]=[];await processNativePushBatch((async(url,options)=>{if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-device-choice-token',expires_in:3600});assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/dartflow/messages:send');sent.push(JSON.parse(String(options?.body)).message.data.id);return Response.json({name:'projects/dartflow/messages/synthetic-device-choice'});})as typeof fetch);assert.equal(sent.includes(on.id),false);assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[on.id])).rows[0].status,'suppressed');}finally{if(oldFcm===undefined)delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;else process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=oldFcm;}
  });
  await t.test('all-channel releases respect each product transport opt-out at preview, queueing and final dispatch',async()=>{
   const channelInstallation=randomUUID(),ec=createECDH('prime256v1');ec.generateKeys();await act(player,{type:'webpush.register',installationId:channelInstallation,subscription:{endpoint:`https://fcm.googleapis.com/fcm/send/release-channel-${randomUUID()}`,keys:{auth:randomBytes(16).toString('base64url'),p256dh:ec.getPublicKey().toString('base64url')}}});
   const releaseDraft={...draft,kind:'release' as const,releaseId};
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'web',enabled:true});await act(player,{type:'product.subscribe',product:'dartflow',channel:'android',enabled:false});
   const first=(await manage({type:'campaign.preview',draft:releaseDraft})).preview!;assert.equal(first.pushCount,1);await manage({type:'campaign.send',previewId:first.id,confirmation:'VERSTUREN'});await processCommunicationCampaigns();
   const firstInbox=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${first.id}`])).rows[0].id;
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[firstInbox])).rows[0].n,0);assert.equal((await admin.query('select count(*)::int n from dartflow_private.web_push_outbox where inbox_id=$1',[firstInbox])).rows[0].n,1);
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'web',enabled:false});await act(player,{type:'product.subscribe',product:'dartflow',channel:'android',enabled:true});
   const second=(await manage({type:'campaign.preview',draft:releaseDraft})).preview!;assert.equal(second.pushCount,1);await manage({type:'campaign.send',previewId:second.id,confirmation:'VERSTUREN'});await processCommunicationCampaigns();
   const secondInbox=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${second.id}`])).rows[0].id;
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.native_push_outbox where inbox_id=$1',[secondInbox])).rows[0].n,1);assert.equal((await admin.query('select count(*)::int n from dartflow_private.web_push_outbox where inbox_id=$1',[secondInbox])).rows[0].n,0);
   let browserSends=0;await processWebPushBatch((async()=>{browserSends++;return {statusCode:201,body:'',headers:{}};})as Parameters<typeof processWebPushBatch>[0]);assert.equal(browserSends,0);assert.equal((await admin.query('select status from dartflow_private.web_push_outbox where inbox_id=$1',[firstInbox])).rows[0].status,'expired');
   await act(player,{type:'product.subscribe',product:'dartflow',channel:'android',enabled:false});await act(player,{type:'product.subscribe',product:'dartflow',channel:'web',enabled:true});
   const oldFcm=process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON,{privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'dartflow',client_email:'synthetic@dartflow.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
   try{const nativeIds:string[]=[];await processNativePushBatch((async(url,options)=>{if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-channel-token',expires_in:3600});assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/dartflow/messages:send');nativeIds.push(JSON.parse(String(options?.body)).message.data.id);return Response.json({name:'projects/dartflow/messages/synthetic-channel-check'});})as typeof fetch);assert.equal(nativeIds.includes(secondInbox),false);assert.equal((await admin.query('select status from dartflow_private.native_push_outbox where inbox_id=$1',[secondInbox])).rows[0].status,'expired');}finally{if(oldFcm===undefined)delete process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON;else process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON=oldFcm;}
   await act(player,{type:'webpush.revoke',installationId:channelInstallation});
  });
  await t.test('browser endpoints are provider bounded; ciphertext is account-bound and account switching revokes pending delivery',async()=>{
   const ec=createECDH('prime256v1');ec.generateKeys();const subscription={endpoint:`https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`,keys:{auth:randomBytes(16).toString('base64url'),p256dh:ec.getPublicKey().toString('base64url')}};
   assert.throws(()=>validateWebPushSubscription({...subscription,endpoint:'https://127.0.0.1/private'}),{code:'webpush_endpoint'});assert.throws(()=>validateWebPushSubscription({...subscription,endpoint:'https://fcm.googleapis.com.evil.example/send'}),{code:'webpush_endpoint'});
   await act(player,{type:'webpush.register',installationId:installation,subscription});subscriptionId=(await admin.query('select id,subscription_cipher from dartflow_private.web_push_subscriptions where installation_id=$1',[installation])).rows[0].id;
   assert.ok(!JSON.stringify((await admin.query('select subscription_cipher from dartflow_private.web_push_subscriptions where id=$1',[subscriptionId])).rows[0]).includes(subscription.endpoint));
   await rule('push','follow','platform-message');const preview=(await manage({type:'campaign.preview',draft})).preview!;await manage({type:'campaign.send',previewId:preview.id,confirmation:'VERSTUREN'});await processCommunicationCampaigns();webInbox=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${preview.id}`])).rows[0].id;
   let sends=0;await processWebPushBatch((async()=>{sends++;return {statusCode:201,body:'',headers:{}};})as Parameters<typeof processWebPushBatch>[0]);assert.ok(sends>=1);
   const status=(await admin.query('select status,provider_accepted_at,received_at from dartflow_private.web_push_outbox where inbox_id=$1',[webInbox])).rows[0];assert.equal(status.status,'accepted');assert.ok(status.provider_accepted_at);assert.equal(status.received_at,null);
   const delivered=await getWebPushDelivery(player,webInbox,subscriptionId,installation);assert.equal(delivered.href,`/app/notifications/${webInbox}`);assert.ok((await admin.query('select received_at from dartflow_private.web_push_outbox where inbox_id=$1',[webInbox])).rows[0].received_at);
   await assert.rejects(getWebPushDelivery(other,webInbox,subscriptionId,installation),{code:'not_found'});
   await act(other,{type:'webpush.register',installationId:installation,subscription});await assert.rejects(getWebPushDelivery(player,webInbox,subscriptionId,installation),{code:'not_found'});
  });
  await t.test('account deletion commits ahead of a waiting browser dispatch without deadlock or stale delivery',async()=>{
   const otherDraft={...draft,audience:{kind:'selected' as const,userIds:[other]}},preview=(await manage({type:'campaign.preview',draft:otherDraft})).preview!;await manage({type:'campaign.send',previewId:preview.id,confirmation:'VERSTUREN'});await processCommunicationCampaigns();
   const inbox=(await admin.query('select id from dartflow_private.native_push_inbox where event_id=$1',[`campaign:${preview.id}`])).rows[0].id;assert.equal((await admin.query('select count(*)::int n from dartflow_private.web_push_outbox where inbox_id=$1',[inbox])).rows[0].n,1);
   await admin.query('begin');await admin.query('select id from dartflow_private.profiles where id=$1 for update',[other]);let sends=0;const delivery=processWebPushBatch((async()=>{sends++;return {statusCode:201,body:'',headers:{}};})as Parameters<typeof processWebPushBatch>[0]);
   try{
    let waiting=false;for(let attempt=0;attempt<100;attempt++){await admin.query('select pg_stat_clear_snapshot()');const blocked=await admin.query("select 1 from pg_stat_activity where datname=current_database()and pid<>pg_backend_pid()and wait_event_type='Lock'and query like 'select id from dartflow_private.profiles where id=$1 for share%'");if(blocked.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(waiting,true,'dispatch waits for the account boundary before taking an outbox lock');
    await admin.query('update dartflow_private.profiles set deletion_requested_at=now()where id=$1',[other]);await admin.query('commit');await delivery;assert.equal(sends,0);assert.equal((await admin.query('select count(*)::int n from dartflow_private.web_push_outbox where inbox_id=$1',[inbox])).rows[0].n,0);
   }finally{await admin.query('rollback');await delivery;}
  });
  await t.test('runtime cannot rewrite audit, campaign manifests or command receipts',async()=>{
   await assert.rejects(database().query('delete from dartflow_private.notification_campaigns where id=$1',[campaignId]),{code:'42501'});
   await assert.rejects(database().query("update dartflow_private.notification_commands set response='{}' where actor_id=$1",[owner]),{code:'42501'});
   await assert.rejects(database().query("update dartflow_private.notification_rule_audit set new_mode='off' where actor_id=$1",[owner]),{code:'42501'});
  });
 }finally{
  try{
  await admin.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  await admin.query('delete from dartflow_private.notification_rules where updated_by=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.notification_rule_audit where actor_id=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.notification_campaigns where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.product_releases where author_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.mail_preferences where user_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  await admin.query("delete from dartflow_private.web_push_keys where environment='development'");for(const row of savedKeys)await admin.query('insert into dartflow_private.web_push_keys(environment,public_key,private_cipher,created_at)values($1,$2,$3,$4)',[row.environment,row.public_key,row.private_cipher,row.created_at]);
  }finally{await admin.end();await closeDatabase();if(oldKey===undefined)delete process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY;else process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=oldKey;if(oldSdk===undefined)delete process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG;else process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG=oldSdk;}
 }
});
