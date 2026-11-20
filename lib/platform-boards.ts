import {randomBytes,randomUUID}from'node:crypto';
import type {PoolClient}from'pg';
import {eventAccess}from'./db';
import {DomainError,validateSettings}from'./domain';
import {enqueueDomainMail}from'./integrations-mail';
import {newTraining}from'./platform-domain';
import {assertBoardUnreserved,boardLease}from'./platform-locks';
import {addMember,blocked,createEntity,hash,text,uuid,view}from'./platform-store';
import type {PlatformCommand,PlatformResponse}from'./platform-types';
import {assertPhysicalBoardEvent,locationManager,physicalBoard} from './location-access';
import {ensureBoardActivity,lockBoardActivity,readBoardActivity,releaseBoardActivity} from './board-activity';

async function screenGrant(client:PoolClient,actor:string,eventId:string,boardId:string,sessionId?:string):Promise<string>{
 // The hash authenticates both the session reference and 256 random capability bits.
 const token=sessionId?Buffer.concat([Buffer.from(sessionId.replaceAll('-',''),'hex'),randomBytes(32)]).toString('base64url'):randomBytes(32).toString('base64url');
 await client.query("insert into dartflow_private.screen_capabilities(id,event_id,board_id,token_hash,created_by,expires_at) values($1,$2,$3,$4,$5,now()+interval '12 hours')",[randomUUID(),eventId,boardId,hash(token),actor]);
 return `/scherm/${token}`;
}
export async function boardAction(client:PoolClient,actor:string,command:PlatformCommand):Promise<PlatformResponse>{
 const a=command.action,boardId=uuid(a.boardId);
 const scope=await client.query('select event_id from dartflow_private.boards where id=$1',[boardId]);if(!scope.rows.length)throw new DomainError('not_found','Deze baan bestaat niet.',404);
 let event=await eventAccess(client,actor,scope.rows[0].event_id);
 if(a.type==='board.start'){
  // Serialize with scoring and expiry in the same event/source lock order.
  // A queued claim then sees the committed interruption before taking the lane.
  const existing=await readBoardActivity(client,boardId);
  if(existing){const locked=await lockBoardActivity(client,existing.sessionId);if(locked?.row.status==='active'&&locked.now>=locked.row.deadline_at.getTime())await releaseBoardActivity(client,{sessionId:existing.sessionId,reason:'timeout'});}
 }
 await client.query('select id from dartflow_private.events where id=$1 for update',[event.id]);
 event=await eventAccess(client,actor,event.id);
 const {rows}=await client.query('select * from dartflow_private.boards where id=$1 for update',[boardId]);const board=rows[0];
 const assigned=await client.query('select id,state from dartflow_private.matches where board_id=$1',[boardId]),lease=await boardLease(client,boardId);
 if(a.type==='board.screen'){
  const core=assigned.rows[0]?.state,member=lease?await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status='active'",[lease.id,actor]):null;
  if(!event.canManage&&lease?.owner_id!==actor&&!member?.rowCount&&!core?.players?.some((p:{id:string})=>p.id===actor)&&core?.writerId!==actor)throw new DomainError('forbidden','Alleen de betrokken speler of wedstrijdleiding kan dit scherm koppelen.',403);
  return {ok:true,screenUrl:await screenGrant(client,actor,event.id,boardId,event.canManage?undefined:lease?.id??core?.id)};
 }
 if(a.type!=='board.start')throw new DomainError('invalid_action','Onbekende vrije-baanactie.');
 const physical=await physicalBoard(client,boardId);
 if(physical?.kind==='home'&&!await locationManager(client,actor,physical.location_id))throw new DomainError('forbidden','Alleen de eigenaar kan een nieuwe partij op deze thuisbaan starten.',403);
 await assertPhysicalBoardEvent(client,boardId,event.id);
 if(board.blocked||assigned.rowCount)throw new DomainError('board_occupied','Deze baan is geblokkeerd of heeft al een partij.',409);
 await assertBoardUnreserved(client,boardId,event.id);
 const mode=String(a.mode??'local');if(!['solo','local','remote'].includes(mode))throw new DomainError('invalid_mode','Kies solo, samen op locatie of op afstand.');
 const settings=validateSettings({...a,startScore:Number(a.startScore??501)as 301|501|701,bestOfLegs:Number(a.bestOfLegs??3)});
 if(mode==='solo'){
  const id=randomUUID(),state=newTraining(id,actor,{...settings,mode:'solo',startScore:settings.startScore});state.boardId=boardId;state.eventId=event.id;state.boardHeld=true;state.boardLeaseUntil=Date.now()+30*60_000;
  const {row}=await createEntity(client,actor,'training',state,'private',null,id);
  const activity=await ensureBoardActivity(client,{sourceId:id,sourceKind:'training',boardIds:[boardId],eventId:event.id,actorIds:[actor]});
  row.state.boardLeaseUntil=activity.deadlineAt;row.state.boardSessionId=activity.sessionId;
  await client.query('update dartflow_private.platform_entities set state=$2 where id=$1',[id,JSON.stringify(row.state)]);
  return {ok:true,id,kind:'training',trainingId:id,url:`/app/training/${id}`,screenUrl:await screenGrant(client,actor,event.id,boardId,id),entity:await view(client,row,actor)};
 }
 const {row,code}=await createEntity(client,actor,'lobby',{name:a.name?text(a.name):`${board.name} · ${mode==='remote'?'Online':'Lokaal'}`,setup:mode==='remote'?'remote':'localone',settings,capacity:2,ready:{},boardId,eventId:event.id,coreClubId:event.club_id,boardLeaseUntil:Date.now()+120_000,...(mode==='remote'?{remoteBoardIds:{[actor]:boardId}}:{})},'private');
 if(a.opponentId){const user=uuid(a.opponentId);if(user===actor||await blocked(client,actor,user))throw new DomainError('blocked','Deze uitnodiging is niet toegestaan.',403);await eventAccess(client,user,event.id);await addMember(client,row.id,user,'member','invited');await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:challenge-invite:${user}`,templateId:'challenge-invite',scope:'platform',recipientId:user,entityId:row.id,expiresAt:new Date(Number(row.state.boardLeaseUntil)).toISOString(),variables:{eventName:row.state.name,startScore:String(row.state.settings?.startScore??501),bestOf:String(row.state.settings?.bestOfLegs??5),actionUrl:`/app/lobby/${row.id}`}});}
 return {ok:true,id:row.id,kind:'lobby',lobbyId:row.id,code,url:`/app/lobby/${row.id}?code=${code}`,screenUrl:await screenGrant(client,actor,event.id,boardId,row.id),entity:await view(client,row,actor)};
}
