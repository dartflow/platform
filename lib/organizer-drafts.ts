import {createHash,randomUUID} from 'node:crypto';
import type{PoolClient}from'pg';
import {database}from'./db';
import {DomainError}from'./domain';
import {assertAccountActive}from'./account-removal';
import {clubPermission}from'./club-access';
import {containsPrivatePinField}from'./private-pin-fields';
import {uuid}from'./platform-store';
import type{OrganizerDraft,OrganizerDraftCommand,OrganizerDraftKind,OrganizerDraftResponse,OrganizerOwnership}from'./organizer-drafts-types';

type Row={id:string;owner_id:string;kind:OrganizerDraftKind;ownership:OrganizerOwnership;club_id:string|null;name:string;revision:number;step:string;values:Record<string,unknown>;created_at:Date;updated_at:Date};
type Client=Pick<PoolClient,'query'>;
function scope(value:{kind?:unknown;ownership?:unknown;clubId?:unknown}):{kind:OrganizerDraftKind;ownership:OrganizerOwnership;club_id:string|null}{
 if(!['tournament','season'].includes(String(value.kind))||!['personal','club','platform'].includes(String(value.ownership)))throw new DomainError('invalid_draft_scope','Kies een toernooi of seizoen en de bijbehorende organisator.');
 const kind=value.kind as OrganizerDraftKind,ownership=value.ownership as OrganizerOwnership,club_id=ownership==='club'?uuid(value.clubId):null;
 if(ownership!=='club'&&value.clubId)throw new DomainError('invalid_draft_scope','Een persoonlijk of landelijk concept heeft geen clubcontext.');
 if(kind==='season'&&ownership==='personal')throw new DomainError('invalid_draft_scope','Een persoonlijk concept is een toernooi; een competitieseizoen hoort bij club of platform.');
 return{kind,ownership,club_id};
}
async function allowed(client:Client,row:Pick<Row,'kind'|'ownership'|'club_id'|'owner_id'>,actor:string):Promise<boolean>{
 if(row.ownership==='personal')return row.owner_id===actor;
 if(row.ownership==='club')return clubPermission(client,row.club_id!,actor,row.kind==='season'?'competitions.manage':'tournaments.manage');
 return Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);
}
const projection=(row:Row):OrganizerDraft=>({id:row.id,ownerId:row.owner_id,kind:row.kind,ownership:row.ownership,clubId:row.club_id,name:row.name,revision:row.revision,step:row.step,values:row.values,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),canEdit:true});
function validatedValues(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('invalid_draft','Een concept bevat benoemde formuliervelden.');
 let count=0;
 const visit=(item:unknown,depth:number):void=>{
  if(depth>8||++count>2000)throw new DomainError('draft_too_large','Het concept bevat te veel gegevens.',413);
  if(item===null||typeof item==='boolean'||typeof item==='string')return;
  if(typeof item==='number'&&Number.isFinite(item))return;
  if(Array.isArray(item)){for(const child of item)visit(child,depth+1);return;}
  if(item&&typeof item==='object'){for(const[key,child]of Object.entries(item)){if(/password|secret|token|credential|authorization|session|pin(?:code)?$/i.test(key))throw new DomainError('private_field','Bewaar geen inloggegevens of pincodes in een concept.');visit(child,depth+1);}return;}
  throw new DomainError('invalid_draft','Gebruik geldige formulierwaarden.');
 };
 visit(value,0);if(Buffer.byteLength(JSON.stringify(value))>32_768)throw new DomainError('draft_too_large','Het concept is te groot.',413);
 return structuredClone(value as Record<string,unknown>);
}
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value)??'null':Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;

export async function getOrganizerDrafts(actorId:string,options:{kind?:OrganizerDraftKind;clubId?:string}={}):Promise<{drafts:OrganizerDraft[]}>{
 const actor=uuid(actorId),client=database();await assertAccountActive(actor,client);
 const rows=(await client.query<Row>(`select *from dartflow_private.organizer_drafts d where($1::text is null or kind=$1)and($2::uuid is null or club_id=$2)and(
   (ownership='personal'and owner_id=$3)or(ownership='club'and exists(select 1 from dartflow_private.club_memberships m where m.club_id=d.club_id and m.user_id=$3))or(ownership='platform'and exists(select 1 from dartflow_private.platform_roles p where p.user_id=$3 and p.role in('owner','admin'))))order by updated_at desc,id`,[options.kind??null,options.clubId?uuid(options.clubId):null,actor])).rows;
 const drafts:OrganizerDraft[]=[];for(const row of rows)if(await allowed(client,row,actor))drafts.push(projection(row));return{drafts:drafts.slice(0,500)};
}

export async function executeOrganizerDraftCommand(actorId:string,command:OrganizerDraftCommand):Promise<OrganizerDraftResponse>{
 const actor=uuid(actorId),requestId=uuid(command?.requestId),a=command?.action;
 if(!a||!['draft.save','draft.delete'].includes(a.type)||!Number.isSafeInteger(a.expectedRevision)||a.expectedRevision<0)throw new DomainError('invalid_command','Geef een geldig conceptcommando en de verwachte revisie.');
 if(containsPrivatePinField(command))throw new DomainError('private_field','Bewaar geen pincodes of verificatiecodes in een concept.');
 const fingerprint=createHash('sha256').update(canonical(a)).digest('hex'),client=await database().connect();
 try{
  await client.query('begin');await assertAccountActive(actor,client);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`dartflow:organizer-draft-command:${actor}`]);
  const prior=(await client.query<{payload_hash:string;response:OrganizerDraftResponse;owner_id:string;kind:OrganizerDraftKind;ownership:OrganizerOwnership;club_id:string|null}>('select *from dartflow_private.organizer_draft_receipts where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];
  if(prior){if(!await allowed(client,prior,actor))throw new DomainError('forbidden','Je hebt geen actueel recht meer op dit organisatieconcept.',403);if(prior.payload_hash!==fingerprint)throw new DomainError('request_reused','Dit aanvraag-ID is eerder anders voor een concept gebruikt.',409);await client.query('commit');return prior.response;}
  const id=a.id?uuid(a.id):randomUUID();
  const existing=(await client.query<Row>('select *from dartflow_private.organizer_drafts where id=$1 for update',[id])).rows[0];
  let row:Row;
  if(existing){
   if(!await allowed(client,existing,actor))throw new DomainError('forbidden','Je hebt geen actueel recht op dit organisatieconcept.',403);
   if(existing.revision!==a.expectedRevision)throw new DomainError('revision_conflict','Het concept is op een ander apparaat gewijzigd. Laad die versie of bewaar je invoer als nieuw concept.',409);
   row=existing;
  }else{
   if(a.type==='draft.delete'||a.expectedRevision!==0)throw new DomainError('draft_not_found','Dit concept bestaat niet meer.',404);
   const destination=scope(a);row={id,owner_id:actor,...destination,name:'',revision:0,step:'',values:{},created_at:new Date(),updated_at:new Date()};
   if(!await allowed(client,row,actor))throw new DomainError('forbidden','Je hebt geen actueel organisatierecht in deze context.',403);
   if((await client.query<{n:number}>('select count(*)::int n from dartflow_private.organizer_drafts where owner_id=$1',[actor])).rows[0].n>=100)throw new DomainError('draft_limit','Verwijder een oud concept voordat je een nieuw concept bewaart.',409);
  }
  let response:OrganizerDraftResponse;
  if(a.type==='draft.delete'){await client.query('delete from dartflow_private.organizer_drafts where id=$1',[id]);response={ok:true,id};}
  else{
   const destination=scope(a);
   if(destination.kind!==row.kind||destination.ownership!==row.ownership||destination.club_id!==row.club_id)throw new DomainError('draft_scope_locked','Maak een nieuw concept voor een andere organisator of wedstrijdsoort.',409);
   if(typeof a.name!=='string'||!a.name.trim()||a.name.length>120||typeof a.step!=='string'||!a.step.trim()||a.step.length>80)throw new DomainError('invalid_draft','Geef het concept een naam en geldige stap.');
   const values=validatedValues(a.values);
   if(existing)row=(await client.query<Row>('update dartflow_private.organizer_drafts set name=$2,step=$3,values=$4,revision=revision+1,updated_at=clock_timestamp()where id=$1 returning *',[id,a.name.trim(),a.step,JSON.stringify(values)])).rows[0];
   else row=(await client.query<Row>('insert into dartflow_private.organizer_drafts(id,owner_id,kind,ownership,club_id,name,step,values,revision)values($1,$2,$3,$4,$5,$6,$7,$8,1)returning *',[id,actor,row.kind,row.ownership,row.club_id,a.name.trim(),a.step,JSON.stringify(values)])).rows[0];
   response={ok:true,id,draft:projection(row)};
  }
  await client.query('insert into dartflow_private.organizer_draft_receipts(actor_id,request_id,payload_hash,response,owner_id,kind,ownership,club_id)values($1,$2,$3,$4,$5,$6,$7,$8)',[actor,requestId,fingerprint,JSON.stringify(response),row.owner_id,row.kind,row.ownership,row.club_id]);
  await client.query('commit');return response;
 }catch(error){await client.query('rollback');if(error&&typeof error==='object'&&'code'in error&&error.code==='23505')throw new DomainError('revision_conflict','Dit concept is gelijktijdig aangemaakt. Laad de opgeslagen versie.',409);throw error;}finally{client.release();}
}
