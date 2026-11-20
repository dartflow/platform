import {createCipheriv,createDecipheriv,randomBytes,randomUUID,createHash,ECDH} from 'node:crypto';
import * as webpush from 'web-push';
import type {PoolClient} from 'pg';
import {database} from './db';
import {DomainError} from './domain';
import {integrationRuntime,integrationTransaction} from './integrations-core';
import {notificationUuid,assertNotificationActor,effectiveNotificationChannel} from './notification-core';
import type {NotificationClient} from './notification-core';
import type {NotificationAction} from './notification-types';
import {nativeInboxApplicable,pushSafeText,pushTransportApplicable} from './native-push';
import type {NativeInboxRow} from './native-push';
type Subscription={endpoint:string;keys:{p256dh:string;auth:string}};
const environment=()=>integrationRuntime().environment;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function key(){const v=Buffer.from(process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY??'','base64');if(v.length!==32)throw new DomainError('webpush_configuration','Browsermeldingen zijn nog niet ingericht.',503);return v;}
function encrypt(value:unknown,binding:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(`dartflow:webpush:1:${environment()}:${binding}`));const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')};}
function decrypt(value:Record<string,string>,binding:string){const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(value.iv,'base64'));cipher.setAAD(Buffer.from(`dartflow:webpush:1:${environment()}:${binding}`));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString());}
export function validateWebPushSubscription(input:unknown):Subscription{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('webpush_subscription','Ongeldige browserregistratie.');const s=input as Subscription;
 let u:URL;try{u=new URL(s.endpoint);}catch{throw new DomainError('webpush_endpoint','Ongeldig browsermeldingsadres.');}
 const h=u.hostname.toLowerCase(),hosts=['fcm.googleapis.com','android.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'];
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||s.endpoint.length>3000||!(hosts.includes(h)||h.endsWith('.notify.windows.com')))throw new DomainError('webpush_endpoint','Deze browsermeldingsdienst wordt niet ondersteund.');
 if(!s.keys||typeof s.keys.auth!=='string'||typeof s.keys.p256dh!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth)||!/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh))throw new DomainError('webpush_keys','Ongeldige browsermeldingssleutels.');
 try{ECDH.convertKey(Buffer.from(s.keys.p256dh,'base64url'),'prime256v1');}catch{throw new DomainError('webpush_keys','Ongeldige browsermeldingssleutels.');}return {endpoint:u.href,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
async function vapidKeys(client:NotificationClient){
 key();const existing=(await client.query('select public_key,private_cipher from dartflow_private.web_push_keys where environment=$1',[environment()])).rows[0];if(existing)return {publicKey:existing.public_key,privateKey:decrypt(existing.private_cipher,'vapid') as string};
 const generated=webpush.generateVAPIDKeys();await client.query('insert into dartflow_private.web_push_keys(environment,public_key,private_cipher)values($1,$2,$3)on conflict(environment)do nothing',[environment(),generated.publicKey,JSON.stringify(encrypt(generated.privateKey,'vapid'))]);const row=(await client.query('select public_key,private_cipher from dartflow_private.web_push_keys where environment=$1',[environment()])).rows[0];return {publicKey:row.public_key,privateKey:decrypt(row.private_cipher,'vapid') as string};
}
export async function getWebPushConfiguration(client:NotificationClient,actor:string){try{const k=await vapidKeys(client);return {supported:true,publicKey:k.publicKey,registered:Boolean((await client.query('select 1 from dartflow_private.web_push_subscriptions where environment=$1 and user_id=$2 and enabled and expires_at>now()',[environment(),actor])).rowCount)};}catch(e){if(e instanceof DomainError&&e.code==='webpush_configuration')return {supported:false,publicKey:null,registered:false};throw e;}}
export async function updateWebPushRegistration(client:PoolClient,actor:string,action:Extract<NotificationAction,{type:'webpush.register'|'webpush.revoke'}>){
 await client.query('select id from dartflow_private.profiles where id=$1 for share',[actor]);await assertNotificationActor(client,actor);const installation=notificationUuid(action.installationId);
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`webpush:${environment()}:${installation}`]);
 if(action.type==='webpush.revoke'){await client.query('update dartflow_private.web_push_subscriptions set enabled=false where environment=$1 and installation_id=$2 and user_id=$3',[environment(),installation,actor]);return;}
 const subscription=validateWebPushSubscription(action.subscription);await vapidKeys(client);
 await client.query('delete from dartflow_private.web_push_subscriptions where environment=$1 and (installation_id=$2 or endpoint_hash=$3)and user_id<>$4',[environment(),installation,hash(subscription.endpoint),actor]);
 if((await client.query('select count(*)::int n from dartflow_private.web_push_subscriptions where environment=$1 and user_id=$2 and enabled and installation_id<>$3',[environment(),actor,installation])).rows[0].n>=25)throw new DomainError('webpush_limit','Verwijder eerst een oude browserregistratie.',409);
 await client.query('delete from dartflow_private.web_push_subscriptions where environment=$1 and endpoint_hash=$2 and installation_id<>$3',[environment(),hash(subscription.endpoint),installation]);
 await client.query('insert into dartflow_private.web_push_subscriptions(id,environment,user_id,installation_id,endpoint_hash,subscription_cipher,expires_at)values($1,$2,$3,$4,$5,$6,now()+interval \'90 days\')on conflict(environment,installation_id)do update set user_id=excluded.user_id,endpoint_hash=excluded.endpoint_hash,subscription_cipher=excluded.subscription_cipher,enabled=true,expires_at=excluded.expires_at,last_seen_at=now()',[randomUUID(),environment(),actor,installation,hash(subscription.endpoint),JSON.stringify(encrypt(subscription,`${actor}:${installation}`))]);
}
export async function enqueueWebPush(client:PoolClient,inboxId:string,actor:string){await client.query("insert into dartflow_private.web_push_outbox(id,inbox_id,subscription_id)select gen_random_uuid(),$1,s.id from dartflow_private.web_push_subscriptions s where s.environment=$2 and s.user_id=$3 and s.enabled and s.expires_at>now()on conflict(inbox_id,subscription_id)do nothing",[inboxId,environment(),actor]);}
export async function processWebPushBatch(sender:typeof webpush.sendNotification=webpush.sendNotification){
 const jobs=await integrationTransaction(async c=>{const token=randomUUID();return (await c.query("with due as(select o.id from dartflow_private.web_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$1 and ((o.status in('queued','retry')and o.available_at<=now())or(o.status='processing'and o.lease_until<now()))order by o.available_at,o.id for update of o skip locked limit 10)update dartflow_private.web_push_outbox o set status='processing',claim_token=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()from due where o.id=due.id returning o.*",[environment(),token])).rows;});
 for(const job of jobs)await integrationTransaction(async c=>{
  const recipient=(await c.query('select recipient_id from dartflow_private.native_push_inbox where id=$1',[job.inbox_id])).rows[0];if(!recipient)return;
  // Account deletion locks this profile before cascading into subscriptions/outbox.
  await c.query('select id from dartflow_private.profiles where id=$1 for share',[recipient.recipient_id]);
  const locked=(await c.query("select id from dartflow_private.web_push_outbox where id=$1 and claim_token=$2 and status='processing'and lease_until>clock_timestamp()for update",[job.id,job.claim_token])).rowCount;if(!locked)return;
  const row=(await c.query<NativeInboxRow>('select * from dartflow_private.native_push_inbox where id=$1',[job.inbox_id])).rows[0];const subscription=(await c.query('select * from dartflow_private.web_push_subscriptions where id=$1 and environment=$2 and enabled and expires_at>now()',[job.subscription_id,environment()])).rows[0];
  let status='expired',error:string|null=null,accepted=false;
  if(row&&subscription&&subscription.user_id===row.recipient_id&&await nativeInboxApplicable(c,row)&&await pushTransportApplicable(c,row,'web')){
   if(!await effectiveNotificationChannel(c,row.recipient_id,row.template_id,'push')){status='suppressed';error='channel-disabled';}else if(job.attempts>5){status='uncertain';error='retry-limit';}else try{
    const k=await vapidKeys(c),payload={id:row.id,subscriptionId:subscription.id,installationId:subscription.installation_id,category:row.category};
    await sender(validateWebPushSubscription(decrypt(subscription.subscription_cipher,`${subscription.user_id}:${subscription.installation_id}`)),JSON.stringify(payload),{TTL:300,timeout:12000,urgency:'high',vapidDetails:{subject:`${integrationRuntime().origin}/help`,publicKey:k.publicKey,privateKey:k.privateKey}});status='accepted';accepted=true;
   }catch(e){const code=(e as {statusCode?:number}).statusCode;if(code===404||code===410){status='expired';error='target-unregistered';await c.query('update dartflow_private.web_push_subscriptions set enabled=false where id=$1',[subscription.id]);}else if(code===429||code&&code>=500||!code){status='retry';error='provider-temporary';}else{status='failed';error='provider-rejected';}}
  }
  await c.query("update dartflow_private.web_push_outbox set status=case when opened_at is not null then 'opened' when received_at is not null then 'received' else $3 end,error_category=$4,provider_accepted_at=case when $5 then now()else provider_accepted_at end,claim_token=null,lease_until=null,available_at=now()+interval '2 minutes',updated_at=now()where id=$1 and claim_token=$2",[job.id,job.claim_token,status,error,accepted]);
 });return {processed:jobs.length};
}
/** Cookie authentication and current subscription binding are required on receipt. */
export async function getWebPushDelivery(actor:string,id:string,subscriptionId:unknown,installationId:unknown){
 await assertNotificationActor(database(),actor);const row=(await database().query<NativeInboxRow>('select i.* from dartflow_private.native_push_inbox i join dartflow_private.web_push_outbox o on o.inbox_id=i.id join dartflow_private.web_push_subscriptions s on s.id=o.subscription_id where i.id=$1 and i.recipient_id=$2 and i.environment=$3 and s.id=$4 and s.installation_id=$5 and s.user_id=$2 and s.enabled and s.expires_at>now()and o.status in(\'processing\',\'accepted\',\'received\',\'opened\')',[notificationUuid(id),actor,environment(),notificationUuid(subscriptionId),notificationUuid(installationId)])).rows[0];
 if(!row||!await nativeInboxApplicable(database(),row)||!await pushTransportApplicable(database(),row,'web')||!await effectiveNotificationChannel(database(),actor,row.template_id,'push'))throw new DomainError('not_found','Deze browsermelding is niet beschikbaar.',404);
 await database().query("update dartflow_private.web_push_outbox set received_at=coalesce(received_at,now()),status=case when status='opened' then 'opened' else 'received' end,updated_at=now()where inbox_id=$1 and subscription_id=$2",[row.id,subscriptionId]);
 return {id:row.id,...pushSafeText(row.category),...(row.reference.communication?{title:row.reference.communication.title,body:row.reference.communication.body}:{}),href:`/app/notifications/${row.id}`};
}
