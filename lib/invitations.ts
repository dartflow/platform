import { createHash, randomInt } from 'node:crypto';
import { DomainError } from './domain';
import { eventAccess } from './db';
import type { Client, EntityRow } from './platform-store';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const unavailable=()=>new DomainError('invalid_invitation','Deze uitnodiging is ongeldig of niet beschikbaar.',404);
/** randomInt uses rejection sampling, so every character has the same probability. */
export function generateInvitationCode():string{return Array.from({length:4},()=>alphabet[randomInt(alphabet.length)]).join('');}
export function normalizeInvitationCode(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const code=value.trim();
 if(/^[A-Za-z0-9]{4}$/.test(code))return code.toUpperCase();
 return /^[A-Za-z0-9_-]{24}$/.test(code)?code:null;
}
export function invitationPath(value:unknown):string|null{
 const code=normalizeInvitationCode(value);return code?.length===4?`/w/${code}`:null;
}
/** Every invite-bearing HTTP command must be limited before its transaction starts. */
export function invitationAttemptRequired(action:Record<string,unknown>):boolean{
 return action.type==='invitation.resolve'||typeof action.code==='string'&&Boolean(action.code.trim())||typeof action.inviteCode==='string'&&Boolean(action.inviteCode.trim());
}
export function invitationCodeAccepted(row:Pick<EntityRow,'invite_hash'|'invite_expires_at'>,value:unknown):boolean{
 const code=normalizeInvitationCode(value);
 return Boolean(code&&row.invite_hash===digest(code)&&row.invite_expires_at&&new Date(row.invite_expires_at).getTime()>Date.now());
}
/** The PK is the concurrency arbiter; a collision never aborts the caller's transaction. */
export async function allocateInvitationCode(client:Client,entityId:string,expiresAt:Date,generate:()=>string=generateInvitationCode,previousHash:string|null=null):Promise<string>{
 for(let attempt=0;attempt<32;attempt++){
  const code=generate();
  if(!/^[A-Z0-9]{4}$/.test(code))throw new DomainError('invalid_invitation_code','De uitnodigingscode kon niet worden aangemaakt.',503);
  if(previousHash===digest(code))continue;
  const inserted=await client.query(`insert into dartflow_private.invitation_codes(code,entity_id,expires_at) values($1,$2,$3)
   on conflict(code) do update set entity_id=excluded.entity_id,expires_at=excluded.expires_at where dartflow_private.invitation_codes.expires_at<=now() returning code`,[code,entityId,expiresAt]);
  if(inserted.rowCount)return code;
 }
 throw new DomainError('invitation_busy','Er kon nu geen uitnodiging worden aangemaakt. Probeer het opnieuw.',503);
}
export async function rotateEntityInvitation(client:Client,row:EntityRow):Promise<string>{
 const {rows}=await client.query<{expires_at:Date}>("select now()+interval '7 days' as expires_at");
 const expires=rows[0].expires_at;
 await client.query('delete from dartflow_private.invitation_codes where entity_id=$1',[row.id]);
 const code=await allocateInvitationCode(client,row.id,expires,generateInvitationCode,row.invite_hash);
 await client.query('update dartflow_private.platform_entities set invite_hash=$2,invite_expires_at=$3 where id=$1',[row.id,digest(code),expires]);
 row.invite_hash=digest(code);row.invite_expires_at=expires;row.invitation_code=code;
 return code;
}
/** Caller authenticates and durably throttles attempts before entering its transaction. */
export async function resolveInvitation(client:Client,actor:string,value:unknown):Promise<{id:string;kind:EntityRow['kind'];name:string}>{
 const code=normalizeInvitationCode(value);if(!code)throw unavailable();
 const {rows}=await client.query<EntityRow>(`select e.* from dartflow_private.platform_entities e where e.invite_hash=$1 and e.invite_expires_at>now()
  and ($2::boolean=false or exists(select 1 from dartflow_private.invitation_codes i where i.code=$3 and i.entity_id=e.id and i.expires_at>now()))`,[digest(code),code.length===4,code]);
 if(rows.length!==1)throw unavailable();
 const row=rows[0];
 if(row.kind==='training'||row.state.closed)throw unavailable();
 const denied=await client.query(`select 1 where
  not exists(select 1 from dartflow_private.profiles p where p.id=$1)
  or exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=$2) or(b.target_id=$1 and b.source_id=$2)))
  or exists(select 1 from dartflow_private.platform_members m where m.user_id=$1 and m.status='banned' and (m.entity_id=$3 or m.entity_id=$4))
  or($4::uuid is not null and not ($5::text in ('league','tournament') and $6::text in ('all','code')) and not exists(select 1 from dartflow_private.club_memberships c where c.club_id=$4 and c.user_id=$1))
  or($5='lobby' and $1<>$2 and exists(select 1 from dartflow_private.platform_members m where m.entity_id=$3 and m.status='invited') and not exists(select 1 from dartflow_private.platform_members m where m.entity_id=$3 and m.user_id=$1 and m.status='invited'))`,[actor,row.owner_id,row.id,row.club_id,row.kind,String(row.state.eligibility??'')]);
 if(denied.rowCount)throw unavailable();
 if(typeof row.state.boardId==='string'&&typeof row.state.eventId==='string'){
  try{await eventAccess(client,actor,row.state.eventId);}catch(error){if(error instanceof DomainError&&[403,404].includes(error.status))throw unavailable();throw error;}
 }
 return {id:row.id,kind:row.kind,name:row.state.name};
}
