import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,getMatch} from './db';
import {DomainError} from './domain';
import {assertAccountActive} from './account-removal';
import {clubIsActiveMember} from './club-access';
import {getSeason} from './seasons';
import {integrationRuntime,integrationTransaction,exactKeys} from './integrations-core';
import {domainMailApplicable,mailActionPath} from './integrations-mail';
import type {DomainMailEvent,DomainMailApplicability} from './integrations-mail';
import {PUSH_CATEGORIES,publicPushConfig,pushPackage,pushTokenHash,encryptPushToken,decryptPushToken,fcmCredentialsConfigured,fcmAccessToken,pushMessage} from './native-push-config';

type Client=Pick<PoolClient,'query'>;
type Inbox={id:string;recipient_id:string;template_id:string;category:string;scope_key:string;reference:DomainMailApplicability;action_path:string;expires_at:string;created_at:string;opened_at:string|null};
const uuid=(value:unknown):string=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DomainError('push_id','Ongeldige meldingsaanvraag.');return value;};
export const pushCategory=(category:string)=>PUSH_CATEGORIES.includes(category as typeof PUSH_CATEGORIES[number])?category:category==='Vereniging'?'Sociaal':null;
const enabled=async(client:Client,actor:string,category:string)=>(await client.query('select enabled from dartflow_private.mail_preferences where user_id=$1 and category=$2',[actor,category])).rows[0]?.enabled!==false;

/** Called in the existing authorized domain transaction, after the domain event dedupe. */
export async function enqueueNativePush(client:PoolClient,event:DomainMailEvent,category:string,templateEnabled:boolean):Promise<void>{
 const mapped=pushCategory(category);if(!mapped||!templateEnabled||!await enabled(client,event.recipientId,mapped))return;
 if(!(await client.query('select id from dartflow_private.profiles where id=$1 and deletion_requested_at is null and deleted_at is null for share',[event.recipientId])).rowCount)return;
 const environment=integrationRuntime().environment,id=randomUUID(),expiresAt=event.expiresAt||new Date(Date.now()+7*86400000).toISOString();
 const reference:DomainMailApplicability={templateId:event.templateId,recipientId:event.recipientId,eventId:event.id,entityId:event.entityId,entityRevision:event.entityRevision,call:event.call,reminder:event.reminder,expiresAt};
 const inserted=await client.query('insert into dartflow_private.native_push_inbox(id,environment,recipient_id,event_id,template_id,category,scope_key,reference,action_path,expires_at)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)on conflict(environment,recipient_id,event_id,template_id)do nothing returning id',[id,environment,event.recipientId,event.id,event.templateId,mapped,event.scope,JSON.stringify(reference),mailActionPath(event.templateId,event.entityId,event.variables.actionUrl),expiresAt]);
 if(!inserted.rowCount)return;
 await client.query("insert into dartflow_private.native_push_outbox(id,inbox_id,device_id,recipient_id,status)select gen_random_uuid(),$1,d.id,$2,'queued' from dartflow_private.native_push_devices d where d.environment=$3 and d.user_id=$2 and d.enabled and d.expires_at>now() on conflict(inbox_id,device_id)do nothing",[id,event.recipientId,environment]);
}

/** No identity, score, name, chat text or private routing data appears on a lock screen. */
export function pushSafeText(category:string){return {title:'DartFlow',body:category==='Competitie'?'Er is een update over je competitie. Open DartFlow voor de actuele informatie.':category==='Toernooien'?'Er is een update over je toernooi. Open DartFlow voor de actuele informatie.':category==='Wedstrijden'?'Er is een wedstrijdmelding. Open DartFlow voor de actuele informatie.':'Er staat een nieuwe melding voor je klaar. Open DartFlow voor de actuele informatie.'};}

async function applicable(client:Client,row:Inbox):Promise<boolean>{
 try{await assertAccountActive(row.recipient_id,client);}catch{return false;}
 if(Date.parse(row.expires_at)<=Date.now()||!await enabled(client,row.recipient_id,row.category)||!await domainMailApplicable(client,{...row.reference,recipientId:row.recipient_id}))return false;
 const match=/^\/wedstrijd\/([0-9a-f-]{36})$/.exec(row.action_path);if(match){try{await getMatch(row.recipient_id,match[1]);return true;}catch{return false;}}
 const season=/^\/app\/competities\/([0-9a-f-]{36})$/.exec(row.action_path);if(season){try{await getSeason(row.recipient_id,season[1]);return true;}catch{return false;}}
 const entity=/^\/app\/(?:clubs|leagues|tournaments|lobby|hall|community)\/([0-9a-f-]{36})$/.exec(row.action_path);if(entity){
  const result=await client.query("select e.*,m.status member_status from dartflow_private.platform_entities e left join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$2 where e.id=$1 and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$2 and b.target_id=e.owner_id)or(b.target_id=$2 and b.source_id=e.owner_id)))",[entity[1],row.recipient_id]);const e=result.rows[0];if(!e||e.member_status==='banned'||['inactive','deleted'].includes(e.state?.lifecycle))return false;
  if(e.club_id&&!await clubIsActiveMember(client,e.club_id,row.recipient_id)&&!(['league','tournament'].includes(e.kind)&&['all','code'].includes(e.state?.eligibility)))return false;
  return e.owner_id===row.recipient_id||['active','invited','pending','waitlisted'].includes(e.member_status)||e.visibility==='public';
 }
 return /^\/app(?:\/(?:friends|mymatches|leagues|tournaments|clubs|hall|community))?$/.test(row.action_path);
}

export async function getNativePush(actor:string){
 await assertAccountActive(actor);const environment=integrationRuntime().environment,client=database();
 const inbox=(await client.query<Inbox>('select * from dartflow_private.native_push_inbox where environment=$1 and recipient_id=$2 order by created_at desc,id limit 100',[environment,actor])).rows;
 const preferences=(await client.query('select category,enabled from dartflow_private.mail_preferences where user_id=$1',[actor])).rows;
 return {sdk:publicPushConfig(),transportConfigured:fcmCredentialsConfigured(),packageName:pushPackage(),preferences:PUSH_CATEGORIES.map(category=>({category,enabled:preferences.find(p=>p.category===category)?.enabled!==false})),items:await Promise.all(inbox.map(async row=>({id:row.id,category:row.category,...pushSafeText(row.category),createdAt:row.created_at,opened:!!row.opened_at,available:await applicable(client,row)})))};
}

export async function executeNativePushCommand(actor:string,input:Record<string,unknown>){
 exactKeys(input,['requestId','action']);uuid(input.requestId);if(!input.action||typeof input.action!=='object'||Array.isArray(input.action))throw new DomainError('push_action','Ongeldige meldingsactie.');const a=input.action as Record<string,unknown>;
 await assertAccountActive(actor);const environment=integrationRuntime().environment;
 if(a.type==='device.register'){
  exactKeys(a,['type','installationId','packageName','token']);const installation=uuid(a.installationId);if(a.packageName!==pushPackage()||!publicPushConfig())throw new DomainError('push_configuration','Meldingen zijn voor deze appomgeving nog niet ingericht.',503);
  if(typeof a.token!=='string'||a.token.length<20||a.token.length>4096||!/^[A-Za-z0-9_:.-]+$/.test(a.token))throw new DomainError('push_token','Ongeldige toestelregistratie.');const token=a.token;
  return integrationTransaction(async client=>{await client.query('select id from dartflow_private.profiles where id=$1 for share',[actor]);await assertAccountActive(actor,client);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`push-user:${environment}:${actor}`]);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`push:${environment}:${installation}`]);
   // Token rotation/account switching invalidates the previous binding and pending deliveries.
   await client.query('delete from dartflow_private.native_push_devices where environment=$1 and token_hash=$2 and installation_id<>$3',[environment,pushTokenHash(token),installation]);
   const prior=(await client.query('select id,user_id from dartflow_private.native_push_devices where environment=$1 and installation_id=$2 for update',[environment,installation])).rows[0];if(prior&&prior.user_id!==actor)await client.query('delete from dartflow_private.native_push_devices where id=$1',[prior.id]);
   if(prior?.user_id!==actor&&(await client.query('select count(*)::int n from dartflow_private.native_push_devices where environment=$1 and user_id=$2 and enabled',[environment,actor])).rows[0].n>=25)throw new DomainError('push_device_limit','Verwijder eerst een oude toestelregistratie voordat je opnieuw meldingen inschakelt.',409);
   const id=prior?.user_id===actor?prior.id:randomUUID();await client.query('insert into dartflow_private.native_push_devices(id,environment,user_id,installation_id,package_name,token_hash,token_cipher,expires_at)values($1,$2,$3,$4,$5,$6,$7,now()+interval \'90 days\')on conflict(environment,installation_id)do update set user_id=excluded.user_id,token_hash=excluded.token_hash,token_cipher=excluded.token_cipher,enabled=true,last_seen_at=now(),expires_at=excluded.expires_at',[id,environment,actor,installation,pushPackage(),pushTokenHash(token),JSON.stringify(encryptPushToken(token,actor,installation))]);return {ok:true,deviceId:id};});
 }
 if(a.type==='device.revoke'){exactKeys(a,['type','installationId']);await database().query('update dartflow_private.native_push_devices set enabled=false where environment=$1 and user_id=$2 and installation_id=$3',[environment,actor,uuid(a.installationId)]);return {ok:true};}
 if(a.type==='preference'){exactKeys(a,['type','category','enabled']);if(!PUSH_CATEGORIES.includes(a.category as typeof PUSH_CATEGORIES[number])||typeof a.enabled!=='boolean')throw new DomainError('push_preference','Kies een geldige meldingsvoorkeur.');await database().query('insert into dartflow_private.mail_preferences(user_id,category,enabled)values($1,$2,$3)on conflict(user_id,category)do update set enabled=excluded.enabled',[actor,a.category,a.enabled]);return {ok:true};}
 if(a.type==='notification.open'){
  exactKeys(a,['type','id']);const row=(await database().query<Inbox>('select * from dartflow_private.native_push_inbox where id=$1 and environment=$2 and recipient_id=$3',[uuid(a.id),environment,actor])).rows[0];if(!row)throw new DomainError('push_not_found','Deze melding hoort niet bij je huidige account of bestaat niet meer.',404);
  if(!await applicable(database(),row))return {ok:true,available:false,message:'Deze melding is verlopen of ingetrokken, of je hebt geen toegang meer. Open Vandaag voor de actuele informatie.'};
  await database().query('update dartflow_private.native_push_inbox set opened_at=coalesce(opened_at,now())where id=$1',[row.id]);return {ok:true,available:true,href:row.action_path};
 }
 if(a.type==='delivery.ack'){
  exactKeys(a,['type','id','deviceId','stage']);if(!['received','opened'].includes(String(a.stage)))throw new DomainError('push_ack','Ongeldige ontvangstbevestiging.');
  await database().query(`update dartflow_private.native_push_outbox o set status=case when o.status='opened' then 'opened' else $4 end,received_at=coalesce(received_at,now()),opened_at=case when $4='opened' then coalesce(opened_at,now())else opened_at end,updated_at=now()from dartflow_private.native_push_devices d where o.inbox_id=$1 and o.device_id=$2 and o.recipient_id=$3 and d.id=o.device_id and d.user_id=$3 and d.enabled and d.environment=$5`,[uuid(a.id),uuid(a.deviceId),actor,a.stage,environment]);return {ok:true};
 }
 throw new DomainError('push_action','Onbekende meldingsactie.');
}

/** Existing mail timer invokes this. FCM acceptance is not counted as device delivery. */
export async function processNativePushBatch(fetcher:typeof fetch=fetch):Promise<{processed:number}>{
 const environment=integrationRuntime().environment;if(!fcmCredentialsConfigured())return {processed:0};
 const jobs=await integrationTransaction(async client=>(await client.query(`with due as(select o.id from dartflow_private.native_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$1 and((o.status in('queued','retry')and o.available_at<=now())or(o.status='processing'and o.lease_until<now()))order by o.available_at,o.id for update of o skip locked limit 3)update dartflow_private.native_push_outbox o set status='processing',claim_token=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1 from due where due.id=o.id returning o.*`,[environment,randomUUID()])).rows);
 await Promise.all(jobs.map(async job=>{let status='failed',error:string|null=null,provider:string|null=null;const dispatch=await database().connect();try{
  await dispatch.query('begin');
  // Share lock orders transport before a concurrent soft-deletion commit.
  await dispatch.query('select id from dartflow_private.profiles where id=$1 for share',[job.recipient_id]);
  const lease=await dispatch.query("select id from dartflow_private.native_push_outbox where id=$1 and claim_token=$2 and status='processing' and lease_until>clock_timestamp() for update",[job.id,job.claim_token]);if(!lease.rowCount){await dispatch.query('commit');return;}
  await dispatch.query("update dartflow_private.native_push_outbox set lease_until=clock_timestamp()+interval '2 minutes'where id=$1 and claim_token=$2",[job.id,job.claim_token]);
  const row=(await dispatch.query<Inbox>('select * from dartflow_private.native_push_inbox where id=$1',[job.inbox_id])).rows[0],device=(await dispatch.query('select * from dartflow_private.native_push_devices where id=$1 and user_id=$2 and environment=$3 and enabled and expires_at>now()',[job.device_id,job.recipient_id,environment])).rows[0];
  if(!row||!device||!await applicable(dispatch,row)){status='expired';}else if(job.attempts>5){status='uncertain';error='retry-limit';}else{
   const token=decryptPushToken(device.token_cipher,device.user_id,device.installation_id),access=await fcmAccessToken(fetcher),response=await fetcher('https://fcm.googleapis.com/v1/projects/dartflow/messages:send',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify(pushMessage(row.id,device.id,row.category,token))});
   if(response.ok){const value=await response.json();if(typeof value.name==='string'&&value.name.startsWith('projects/dartflow/messages/')){status='accepted';provider=value.name.slice(0,240);}else{status='uncertain';error='invalid-provider-result';}}
   else if(response.status===404){status='expired';error='token-unregistered';await dispatch.query('update dartflow_private.native_push_devices set enabled=false where id=$1',[device.id]);}
   else if(response.status===429||response.status>=500){status='retry';error='provider-temporary';}
   else{status='failed';error=[401,403].includes(response.status)?'provider-credentials':'provider-rejected';}
  }
 await dispatch.query('commit');
 }catch{await dispatch.query('rollback').catch(()=>{});status='retry';error='transport-unknown';}finally{dispatch.release();}
  await database().query("update dartflow_private.native_push_outbox set status=$3,error_category=$4,provider_id=$5,claim_token=null,lease_until=null,available_at=now()+interval '2 minutes',updated_at=now()where id=$1 and claim_token=$2 and status='processing' and lease_until>clock_timestamp()",[job.id,job.claim_token,status,error,provider]);
 }));
 await database().query("delete from dartflow_private.native_push_inbox where environment=$1 and expires_at<now()-interval '30 days'",[environment]);await database().query("delete from dartflow_private.native_push_devices where environment=$1 and expires_at<now()",[environment]);return {processed:jobs.length};
}
