import {randomUUID} from 'node:crypto';
import {database} from './db';
import {DomainError} from './domain';
import {integrationTransaction,integrationRuntime,exactKeys} from './integrations-core';
import {executeNativePushCommand,getNativePush} from './native-push';
import {getWebPushConfiguration,updateWebPushRegistration} from './web-push';
import {NOTIFICATION_CATEGORIES,NOTIFICATION_CHANNELS} from './notification-types';
import type {NotificationSettings,NotificationInbox,NotificationCommand,NotificationAdminCommand,NotificationAdmin,NotificationResult,NotificationMode} from './notification-types';
import {notificationUuid,assertNotificationActor,canManageNotifications,requireNotificationManager,notificationEventDefinitions,notificationEvent,notificationStateSnapshot,notificationCommandReceipt,saveNotificationCommand} from './notification-core';
import type {NotificationClient} from './notification-core';
import {executeCampaignCommand,campaignSummary,productRecipientEligible} from './notification-campaigns';

export async function registerNotificationProductUse(client:NotificationClient,actor:string,channel:'web'|'android'){
 await client.query("insert into dartflow_private.notification_product_subscriptions(user_id,product,channel,enabled,expires_at)values($1,'dartflow',$2,true,now()+interval '90 days')on conflict(user_id,product,channel)do update set expires_at=excluded.expires_at,updated_at=now()where notification_product_subscriptions.expires_at<now()+interval '45 days'",[actor,channel]);
}
export async function getNotificationSettings(actor:string,channel:'web'|'android'):Promise<NotificationSettings>{return integrationTransaction(async c=>{
 await assertNotificationActor(c,actor);await registerNotificationProductUse(c,actor,channel);const definitions=notificationEventDefinitions();const snapshot=await notificationStateSnapshot(c,actor);
 const categories=await Promise.all(NOTIFICATION_CATEGORIES.map(async category=>({category,channels:await Promise.all(NOTIFICATION_CHANNELS.map(async ch=>{
  const defs=definitions.filter(d=>d.category===category&&d.channels.includes(ch)),states=await Promise.all(defs.map(async d=>({eventId:d.id,...snapshot(d.id,ch)})));
  const modes=[...new Set(states.map(s=>s.mode))];return {channel:ch,applicable:states.length>0,personalEnabled:states[0]?.personalEnabled??true,effectiveEnabled:states.some(s=>s.effectiveEnabled),mode:modes.length>1?'mixed' as const:modes[0]??'follow' as const,events:states.map(s=>({eventId:s.eventId,mode:s.mode,effectiveEnabled:s.effectiveEnabled}))};
 }))})));
 const storedSubscriptions=(await c.query<{product:'dartflow'|'oche-live';channel:'web'|'android';enabled:boolean}>('select product,channel,enabled from dartflow_private.notification_product_subscriptions where user_id=$1',[actor])).rows;
 const subscriptions=[];for(const product of ['dartflow','oche-live']as const)for(const subscriptionChannel of ['web','android']as const){const stored=storedSubscriptions.find(s=>s.product===product&&s.channel===subscriptionChannel);subscriptions.push({product,channel:subscriptionChannel,enabled:stored?.enabled??await productRecipientEligible(c,actor,product,subscriptionChannel)});}
 return {categories,webPush:await getWebPushConfiguration(c,actor),canManage:await canManageNotifications(c,actor),subscriptions};
});}
export async function getNotificationInbox(actor:string,channel:'web'|'android'):Promise<NotificationInbox>{await assertNotificationActor(database(),actor);await registerNotificationProductUse(database(),actor,channel);const source=await getNativePush(actor);const items=source.items.map(i=>({id:i.id,category:i.category,title:i.title,body:i.body,createdAt:new Date(i.createdAt).toISOString(),opened:i.opened,available:i.available,...(i.href?{href:i.href}:{})}));return {items,unread:items.filter(i=>!i.opened).length};}
export async function executeNotificationCommand(actor:string,command:NotificationCommand):Promise<NotificationResult>{
 notificationUuid(command?.requestId);if(!command.action||typeof command.action!=='object')throw new DomainError('notification_action','Ongeldige meldingsactie.');
 // Open must re-authorize the target on every retry instead of replaying a stale URL.
 if(command.action.type==='notification.open'){const opened=await executeNativePushCommand(actor,command as unknown as Record<string,unknown>);return {...opened,ok:true};}
 return integrationTransaction(async c=>{
  await assertNotificationActor(c,actor);const prior=await notificationCommandReceipt(c,actor,command.requestId,command.action);if(prior)return prior;const a=command.action;
  if(a.type==='preference.set'){
   exactKeys(a,['type','category','channel','enabled']);if(!NOTIFICATION_CATEGORIES.includes(a.category)||!NOTIFICATION_CHANNELS.includes(a.channel)||typeof a.enabled!=='boolean'||!notificationEventDefinitions().some(d=>d.category===a.category&&d.channels.includes(a.channel)))throw new DomainError('notification_preference','Kies een toepasselijk meldingskanaal.');
   await c.query('insert into dartflow_private.notification_preferences(user_id,category,channel,enabled)values($1,$2,$3,$4)on conflict(user_id,category,channel)do update set enabled=excluded.enabled,updated_at=clock_timestamp()',[actor,a.category,a.channel,a.enabled]);
  }else if(a.type==='product.subscribe'){
   exactKeys(a,['type','product','channel','enabled']);if(!['dartflow','oche-live'].includes(a.product)||!['web','android'].includes(a.channel)||typeof a.enabled!=='boolean')throw new DomainError('notification_subscription','Kies een product en kanaal.');
   await c.query("insert into dartflow_private.notification_product_subscriptions(user_id,product,channel,enabled,expires_at)values($1,$2,$3,$4,now()+interval '90 days')on conflict(user_id,product,channel)do update set enabled=excluded.enabled,expires_at=excluded.expires_at,updated_at=now()",[actor,a.product,a.channel,a.enabled]);
  }else if(a.type==='webpush.register'||a.type==='webpush.revoke'){await updateWebPushRegistration(c,actor,a);}
  else throw new DomainError('notification_action','Onbekende meldingsactie.');
  const result:NotificationResult={ok:true};await saveNotificationCommand(c,actor,command.requestId,a,result);return result;
 });
}
export async function getNotificationAdmin(actor:string):Promise<NotificationAdmin>{return integrationTransaction(async c=>{
 await requireNotificationManager(c,actor);const definitions=notificationEventDefinitions(),rules=(await c.query<{event_id:string;channel:'inbox'|'email'|'push';mode:NotificationMode;revision:number}>('select event_id,channel,mode,revision from dartflow_private.notification_rules where environment=$1',[integrationRuntime().environment])).rows;
 const events=definitions.map(d=>({...d,rules:d.channels.map(channel=>{const rule=rules.find(r=>r.event_id===d.id&&r.channel===channel);return {channel,mode:rule?.mode??'follow' as NotificationMode,revision:rule?.revision??0};})}));
 const ids=(await c.query<{id:string}>('select id from dartflow_private.notification_campaigns where environment=$1 order by created_at desc,id limit 100',[integrationRuntime().environment])).rows;
 const recipients=(await c.query<{id:string;label:string}>("select p.id,coalesce(nullif(p.display_name,''),nullif(p.username,''),p.name)label from dartflow_private.profile_labels p join dartflow_private.profiles a on a.id=p.id where a.deleted_at is null and a.deletion_requested_at is null order by label,p.id limit 2000")).rows;
 const campaigns=[];for(const r of ids)campaigns.push(await campaignSummary(c,r.id));
 const tests=[];const testRows=(await c.query('select id,title,recipient_id,created_at from dartflow_private.notification_test_messages where environment=$1 and actor_id=$2 order by created_at desc,id limit 30',[integrationRuntime().environment,actor])).rows;
 for(const test of testRows){const statuses=(await c.query<{channel:'inbox'|'push';status:string;count:number}>(`select 'inbox' channel,case when opened_at is null then 'stored' else 'opened' end status,count(*)::int count from dartflow_private.native_push_inbox where environment=$1 and event_id=$2 and inbox_allowed group by 2 union all select 'push',o.status,count(*)::int from dartflow_private.native_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$1 and i.event_id=$2 group by o.status union all select 'push',o.status,count(*)::int from dartflow_private.web_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$1 and i.event_id=$2 group by o.status`,[integrationRuntime().environment,`campaign-test:${test.id}`])).rows;tests.push({id:test.id,title:test.title,recipientId:test.recipient_id,recipientLabel:recipients.find(r=>r.id===test.recipient_id)?.label??'Verwijderd account',createdAt:new Date(test.created_at).toISOString(),statuses});}
 return {events,campaigns,tests,recipients};
});}
export async function executeNotificationAdminCommand(actor:string,command:NotificationAdminCommand):Promise<NotificationResult>{
 if(command?.action?.type!=='policy.set')return executeCampaignCommand(actor,command);
 return integrationTransaction(async c=>{
  await requireNotificationManager(c,actor);const prior=await notificationCommandReceipt(c,actor,command.requestId,command.action);if(prior)return prior;const a=command.action;if(a.type!=='policy.set')throw new DomainError('notification_rule','Kies een meldingsregel.');exactKeys(a,['type','eventId','channel','mode','expectedRevision']);
  const def=notificationEvent(a.eventId);if(!def.channels.includes(a.channel)||!['follow','on','off'].includes(a.mode)||!Number.isSafeInteger(a.expectedRevision)||a.expectedRevision<0)throw new DomainError('notification_rule','Controleer gebeurtenis, kanaal en beheerstand.');
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`notification-rule:${integrationRuntime().environment}:${a.eventId}:${a.channel}`]);
  const old=(await c.query('select mode,revision from dartflow_private.notification_rules where environment=$1 and event_id=$2 and channel=$3',[integrationRuntime().environment,a.eventId,a.channel])).rows[0];if((old?.revision??0)!==a.expectedRevision)throw new DomainError('revision_conflict','Deze meldingsregel is gewijzigd. Vernieuw de actuele stand.',409);
  await c.query('insert into dartflow_private.notification_rules(environment,event_id,channel,mode,revision,updated_by)values($1,$2,$3,$4,1,$5)on conflict(environment,event_id,channel)do update set mode=excluded.mode,revision=notification_rules.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()',[integrationRuntime().environment,a.eventId,a.channel,a.mode,actor]);
  await c.query('insert into dartflow_private.notification_rule_audit(id,environment,event_id,channel,actor_id,old_mode,new_mode)values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),integrationRuntime().environment,a.eventId,a.channel,actor,old?.mode??'follow',a.mode]);
  const result:NotificationResult={ok:true};await saveNotificationCommand(c,actor,command.requestId,a,result);return result;
 });
}
