import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {entity,requireAccess,text,transaction,uuid,type Client} from './platform-store';

export const COMMUNITY_RULES_VERSION='2026-11-18';
export const REPORT_CATEGORIES=[
 {id:'harassment',label:'Pesten of intimidatie'},{id:'hate',label:'Haat of discriminatie'},
 {id:'sexual',label:'Seksuele inhoud'},{id:'child-safety',label:'Veiligheid van minderjarigen'},
 {id:'threats',label:'Bedreiging of geweld'},{id:'scam',label:'Spam of oplichting'},
 {id:'privacy',label:'Privégegevens zonder toestemming'},{id:'other',label:'Andere overtreding'},
] as const;
export type SafetyState={rulesVersion:string;rulesUrl:string;termsUrl:string;minimumAge:number;acceptedVersion:string|null;acceptedAt:string|null;requiresAcceptance:boolean;reportCategories:typeof REPORT_CATEGORIES;contactEmail:string};
export async function readPlayerSafety(client:Client,actor:string):Promise<SafetyState>{
 const row=(await client.query<{version:string;accepted_at:Date}>('select version,accepted_at from dartflow_private.player_safety_acceptances where user_id=$1 and version=$2',[uuid(actor),COMMUNITY_RULES_VERSION])).rows[0];
 return {rulesVersion:COMMUNITY_RULES_VERSION,rulesUrl:'https://dartflow.nl/communityregels',termsUrl:'https://dartflow.nl/voorwaarden',minimumAge:13,acceptedVersion:row?.version??null,acceptedAt:row?new Date(row.accepted_at).toISOString():null,requiresAcceptance:!row,reportCategories:REPORT_CATEGORIES,contactEmail:'info@dartflow.nl'};
}
export async function getPlayerSafety(actor:string){return transaction(client=>readPlayerSafety(client,actor));}
export async function acceptPlayerSafety(actor:string,input:{version?:unknown;accepted?:unknown;ageConfirmed?:unknown}){
 if(input.version!==COMMUNITY_RULES_VERSION)throw new DomainError('rules_changed','De communityregels zijn gewijzigd. Lees de actuele versie.',409);
 if(input.accepted!==true||input.ageConfirmed!==true)throw new DomainError('rules_confirmation_required','Bevestig dat je minimaal 13 jaar bent en akkoord gaat met de voorwaarden en communityregels.');
 return transaction(async client=>{await client.query('insert into dartflow_private.player_safety_acceptances(user_id,version,age_confirmed) values($1,$2,true) on conflict(user_id,version) do nothing',[uuid(actor),COMMUNITY_RULES_VERSION]);return {ok:true,...await readPlayerSafety(client,actor)};});
}
export async function requireCommunityRules(client:Client,actor:string){
 if(!(await client.query('select 1 from dartflow_private.player_safety_acceptances where user_id=$1 and version=$2 and age_confirmed',[actor,COMMUNITY_RULES_VERSION])).rowCount)throw new DomainError('community_rules_required','Lees en accepteer eerst de communityregels en voorwaarden. Bevestig dat je minimaal 13 jaar bent.',403);
}
const unavailable=()=>new DomainError('report_target_unavailable','Dit profiel of bericht is niet beschikbaar om te melden.',404);
export type ReportTarget={targetId:string;targetType:string;userId:string;roomId:string|null;scopeKind:string|null;scopeId:string|null};
/** Resolve the server-owned author and scope; never trust a caller-supplied author or room. */
export async function resolveReportTarget(client:Client,actor:string,a:Record<string,unknown>):Promise<ReportTarget>{
 const kind=String(a.targetType??(a.userId?'user':a.roomId?'room':'')),id=uuid(a.targetId??a.userId??a.roomId);
 let target:ReportTarget;
 if(kind==='user'){
  if(id===actor)throw new DomainError('invalid_target','Je kunt je eigen account niet melden.');
  const visible=await client.query(`select 1 from dartflow_private.profiles p left join dartflow_private.platform_preferences pref on pref.user_id=p.id where p.id=$2 and (coalesce(pref.discoverable,true) or exists(select 1 from dartflow_private.platform_relationships r where(r.source_id=$1 and r.target_id=$2)or(r.source_id=$2 and r.target_id=$1)) or exists(select 1 from dartflow_private.platform_members me join dartflow_private.platform_members other on other.entity_id=me.entity_id where me.user_id=$1 and other.user_id=$2 and me.status='active' and other.status='active') or exists(select 1 from dartflow_private.matches m where m.state->'players' @> jsonb_build_array(jsonb_build_object('id',$1::text)) and m.state->'players' @> jsonb_build_array(jsonb_build_object('id',$2::text))))`,[actor,id]);
  if(!visible.rowCount)throw unavailable();target={targetId:id,targetType:kind,userId:id,roomId:null,scopeKind:null,scopeId:null};
 }else if(kind==='room'){
  const room=await entity(client,id);if(room.kind!=='room')throw unavailable();await requireAccess(client,room,actor);
  target={targetId:id,targetType:kind,userId:room.owner_id,roomId:id,scopeKind:'room',scopeId:id};
 }else if(kind==='post'||kind==='reply'){
  const {resolveFeedReportTarget}=await import('./feed');
  target=await resolveFeedReportTarget(client,actor,id,kind);
 }else if(kind==='message'){
  const row=(await client.query('select author_id,scope_kind,scope_id,deleted from dartflow_private.community_messages where id=$1',[id])).rows[0];
  if(!row||row.deleted)throw unavailable();
  const {communityScope}=await import('./community');await communityScope(client,actor,row.scope_kind,row.scope_id,true);
  target={targetId:id,targetType:kind,userId:row.author_id,roomId:row.scope_kind==='match'?null:row.scope_id,scopeKind:row.scope_kind,scopeId:row.scope_id};
 }else if(kind==='room-message'){
  const row=(await client.query('select author_id,room_id,deleted from dartflow_private.platform_messages where id=$1',[id])).rows[0];
  if(!row||row.deleted)throw unavailable();const room=await entity(client,row.room_id);if(room.kind!=='room')throw unavailable();await requireAccess(client,room,actor);
  target={targetId:id,targetType:kind,userId:row.author_id,roomId:room.id,scopeKind:'room',scopeId:room.id};
 }else throw new DomainError('invalid_report_target','Kies een profiel, bericht, reactie of chatbericht om te melden.');
 if(kind==='user'&&a.roomId){
  const room=await entity(client,a.roomId);if(room.kind!=='room')throw unavailable();await requireAccess(client,room,actor);
  if(!(await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status='active'",[room.id,id])).rowCount)throw unavailable();
  target={...target,roomId:room.id,scopeKind:'room',scopeId:room.id};
 }
 if(a.userId!==undefined&&a.userId!==target.userId)throw unavailable();
 if(target.userId===actor)throw new DomainError('invalid_target','Je kunt je eigen inhoud niet melden.');
 if(a.scopeKind!==undefined&&a.scopeKind!==target.scopeKind||a.scopeId!==undefined&&a.scopeId!==target.scopeId||a.roomId!==undefined&&a.roomId!==target.roomId)throw unavailable();
 return target;
}
export async function createSafetyReport(client:Client,actor:string,a:Record<string,unknown>){
 const category=String(a.category??'other');if(!REPORT_CATEGORIES.some(c=>c.id===category))throw new DomainError('invalid_report_category','Kies een geldige reden voor je melding.');
 const reason=text(a.reason,2000);const target=await resolveReportTarget(client,actor,a);
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`safety-report:${actor}`]);
 if((await client.query('select count(*)::int n from dartflow_private.platform_reports where reporter_id=$1 and created_at>now()-interval \'1 hour\'',[actor])).rows[0].n>=10)throw new DomainError('rate_limited','Je hebt veel meldingen verstuurd. Probeer het later opnieuw of mail info@dartflow.nl.',429);
 const id=randomUUID();await client.query('insert into dartflow_private.platform_reports(id,reporter_id,target_id,room_id,reason,target_type,content_id,scope_kind,scope_id,category) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,actor,target.userId,target.roomId,reason,target.targetType,target.targetId,target.scopeKind,target.scopeId,category]);
 return {id,target,reason,category};
}
