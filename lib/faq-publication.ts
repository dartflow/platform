import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {DomainError} from './domain';
import {assertAccountActive} from './account-removal';
import {filterFaq,getFaq} from './faq';
import type {FaqItem,FaqSnapshot} from './faq';

type Client=Pick<PoolClient,'query'>;
export type FaqDraft={id:string;questionId:string;revision:number;item:FaqItem;audience:NonNullable<FaqItem['audience']>;updatedAt:string};
export type FaqAdmin={published:FaqSnapshot;drafts:FaqDraft[];history:{id:string;version:string;createdAt:string;reason:string}[]};
export type FaqAdminCommand={requestId:string;action:{type:'faq.save'|'faq.publish'|'faq.restore';questionId?:string;draftId?:string;expectedRevision?:number;item?:FaqItem;publicationId?:string;expectedVersion?:string;reason?:string}};
const stamp=(value:Date|string)=>new Date(value).toISOString();
const uuid=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DomainError('invalid_id','Ongeldig aanvraag-ID.');return value;};
const label=(value:unknown,max:number)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new DomainError('invalid_faq','Vul alle velden in binnen de aangegeven lengte.');return value.trim();};
const draft=(row:{id:string;question_id:string;revision:number;item:FaqItem;audience:FaqDraft['audience'];updated_at:Date|string}):FaqDraft=>({id:row.id,questionId:row.question_id,revision:row.revision,item:row.item,audience:row.audience,updatedAt:stamp(row.updated_at)});
async function requireEditor(client:Client,actor:string){await assertAccountActive(actor,client);if(!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount)throw new DomainError('forbidden','Alleen platformbeheer publiceert de gedeelde hulpinhoud.',403);}
async function published(client:Client):Promise<FaqSnapshot>{
 const row=(await client.query<{version:string;items:FaqItem[];created_at:Date}>('select version,items,created_at from dartflow_private.faq_publications order by created_at desc,id desc limit 1')).rows[0];
 return row?{version:row.version,publishedAt:stamp(row.created_at),categories:[...new Set(row.items.map(item=>item.category))],items:row.items}:getFaq();
}
export async function getPublishedFaq(input:Parameters<typeof getFaq>[0]={}):Promise<FaqSnapshot>{
 if(!process.env.DARTFLOW_DATABASE_URL)return getFaq(input);
 return filterFaq(await published(database()),input);
}
export async function getFaqAdmin(actor:string):Promise<FaqAdmin>{
 const client=await database().connect();try{await client.query('begin isolation level repeatable read read only');await requireEditor(client,uuid(actor));
  const current=await published(client),drafts=(await client.query('select * from dartflow_private.faq_drafts order by updated_at desc,id')).rows.map(draft),history=(await client.query<{id:string;version:string;created_at:Date;reason:string}>('select id,version,created_at,reason from dartflow_private.faq_publications order by created_at desc,id desc limit 30')).rows.map(row=>({id:row.id,version:row.version,createdAt:stamp(row.created_at),reason:row.reason}));await client.query('commit');return {published:current,drafts,history};
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
function parseItem(value:unknown):FaqItem{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('invalid_faq','Vul een volledige vraag en antwoord in.');
 const item=value as FaqItem,id=label(item.id,100);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new DomainError('invalid_faq','Gebruik een vaste vraagcode met kleine letters, cijfers en streepjes.');
 const audience=item.audience??'all';if(!['all','player','captain','organizer','club','platform'].includes(audience))throw new DomainError('invalid_faq','Kies een doelgroep.');
 if(!Array.isArray(item.keywords)||item.keywords.length>30||item.keywords.some(word=>typeof word!=='string'||word.length>80))throw new DomainError('invalid_faq','Gebruik maximaal dertig korte zoekwoorden.');
 return {id,question:label(item.question,240),answer:label(item.answer,12000),category:label(item.category,100),keywords:[...new Set(item.keywords.map(word=>word.trim()).filter(Boolean))],audience};
}
export async function executeFaqAdminCommand(actor:string,command:FaqAdminCommand):Promise<{ok:true;id:string;draft?:FaqDraft;version?:string}>{
 const actorId=uuid(actor),requestId=uuid(command?.requestId);if(!command.action||!['faq.save','faq.publish','faq.restore'].includes(command.action.type))throw new DomainError('invalid_action','Onbekende hulpbeheeractie.');
 const client=await database().connect();try{await client.query('begin');await requireEditor(client,actorId);await client.query("select pg_advisory_xact_lock(hashtextextended('dartflow:faq-publication',0))");
  const hash=createHash('sha256').update(JSON.stringify(command.action)).digest('hex'),receipt=(await client.query<{payload_hash:string;response:{ok:true;id:string;draft?:FaqDraft;version?:string}}>('select payload_hash,response from dartflow_private.faq_commands where actor_id=$1 and request_id=$2',[actorId,requestId])).rows[0];
  if(receipt){if(receipt.payload_hash!==hash)throw new DomainError('request_reused','Dit aanvraag-ID hoort bij een andere wijziging.',409);await client.query('commit');return receipt.response;}
  const action=command.action;if(!['faq.save','faq.publish','faq.restore'].includes(action.type))throw new DomainError('invalid_faq','Onbekende helpbeheeractie.');let response:{ok:true;id:string;draft?:FaqDraft;version?:string};
  if(action.type==='faq.save'){
   const item=parseItem(action.item);if(item.id!==action.questionId)throw new DomainError('invalid_faq','De vaste vraagcode kan niet veranderen.');
   const current=(await client.query('select * from dartflow_private.faq_drafts where question_id=$1 for update',[item.id])).rows[0];if(!Number.isSafeInteger(action.expectedRevision)||action.expectedRevision!==(current?.revision??0))throw new DomainError('revision_conflict','Dit concept is inmiddels gewijzigd. Je invoer is bewaard; open de actuele versie ter vergelijking.',409);
   const id=current?.id??randomUUID(),row=(await client.query('insert into dartflow_private.faq_drafts(id,question_id,revision,item,audience,author_id)values($1,$2,1,$3,$4,$5) on conflict(question_id)do update set revision=faq_drafts.revision+1,item=excluded.item,audience=excluded.audience,author_id=excluded.author_id,updated_at=clock_timestamp() returning *',[id,item.id,JSON.stringify(item),item.audience,actorId])).rows[0];response={ok:true,id,draft:draft(row)};
  }else{
   const current=await published(client);if(action.expectedVersion!==current.version)throw new DomainError('revision_conflict','Er is een nieuwere publicatie. Vergelijk die eerst met je wijziging.',409);
   const reason=label(action.reason,1000);let items=current.items;
   if(action.type==='faq.publish'){
    const row=(await client.query('select * from dartflow_private.faq_drafts where id=$1 for update',[uuid(action.draftId)])).rows[0];if(!row)throw new DomainError('not_found','Dit concept bestaat niet.',404);if(row.revision!==action.expectedRevision)throw new DomainError('revision_conflict','Het concept is inmiddels gewijzigd.',409);
    const item=parseItem(row.item);items=current.items.some(value=>value.id===item.id)?current.items.map(value=>value.id===item.id?item:value):[...current.items,item];
   }else{const row=(await client.query<{items:FaqItem[]}>('select items from dartflow_private.faq_publications where id=$1',[uuid(action.publicationId)])).rows[0];if(!row)throw new DomainError('not_found','Deze bewaarde publicatie bestaat niet.',404);items=row.items;}
   const prior=(await client.query<{id:string}>('select id from dartflow_private.faq_publications order by created_at desc,id desc limit 1')).rows[0],id=randomUUID(),version=`${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,17)}-${id.slice(0,8)}`;
   await client.query('insert into dartflow_private.faq_publications(id,version,items,actor_id,reason,previous_id)values($1,$2,$3,$4,$5,$6)',[id,version,JSON.stringify(items),actorId,reason,prior?.id??null]);response={ok:true,id,version};
  }
  await client.query('insert into dartflow_private.faq_commands(actor_id,request_id,payload_hash,response)values($1,$2,$3,$4)',[actorId,requestId,hash,JSON.stringify(response)]);await client.query('commit');return response;
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
