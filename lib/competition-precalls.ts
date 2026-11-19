import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {entity,requireAccess,save,uuid,view,type EntityRow} from './platform-store';
import type {PlatformCommand,PlatformResponse} from './platform-types';
import type {MatchState,PublicSnapshot} from './types';
import {eventPhysicalBoards} from './location-access';
import {assertPrimaryCorrectionFixtureAllowed,primaryCorrectionBlockedFixtureIds} from './match-corrections';
import {assertCircuitQualificationCommand,decorateCircuitQualificationState} from './circuit-qualifications';

type Precall={fixtureId:string;writerId?:string;createdAt:string;showOnDisplay:boolean};
export async function precallAccess(client:PoolClient,actor:string,command:PlatformCommand):Promise<void>{
 if(command.action.type!=='fixture.precall')return;
 await requireAccess(client,await entity(client,command.action.id),actor,true);
}
export async function precallAction(client:PoolClient,actor:string,command:PlatformCommand):Promise<PlatformResponse|null>{
 const action=command.action;if(action.type!=='fixture.precall')return null;
 const row=await entity(client,action.id,true);await requireAccess(client,row,actor,true);
 if(!['league','tournament'].includes(row.kind)||row.state.seasonManaged===true)throw new DomainError('invalid_precall','Open de wedstrijdleiding van een toernooi of competitie.');
 if(command.expectedRevision!==undefined&&command.expectedRevision!==row.revision)throw new DomainError('revision_conflict','De wedstrijdleiding is gewijzigd. Vernieuw en probeer opnieuw.',409);
 const boardId=uuid(action.boardId);
 if(!(await eventPhysicalBoards(client,row.state.eventId!)).some(board=>board.id===boardId))throw new DomainError('invalid_board','Deze baan hoort niet bij dit evenement.');
 const calls=(row.state.preCalls??={}) as Record<string,Precall>;
 if(action.enabled===false)delete calls[boardId];
 else{
  if(row.state.paused||row.state.closed||row.state.completed)throw new DomainError('event_paused','Deze speeldag kan nu geen vooroproep versturen.',409);
  const fixture=row.state.fixtures?.find(fixture=>fixture.id===uuid(action.fixtureId));
  if(!fixture||fixture.status!=='scheduled'||fixture.players.length!==2||!fixture.players.every(Boolean))throw new DomainError('fixture_unavailable','Kies een complete nog niet toegewezen partij.',409);
  await assertPrimaryCorrectionFixtureAllowed(client,row,fixture.id);
  await assertCircuitQualificationCommand(client,row,'fixture.precall');
  if(Object.entries(calls).some(([board,call])=>board!==boardId&&call.fixtureId===fixture.id))throw new DomainError('precall_exists','Deze partij heeft al een vooroproep op een andere baan.',409);
  const current=(await client.query<{state:MatchState}>("select state from dartflow_private.matches where board_id=$1 and event_id=$2 and state->>'status'='live'",[boardId,row.state.eventId])).rows[0]?.state;
  if(!current)throw new DomainError('precall_board_free','Een vrije baan krijgt een definitieve oproep via Baan toewijzen.',409);
  const previous=current.players.map(player=>current.previousSets.filter(set=>set.winner===player.id).length);
  const matchPoint=current.players.some((_player,side)=>(current.settings.legLimit?current.game.legs.reduce((sum,n)=>sum+n,0)>=current.settings.legLimit-1:current.game.legs[side]>=Math.floor(current.settings.bestOfLegs/2))&&previous[side]>=Math.floor(current.settings.bestOfSets/2));
  if(!matchPoint)throw new DomainError('precall_too_early','Een vooroproep is mogelijk wanneer de lopende partij in een beslissende leg kan eindigen.',409);
  const people=fixture.players as string[],writerId=action.writerId?uuid(action.writerId):undefined;
  const members=(await client.query<{user_id:string;attributes:Record<string,unknown>}>("select user_id,attributes from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true' and user_id=any($2::uuid[])",[row.id,[...people,...(writerId?[writerId]:[])]] )).rows;
  if(people.some(id=>!members.some(member=>member.user_id===id&&member.attributes.checkedIn===true&&member.attributes.available!==false))||writerId&&(people.includes(writerId)||!members.some(member=>member.user_id===writerId&&member.attributes.checkedIn===true&&member.attributes.available!==false)))throw new DomainError('players_unavailable','Check deelnemers en eventuele schrijver eerst in en controleer hun beschikbaarheid.',409);
  calls[boardId]={fixtureId:fixture.id,...(writerId?{writerId}:{}),createdAt:new Date().toISOString(),showOnDisplay:action.showOnDisplay===true};
 }
 await save(client,row);return {ok:true,id:row.id,entity:await view(client,row,actor)};
}
export async function readPublicPrecall(client:Pick<PoolClient,'query'>,boardId:string,eventId:string):Promise<Pick<PublicSnapshot,'pendingCall'>>{
 const row=(await client.query<EntityRow>("select e.* from dartflow_private.platform_entities e join dartflow_private.boards b on b.id=$1 and not b.blocked where e.state->>'eventId'=$2 and e.state->'preCalls' ? $1::text and not exists(select 1 from dartflow_private.location_boards lb where lb.board_id=b.id and(lb.archived_at is not null or lb.closed_at is not null or lb.close_after_session)) limit 1",[boardId,eventId])).rows[0];
 if(!row||row.state.paused||row.state.closed||row.state.completed)return {};
 const call=(row.state.preCalls as Record<string,Precall>)[boardId],fixture=row.state.fixtures?.find(fixture=>fixture.id===call.fixtureId);
 if(!call.showOnDisplay||!fixture||fixture.status!=='scheduled'||!fixture.players.every(Boolean))return {};
 if((await primaryCorrectionBlockedFixtureIds(client,row)).has(fixture.id)||(await decorateCircuitQualificationState(client,row)).state.circuitSourceStale)return {};
 const ids=[...fixture.players,...(call.writerId?[call.writerId]:[])];
 const people=(await client.query<{id:string;name:string;available:boolean}>("select p.id,p.name,coalesce(m.attributes->>'available','true')<>'false' as available from dartflow_private.platform_members m join dartflow_private.profile_labels p on p.id=m.user_id where m.entity_id=$1 and m.status='active' and m.attributes->>'registered'='true' and m.user_id=any($2::uuid[])",[row.id,ids])).rows;
 if(ids.some(id=>!people.some(person=>person.id===id&&person.available)))return {};
 return {pendingCall:{label:'Vooroproep · wacht op definitieve toewijzing',players:fixture.players.map(id=>people.find(person=>person.id===id)!.name) as [string,string],...(call.writerId?{writerName:people.find(person=>person.id===call.writerId)!.name}:{})}};
}
