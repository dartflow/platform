import {safeNext} from './config';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {assertAccountActive} from './account-removal';
import {MAIL_CATALOG} from './integrations-catalog';
import {integrationRuntime} from './integrations-core';
import {NOTIFICATION_CATEGORIES,NOTIFICATION_CHANNELS} from './notification-types';
import type {NotificationCategory,NotificationChannel,NotificationMode,NotificationEventDefinition} from './notification-types';
export type NotificationClient=Pick<PoolClient,'query'>;
export const notificationUuid=(value:unknown):string=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DomainError('invalid_id','Ongeldige verwijzing.');return value;};
export function notificationText(value:unknown,max:number,multiline=false):string{if(typeof value!=='string'||!value.trim()||value.length>max||(multiline?/[^\S\n\r\t]*[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f]/).test(value))throw new DomainError('invalid_text',`Vul tekst in van maximaal ${max} tekens.`);return value.trim();}
export function notificationHash(value:unknown):string{const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
export function notificationCategory(value:string):NotificationCategory{return NOTIFICATION_CATEGORIES.includes(value as NotificationCategory)?value as NotificationCategory:value==='Account'?'Beveiliging':'Sociaal';}
export function notificationEventDefinitions():NotificationEventDefinition[]{return MAIL_CATALOG.filter(t=>!t.readOnly).map(t=>({id:t.id,label:t.label,category:notificationCategory(t.id.startsWith('moderation-')?'Moderatie':t.category),channels:t.id==='support-received'?['email']:['product-release','platform-message'].includes(t.id)?['inbox','push']:t.id==='welcome'?['email','inbox']:[...NOTIFICATION_CHANNELS],trigger:t.trigger}));}
export function notificationEvent(id:string):NotificationEventDefinition{const def=notificationEventDefinitions().find(d=>d.id===id);if(!def)throw new DomainError('notification_event','Deze meldingsgebeurtenis bestaat niet.',404);return def;}
export async function assertNotificationActor(client:NotificationClient,actor:string){notificationUuid(actor);await assertAccountActive(actor,client);if(!(await client.query('select 1 from dartflow_private.profiles where id=$1',[actor])).rowCount)throw new DomainError('forbidden','Dit account is niet beschikbaar.',403);}
export async function canManageNotifications(client:NotificationClient,actor:string){await assertNotificationActor(client,actor);return Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);}
export async function requireNotificationManager(client:NotificationClient,actor:string){if(!await canManageNotifications(client,actor))throw new DomainError('forbidden','Alleen bevoegde platformmedewerkers beheren deze functie.',403);}
export async function notificationChannelState(client:NotificationClient,actor:string,eventId:string,channel:NotificationChannel){
 const def=notificationEvent(eventId),env=integrationRuntime().environment;
 const row=(await client.query(`select
  (select enabled from dartflow_private.notification_preferences where user_id=$1 and category=$2 and channel=$3) personal,
  (select enabled from dartflow_private.mail_preferences where user_id=$1 and category=$2) legacy,
  (select enabled from dartflow_private.mail_preferences where user_id=$1 and category=$4) fallback,
  (select mode from dartflow_private.notification_rules where environment=$5 and event_id=$6 and channel=$3) mode`,[actor,def.category,channel,['Vereniging','Moderatie','Chat'].includes(def.category)?'Sociaal':def.category==='Beveiliging'?'Account':def.category,env,eventId])).rows[0];
 const personalEnabled=row.personal??row.legacy??row.fallback??true,mode:NotificationMode=row.mode??'follow',applicable=def.channels.includes(channel);
 return {personalEnabled,mode,applicable,effectiveEnabled:applicable&&(mode==='on'||mode==='follow'&&personalEnabled)};
}
export async function effectiveNotificationChannel(client:NotificationClient,actor:string,eventId:string,channel:NotificationChannel){return (await notificationChannelState(client,actor,eventId,channel)).effectiveEnabled;}
/** Read-heavy inbox/settings projections share three bounded queries per account. */
export async function notificationStateSnapshot(client:NotificationClient,actor:string){
 const personal=(await client.query('select category,channel,enabled from dartflow_private.notification_preferences where user_id=$1',[actor])).rows;
 const legacy=(await client.query('select category,enabled from dartflow_private.mail_preferences where user_id=$1',[actor])).rows;
 const rules=(await client.query('select event_id,channel,mode from dartflow_private.notification_rules where environment=$1',[integrationRuntime().environment])).rows;
 return (eventId:string,channel:NotificationChannel)=>{
  const def=notificationEvent(eventId),fallback=['Vereniging','Moderatie','Chat'].includes(def.category)?'Sociaal':def.category==='Beveiliging'?'Account':def.category;
  const personalEnabled=personal.find(r=>r.category===def.category&&r.channel===channel)?.enabled??legacy.find(r=>r.category===def.category)?.enabled??legacy.find(r=>r.category===fallback)?.enabled??true;
  const mode:NotificationMode=rules.find(r=>r.event_id===eventId&&r.channel===channel)?.mode??'follow',applicable=def.channels.includes(channel);
  return {personalEnabled,mode,applicable,effectiveEnabled:applicable&&(mode==='on'||mode==='follow'&&personalEnabled)};
 };
}
export async function notificationCommandReceipt(client:NotificationClient,actor:string,requestId:string,action:unknown){
 notificationUuid(requestId);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`notification-command:${integrationRuntime().environment}:${actor}:${requestId}`]);
 const row=(await client.query('select payload_hash,response from dartflow_private.notification_commands where environment=$1 and actor_id=$2 and request_id=$3',[integrationRuntime().environment,actor,requestId])).rows[0];
 if(row&&row.payload_hash!==notificationHash(action))throw new DomainError('request_reused','Deze aanvraag hoort bij andere invoer.',409);return row?.response;
}
export async function saveNotificationCommand(client:NotificationClient,actor:string,requestId:string,action:unknown,response:unknown){await client.query('insert into dartflow_private.notification_commands(environment,actor_id,request_id,payload_hash,response)values($1,$2,$3,$4,$5)',[integrationRuntime().environment,actor,requestId,notificationHash(action),JSON.stringify(response)]);}
export function safeNotificationPath(value:unknown){if(typeof value!=='string'||value.length>300||/[\\%\u0000-\u0020?#]/.test(value)||!/^\/app(?:\/[a-zA-Z0-9-]+){0,5}$/.test(value)||value.includes('..')||safeNext(value)!==value)throw new DomainError('notification_destination','Kies een geldige interne DartFlow-bestemming.');return value;}
