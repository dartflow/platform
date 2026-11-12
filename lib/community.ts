import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {clubIsActiveMember,clubPermission} from './club-access';
import {blocked,entity,member,requireAccess,text,transaction,uuid,type Client} from './platform-store';
import type {PlatformCommand,PlatformResponse} from './platform-types';
import type {ChatPage,CommunityKind,CommunityScope,FeedPage,FeedPost} from './community-types';

export const PLATFORM_FEED_ID='00000000-0000-4000-8000-000000000017';
const kinds=['platform','club','league','tournament','match'];
export function communityIdentity(kind:unknown,id:unknown):{kind:CommunityKind;id:string}{
 if(typeof kind!=='string'||!kinds.includes(kind))throw new DomainError('invalid_scope','Kies een bestaande feed of chat.');
 return {kind:kind as CommunityKind,id:kind==='platform'?PLATFORM_FEED_ID:uuid(id)};
}
export async function communityScope(client:Client,actor:string,kind:CommunityKind,id:string,lock=false,ignoreRestriction=false):Promise<CommunityScope>{
 if(kind==='platform')return {kind,id:PLATFORM_FEED_ID,name:'Platform',canModerate:Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[actor])).rowCount),canWrite:true};
 let canModerate=false,name='',writable=true;
 if(kind==='match'){
  const result=await client.query<{state:{scoringMode?:string;players:{id:string}[];status:string};event_id:string}>(`select state,event_id from dartflow_private.matches where id=$1${lock?' for share':''}`,[id]);
  const row=result.rows[0];
  if(!row||row.state.scoringMode!=='per-player'||!row.state.players.some(p=>p.id===actor))throw new DomainError('forbidden','Deze chat is alleen voor de twee spelers van een thuis- of hybridewedstrijd.',403);
  for(const other of row.state.players)if(await blocked(client,actor,other.id))throw new DomainError('blocked','Deze wedstrijdchat is geblokkeerd.',403);
  // The same fresh event admission used for scoring remains required for chat.
  const {eventAccess}=await import('./db');await eventAccess(client,actor,row.event_id);
  writable=['called','ready','live','result','disputed'].includes(row.state.status);
  name='Wedstrijdchat';
 }else{
  if(lock)await client.query('select id from dartflow_private.platform_entities where id=$1 for share',[id]);
  const row=await entity(client,id);
  if(row.kind!==kind)throw new DomainError('not_found','Deze feed of chat bestaat niet.',404);
  if(await blocked(client,actor,row.owner_id))throw new DomainError('blocked','Dit onderdeel is geblokkeerd.',403);
  if(kind==='club'){
   if(!await clubIsActiveMember(client,id,actor))throw new DomainError('forbidden','Alleen huidige verenigingsleden hebben toegang tot deze feed en chat.',403);
   canModerate=await clubPermission(client,id,actor,'chat.moderate');
  }else{
   const self=await member(client,id,actor);
   if(row.owner_id!==actor&&(self?.status!=='active'||self.attributes.registered!==true))throw new DomainError('forbidden','Deze feed en chat zijn alleen voor deelnemers en wedstrijdleiding.',403);
   await requireAccess(client,row,actor);
   canModerate=row.owner_id===actor||Boolean(self?.status==='active'&&['admin','moderator'].includes(self.role));
   if(row.club_id&&await clubPermission(client,row.club_id,actor,'chat.moderate'))canModerate=true;
  }
  name=row.state.name;
 }
 const restriction=await client.query<{banned:boolean;muted:boolean}>('select banned,(muted_until>now()) as muted from dartflow_private.community_moderation where scope_kind=$1 and scope_id=$2 and user_id=$3',[kind,id,actor]);
 if(!ignoreRestriction&&restriction.rows[0]?.banned)throw new DomainError('chat_banned','Je hebt geen toegang meer tot deze feed of chat.',403);
 return {kind,id,name,canModerate,canWrite:writable&&!restriction.rows[0]?.muted};
}
export async function communityScopes(client:Client,actor:string):Promise<CommunityScope[]>{
 const result:CommunityScope[]=[await communityScope(client,actor,'platform',PLATFORM_FEED_ID)];
 const rows=await client.query<{id:string;kind:CommunityKind}>(`select e.id,e.kind from dartflow_private.platform_entities e left join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$1 where e.kind in ('club','league','tournament') and (e.owner_id=$1 or(m.status='active' and (e.kind='club' or m.attributes->>'registered'='true'))) order by e.state->>'name',e.id limit 250`,[actor]);
 for(const row of rows.rows)try{result.push(await communityScope(client,actor,row.kind,row.id,true));}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}
 return result;
}
export function decodeFeedCursor(value:unknown):{at:string;id:string}|null{
 if(value===undefined||value===null||value==='')return null;
 try{if(typeof value!=='string'||value.length>240)throw 0;const data=JSON.parse(Buffer.from(value,'base64url').toString());if(typeof data.at!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(data.at)||!Number.isFinite(Date.parse(data.at)))throw 0;return {at:data.at,id:uuid(data.id)};}catch{throw new DomainError('invalid_cursor','Dit synchronisatiepunt is ongeldig. Vernieuw de feed.');}
}
const encodeCursor=(post:FeedPost)=>Buffer.from(JSON.stringify({at:post.createdAt,id:post.id})).toString('base64url');
const hiddenAuthors=`not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=p.author_id) or(b.target_id=$1 and b.source_id=p.author_id)))`;
export async function getCommunityFeed(actorId:string,options:{kind?:unknown;id?:unknown;cursor?:unknown;parentId?:unknown}={}):Promise<FeedPage>{
 const actor=uuid(actorId),cursor=decodeFeedCursor(options.cursor),parent=options.parentId?uuid(options.parentId):null;
 return transaction(async client=>{
  const all=await communityScopes(client,actor);
  const chosen=options.kind&&options.kind!=='my'?communityIdentity(options.kind,options.id):null;
  if(chosen?.kind==='match')throw new DomainError('invalid_scope','Een wedstrijd heeft een privéchat en geen feed.');
  const scopes=chosen?[await communityScope(client,actor,chosen.kind,chosen.id,true)]:all;
  if(parent){
   const original=await client.query('select scope_kind,scope_id from dartflow_private.community_posts where id=$1 and parent_id is null and not deleted',[parent]);
   if(!original.rows.length||!scopes.some(s=>s.kind===original.rows[0].scope_kind&&s.id===original.rows[0].scope_id))throw new DomainError('not_found','Dit gesprek is niet beschikbaar.',404);
  }
  const {rows}=await client.query<FeedPost>(`select p.id,p.scope_kind as "scopeKind",p.scope_id as "scopeId",p.author_id as "authorId",a.name as "authorName",p.body,to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",p.parent_id as "parentId",
   (select count(*)::int from dartflow_private.community_likes l where l.post_id=p.id) as likes,
   exists(select 1 from dartflow_private.community_likes l where l.post_id=p.id and l.user_id=$1) as liked,
   (select count(*)::int from dartflow_private.community_posts r where r.parent_id=p.id and not r.deleted and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=r.author_id) or(b.target_id=$1 and b.source_id=r.author_id)))) as "replyCount"
   from dartflow_private.community_posts p join dartflow_private.profiles a on a.id=p.author_id
   where not p.deleted and ${hiddenAuthors} and exists(select 1 from jsonb_to_recordset($2::jsonb) s(kind text,id uuid) where s.kind=p.scope_kind and s.id=p.scope_id)
   and (($3::uuid is null and p.parent_id is null) or p.parent_id=$3)
   and ($4::timestamptz is null or (p.created_at,p.id)<($4::timestamptz,$5::uuid)) order by p.created_at desc,p.id desc limit 31`,[actor,JSON.stringify(scopes),parent,cursor?.at??null,cursor?.id??null]);
  const posts=rows.slice(0,30).map(post=>{const scope=scopes.find(s=>s.kind===post.scopeKind&&s.id===post.scopeId)!;return {...post,scopeName:scope.name,canDelete:post.authorId===actor||scope.canModerate};});
  return {posts,nextCursor:rows.length>30?encodeCursor(posts.at(-1)!):null,scopes:all};
 });
}
export async function getCommunityChat(actorId:string,kindValue:unknown,idValue:unknown,after=0):Promise<ChatPage>{
 const actor=uuid(actorId),{kind,id}=communityIdentity(kindValue,idValue);
 if(kind==='platform')throw new DomainError('invalid_scope','Platformberichten staan in de feed.');
 if(!Number.isSafeInteger(after)||after<0)throw new DomainError('invalid_cursor','Ongeldig synchronisatiepunt.');
 return transaction(async client=>{
  const scope=await communityScope(client,actor,kind,id,true);
  const result=await client.query<ChatPage['messages'][number]>(`select * from(select m.id,m.sequence::float8 as sequence,m.author_id as "authorId",p.name as "authorName",case when m.deleted then '' else m.body end as body,m.deleted,m.created_at as "createdAt" from dartflow_private.community_messages m join dartflow_private.profile_labels p on p.id=m.author_id where m.scope_kind=$1 and m.scope_id=$2 and ($3=0 or m.sequence>$3) and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$4 and b.target_id=m.author_id) or(b.target_id=$4 and b.source_id=m.author_id))) order by case when $3=0 then -m.sequence else m.sequence end limit 100) recent order by sequence`,[kind,id,after,actor]);
  return {scope,messages:result.rows,cursor:result.rows.at(-1)?.sequence??after};
 });
}
export async function revalidateCommunityCommand(client:Client,actor:string,command:PlatformCommand):Promise<void>{
 const a=command.action;if(!a.type.startsWith('community.'))return;
 if(a.postId){const row=await client.query('select scope_kind,scope_id from dartflow_private.community_posts where id=$1',[uuid(a.postId)]);if(!row.rows.length)throw new DomainError('not_found','Dit bericht bestaat niet.',404);await communityScope(client,actor,row.rows[0].scope_kind,row.rows[0].scope_id,true);}
 else{const scope=communityIdentity(a.scopeKind,a.scopeId);await communityScope(client,actor,scope.kind,scope.id,true);}
}
export async function communityAction(client:Client,actor:string,command:PlatformCommand):Promise<PlatformResponse|null>{
 const a=command.action;if(!a.type.startsWith('community.'))return null;
 // A cursor may only advance in the order transactions commit within this scope.
 // The shared scope lock stays held through the command receipt and COMMIT.
 let writeScope:{kind:CommunityKind;id:string};
 if(a.postId){
  const target=await client.query('select scope_kind,scope_id from dartflow_private.community_posts where id=$1',[uuid(a.postId)]);
  if(!target.rows.length)throw new DomainError('not_found','Dit bericht bestaat niet meer.',404);
  writeScope={kind:target.rows[0].scope_kind,id:target.rows[0].scope_id};
 }else writeScope=communityIdentity(a.scopeKind,a.scopeId);
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`community:${writeScope.kind}:${writeScope.id}`]);
 if(a.type==='community.like'||a.type==='community.delete'||a.type==='community.reply'){
  const result=await client.query('select * from dartflow_private.community_posts where id=$1 for update',[uuid(a.postId)]),post=result.rows[0];
  if(!post||post.deleted)throw new DomainError('not_found','Dit bericht bestaat niet meer.',404);
  const scope=await communityScope(client,actor,post.scope_kind,post.scope_id,true);
  if(await blocked(client,actor,post.author_id))throw new DomainError('blocked','Dit gesprek is geblokkeerd.',403);
  if(a.type==='community.delete'){
   if(post.author_id!==actor&&!scope.canModerate)throw new DomainError('forbidden','Je kunt dit bericht niet verwijderen.',403);
   await client.query('update dartflow_private.community_posts set deleted=true where id=$1',[post.id]);return {ok:true,id:post.id};
  }
  if(!scope.canWrite)throw new DomainError('chat_muted','Je kunt tijdelijk geen bericht of reactie plaatsen.',403);
  if(a.type==='community.like'){
   if(typeof a.liked!=='boolean')throw new DomainError('invalid_like','Kies of je dit bericht leuk vindt.');
   if(a.liked)await client.query('insert into dartflow_private.community_likes(post_id,user_id) values($1,$2) on conflict do nothing',[post.id,actor]);
   else await client.query('delete from dartflow_private.community_likes where post_id=$1 and user_id=$2',[post.id,actor]);
   return {ok:true,id:post.id};
  }
  if(post.parent_id)throw new DomainError('invalid_thread','Reageer in het oorspronkelijke gesprek.');
  const id=randomUUID();await client.query('insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,parent_id,body) values($1,$2,$3,$4,$5,$6)',[id,scope.kind,scope.id,actor,post.id,text(a.body,4000)]);return {ok:true,id};
 }
 const {kind,id:scopeId}=communityIdentity(a.scopeKind,a.scopeId),scope=await communityScope(client,actor,kind,scopeId,true);
 if(a.type==='community.post'){
  if(kind==='match')throw new DomainError('invalid_scope','Gebruik de wedstrijdchat.');
  if(!scope.canWrite)throw new DomainError('chat_muted','Je kunt tijdelijk geen bericht plaatsen.',403);
  const id=randomUUID();await client.query('insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,body) values($1,$2,$3,$4,$5)',[id,kind,scopeId,actor,text(a.body,4000)]);return {ok:true,id};
 }
 if(kind==='platform')throw new DomainError('invalid_scope','Gebruik de platformfeed.');
 if(a.type==='community.message'){
  if(!scope.canWrite)throw new DomainError('chat_muted','Je kunt tijdelijk geen bericht plaatsen.',403);
  const id=randomUUID();await client.query('insert into dartflow_private.community_messages(id,scope_kind,scope_id,author_id,body) values($1,$2,$3,$4,$5)',[id,kind,scopeId,actor,text(a.body,2000)]);return {ok:true,id};
 }
 if(a.type==='community.message.delete'){
  const row=await client.query('select author_id from dartflow_private.community_messages where id=$1 and scope_kind=$2 and scope_id=$3 for update',[uuid(a.messageId),kind,scopeId]);
  if(!row.rows.length)throw new DomainError('not_found','Dit bericht bestaat niet.',404);
  if(row.rows[0].author_id!==actor&&!scope.canModerate)throw new DomainError('forbidden','Je kunt dit bericht niet verwijderen.',403);
  await client.query('update dartflow_private.community_messages set deleted=true,sequence=default where id=$1 and not deleted',[a.messageId]);return {ok:true};
 }
 if(a.type==='community.moderate'){
  if(!scope.canModerate)throw new DomainError('forbidden','Je hebt hier geen moderatierecht.',403);
  const target=uuid(a.userId);if(target===actor)throw new DomainError('invalid_target','Kies een andere deelnemer.');
  const targetScope=await communityScope(client,target,kind,scopeId,true,true);
  if(targetScope.canModerate)throw new DomainError('invalid_target','Een moderator kan niet via de chat worden geblokkeerd.');
  const minutes=a.minutes===undefined?0:Number(a.minutes);if(!Number.isInteger(minutes)||minutes<0||minutes>10080||typeof a.banned!=='boolean')throw new DomainError('invalid_moderation','Kies een blokkade of maximaal zeven dagen stilte.');
  await client.query('insert into dartflow_private.community_moderation(scope_kind,scope_id,user_id,muted_until,banned,updated_by) values($1,$2,$3,case when $4::int>0 then now()+$4*interval \'1 minute\' else null end,$5,$6) on conflict(scope_kind,scope_id,user_id) do update set muted_until=excluded.muted_until,banned=excluded.banned,updated_by=excluded.updated_by',[kind,scopeId,target,minutes,a.banned,actor]);return {ok:true};
 }
 throw new DomainError('invalid_action','Deze communityactie bestaat niet.');
}
