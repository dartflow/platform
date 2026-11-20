import {randomUUID} from 'node:crypto';
import {database} from './db';
import {DomainError} from './domain';
import {integrationTransaction} from './integrations-core';
import {assertNotificationActor,requireNotificationManager,notificationUuid,notificationText,notificationCommandReceipt,saveNotificationCommand} from './notification-core';
import type {NotificationClient} from './notification-core';
import type {ProductRelease,ProductReleaseCommand,ProductReleaseResult,ReleaseProduct,ReleaseChannel,ProductReleaseAdmin,ProductReleaseList} from './product-release-types';
type ReleaseRow={id:string;product:ReleaseProduct;channel:ReleaseChannel;version:string;title:string;body:string;revision:number;status:'draft'|'published';created_at:Date|string;updated_at:Date|string;published_at:Date|string|null;published_by:string|null};
const stamp=(s:Date|string)=>new Date(s).toISOString();
export const projectProductRelease=(r:ReleaseRow):ProductRelease=>({id:r.id,product:r.product,channel:r.channel,version:r.version,title:r.title,body:r.body,revision:r.revision,status:r.status,createdAt:stamp(r.created_at),updatedAt:stamp(r.updated_at),publishedAt:r.published_at?stamp(r.published_at):null,publishedBy:r.published_by});
export async function readPublishedProductRelease(client:NotificationClient,id:string):Promise<ProductRelease>{const r=(await client.query<ReleaseRow>("select * from dartflow_private.product_releases where id=$1 and status='published'",[notificationUuid(id)])).rows[0];if(!r)throw new DomainError('not_found','Deze release is niet beschikbaar.',404);return projectProductRelease(r);}
export async function getProductRelease(actor:string,id:string){await assertNotificationActor(database(),actor);return readPublishedProductRelease(database(),id);}
export async function getProductReleases(actor:string,product:unknown='dartflow',channel:unknown='web'):Promise<ProductReleaseList>{await assertNotificationActor(database(),actor);if(!['dartflow','oche-live'].includes(String(product))||!['web','android'].includes(String(channel)))throw new DomainError('release_filter','Kies een product en kanaal.');return {items:(await database().query<ReleaseRow>("select * from dartflow_private.product_releases where status='published' and product=$1 and channel in($2,'all')order by published_at desc,id desc limit 100",[product,channel])).rows.map(projectProductRelease)};}
export async function getProductReleaseAdmin(actor:string):Promise<ProductReleaseAdmin>{return integrationTransaction(async c=>{await requireNotificationManager(c,actor);const rows=(await c.query<ReleaseRow>('select * from dartflow_private.product_releases order by updated_at desc,id limit 300')).rows.map(projectProductRelease);return {canManage:true,drafts:rows.filter(r=>r.status==='draft'),published:rows.filter(r=>r.status==='published')};});}
export async function executeProductReleaseCommand(actor:string,command:ProductReleaseCommand):Promise<ProductReleaseResult>{return integrationTransaction(async c=>{
 await requireNotificationManager(c,actor);const prior=await notificationCommandReceipt(c,actor,command.requestId,command.action);if(prior)return prior;
 const a=command.action;if(!a||!['release.save','release.publish'].includes(a.type)||!Number.isSafeInteger(a.expectedRevision)||a.expectedRevision<0)throw new DomainError('release_action','Controleer de release en revisie.');
 const id=a.type==='release.save'?(a.id?notificationUuid(a.id):randomUUID()):notificationUuid(a.id);
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`product-release:${id}`]);
 const current=(await c.query<ReleaseRow>('select * from dartflow_private.product_releases where id=$1 for update',[id])).rows[0];
 if((current?.revision??0)!==a.expectedRevision)throw new DomainError('revision_conflict','Deze release is gewijzigd. Je invoer is bewaard; vernieuw de actuele versie.',409);
 if(current?.status==='published')throw new DomainError('published_release','Deze gepubliceerde release is vastgelegd. Maak een nieuw concept.',409);
 let row:ReleaseRow;
 if(a.type==='release.save'){
  if(!['dartflow','oche-live'].includes(a.product)||!['web','android','all'].includes(a.channel)||typeof a.version!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9.-]{1,40})?$/.test(a.version))throw new DomainError('release_fields','Kies product, kanaal en een geldig versienummer.');
  const title=notificationText(a.title,160),body=notificationText(a.body,15000,true);
  try{row=(await c.query<ReleaseRow>(`insert into dartflow_private.product_releases(id,product,channel,version,title,body,author_id)values($1,$2,$3,$4,$5,$6,$7)on conflict(id)do update set product=excluded.product,channel=excluded.channel,version=excluded.version,title=excluded.title,body=excluded.body,revision=product_releases.revision+1,updated_at=clock_timestamp()returning *`,[id,a.product,a.channel,a.version,title,body,actor])).rows[0];}catch(e){if((e as {code?:string}).code==='23505')throw new DomainError('release_duplicate','Dit product, kanaal en versienummer bestaan al.',409);throw e;}
 }else{
  if(!current)throw new DomainError('not_found','Dit concept bestaat niet.',404);
  row=(await c.query<ReleaseRow>("update dartflow_private.product_releases set status='published',published_at=clock_timestamp(),published_by=$2,revision=revision+1,updated_at=clock_timestamp()where id=$1 returning *",[id,actor])).rows[0];
 }
 const result:ProductReleaseResult={ok:true,id,release:projectProductRelease(row)};await saveNotificationCommand(c,actor,command.requestId,a,result);return result;
});}
