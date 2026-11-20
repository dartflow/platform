import {notificationDestinationApplicable} from './notification-targets';
import {randomUUID} from 'node:crypto';
import {database} from './db';
import {DomainError} from './domain';
import {integrationRuntime,integrationTransaction,exactKeys} from './integrations-core';
import {enqueueDomainMail} from './integrations-mail';
import {readPublishedProductRelease} from './product-releases';
import {effectiveNotificationChannel,notificationUuid,notificationText,notificationHash,safeNotificationPath,requireNotificationManager,notificationCommandReceipt,saveNotificationCommand} from './notification-core';
import type {NotificationClient} from './notification-core';
import type {CommunicationReference} from './notification-events';
import type {CampaignDraft,CampaignPreview,CampaignSummary,NotificationAdminCommand,NotificationResult,NotificationChannel} from './notification-types';

type Resolved={draft:CampaignDraft;product:'dartflow'|'oche-live';channel:'web'|'android'|'all';href:string;templateId:'product-release'|'platform-message'};
type CampaignRow={audience?:CampaignDraft['audience'];id:string;kind:'release'|'platform';release_id:string|null;title:string;body:string;href:string;product:Resolved['product'];channel:Resolved['channel'];actor_id:string;created_at:Date|string;recipient_count:number;inbox_count:number;push_count:number};
const environment=()=>integrationRuntime().environment;
export async function activeNotificationRecipient(client:NotificationClient,id:string){return Boolean((await client.query(`select 1 from dartflow_private.profiles p where p.id=$1 and p.deleted_at is null and p.deletion_requested_at is null and not exists(select 1 from dartflow_private.play_review_accounts r where (r.user_id=p.id or r.companion_user_id=p.id)and not r.enabled)`,[id])).rowCount);}
export async function productRecipientEligible(client:NotificationClient,id:string,product:Resolved['product'],channel:Resolved['channel']){
 if(!await activeNotificationRecipient(client,id))return false;
 const subscriptions=(await client.query('select channel,enabled,expires_at>now() valid from dartflow_private.notification_product_subscriptions where user_id=$1 and product=$2',[id,product])).rows;
 const selected=channel==='all'?['web','android']:[channel];
 for(const c of selected){const row=subscriptions.find(s=>s.channel===c);if(row){if(row.enabled&&row.valid)return true;continue;}if(product==='dartflow'&&c==='web')return true;
  if(product==='dartflow'&&c==='android'&&(await client.query('select 1 from dartflow_private.native_push_devices where environment=$1 and user_id=$2 and enabled and expires_at>now()',[environment(),id])).rowCount)return true;
 }return false;
}
async function pushReachable(client:NotificationClient,id:string,resolved:Resolved){const r=(await client.query(`select
 exists(select 1 from dartflow_private.native_push_devices where environment=$1 and user_id=$2 and enabled and expires_at>now()) native,
 exists(select 1 from dartflow_private.web_push_subscriptions where environment=$1 and user_id=$2 and enabled and expires_at>now()) web`,[environment(),id])).rows[0];const native=resolved.channel!=='web'&&r.native&&(resolved.draft.kind==='platform'||await productRecipientEligible(client,id,resolved.product,'android'));const web=resolved.channel!=='android'&&r.web&&(resolved.draft.kind==='platform'||await productRecipientEligible(client,id,resolved.product,'web'));return native||web;}
async function resolveDraft(client:NotificationClient,value:CampaignDraft,id:string):Promise<Resolved>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('campaign_draft','Controleer het bericht.');exactKeys(value,['kind','releaseId','title','body','audience','href']);
 if(!['release','platform'].includes(value.kind))throw new DomainError('campaign_kind','Kies release of platformbericht.');
 const title=notificationText(value.title,80),body=notificationText(value.body,180),audience=value.audience;
 if(!audience||!['all','selected'].includes(audience.kind))throw new DomainError('campaign_audience','Kies de ontvangers.');
 if(audience.kind==='selected'){if(!Array.isArray(audience.userIds)||!audience.userIds.length||audience.userIds.length>2000)throw new DomainError('campaign_audience','Selecteer 1–2000 spelers.');audience.userIds=[...new Set(audience.userIds.map(notificationUuid))].sort();}
 const draft={...value,title,body,audience};
 if(value.kind==='release'){const release=await readPublishedProductRelease(client,notificationUuid(value.releaseId));return {draft:{...draft,href:undefined},product:release.product,channel:release.channel,href:`/app/whats-new/${release.id}`,templateId:'product-release'};}
 return {draft:{...draft,releaseId:undefined},product:'dartflow',channel:'all',href:value.href?safeNotificationPath(value.href):`/app/platform-messages/${id}`,templateId:'platform-message'};
}
async function recipients(client:NotificationClient,resolved:Resolved){const selected=resolved.draft.audience.kind==='selected'?resolved.draft.audience.userIds:null;const rows=(await client.query<{id:string}>('select id from dartflow_private.profiles where deleted_at is null and deletion_requested_at is null and ($1::uuid[]is null or id=any($1))order by id',[selected])).rows;const ids:string[]=[];for(const r of rows)if(await activeNotificationRecipient(client,r.id)&&(resolved.draft.kind!=='release'||await productRecipientEligible(client,r.id,resolved.product,resolved.channel))&&(!resolved.draft.href||await notificationDestinationApplicable(client,r.id,resolved.href)))ids.push(r.id);return ids;}
async function reach(client:NotificationClient,resolved:Resolved,ids:string[]){let inbox=0,push=0,unreachable=0;for(const id of ids){const i=await effectiveNotificationChannel(client,id,resolved.templateId,'inbox'),p=await effectiveNotificationChannel(client,id,resolved.templateId,'push')&&await pushReachable(client,id,resolved);if(i)inbox++;if(p)push++;if(!i&&!p)unreachable++;}return {inbox,push,unreachable};}
export async function communicationCampaignEligible(client:NotificationClient,recipient:string,reference:Exclude<CommunicationReference,{kind:'support'}>):Promise<boolean>{
 if(!await activeNotificationRecipient(client,recipient))return false;
 if(reference.kind==='test'){const t=(await client.query('select href from dartflow_private.notification_test_messages where id=$1 and environment=$2 and recipient_id=$3 and expires_at>now()',[notificationUuid(reference.messageId),environment(),recipient])).rows[0];return Boolean(t)&&(!t.href||await notificationDestinationApplicable(client,recipient,t.href));}
 const c=(await client.query<CampaignRow>(`select c.* from dartflow_private.notification_campaigns c join dartflow_private.notification_campaign_recipients r on r.campaign_id=c.id and r.recipient_id=$3 where c.id=$1 and c.environment=$2`,[notificationUuid(reference.campaignId),environment(),recipient])).rows[0];
 return Boolean(c)&&(c.kind==='platform'||await productRecipientEligible(client,recipient,c.product,c.channel))&&(c.href===`/app/platform-messages/${c.id}`||await notificationDestinationApplicable(client,recipient,c.href));
}
export async function campaignSummary(client:NotificationClient,id:string):Promise<CampaignSummary>{
 const c=(await client.query<CampaignRow>('select * from dartflow_private.notification_campaigns where id=$1 and environment=$2',[id,environment()])).rows[0];if(!c)throw new DomainError('not_found','Deze verzending bestaat niet.',404);
 const rows=(await client.query<{channel:NotificationChannel;status:string;count:number}>(`select 'inbox' as channel,case when opened_at is null then 'stored' else 'opened' end as status,count(*)::int as count from dartflow_private.native_push_inbox where environment=$2 and reference->'communication'->'reference'->>'campaignId'=$1::text and inbox_allowed group by 2
 union all select 'push',o.status,count(*)::int from dartflow_private.native_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$2 and i.reference->'communication'->'reference'->>'campaignId'=$1::text group by o.status
 union all select 'push',o.status,count(*)::int from dartflow_private.web_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$2 and i.reference->'communication'->'reference'->>'campaignId'=$1::text group by o.status
 union all select 'inbox',case when r.status='queued' then 'planning' else 'ineligible' end,count(*)::int from dartflow_private.notification_campaign_recipients r where campaign_id=$1::uuid and status<>'enqueued' group by 2`,[id,environment()])).rows;
 const errors=(await client.query<{category:string;count:number}>(`select o.error_category category,count(*)::int count from dartflow_private.native_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$2 and i.reference->'communication'->'reference'->>'campaignId'=$1::text and o.error_category is not null group by o.error_category union all select o.error_category,count(*)::int from dartflow_private.web_push_outbox o join dartflow_private.native_push_inbox i on i.id=o.inbox_id where i.environment=$2 and i.reference->'communication'->'reference'->>'campaignId'=$1::text and o.error_category is not null group by o.error_category`,[id,environment()])).rows;
 const actor=(await client.query('select coalesce(nullif(display_name,\'\'),nullif(username,\'\'),name)name from dartflow_private.profile_labels where id=$1',[c.actor_id])).rows[0];
 return {id:c.id,kind:c.kind,releaseId:c.release_id,title:c.title,body:c.body,href:c.href,product:c.product,channel:c.channel,actorId:c.actor_id,actorName:actor?.name??'Voormalige beheerder',audienceLabel:c.audience?.kind==='all'?'Alle in aanmerking komende spelers':c.audience?.kind==='selected'?`${c.audience.userIds.length} geselecteerde spelers`:'Bewaarde doelgroep',createdAt:new Date(c.created_at).toISOString(),recipientCount:c.recipient_count,inboxCount:c.inbox_count,pushCount:c.push_count,statuses:rows,errors};
}
export async function executeCampaignCommand(actor:string,command:NotificationAdminCommand):Promise<NotificationResult>{return integrationTransaction(async c=>{
 await requireNotificationManager(c,actor);const prior=await notificationCommandReceipt(c,actor,command.requestId,command.action);if(prior)return prior;const a=command.action;let result:NotificationResult;
 if(a.type==='campaign.preview'){
  const id=randomUUID(),r=await resolveDraft(c,a.draft,id),ids=await recipients(c,r),counts=await reach(c,r,ids),expiresAt=new Date(Date.now()+15*60000).toISOString();
  const preview:CampaignPreview={id,expiresAt,title:r.draft.title,body:r.draft.body,href:r.href,product:r.product,channel:r.channel,recipientCount:ids.length,inboxCount:counts.inbox,pushCount:counts.push,unreachableCount:counts.unreachable,audience:r.draft.audience};
  await c.query('insert into dartflow_private.notification_previews(id,environment,actor_id,draft,projection,audience_hash,expires_at)values($1,$2,$3,$4,$5,$6,$7)',[id,environment(),actor,JSON.stringify(r.draft),JSON.stringify(preview),notificationHash({ids,counts}),expiresAt]);result={ok:true,id,preview};
 }else if(a.type==='campaign.send'){
  if(a.confirmation!=='VERSTUREN')throw new DomainError('campaign_confirmation','Bevestig de echte verzending expliciet.');const id=notificationUuid(a.previewId);
  const preview=(await c.query('select * from dartflow_private.notification_previews where id=$1 and environment=$2 and actor_id=$3 for update',[id,environment(),actor])).rows[0];if(!preview)throw new DomainError('not_found','Dit voorbeeld hoort niet bij jouw account.',404);
  if((await c.query('select 1 from dartflow_private.notification_campaigns where id=$1',[id])).rowCount)result={ok:true,id,campaign:await campaignSummary(c,id)};
  else{
   if(new Date(preview.expires_at).getTime()<=Date.now())throw new DomainError('campaign_preview_expired','Maak een nieuw voorbeeld voordat je verzendt.',409);
   const r=await resolveDraft(c,preview.draft,id),ids=await recipients(c,r),counts=await reach(c,r,ids);if(notificationHash({ids,counts})!==preview.audience_hash)throw new DomainError('campaign_audience_changed','Bereik of voorkeuren zijn gewijzigd. Bekijk en bevestig een nieuw voorbeeld.',409);
   await c.query('insert into dartflow_private.notification_campaigns(id,environment,preview_id,actor_id,kind,release_id,title,body,href,product,channel,audience,recipient_count,inbox_count,push_count)values($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,environment(),actor,r.draft.kind,r.draft.releaseId??null,r.draft.title,r.draft.body,r.href,r.product,r.channel,JSON.stringify(r.draft.audience),ids.length,counts.inbox,counts.push]);
   await c.query('insert into dartflow_private.notification_campaign_recipients(campaign_id,recipient_id)select $1,unnest($2::uuid[])',[id,ids]);result={ok:true,id,campaign:await campaignSummary(c,id)};
  }
 }else if(a.type==='campaign.test'){
  const id=randomUUID(),recipient=notificationUuid(a.testRecipientId),r=await resolveDraft(c,{...a.draft,audience:{kind:'selected',userIds:[recipient]}},id);if(!await activeNotificationRecipient(c,recipient))throw new DomainError('test_recipient','Kies een actief proefaccount.');
  await c.query('insert into dartflow_private.notification_test_messages(id,environment,actor_id,recipient_id,title,body,href,expires_at)values($1,$2,$3,$4,$5,$6,$7,now()+interval \'1 day\')',[id,environment(),actor,recipient,r.draft.title,r.draft.body,r.draft.kind==='release'?r.href:r.draft.href||null]);
  const href=r.draft.kind==='release'?r.href:r.draft.href||`/app/platform-messages/${id}`;
  await enqueueDomainMail(c,{id:`campaign-test:${id}`,templateId:r.templateId,scope:'platform',recipientId:recipient,actorId:actor,variables:{actionUrl:href},communication:{reference:{kind:'test',messageId:id,product:r.product,channel:r.channel},title:r.draft.title,body:r.draft.body,href}});result={ok:true,id,message:'Test opgeslagen voor uitsluitend de gekozen proefontvanger. Bekijk de kanaalstatus; dit is geen campagne.'};
 }else if(a.type==='campaign.retry'){
  const id=notificationUuid(a.campaignId);await campaignSummary(c,id);
  await c.query("update dartflow_private.native_push_outbox set available_at=now()where status='retry' and inbox_id in(select id from dartflow_private.native_push_inbox where environment=$1 and reference->'communication'->'reference'->>'campaignId'=$2)",[environment(),id]);
  await c.query("update dartflow_private.web_push_outbox set available_at=now()where status='retry' and inbox_id in(select id from dartflow_private.native_push_inbox where environment=$1 and reference->'communication'->'reference'->>'campaignId'=$2)",[environment(),id]);result={ok:true,id,campaign:await campaignSummary(c,id)};
 }else throw new DomainError('campaign_action','Onbekende verzendactie.');
 await saveNotificationCommand(c,actor,command.requestId,a,result);return result;
});}
export async function processCommunicationCampaigns(){return integrationTransaction(async c=>{
 const pending=(await c.query<{campaign_id:string;recipient_id:string}>("select r.campaign_id,r.recipient_id from dartflow_private.notification_campaign_recipients r join dartflow_private.notification_campaigns c on c.id=r.campaign_id where c.environment=$1 and r.status='queued'order by r.created_at,r.campaign_id,r.recipient_id for update of r skip locked limit 50",[environment()])).rows;
 for(const row of pending){const campaign=(await c.query<CampaignRow>('select * from dartflow_private.notification_campaigns where id=$1',[row.campaign_id])).rows[0];const reference={kind:'campaign' as const,campaignId:campaign.id,product:campaign.product,channel:campaign.channel};
  if(!await communicationCampaignEligible(c,row.recipient_id,reference)){await c.query("update dartflow_private.notification_campaign_recipients set status='ineligible'where campaign_id=$1 and recipient_id=$2",[campaign.id,row.recipient_id]);continue;}
  await enqueueDomainMail(c,{id:`campaign:${campaign.id}`,templateId:campaign.kind==='release'?'product-release':'platform-message',scope:'platform',recipientId:row.recipient_id,actorId:campaign.actor_id,variables:{actionUrl:campaign.href},communication:{reference,title:campaign.title,body:campaign.body,href:campaign.href}});
  await c.query("update dartflow_private.notification_campaign_recipients set status='enqueued'where campaign_id=$1 and recipient_id=$2",[campaign.id,row.recipient_id]);
 }return {processed:pending.length};
});}
export async function getPlatformMessage(actor:string,id:string){notificationUuid(id);if(!await activeNotificationRecipient(database(),actor))throw new DomainError('forbidden','Dit account is niet beschikbaar.',403);const message=(await database().query(`select c.id,c.title,c.body,c.created_at,c.href from dartflow_private.notification_campaigns c join dartflow_private.notification_campaign_recipients r on r.campaign_id=c.id and r.recipient_id=$3 where c.id=$1 and c.environment=$2 and c.kind='platform' union all select id,title,body,created_at,href from dartflow_private.notification_test_messages where id=$1 and environment=$2 and recipient_id=$3 and expires_at>now()`,[id,environment(),actor])).rows[0];if(!message)throw new DomainError('not_found','Dit bericht is verlopen of hoort niet bij jouw account.',404);return {id:message.id,title:message.title,body:message.body,createdAt:new Date(message.created_at).toISOString(),...(message.href&&message.href!==`/app/platform-messages/${id}`?{href:message.href}:{})};}
