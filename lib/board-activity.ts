import {matchParticipants,matchSideIndex} from './match-sides';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,eventAccess} from './db';
import {DomainError,newGame} from './domain';
import {assertPhysicalBoardEvent,locationManager,physicalBoard} from './location-access';
import {assertBoardUnreserved} from './platform-locks';
import type {Client,EntityRow} from './platform-store';
import type {SeasonState} from './seasons-types';
import type {MatchCommand,MatchState} from './types';
import {boardActivityClock,type BoardActivityView} from './board-activity-types';

type SourceKind='training'|'lobby'|'match';
type ActivityRow={id:string;source_kind:SourceKind;source_id:string;event_id:string;kind:'free'|'official';status:'active'|'released'|'interrupted'|'completed';board_ids:string[];actor_ids:string[];activity_at:Date;deadline_at:Date;warning_epoch:string;extensions_used:number;last_score_revision:number|null;reason:string|null};
export type LockedBoardActivity={row:ActivityRow;now:number;view:BoardActivityView};
const identity=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DomainError('invalid_id','Ongeldige baanopstelling.');return value;};
const millis=(value:Date|string)=>new Date(value).getTime();
async function serverNow(client:Client):Promise<number>{return Number((await client.query("select floor(extract(epoch from clock_timestamp())*1000)::float8 as now")).rows[0].now);}
function projection(row:ActivityRow,now:number,canExtend=false):BoardActivityView{
 const clock=boardActivityClock(millis(row.activity_at),now);
 return {sessionId:row.id,sourceId:row.source_id,sourceKind:row.source_kind,kind:row.kind,phase:row.status==='active'?(clock.phase==='active'?'active':clock.phase==='warning'?'warning':'released'):row.status,serverNow:now,activityAt:millis(row.activity_at),warningAt:clock.warningAt,deadlineAt:millis(row.deadline_at),warningEpoch:row.warning_epoch,extensionsUsed:row.extensions_used,maxExtensions:2,boardIds:row.board_ids,canExtend:canExtend&&row.status==='active'&&clock.phase==='warning'&&row.extensions_used<2,...(row.reason?{reason:row.reason}:{})};
}
/** Public displays never receive the private match/training UUID. */
export function publicBoardActivity(activity:BoardActivityView|null,canExtend=false):BoardActivityView|null{
 return activity?{...activity,sourceId:`oche-${createHash('sha256').update(activity.sourceId).digest('hex').slice(0,32)}`,canExtend:canExtend&&activity.phase==='warning'&&activity.extensionsUsed<2}:null;
}
async function currentSource(client:Client,sourceId:string):Promise<ActivityRow|null>{return (await client.query<ActivityRow>('select * from dartflow_private.board_activity_sessions where source_id=$1 order by created_at desc,id desc limit 1',[sourceId])).rows[0]??null;}
async function participant(client:Client,row:ActivityRow,actor:string):Promise<boolean>{
 if(row.source_kind==='match')return Boolean((await client.query('select 1 from dartflow_private.match_players where match_id=$1 and user_id=$2',[row.source_id,actor])).rowCount);
 return Boolean((await client.query("select 1 from dartflow_private.platform_entities e where e.id=$1 and (e.owner_id=$2 or(e.kind='lobby' and exists(select 1 from dartflow_private.platform_members m where m.entity_id=e.id and m.user_id=$2 and m.status='active')))",[row.source_id,actor])).rowCount);
}
export async function readSourceBoardActivity(client:Client,sourceId:string,actorId?:string):Promise<BoardActivityView|null>{
 const row=await currentSource(client,identity(sourceId));if(!row)return null;
 return projection(row,await serverNow(client),actorId?await participant(client,row,actorId):false);
}
export async function readBoardActivity(client:Client,boardId:string,actorId?:string):Promise<BoardActivityView|null>{
 const row=(await client.query<ActivityRow>('select s.* from dartflow_private.board_activity_links l join dartflow_private.board_activity_sessions s on s.id=l.session_id where l.board_id=$1',[identity(boardId)])).rows[0];
 return row?projection(row,await serverNow(client),actorId?await participant(client,row,actorId):false):null;
}
/** Source -> physical boards in UUID order -> session; inspect the clock only after all locks. */
export async function lockBoardActivity(client:Client,sessionId:string,additionalBoardIds:string[]=[]):Promise<LockedBoardActivity|null>{
 const before=(await client.query<ActivityRow>('select * from dartflow_private.board_activity_sessions where id=$1',[identity(sessionId)])).rows[0];if(!before)return null;
 if(before.source_kind!=='match')await client.query('select id from dartflow_private.platform_entities where id=$1 for update',[before.source_id]);
 await client.query('select id from dartflow_private.events where id=$1 for update',[before.event_id]);
 if(before.source_kind==='match')await client.query('select id from dartflow_private.matches where id=$1 for update',[before.source_id]);
 const afterSource=(await client.query<ActivityRow>('select * from dartflow_private.board_activity_sessions where id=$1',[sessionId])).rows[0];if(!afterSource)return null;
 await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[[...new Set([...afterSource.board_ids,...additionalBoardIds])].sort()]);
 const row=(await client.query<ActivityRow>('select * from dartflow_private.board_activity_sessions where id=$1 for update',[sessionId])).rows[0];if(!row)return null;
 const now=await serverNow(client);return {row,now,view:projection(row,now)};
}
export async function ensureBoardActivity(client:Client,input:{sourceId:string;sourceKind:SourceKind;boardIds:string[];eventId:string;kind?:'free'|'official';actorIds:string[]}):Promise<BoardActivityView>{
 const boards=[...new Set(input.boardIds.map(identity))].sort();if(!boards.length)throw new DomainError('board_required','Kies een fysieke baan.');
 const previous=await currentSource(client,input.sourceId);
 const locked=previous&&['active','completed'].includes(previous.status)?await lockBoardActivity(client,previous.id,boards):null;
 if(!locked)await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[boards]);
 const occupied=await client.query('select s.source_id from dartflow_private.board_activity_links l join dartflow_private.board_activity_sessions s on s.id=l.session_id where l.board_id=any($1::uuid[]) and s.source_id<>$2',[boards,input.sourceId]);
 if(occupied.rowCount)throw new DomainError('board_occupied','De fysieke baan heeft al een actieve opstelling.',409);
 if(previous&&['active','completed'].includes(previous.status)){
  if(!locked)throw new DomainError('board_session_expired','Deze baanopstelling is beëindigd.',409);
  if(locked.row.status==='active'&&locked.now>=millis(locked.row.deadline_at))return (await releaseBoardActivity(client,{sessionId:previous.id,reason:'timeout'}))!;
  if(locked.row.status==='completed')return locked.view;
  const combined=[...new Set([...locked.row.board_ids,...boards])].sort();
  const updated=(await client.query<ActivityRow>('update dartflow_private.board_activity_sessions set board_ids=$2,actor_ids=$3 where id=$1 returning *',[previous.id,combined,input.actorIds])).rows[0];
  for(const board of boards)await client.query('insert into dartflow_private.board_activity_links(board_id,session_id) values($1,$2) on conflict(board_id) do nothing',[board,previous.id]);
  return projection(updated,locked.now);
 }
 if(previous?.kind==='free'&&previous.status==='released')throw new DomainError('board_session_expired','Deze vrije baanopstelling is beëindigd. Scan opnieuw.',409);
 const now=await serverNow(client),id=randomUUID();
 const row=(await client.query<ActivityRow>('insert into dartflow_private.board_activity_sessions(id,source_kind,source_id,event_id,kind,board_ids,actor_ids,activity_at,deadline_at,warning_epoch,extensions_used) values($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision/1000),to_timestamp(($8::double precision+180000)/1000),$9,$10) returning *',[id,input.sourceKind,input.sourceId,input.eventId,input.kind??'free',boards,input.actorIds,now,randomUUID(),previous?.extensions_used??0])).rows[0];
 for(const board of boards)await client.query('insert into dartflow_private.board_activity_links(board_id,session_id) values($1,$2)',[board,id]);
 return projection(row,now);
}
/** A lobby becoming a match keeps the same session identity and shared extension budget. */
export async function bindBoardActivityMatch(client:Client,lobbyId:string,state:MatchState):Promise<void>{
 const row=await currentSource(client,lobbyId);
 if(!row)return; // Waiting lobbies retain their existing setup lease; T starts at match.start.
 const locked=await lockBoardActivity(client,row.id);if(!locked||locked.row.status!=='active'||locked.now>=millis(locked.row.deadline_at))throw new DomainError('board_session_expired','Deze baanopstelling is verlopen. Scan opnieuw.',409);
 await client.query("update dartflow_private.board_activity_sessions set source_kind='match',source_id=$2,event_id=$3,actor_ids=$4,activity_at=to_timestamp($5::double precision/1000),deadline_at=to_timestamp(($5::double precision+180000)/1000),warning_epoch=$6 where id=$1",[row.id,state.id,state.eventId,matchParticipants(state).map(p=>p.id),locked.now,randomUUID()]);
}
export async function boardDeviceCanExtend(client:Client,boardId:string,token?:string,lock=false):Promise<boolean>{
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
 const device=(await client.query<{created_by:string;event_id:string}>(`select created_by,event_id from dartflow_private.board_screen_devices where board_id=$1 and token_hash=$2 and paired_at is not null and revoked_at is null and expires_at>clock_timestamp()${lock?' for share':''}`,[identity(boardId),createHash('sha256').update(token).digest('hex')])).rows[0];
 if(!device)return false;const physical=await physicalBoard(client,boardId);
 if(physical)return locationManager(client,device.created_by,physical.location_id);
 try{return Boolean((await eventAccess(client,device.created_by,device.event_id)).canManage);}catch(error){if(error instanceof DomainError&&[403,404].includes(error.status))return false;throw error;}
}
export async function extendBoardActivity(actor:string|null,input:{sessionId:string;warningEpoch:string;requestId:string;boardId?:string;deviceToken?:string}):Promise<BoardActivityView>{
 const client=await database().connect();try{await client.query('begin');const locked=await lockBoardActivity(client,input.sessionId);if(!locked)throw new DomainError('not_found','Deze baanopstelling bestaat niet.',404);
 const {row,now}=locked;let actorKey:string;
 if(actor){identity(actor);if(!await participant(client,row,actor))throw new DomainError('forbidden','Alleen een betrokken speler kan doorspelen.',403);await eventAccess(client,actor,row.event_id);actorKey=`player:${actor}`;}
 else{if(!input.boardId||!row.board_ids.includes(input.boardId)||!await boardDeviceCanExtend(client,input.boardId,input.deviceToken,true))throw new DomainError('forbidden','Koppel dit Oche Live-scherm voordat je doorspeelt.',403);actorKey=`device:${createHash('sha256').update(input.deviceToken!).digest('hex')}`;}
 identity(input.requestId);identity(input.warningEpoch);
 if(row.status==='active'&&now>=millis(row.deadline_at)){await releaseBoardActivity(client,{sessionId:row.id,reason:'timeout'});await client.query('commit');throw new DomainError('board_session_expired','De baan is al vrijgegeven.',409);}
 if(row.status!=='active')throw new DomainError('board_session_expired','De baan is al vrijgegeven.',409);
 const prior=(await client.query('select actor_key,warning_epoch from dartflow_private.board_activity_receipts where session_id=$1 and request_id=$2',[row.id,input.requestId])).rows[0];
 if(prior){if(prior.actor_key!==actorKey||prior.warning_epoch!==input.warningEpoch)throw new DomainError('request_reused','Dit actie-ID is al anders gebruikt.',409);const result=projection(row,now,true);await client.query('commit');return result;}
 if(row.warning_epoch!==input.warningEpoch)throw new DomainError('warning_changed','Deze waarschuwing is al verwerkt. Vernieuw de stand.',409);
 if(now<millis(row.activity_at)+120000)throw new DomainError('warning_not_started','Doorspelen kan tijdens de laatste minuut.',409);
 if(row.extensions_used>=2)throw new DomainError('extension_limit','De twee gezamenlijke verlengingen zijn al gebruikt. Een geldige score houdt de baan actief.',409);
 const updated=(await client.query<ActivityRow>('update dartflow_private.board_activity_sessions set activity_at=to_timestamp($2::double precision/1000),deadline_at=to_timestamp(($2::double precision+180000)/1000),warning_epoch=$3,extensions_used=extensions_used+1 where id=$1 returning *',[row.id,now,randomUUID()])).rows[0];
 const result=projection(updated,now,true);await client.query('insert into dartflow_private.board_activity_receipts(session_id,request_id,actor_key,warning_epoch,response) values($1,$2,$3,$4,$5)',[row.id,input.requestId,actorKey,input.warningEpoch,JSON.stringify(result)]);
 await client.query('commit');return result;
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
async function resetAcceptedScore(client:Client,row:ActivityRow,revision:number):Promise<void>{
 if(row.last_score_revision!==null&&row.last_score_revision>=revision)return;
 const now=await serverNow(client);
 await client.query("update dartflow_private.board_activity_sessions set activity_at=to_timestamp($2::double precision/1000),deadline_at=to_timestamp(($2::double precision+180000)/1000),warning_epoch=$3,last_score_revision=$4,status='active' where id=$1",[row.id,now,randomUUID(),revision]);
}
export async function guardMatchBoardActivity(client:Client,state:MatchState):Promise<BoardActivityView|null>{
 if(state.primaryCorrection?.phase==='rescoring'&&!state.boardId)return null;
 if(['abandoned','interrupted'].includes(state.status))throw new DomainError('board_session_expired',state.status==='interrupted'?'Deze officiële partij is onderbroken. De wedstrijdleiding kan hervatten.':'Deze vrije partij is verlopen. Scan de baan opnieuw.',409);
 let row=await currentSource(client,state.id);
 if(!row&&state.boardId&&state.status==='live'){const kind=(await client.query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='lobby'",[state.id])).rowCount?'free':'official';await ensureBoardActivity(client,{sourceId:state.id,sourceKind:'match',boardIds:await matchBoardIds(client,state),eventId:state.eventId,actorIds:[...new Set([...matchParticipants(state).map(p=>p.id),...(state.remoteWriterIds??[])])],kind});row=await currentSource(client,state.id);}
 if(row&&row.status==='interrupted'&&['called','ready'].includes(state.status))return null;
 if(!row)return null;const locked=await lockBoardActivity(client,row.id);if(!locked)return null;
 if(locked.row.status==='active'&&locked.now>=millis(locked.row.deadline_at))return releaseBoardActivity(client,{sessionId:row.id,reason:'timeout'});
 if(['released','interrupted'].includes(locked.row.status))throw new DomainError('board_session_expired','Deze fysieke baanopstelling is beëindigd.',409);
 return locked.view;
}
async function matchBoardIds(client:Client,state:MatchState):Promise<string[]>{
 const linked=(await client.query<{id:string;state:Record<string,unknown>}>("select e.id,e.state from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='lobby'",[state.id])).rows[0];
 const ids=[state.boardId],ownersByBoard=new Map<string,Set<string>>();
 const official=state.remoteBoardIds?(await client.query<{id:string;state:SeasonState}>("select cs.id,cs.state from dartflow_private.platform_match_links l join dartflow_private.competition_seasons cs on cs.id=l.entity_id where l.match_id=$1",[state.id])).rows[0]:undefined;
 if(state.remoteBoardIds){const fixture=official?.state.fixtures.find(f=>f.slots.some(slot=>slot.matchId===state.id)),bindings=[fixture?.remoteAssignments?.home,fixture?.remoteAssignments?.away];if(!official||!fixture||bindings.some((binding,i)=>!binding||binding.boardId!==state.remoteBoardIds![i]||binding.writerId!==state.remoteWriterIds?.[i])||new Set(state.remoteBoardIds).size!==2)throw new DomainError('remote_board_owner','De officiële fysieke zijden zijn niet actueel toegewezen.',409);for(const binding of bindings){ids.push(binding!.boardId);ownersByBoard.set(binding!.boardId,new Set([binding!.by]));}}
 if(linked){
  ids.push(typeof linked.state.boardId==='string'?linked.state.boardId:null);
  for(const key of ['remoteBoardIds','boardMap']){
   const value=linked.state[key];if(!value||typeof value!=='object')continue;
   for(const [actor,id]of Object.entries(value))if(typeof id==='string'){
    if(matchSideIndex(state,actor)<0)throw new DomainError('remote_board_owner','De gekoppelde baan hoort niet bij een deelnemer.',409);
    ids.push(id);const owners=ownersByBoard.get(id)??new Set<string>();owners.add(actor);ownersByBoard.set(id,owners);
   }
  }
 }
 const boards=[...new Set(ids.filter((id):id is string=>Boolean(id)).map(identity))].sort();
 if(boards.length>2)throw new DomainError('remote_board_limit','Een partij kan maximaal twee fysieke banen gebruiken.',409);
 await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[boards]);
 for(const id of boards){
  const board=(await client.query<{blocked:boolean;event_id:string}>('select blocked,event_id from dartflow_private.boards where id=$1',[id])).rows[0];
  const physical=await physicalBoard(client,id);
  if(!board||board.blocked||physical?.archived_at||physical?.closed_at||(physical?.close_after_session&&id!==state.boardId))throw new DomainError('board_unavailable','Een gekoppelde fysieke baan is niet beschikbaar.',409);
  if((await client.query('select 1 from dartflow_private.matches where board_id=$1 and id<>$2',[id,state.id])).rowCount)throw new DomainError('board_occupied','Een gekoppelde fysieke baan heeft al een andere partij.',409);
  // Binding and lobby creation may precede the physical start. Recheck current
  // reservation/leases and the mapped player's rights under the same board locks.
  const eventId=official||id===state.boardId?state.eventId:board.event_id;
  await assertPhysicalBoardEvent(client,id,eventId,state.id);
  if(linked)await assertBoardUnreserved(client,id,eventId,linked.id);if(official)await assertBoardUnreserved(client,id,eventId,state.id);
  for(const actor of ownersByBoard.get(id)??[]){
   await eventAccess(client,actor,board.event_id);
   if(physical?.kind==='home'&&!await locationManager(client,actor,physical.location_id))throw new DomainError('forbidden','De deelnemer heeft geen actuele toegang tot zijn thuisbaan.',403);
  }
 }
 return boards;
}
export async function acceptedMatchBoardActivity(client:Client,source:MatchState,next:MatchState,command:MatchCommand):Promise<void>{
 if(next.primaryCorrection?.phase==='rescoring'&&!next.boardId)return;
 let row=await currentSource(client,next.id);
 if((!row||row.status==='interrupted')&&next.boardId&&next.status==='live'){const linked=(await client.query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='lobby'",[next.id])).rowCount;await ensureBoardActivity(client,{sourceId:next.id,sourceKind:'match',boardIds:await matchBoardIds(client,next),eventId:next.eventId,actorIds:[...new Set([...matchParticipants(next).map(p=>p.id),...(next.remoteWriterIds??[])])],kind:linked?'free':'official'});row=await currentSource(client,next.id);}
 if(!row)return;
 if(command.action.type==='score')await resetAcceptedScore(client,row,next.revision);
 if(['result','confirmed'].includes(next.status))await client.query("update dartflow_private.board_activity_sessions set status='completed' where id=$1 and status in('active','completed')",[row.id]);
 else if(next.status==='live'&&row.status==='completed')await client.query("update dartflow_private.board_activity_sessions set status='active' where id=$1",[row.id]);
 if(source.boardId&&!next.boardId)await releaseBoardActivity(client,{sessionId:row.id,reason:'completed'});
}
export async function guardTrainingBoardActivity(client:Client,row:EntityRow):Promise<BoardActivityView|null>{
 if(row.state.discarded)throw new DomainError('board_session_expired','Deze verlopen training is gewist. Scan opnieuw.',409);
 if(typeof row.state.boardId!=='string')return null;
 let session=await currentSource(client,row.id);
 if(!session){if(row.state.boardHeld!==true)throw new DomainError('board_session_expired','Deze training gebruikt de baan niet meer.',409);await ensureBoardActivity(client,{sourceId:row.id,sourceKind:'training',boardIds:[row.state.boardId],eventId:String(row.state.eventId),actorIds:[row.owner_id]});session=await currentSource(client,row.id);}
 const locked=session?await lockBoardActivity(client,session.id):null;
 if(locked?.row.status==='active'&&locked.now>=millis(locked.row.deadline_at))return releaseBoardActivity(client,{sessionId:locked.row.id,reason:'timeout'});
 if(!locked||locked.row.status!=='active')throw new DomainError('board_session_expired','De baanopstelling is verlopen. Deze training kan niet verder scoren.',409);
 return locked.view;
}
export async function acceptedTrainingBoardActivity(client:Client,row:EntityRow,actionType:string):Promise<void>{
 const session=await currentSource(client,row.id);if(!session)return;
 if(actionType==='training.score')await resetAcceptedScore(client,session,row.revision);
 if(row.state.completed===true||actionType==='training.finish')await releaseBoardActivity(client,{sessionId:session.id,reason:'completed'});
}
export async function releaseBoardActivity(client:Client,input:{sessionId:string;reason:'timeout'|'forced'|'completed';actorId?:string;expectedWarningEpoch?:string;expectedDeadlineAt?:number}):Promise<BoardActivityView|null>{
 const locked=await lockBoardActivity(client,input.sessionId);if(!locked)return null;const {row,now}=locked;
 if(!['active','completed'].includes(row.status))return locked.view;
 if(input.expectedWarningEpoch&&input.expectedWarningEpoch!==row.warning_epoch||input.expectedDeadlineAt!==undefined&&input.expectedDeadlineAt!==millis(row.deadline_at))return locked.view;
 if(input.reason==='timeout'&&(row.status!=='active'||now<millis(row.deadline_at)))return locked.view;
 const assigned=await client.query('select board_id from dartflow_private.board_activity_links where session_id=$1 order by board_id',[row.id]);
 if(!assigned.rowCount)return locked.view;
 let terminal:ActivityRow['status']=input.reason==='completed'?'completed':row.kind==='official'?'interrupted':'released';
 if(row.source_kind==='match'){
  const state:MatchState=(await client.query('select state from dartflow_private.matches where id=$1',[row.source_id])).rows[0]?.state;
  if(state?.boardId){
   if(state.resultPublished||state.status==='confirmed'||input.reason==='completed'||row.status==='completed'&&state.game.status==='finished')terminal='completed';
   const beforeStatus=state.status;state.boardId=null;state.callRef=null;state.revision++;
   if(terminal==='interrupted'){
    state.status='interrupted';state.paused=true;state.correction=null;state.boardInterruption={sessionId:row.id,reason:input.reason==='forced'?'forced':'timeout',at:new Date(now).toISOString(),previousStatus:beforeStatus};
    const target=(await client.query<{id:string;kind:'league'|'tournament';owner_id:string}>("select e.id,e.kind,e.owner_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind in('league','tournament')",[state.id])).rows[0];
    if(target)await client.query('insert into dartflow_private.community_messages(id,scope_kind,scope_id,author_id,body) values($1,$2,$3,$4,$5)',[randomUUID(),target.kind,target.id,target.owner_id,`Oche Live: de fysieke baan van ${state.players.map(p=>p.name).join(' tegen ')} is vrijgegeven wegens ${input.reason==='forced'?'een ingreep van de locatiebeheerder':'inactiviteit'}. De partij is onderbroken; voortgang en speelschema blijven behouden. De wedstrijdleiding kan de partij op een baan hervatten.`]);
   }else if(terminal==='released'){
    state.status='abandoned';state.game=newGame(state.id,matchParticipants(state).map(p=>p.id),state.settings);state.previousSets=[];state.winnerId=null;state.resultRevision=null;state.resultPublished=false;state.accepted=[false,false];state.confirmations=[false,false];state.correction=null;state.dispute=null;state.paused=false;state.delegatedWriterId=null;
    await client.query('delete from dartflow_private.visits where match_id=$1',[state.id]);await client.query('delete from dartflow_private.match_confirmations where match_id=$1',[state.id]);
   }
   await client.query('update dartflow_private.matches set board_id=null,state=$2,revision=$3,updated_at=clock_timestamp() where id=$1',[state.id,JSON.stringify(state),state.revision]);
  }
 }
 if(terminal==='released'){
  const entities=(await client.query<{id:string;state:{name:string;setup?:string;matchId?:string}}>("select e.id,e.state from dartflow_private.platform_entities e where e.id=$1 or(e.kind='lobby' and e.state->>'matchId'=$1::text)",[row.source_id])).rows;
  for(const entity of entities){
   await client.query("update dartflow_private.platform_entities set state=$2,invite_hash=null,invite_expires_at=clock_timestamp(),revision=revision+1 where id=$1",[entity.id,JSON.stringify({name:entity.state.name,closed:true,completed:true,discarded:true,expiredAt:new Date(now).toISOString(),boardHeld:false,boardLeaseUntil:0,boardSessionId:row.id,...(entity.state.matchId?{matchId:entity.state.matchId}:{}),...(entity.state.setup?{setup:entity.state.setup}:{})})]);
   await client.query('delete from dartflow_private.invitation_codes where entity_id=$1',[entity.id]);
  }
 }
 await client.query('delete from dartflow_private.board_activity_links where session_id=$1',[row.id]);
 await client.query('update dartflow_private.location_boards set closed_at=clock_timestamp(),close_after_session=false where board_id=any($1::uuid[]) and close_after_session',[row.board_ids]);
 const updated=(await client.query<ActivityRow>('update dartflow_private.board_activity_sessions set status=$2,ended_at=to_timestamp($3::double precision/1000),reason=$4 where id=$1 returning *',[row.id,terminal,now,input.reason])).rows[0];
 if(terminal==='released')await client.query('select dartflow_private.purge_abandoned_board_payloads($1)',[row.id]);
 await client.query('insert into dartflow_private.audit_events(actor_id,event_id,match_id,action,detail) values($1,$2,$3,$4,$5)',[input.actorId??null,row.event_id,row.source_kind==='match'?row.source_id:null,`board.${input.reason}`,JSON.stringify({sessionId:row.id,sourceId:row.source_id,boardIds:row.board_ids,deadlineAt:millis(row.deadline_at),releasedAt:now,kind:row.kind})]);
 return projection(updated,now);
}
export async function processBoardActivityBatch():Promise<{processed:number}>{
 const candidates=await database().query<{id:string;warning_epoch:string;deadline_at:Date}>("select id,warning_epoch,deadline_at from dartflow_private.board_activity_sessions where status='active' and deadline_at<=clock_timestamp() order by deadline_at,id limit 25");let processed=0;
 for(const row of candidates.rows){const client:PoolClient=await database().connect();try{await client.query('begin');const result=await releaseBoardActivity(client,{sessionId:row.id,reason:'timeout',expectedWarningEpoch:row.warning_epoch,expectedDeadlineAt:millis(row.deadline_at)});await client.query('commit');if(result&&['released','interrupted'].includes(result.phase))processed++;}catch(error){await client.query('rollback');throw error;}finally{client.release();}}
 return {processed};
}
