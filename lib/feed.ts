import {randomUUID} from 'node:crypto';
import {DomainError,matchView} from './domain';
import {consumeRateLimit,eventAccess} from './db';
import {communityScope,PLATFORM_FEED_ID,decodeFeedCursor} from './community';
import {clubIsActiveMember,clubPermission} from './club-access';
import {blocked,canonical,createEntity,addMember,entity,hash,member,requireAccess,text,transaction,uuid,type Client} from './platform-store';
import {requireScoreboardName} from './profile-name';
import {containsPrivatePinField} from './private-pin-fields';
import {requireCommunityRules,type ReportTarget} from './player-safety';
import type {MatchState} from './types';
import type {FeedAction,FeedCategory,FeedChannel,FeedCommand,FeedItem,FeedKind,FeedReply,FeedResult,FeedState} from './feed-types';

type Source={kind:'match'|'encounter';id:string;revision:number;clubId:string|null;participantIds:string[];channel:string|null;result:FeedResult;settings:MatchState['settings']|null;setup:string};
const channelKinds:FeedKind[]=['platform','friends','club','club-public','league','tournament'];
const unavailable=()=>new DomainError('result_unavailable','Deze uitslag is niet beschikbaar of de toegang is ingetrokken.',404);
const stamp=(value:Date|string)=>new Date(value).toISOString();
const statusLabels:Record<string,string>={open:'Inschrijving geopend',registration:'Inschrijving geopend',planned:'Programma gepubliceerd',published:'Programma gepubliceerd',active:'Competitie gestart',completed:'Eindstand bekend',archived:'Eindstand beschikbaar'};
export function feedChannelIdentity(value:unknown):{kind:FeedKind;id:string;key:string}{
 if(typeof value!=='string'||value.length>100)throw new DomainError('invalid_channel','Kies een bestaand kanaal.');
 const [raw,id,...extra]=value.split(':');if(extra.length||!channelKinds.includes(raw as FeedKind))throw new DomainError('invalid_channel','Kies een bestaand kanaal.');
 const kind=raw as FeedKind,key=['platform','friends'].includes(kind)?kind:`${kind}:${uuid(id)}`;
 if(['platform','friends'].includes(kind)&&id)throw new DomainError('invalid_channel','Kies een bestaand kanaal.');
 return {kind,id:['platform','friends'].includes(kind)?PLATFORM_FEED_ID:uuid(id),key};
}
async function channel(client:Client,actor:string,key:string):Promise<FeedChannel>{
 const {kind,id}=feedChannelIdentity(key);let name='',visibility:FeedChannel['visibility']='members',canManage=false,canPost=false,href='/app/feed';
 if(kind==='platform'){name='DartFlow';visibility='public';canManage=Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);canPost=canManage;}
 else if(kind==='friends'){name='Vrienden';visibility='friends';canPost=true;}
 else{
  await client.query('select id from dartflow_private.platform_entities where id=$1 for share',[id]);
  const row=await entity(client,id);if(row.kind!==(kind==='club-public'?'club':kind))throw new DomainError('not_found','Dit kanaal bestaat niet.',404);
  if(await blocked(client,actor,row.owner_id))throw new DomainError('forbidden','Dit kanaal is niet beschikbaar.',403);
  const own=await member(client,id,actor);if(own?.status==='banned')throw new DomainError('forbidden','Je hebt geen toegang meer tot dit kanaal.',403);
  name=row.state.name;href=kind.startsWith('club')?`/app/clubs/${id}`:`/app/${kind==='league'?'leagues':'hall'}/${id}`;
  if(kind==='club'){
   const scope=await communityScope(client,actor,'club',id);canManage=scope.canModerate;canPost=scope.canWrite;
  }else{
   const isPublic=row.visibility==='public'&&!['code','invite'].includes(String(row.state.eligibility??''))&&!['draft','canceled'].includes(String(row.state.status??''));
   if(kind==='club-public'&&!isPublic)throw new DomainError('forbidden','Dit openbare clubkanaal is niet beschikbaar.',403);
   if(!isPublic){const scope=await communityScope(client,actor,kind as 'league'|'tournament',id);canManage=scope.canModerate;canPost=scope.canWrite&&canManage;}
   else{
    visibility='public';
    if(kind==='club-public')canManage=await clubPermission(client,id,actor,'chat.moderate');
    else if(row.club_id)canManage=await clubPermission(client,row.club_id,actor,kind==='league'?'competitions.manage':'tournaments.manage');
    else canManage=row.owner_id===actor||Boolean(own?.status==='active'&&['admin','moderator','owner'].includes(own.role));
    // Public updates are official publications. Following never grants registration or write authority.
    canPost=canManage;
   }
  }
 }
 const [pref,policy]=await Promise.all([client.query('select following,mode from dartflow_private.feed_preferences where user_id=$1 and channel=$2',[actor,key]),client.query('select members_can_post,reactions,max_pin_days from dartflow_private.feed_policies where channel=$1',[key])]);
 const restriction=['platform','friends'].includes(kind)?null:(await client.query('select banned,(muted_until>now()) muted from dartflow_private.community_moderation where scope_kind=$1 and scope_id=$2 and user_id=$3',[kind==='club-public'?'club':kind,id,actor])).rows[0];if(restriction?.banned)throw new DomainError('forbidden','Je hebt geen toegang meer tot dit kanaal.',403);
 const p=policy.rows[0];return {key,kind,id,name,visibility,following:pref.rows[0]?.following??['platform','friends','club'].includes(kind),mode:pref.rows[0]?.mode??'all',canPost:canPost&&!restriction?.muted&&(p?.members_can_post!==false||canManage),canReact:!restriction?.muted,canManage,membersCanPost:p?.members_can_post??true,reactions:p?.reactions??true,maxPinDays:p?.max_pin_days??7,href};
}
async function channels(client:Client,actor:string):Promise<FeedChannel[]>{
 const result=[await channel(client,actor,'platform'),await channel(client,actor,'friends')];
 const rows=await client.query<{id:string;kind:'club'|'league'|'tournament';visibility:string}>(`select e.id,e.kind,e.visibility from dartflow_private.platform_entities e left join dartflow_private.platform_members m on m.entity_id=e.id and m.user_id=$1 where e.kind in('club','league','tournament') and(e.visibility='public' or e.owner_id=$1 or m.status='active') order by e.updated_at desc,e.id limit 300`,[actor]);
 for(const row of rows.rows)for(const kind of row.kind==='club'?['club',...(row.visibility==='public'?['club-public']:[])]:[row.kind])try{result.push(await channel(client,actor,`${kind}:${row.id}`));}catch(e){if(!(e instanceof DomainError&&[403,404].includes(e.status)))throw e;}
 return result;
}
async function source(client:Client,actor:string|null,idValue:string,publicOnly=false):Promise<Source>{
 const id=uuid(idValue),loaded=await client.query<{state:MatchState;created_at:Date;result_revision:number}>(`select m.state,r.created_at,r.result_revision from dartflow_private.matches m join dartflow_private.match_results r on r.match_id=m.id where m.id=$1`,[id]);
 if(loaded.rows.length){
  const row=loaded.rows[0],state=row.state;if(state.status!=='confirmed'||!state.resultPublished)throw unavailable();
  const link=(await client.query<{entity_id:string}>(`select l.entity_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 order by case when e.kind in('league','tournament') then 0 else 1 end,l.entity_id limit 1`,[id])).rows[0];
  const origin=link?await entity(client,link.entity_id):null;
  // A national single is not a final team result. The encounter adapter owns publication.
  if(origin?.state.seasonManaged===true){
   const {getSeasonFeedSources}=await import('./seasons');
   const official=(await getSeasonFeedSources(client,actor)).find(result=>result.matchIds.includes(id));
   if(!official)throw unavailable();
   return source(client,actor,official.id,publicOnly);
  }
  const clubId=origin?.club_id??(await client.query("select cb.club_id from dartflow_private.club_boards cb where cb.event_id=$1 order by cb.board_id limit 1",[state.eventId])).rows[0]?.club_id??((await client.query("select 1 from dartflow_private.platform_entities where id=$1 and kind='club'",[state.clubId])).rowCount?state.clubId:null);
  const publicAllowed=Boolean(origin&&['league','tournament'].includes(origin.kind)&&origin.visibility==='public'&&!['code','invite'].includes(String(origin.state.eligibility??''))&&!['draft','canceled'].includes(String(origin.state.status??'')));
  if(publicOnly&&!publicAllowed)throw unavailable();
  const participant=Boolean(actor&&state.players.some(p=>p.id===actor));let manager=false;if(actor&&origin&&['league','tournament'].includes(origin.kind))try{await requireAccess(client,origin,actor,true);manager=true;}catch{/* The normal participant/public read check still applies below. */}
  if(actor){for(const p of state.players)if(await blocked(client,actor,p.id))throw unavailable();if(!participant){if(origin&&['league','tournament'].includes(origin.kind)){try{await requireAccess(client,origin,actor);}catch{if(!publicAllowed)throw unavailable();}}else if(!clubId||!await clubIsActiveMember(client,clubId,actor))throw unavailable();}else if(!publicOnly){try{await eventAccess(client,actor,state.eventId);}catch{throw unavailable();}}}
  else if(!publicAllowed)throw unavailable();
  const profiles=(await client.query<{id:string;name:string;show_public_statistics:boolean}>('select id,name,show_public_statistics from dartflow_private.profile_labels where id=any($1::uuid[])',[state.players.map(p=>p.id)])).rows;
  const view=matchView(state,actor??'',false);
  return {kind:'match',id,revision:Math.max(state.revision,row.result_revision),clubId,participantIds:state.players.map(p=>p.id),channel:origin&&['league','tournament'].includes(origin.kind)?`${origin.kind}:${origin.id}`:null,settings:state.settings,setup:typeof origin?.state.setup==='string'?origin.state.setup:state.scoringMode==='per-player'?'remote':'localone',result:{id,revision:Math.max(state.revision,row.result_revision),title:origin?.state.name??'Vrije wedstrijd',players:state.players.map(p=>({name:profiles.find(x=>x.id===p.id)?.name??'Speler'})),score:view.sets.some(v=>v>1)?view.sets:view.legs,legs:view.legs,settings:state.settings,stats:view.stats.map((s,index)=>{const allowed=!publicOnly&&actor!==null||profiles.find(p=>p.id===state.players[index].id)?.show_public_statistics;return {average:allowed&&s.measurementComplete&&Number.isFinite(s.average)?s.average!:null,highestFinish:allowed?s.highestFinish:null,oneEighties:allowed?s.oneEighties:null};}),confirmedAt:stamp(row.created_at),href:actor?`/wedstrijd/${id}`:null,publicAllowed,canShare:participant||manager,canRematch:participant&&!state.administrativeDecision}};
 }
 const {getSeasonFeedSources}=await import('./seasons');
 const official=(await getSeasonFeedSources(client,actor)).find(r=>r.id===id);if(!official||publicOnly&&official.visibility!=='public')throw unavailable();
  const own=official.canShare;
 return {kind:'encounter',id,revision:official.revision,clubId:official.clubId,participantIds:official.participantIds,channel:`league:${official.seasonId}`,settings:official.settings??null,setup:official.setup??'localone',result:{id,revision:official.revision,title:official.name,players:[{name:official.home.name},{name:official.away.name}],score:official.score,legs:official.legs,settings:official.settings??null,stats:[],confirmedAt:official.confirmedAt,href:actor?official.href:null,publicAllowed:official.visibility==='public',canShare:own,canRematch:Boolean(official.canRematch)}};
}
export async function getFeedResult(actorId:string|null,idValue:string):Promise<FeedResult>{
 const actor=actorId?uuid(actorId):null,id=uuid(idValue);return transaction(async client=>{
  const share=(await client.query('select * from dartflow_private.feed_shares where id=$1',[id])).rows[0];
  if(!share){if(!actor)throw unavailable();const src=await source(client,actor,id);const available=await channels(client,actor);return {...src.result,clubShareAllowed:Boolean(src.clubId&&await clubIsActiveMember(client,src.clubId,actor)),allowedChannels:available.filter(c=>c.canPost&&(c.kind==='club'?c.id===src.clubId:c.kind==='friends'?src.result.publicAllowed:c.kind==='platform'||c.kind==='club-public'?src.result.publicAllowed:c.key===src.channel)).map(c=>c.key)};}
  if(share.revoked_at)throw unavailable();
  const original=await source(client,share.created_by,share.source_id);if(!original.result.canShare)throw unavailable();
  if(share.audience==='public'){const current=await source(client,actor,share.source_id,true);return {...current.result,canShare:false,canRematch:false,shareId:id,sharedByMe:actor===share.created_by,audience:'Openbaar'};}
  if(!actor)throw new DomainError('login_required','Log in om deze besloten uitslagkaart te openen.',401);
  if(share.audience==='club'){if(!share.club_id||share.club_id!==original.clubId||!await clubIsActiveMember(client,share.club_id,share.created_by)||!await clubIsActiveMember(client,share.club_id,actor))throw unavailable();}
  else if(actor!==share.created_by&&!original.participantIds.includes(actor))throw unavailable();
  const current=await source(client,actor,share.source_id);return {...current.result,shareId:id,sharedByMe:actor===share.created_by,audience:share.audience==='club'?'Vereniging':'Privé'};
 });
}
/** The caller's existing transaction owns publication; this stores only a private source pointer. */
export async function captureSeasonFeedSources(client:Client,actor:string,seasonId?:string){
 const {getSeasonFeedSources}=await import('./seasons');
 // Different scorers own different event locks. Always acquire shared feed
 // projection rows in the same order, regardless of which season just changed.
 const sources=(await getSeasonFeedSources(client,actor)).filter(source=>!seasonId||source.seasonId===seasonId).sort((a,b)=>a.id.localeCompare(b.id));
 for(const official of sources){
  const owner=(await client.query('select owner_id from dartflow_private.platform_entities where id=$1',[official.seasonId])).rows[0]?.owner_id;if(!owner)continue;
  await client.query(`insert into dartflow_private.feed_items(id,channel,author_id,category,title,important,source_kind,source_id,source_revision,dedupe_key,created_at) values($1,$2,$3,'result',$4,true,'encounter',$5,$6,$7,$8) on conflict(dedupe_key) do update set source_revision=excluded.source_revision,title=excluded.title,updated_at=clock_timestamp() where feed_items.source_revision<excluded.source_revision`,[randomUUID(),`league:${official.seasonId}`,owner,official.name,official.id,official.revision,`official:encounter:${official.id}`,official.confirmedAt]);
 }
}
export async function captureFeedResult(client:Client,next:MatchState):Promise<void>{
 if(next.status!=='confirmed'||!next.resultPublished)return;
 const origin=(await client.query<{entity_id:string;kind:string;owner_id:string;state:{name:string;seasonManaged?:boolean};created_at:Date}>(`select e.id entity_id,e.kind,e.owner_id,e.state,r.created_at from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id join dartflow_private.match_results r on r.match_id=l.match_id where l.match_id=$1 and e.kind in('league','tournament') order by e.id limit 1`,[next.id])).rows[0];
 if(!origin)return;
 if(origin.state.seasonManaged){await captureSeasonFeedSources(client,origin.owner_id,origin.entity_id);return;}
 await client.query(`insert into dartflow_private.feed_items(id,channel,author_id,category,title,important,source_kind,source_id,source_revision,dedupe_key,created_at) values($1,$2,$3,'result',$4,true,'match',$5,$6,$7,$8) on conflict(dedupe_key) do update set source_revision=excluded.source_revision,title=excluded.title,updated_at=clock_timestamp() where feed_items.source_revision<excluded.source_revision`,[randomUUID(),`${origin.kind}:${origin.entity_id}`,origin.owner_id,origin.state.name,next.id,next.revision,`official:match:${next.id}`,origin.created_at]);
}
// Existing sources are discovered lazily; future results are inserted by the publication hooks.
async function projectOfficial(client:Client,actor:string){
 await captureSeasonFeedSources(client,actor);
 const matches=await client.query<{id:string;entity_id:string;kind:string;owner_id:string;revision:number;created_at:Date;name:string}>(`select m.id,e.id entity_id,e.kind,e.owner_id,m.revision,r.created_at,e.state->>'name' name from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id join dartflow_private.matches m on m.id=l.match_id join dartflow_private.match_results r on r.match_id=m.id where e.kind in('league','tournament') and e.state->>'seasonManaged' is distinct from 'true' and m.state->>'status'='confirmed' and m.state->>'resultPublished'='true' and(e.visibility='public' or e.owner_id=$1 or exists(select 1 from dartflow_private.platform_members pm where pm.entity_id=e.id and pm.user_id=$1 and pm.status='active')) order by r.created_at desc,m.id limit 300`,[actor]);
 for(const match of matches.rows)await client.query(`insert into dartflow_private.feed_items(id,channel,author_id,category,title,important,source_kind,source_id,source_revision,dedupe_key,created_at) values($1,$2,$3,'result',$4,true,'match',$5,$6,$7,$8) on conflict(dedupe_key) do update set source_revision=excluded.source_revision,title=excluded.title,updated_at=clock_timestamp() where feed_items.source_revision<excluded.source_revision`,[randomUUID(),`${match.kind}:${match.entity_id}`,match.owner_id,match.name,match.id,match.revision,`official:match:${match.id}`,match.created_at]);
 const events=await client.query<{id:string;kind:'league'|'tournament';owner_id:string;revision:number;state:{name:string;status?:string;phase?:string;registrationOpen?:boolean};updated_at:Date}>(`select e.* from dartflow_private.platform_entities e where e.kind in('league','tournament') and(e.visibility='public' or e.owner_id=$1 or exists(select 1 from dartflow_private.platform_members m where m.entity_id=e.id and m.user_id=$1 and m.status='active')) order by e.updated_at desc limit 100`,[actor]);
 for(const event of events.rows){const status=event.state.status??event.state.phase??(event.state.registrationOpen===true?'registration':undefined);if(!['open','registration','planned','active','completed','archived','published'].includes(String(status)))continue;await client.query(`insert into dartflow_private.feed_items(id,channel,author_id,category,title,important,source_kind,source_id,source_revision,dedupe_key,created_at) values($1,$2,$3,'update',$4,true,'event',$5,$6,$7,$8) on conflict(dedupe_key) do update set source_revision=excluded.source_revision,title=excluded.title,updated_at=clock_timestamp() where feed_items.source_revision<excluded.source_revision`,[randomUUID(),`${event.kind}:${event.id}`,event.owner_id,`${event.state.name} · ${statusLabels[String(status)]??status}`,event.id,event.revision,`official:event:${event.id}:${status}`,event.updated_at]);}
}
const encode=(r:{createdAt:string;id:string})=>Buffer.from(JSON.stringify({at:r.createdAt,id:r.id})).toString('base64url');
// Existing compact club/event feeds keep their original IDs and conversation.
// Source permissions are still checked by channel() on every read and mutation.
async function synchronizeCommunity(client:Client,keys:string[],itemId:string|null=null){
 if(!keys.length)return;
 await client.query(`insert into dartflow_private.feed_items(id,channel,author_id,category,body,deleted,created_at,dedupe_key,legacy_community) select p.id,case when p.scope_kind='platform' then 'platform' else p.scope_kind||':'||p.scope_id::text end,p.author_id,'post',p.body,p.deleted,p.created_at,'community:'||p.id::text,true from dartflow_private.community_posts p where p.parent_id is null and($2::uuid is null or p.id=$2) and(case when p.scope_kind='platform' then 'platform' else p.scope_kind||':'||p.scope_id::text end)=any($1::text[]) on conflict(id) do update set body=excluded.body,deleted=excluded.deleted where feed_items.legacy_community and(feed_items.body,feed_items.deleted) is distinct from(excluded.body,excluded.deleted)`,[keys,itemId]);
 await client.query(`insert into dartflow_private.feed_likes(item_id,user_id) select l.post_id,l.user_id from dartflow_private.community_likes l join dartflow_private.feed_items i on i.id=l.post_id where i.legacy_community and i.channel=any($1::text[]) and($2::uuid is null or i.id=$2) on conflict do nothing`,[keys,itemId]);
 await client.query(`delete from dartflow_private.feed_likes l using dartflow_private.feed_items i where i.id=l.item_id and i.legacy_community and i.channel=any($1::text[]) and($2::uuid is null or i.id=$2) and not exists(select 1 from dartflow_private.community_likes c where c.post_id=l.item_id and c.user_id=l.user_id)`,[keys,itemId]);
 await client.query(`insert into dartflow_private.feed_replies(id,item_id,author_id,body,created_at) select r.id,r.parent_id,r.author_id,r.body,r.created_at from dartflow_private.community_posts r join dartflow_private.feed_items i on i.id=r.parent_id where i.legacy_community and i.channel=any($1::text[]) and($2::uuid is null or i.id=$2) and not r.deleted on conflict do nothing`,[keys,itemId]);
 await client.query(`delete from dartflow_private.feed_replies r using dartflow_private.community_posts c,dartflow_private.feed_items i where c.id=r.id and c.deleted and i.id=r.item_id and i.legacy_community and i.channel=any($1::text[]) and($2::uuid is null or i.id=$2)`,[keys,itemId]);
}
function allowedCategory(filter:string,category:FeedCategory){return filter==='all'||filter==='results'&&['result','achievement'].includes(category)||filter==='events'&&['event','update'].includes(category)||filter==='posts'&&category==='post';}
export async function getFeedState(actorId:string,options:{mode?:string;filter?:string;channel?:string;cursor?:string}={}):Promise<FeedState>{
 const actor=uuid(actorId),mode=options.mode??'mine',filter=options.filter??'all',cursor=decodeFeedCursor(options.cursor);if(!['mine','discover'].includes(mode)||!['all','results','events','posts'].includes(filter))throw new DomainError('invalid_filter','Kies een bestaand feedfilter.');
 return transaction(async client=>{
  // Publication commands lock their entity before updating its feed projection.
  // Acquire every channel lock first so a read cannot invert that lock order.
  const all=await channels(client,actor),chosen=options.channel?await channel(client,actor,options.channel):null;if(chosen&&!all.some(c=>c.key===chosen.key))all.push(chosen);
  await projectOfficial(client,actor);
  const visible=(chosen?[chosen]:all).filter(c=>(mode!=='discover'||c.visibility==='public')&&(Boolean(chosen)||mode==='discover'||c.following)&&c.mode!=='muted');
  // A public event channel does not make its existing participant conversation
  // public. Preserve the original community ACL for every legacy projection.
  const communityAllowed=new Set<string>();
  for(const scope of visible){if(!['platform','club','league','tournament'].includes(scope.kind))continue;try{await communityScope(client,actor,scope.kind as 'platform'|'club'|'league'|'tournament',scope.id);communityAllowed.add(scope.key);}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
  await synchronizeCommunity(client,[...communityAllowed]);
  const rows=(await client.query(`select f.*,to_char(f.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,p.name author_name,(select count(*)::int from dartflow_private.feed_likes l where l.item_id=f.id) likes,exists(select 1 from dartflow_private.feed_likes l where l.item_id=f.id and l.user_id=$1) liked,(select count(*)::int from dartflow_private.feed_replies r where r.item_id=f.id and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=r.author_id) or(b.target_id=$1 and b.source_id=r.author_id)))) reply_count from dartflow_private.feed_items f join dartflow_private.profile_labels p on p.id=f.author_id where not f.deleted and f.channel=any($2::text[]) and ($3::timestamptz is null or(f.created_at,f.id)<($3::timestamptz,$4::uuid)) and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=f.author_id) or(b.target_id=$1 and b.source_id=f.author_id))) and(f.channel<>'friends' or f.author_id=$1 or exists(select 1 from dartflow_private.platform_relationships b where b.kind='friend' and b.source_id=$1 and b.target_id=f.author_id)) order by f.created_at desc,f.id desc limit 101`,[actor,visible.map(c=>c.key),cursor?.at??null,cursor?.id??null])).rows;
  const items:FeedItem[]=[];let scanned=0,last:{createdAt:string;id:string}|null=null;
  for(const row of rows.slice(0,100)){scanned++;last={id:row.id,createdAt:row.cursor_at};const ch=visible.find(c=>c.key===row.channel)!;if(row.legacy_community&&!communityAllowed.has(ch.key)||ch.mode==='important'&&!row.important||!allowedCategory(filter,row.category))continue;let result:FeedResult|undefined;
   if(row.source_kind==='match'||row.source_kind==='encounter')try{result=(await source(client,actor,row.source_id,ch.visibility==='public')).result;if(row.channel==='friends'&&!result.publicAllowed&&row.author_id!==actor)continue;}catch(e){if(e instanceof DomainError&&[403,404].includes(e.status))continue;throw e;}
   if(row.source_kind==='event')try{const e=await entity(client,row.source_id);if(['draft','canceled'].includes(String(e.state.status??'')))continue;}catch{continue;}
   items.push({id:row.id,channel:row.channel,category:row.category,title:row.title,body:row.body,authorName:row.author_name,authorId:row.author_id,createdAt:row.cursor_at,important:row.important,pinUntil:row.pin_until&&new Date(row.pin_until).getTime()>Date.now()?stamp(row.pin_until):null,likes:row.likes,liked:row.liked,replyCount:row.reply_count,canDelete:row.author_id===actor||ch.canManage,canManage:ch.canManage,reactions:ch.reactions,href:result?`/app/feed/result/${row.source_id}`:row.source_kind==='event'?ch.href:null,...(result?{result}:{})});if(items.length===20)break;
  }
  const pins=cursor?[]:items.filter(r=>r.pinUntil&&Date.parse(r.pinUntil)>Date.now()).slice(0,2),upcoming=(await client.query(`select id,state->>'name' name,state->>'date' as "at",kind from dartflow_private.platform_entities where kind in('league','tournament') and (state->>'date')~'^\\d{4}-\\d{2}-\\d{2}' and state->>'date'>=to_char(current_date,'YYYY-MM-DD') and id=any($1::uuid[]) order by state->>'date',id limit 5`,[all.filter(c=>['league','tournament'].includes(c.kind)&&c.following&&c.mode!=='muted').map(c=>c.id)])).rows.map(r=>({id:r.id,name:r.name,at:r.at,href:`/app/${r.kind==='league'?'leagues':'hall'}/${r.id}`}));
  return{channels:all,posts:items.filter(r=>!pins.includes(r)),pins,nextCursor:last&&(scanned<rows.length||rows.length===101)?encode(last):null,upcoming};
 });
}
async function readItem(client:Client,actor:string,idValue:unknown){
 const id=uuid(idValue),candidate=(await client.query<{channel:string}>('select channel from dartflow_private.feed_items where id=$1 and not deleted',[id])).rows[0];
 if(!candidate)throw new DomainError('not_found','Dit bericht is niet beschikbaar.',404);
 const ch=await channel(client,actor,candidate.channel);
 const item=(await client.query('select * from dartflow_private.feed_items where id=$1 and not deleted for update',[id])).rows[0];
 if(!item)throw new DomainError('not_found','Dit bericht is niet beschikbaar.',404);
 // Never acquire another entity lock after the item lock if its scope changed.
 if(item.channel!==candidate.channel)throw new DomainError('revision_conflict','Dit bericht is gewijzigd. Open het opnieuw.',409);
 if(item.legacy_community){await communityScope(client,actor,ch.kind as 'platform'|'club'|'league'|'tournament',ch.id,true);const legacy=(await client.query('select deleted from dartflow_private.community_posts where id=$1',[item.id])).rows[0];if(!legacy||legacy.deleted)throw new DomainError('not_found','Dit bericht is niet beschikbaar.',404);await synchronizeCommunity(client,[ch.key],item.id);}if(await blocked(client,actor,item.author_id))throw new DomainError('not_found','Dit bericht is niet beschikbaar.',404);if(item.channel==='friends'&&item.author_id!==actor&&!(await client.query("select 1 from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='friend'",[actor,item.author_id])).rowCount)throw new DomainError('forbidden','Dit bericht is alleen voor huidige vrienden.',403);if(['match','encounter'].includes(item.source_kind))await source(client,actor,item.source_id);return{item,ch};
}
export async function getFeedReplies(actorId:string,itemId:string,cursor?:string):Promise<{replies:FeedReply[];nextCursor:string|null}>{const actor=uuid(actorId),page=decodeFeedCursor(cursor);return transaction(async client=>{await readItem(client,actor,itemId);const rows=(await client.query(`select r.id,r.author_id as "authorId",p.name as "authorName",r.body,to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from dartflow_private.feed_replies r join dartflow_private.profile_labels p on p.id=r.author_id where r.item_id=$1 and($3::timestamptz is null or(r.created_at,r.id)<($3::timestamptz,$4::uuid)) and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$2 and b.target_id=r.author_id) or(b.target_id=$2 and b.source_id=r.author_id))) order by r.created_at desc,r.id desc limit 21`,[uuid(itemId),actor,page?.at??null,page?.id??null])).rows.map(r=>({...r,createdAt:String(r.createdAt)}));return{replies:rows.slice(0,20).reverse(),nextCursor:rows.length>20?encode(rows[19]):null};});}
async function revalidate(client:Client,actor:string,action:FeedAction){if(action.channel){const scope=await channel(client,actor,String(action.channel));if(['compose','share'].includes(action.type)&&!scope.canPost)throw new DomainError('forbidden','Je kunt in dit kanaal geen bericht plaatsen.',403);}if(action.itemId)await readItem(client,actor,action.itemId);if(action.sourceId)await source(client,actor,String(action.sourceId));if(action.shareId){const row=(await client.query('select created_by from dartflow_private.feed_shares where id=$1',[uuid(action.shareId)])).rows[0];if(!row||row.created_by!==actor)throw unavailable();}}
export async function executeFeedAction(actorId:string,input:unknown):Promise<Record<string,unknown>>{
 const actor=uuid(actorId),command=input as FeedCommand;if(!command||typeof command!=='object'||!command.action||typeof command.action.type!=='string')throw new DomainError('invalid_command','Ongeldige feedactie.');uuid(command.requestId);if(JSON.stringify(command).length>9000)throw new DomainError('invalid_command','Deze feedactie is te groot.');
 if(containsPrivatePinField(command))throw new DomainError('private_field','Gebruik de beveiligde spelerspincodeflow.',400);
 const limit=await consumeRateLimit(`feed:actor:${actor}`,60,60);if(!limit.allowed)throw Object.assign(new DomainError('rate_limited','Te veel feedacties. Probeer het over een minuut opnieuw.',429),{retryAfter:limit.retryAfter});
 return transaction(async client=>{await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`feed-command:${actor}`]);const action=command.action,fingerprint=hash(canonical(action)),receipt=(await client.query('select fingerprint,response from dartflow_private.feed_receipts where actor_id=$1 and request_id=$2',[actor,command.requestId])).rows[0];if(receipt){if(receipt.fingerprint!==fingerprint)throw new DomainError('request_reused','Dit aanvraag-ID hoort bij een andere actie.',409);await revalidate(client,actor,action);return receipt.response;}
  if(['compose','reply','share'].includes(action.type))await requireCommunityRules(client,actor);
  let response:Record<string,unknown>={ok:true};
  if(['follow','mode','policy','compose','share'].includes(action.type)){
   const ch=action.channel?await channel(client,actor,String(action.channel)):null;
   if(['follow','mode'].includes(action.type)){
    if(!ch||action.type==='follow'&&typeof action.following!=='boolean'||action.type==='mode'&&!['all','important','muted'].includes(String(action.mode)))throw new DomainError('invalid_preference','Kies een geldige kanaalvoorkeur.');
    await client.query('insert into dartflow_private.feed_preferences(user_id,channel,following,mode) values($1,$2,$3,$4) on conflict(user_id,channel) do update set following=excluded.following,mode=excluded.mode',[actor,ch.key,action.type==='follow'?action.following:ch.following,action.type==='mode'?action.mode:ch.mode]);
   }else if(action.type==='policy'){
    const max=Number(action.maxPinDays);if(!ch?.canManage||!['platform','club','club-public','league','tournament'].includes(ch.kind))throw new DomainError('forbidden','Alleen de kanaalbeheerder kan dit wijzigen.',403);if(typeof action.membersCanPost!=='boolean'||typeof action.reactions!=='boolean'||![1,3,7].includes(max))throw new DomainError('invalid_policy','Kies geldige kanaalinstellingen.');
    await client.query('insert into dartflow_private.feed_policies(channel,members_can_post,reactions,max_pin_days,updated_by) values($1,$2,$3,$4,$5) on conflict(channel) do update set members_can_post=excluded.members_can_post,reactions=excluded.reactions,max_pin_days=excluded.max_pin_days,updated_by=excluded.updated_by',[ch.key,action.membersCanPost,action.reactions,max,actor]);
   }else if(action.type==='compose'){
    if(!ch?.canPost)throw new DomainError('forbidden','Je kunt in dit kanaal geen bericht plaatsen.',403);const id=randomUUID(),body=text(action.body,900);const legacy=['platform','club','league','tournament'].includes(ch.kind)&&(ch.kind==='platform'||ch.visibility==='members');if(legacy)await client.query('insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,body) values($1,$2,$3,$4,$5)',[id,ch.kind,ch.id,actor,body]);await client.query("insert into dartflow_private.feed_items(id,channel,author_id,category,body,important,legacy_community) values($1,$2,$3,'post',$4,$5,$6)",[id,ch.key,actor,body,Boolean(ch.canManage&&action.important===true),legacy]);response={ok:true,id};
   }else{
    const src=await source(client,actor,uuid(action.sourceId));if(!src.result.canShare)throw new DomainError('forbidden','Alleen een deelnemer of bevoegde official kan deze uitslag delen.',403);
    const audience=String(action.audience??'private');if(!['private','club','public'].includes(audience)||audience==='public'&&!src.result.publicAllowed)throw new DomainError('invalid_audience','Deze uitslag is niet vrijgegeven voor openbaar delen.',403);
    if(audience==='club'&&(!src.clubId||!await clubIsActiveMember(client,src.clubId,actor)))throw new DomainError('forbidden','Deze uitslag kan niet met jouw vereniging worden gedeeld.',403);
    if(ch&&(audience==='private'||audience==='club'&&ch.kind!=='club'||audience==='public'&&ch.visibility!=='public'&&ch.kind!=='friends'))throw new DomainError('invalid_audience','Het gekozen kanaal past niet bij het bevestigde publiek.',403);
    if(ch&&(!ch.canPost||ch.kind==='friends'&&!src.result.publicAllowed||ch.kind==='club'&&ch.id!==src.clubId||ch.visibility==='public'&&!src.result.publicAllowed||ch.kind==='league'&&ch.key!==src.channel||ch.kind==='tournament'&&ch.key!==src.channel))throw new DomainError('invalid_audience','Bron en gekozen kanaal hebben geen passend publiek.',403);
    const id=randomUUID();await client.query('insert into dartflow_private.feed_shares(id,source_kind,source_id,created_by,audience,club_id) values($1,$2,$3,$4,$5,$6)',[id,src.kind,src.id,actor,audience,audience==='club'?src.clubId:null]);response={ok:true,id,url:`/app/feed/result/${id}`};
    if(ch){const itemId=randomUUID();await client.query("insert into dartflow_private.feed_items(id,channel,author_id,category,title,body,source_kind,source_id,source_revision,dedupe_key) values($1,$2,$3,'result','Uitslag gedeeld',$4,$5,$6,$7,$8)",[itemId,ch.key,actor,typeof action.body==='string'?text(action.body,900,false):'',src.kind,src.id,src.revision,`share:${id}`]);response.itemId=itemId;}
   }
  }else if(action.type==='revoke'){
   const result=await client.query('update dartflow_private.feed_shares set revoked_at=coalesce(revoked_at,now()) where id=$1 and created_by=$2 returning id',[uuid(action.shareId),actor]);if(!result.rowCount)throw unavailable();await client.query('update dartflow_private.feed_items set deleted=true where dedupe_key=$1',[`share:${action.shareId}`]);
  }else if(action.type==='rematch'){
   const src=await source(client,actor,uuid(action.sourceId));if(!src.result.canRematch||!src.settings)throw new DomainError('forbidden','Een revanche is alleen beschikbaar voor een gespeelde eigen partij.',403);await requireScoreboardName(client,actor);const {row,code}=await createEntity(client,actor,'lobby',{name:`Revanche · ${src.result.players.map(p=>p.name).join(' – ')}`,setup:src.setup,settings:src.settings,capacity:2,ready:{},rematchOf:src.id},'private');const opponent=src.participantIds.find(p=>p!==actor);if(opponent){if(await blocked(client,actor,opponent))throw new DomainError('forbidden','Deze uitnodiging is niet toegestaan.',403);await addMember(client,row.id,opponent,'member','invited');}response={ok:true,id:row.id,code,url:`/app/lobby/${row.id}`};
  }else if(['like','reply','pin','delete'].includes(action.type)){
   const{item,ch}=await readItem(client,actor,action.itemId);
   if(action.type==='delete'){if(item.author_id!==actor&&!ch.canManage)throw new DomainError('forbidden','Je kunt dit bericht niet verwijderen.',403);await client.query('update dartflow_private.feed_items set deleted=true where id=$1',[item.id]);if(item.legacy_community)await client.query('update dartflow_private.community_posts set deleted=true where id=$1',[item.id]);}
   else if(action.type==='pin'){const days=Number(action.days);if(!ch.canManage)throw new DomainError('forbidden','Alleen de kanaalbeheerder kan een bericht vastzetten.',403);if(![0,1,3,7].includes(days)||days>ch.maxPinDays)throw new DomainError('invalid_pin','Kies een beschikbare looptijd.');await client.query("update dartflow_private.feed_items set pin_until=case when $2::int=0 then null else now()+$2*interval '1 day' end where id=$1",[item.id,days]);}
   else{if(!ch.reactions||!ch.canReact)throw new DomainError('reactions_disabled','Reacties zijn voor jou uitgeschakeld in dit kanaal.',403);if(action.type==='like'){if(typeof action.liked!=='boolean')throw new DomainError('invalid_like','Kies een like of haal hem weg.');if(action.liked)await client.query('insert into dartflow_private.feed_likes(item_id,user_id) values($1,$2) on conflict do nothing',[item.id,actor]);else await client.query('delete from dartflow_private.feed_likes where item_id=$1 and user_id=$2',[item.id,actor]);if(item.legacy_community){if(action.liked)await client.query('insert into dartflow_private.community_likes(post_id,user_id) values($1,$2) on conflict do nothing',[item.id,actor]);else await client.query('delete from dartflow_private.community_likes where post_id=$1 and user_id=$2',[item.id,actor]);}}else{const id=randomUUID();await client.query('insert into dartflow_private.feed_replies(id,item_id,author_id,body) values($1,$2,$3,$4)',[id,item.id,actor,text(action.body,400)]);if(item.legacy_community)await client.query('insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,parent_id,body) values($1,$2,$3,$4,$5,$6)',[id,ch.kind,ch.id,actor,item.id,text(action.body,400)]);response={ok:true,id};}}
  }else throw new DomainError('invalid_action','Deze feedactie bestaat niet.');
  await client.query('insert into dartflow_private.feed_receipts(actor_id,request_id,fingerprint,response) values($1,$2,$3,$4)',[actor,command.requestId,fingerprint,JSON.stringify(response)]);return response;
 });
}

/** Reporting resolves the current readable item and real author before storing a reference. */
export async function resolveFeedReportTarget(client:Client,actor:string,id:string,kind:'post'|'reply'):Promise<ReportTarget>{
 let author:string,itemId=id;
 if(kind==='reply'){
  const reply=(await client.query('select item_id,author_id from dartflow_private.feed_replies where id=$1',[id])).rows[0];
  if(reply){itemId=reply.item_id;author=reply.author_id;}
  else{
   const legacy=(await client.query('select author_id,parent_id,scope_kind,scope_id,deleted from dartflow_private.community_posts where id=$1',[id])).rows[0];
   if(!legacy||!legacy.parent_id||legacy.deleted)throw new DomainError('not_found','Deze reactie is niet beschikbaar.',404);
   await communityScope(client,actor,legacy.scope_kind,legacy.scope_id,true);
   return {targetId:id,targetType:kind,userId:legacy.author_id,roomId:legacy.scope_kind==='platform'?null:legacy.scope_id,scopeKind:legacy.scope_kind,scopeId:legacy.scope_id};
  }
 }else author='';
 const raw=(await client.query('select author_id from dartflow_private.feed_items where id=$1',[itemId])).rows[0];
 if(!raw){
  const legacy=(await client.query('select author_id,parent_id,scope_kind,scope_id,deleted from dartflow_private.community_posts where id=$1',[itemId])).rows[0];
  if(!legacy||legacy.parent_id||legacy.deleted)throw new DomainError('not_found','Dit bericht is niet beschikbaar.',404);
  await communityScope(client,actor,legacy.scope_kind,legacy.scope_id,true);
  return {targetId:id,targetType:kind,userId:author||legacy.author_id,roomId:legacy.scope_kind==='platform'?null:legacy.scope_id,scopeKind:legacy.scope_kind,scopeId:legacy.scope_id};
 }
 const{item,ch}=await readItem(client,actor,itemId);
 return {targetId:id,targetType:kind,userId:author||item.author_id,roomId:['club','league','tournament'].includes(ch.kind)?ch.id:null,scopeKind:ch.kind,scopeId:ch.id};
}
