import {getPublicPlayBoard} from './play-sessions';
import {publicTactics} from './tactics';
import{publicBullStart}from'./bull-start';
import {matchEventNotice} from './event-display-notice';
import {readPublicPrecall} from './competition-precalls';
import {readSeasonDisplay} from './season-display';
import {readCompetitionLobbyDisplay} from './competition-board-lobby';
import {assignedBoardMatch} from './board-match-projection';
import {publicMatchSides,publicMatchVisit,publicMatchSettings,matchParticipants} from './match-sides';
import {getOcheStatistics} from './player-statistics-db';
import {calculatePlayerMeasures,currentPlayerProfiles} from './player-statistics';
import { randomUUID } from 'node:crypto';
import {readBoardScoreEvents} from './score-events';
import { database } from './db';
import { checkout, DomainError, matchView } from './domain';
import { boardLease } from './platform-locks';
import { text, uuid } from './platform-store';
import type { Client } from './platform-store';
import type { ClubBoardScreenView, ClubBoardView, PlatformCommand, PlatformResponse } from './platform-types';
import type { Game, MatchState, PublicSnapshot, Stats, Visit } from './types';
import {ensureLegacyPhysicalBoard} from './locations';
import {locationScreenContext} from './location-access';
import {publicBoardActivity,readBoardActivity} from './board-activity';

type BoardRow = {board_id:string;club_id:string;event_id:string;name:string;access:'all'|'club';blocked:boolean;closed_at:Date|null;close_after_session:boolean|null;club_name:string;club_lifecycle:string;owner_id:string;role:string|null;status:string|null;core_role:string|null;owner_blocked:boolean;occupied:boolean;state:MatchState|null;location_id:string|null;physical_manage:boolean};
const boardSelect = `select cb.*,b.name,b.blocked,c.name as club_name,coalesce(ce.state->>'lifecycle','active') as club_lifecycle,ce.owner_id,cm.role,cm.status,core.role as core_role,lb.location_id,lb.closed_at,lb.close_after_session,
 (l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1)) as physical_manage,
 exists(select 1 from dartflow_private.platform_relationships r where r.kind='block' and ((r.source_id=$1 and r.target_id=ce.owner_id) or(r.target_id=$1 and r.source_id=ce.owner_id))) as owner_blocked,
 (m.id is not null or exists(select 1 from dartflow_private.board_activity_links al join dartflow_private.board_activity_sessions ac on ac.id=al.session_id where al.board_id=b.id and ac.status in('active','completed')) or exists(select 1 from dartflow_private.platform_entities pe where pe.state->>'boardId'=b.id::text and coalesce(pe.state->>'closed','false')<>'true' and (pe.state->>'boardLeaseUntil')::bigint>floor(extract(epoch from now())*1000) and ((pe.kind='lobby' and pe.state->>'matchId' is null) or(pe.kind='training' and pe.state->>'boardHeld'='true')))) as occupied,
 m.state from dartflow_private.club_boards cb join dartflow_private.boards b on b.id=cb.board_id and b.event_id=cb.event_id
 join dartflow_private.clubs c on c.id=cb.club_id join dartflow_private.events e on e.id=cb.event_id and e.club_id=cb.club_id
 join dartflow_private.platform_entities ce on ce.id=cb.club_id and ce.kind='club'
 left join dartflow_private.platform_members cm on cm.entity_id=ce.id and cm.user_id=$1
 left join dartflow_private.club_memberships core on core.club_id=cb.club_id and core.user_id=$1
 left join dartflow_private.location_boards lb on lb.board_id=cb.board_id left join dartflow_private.locations l on l.id=lb.location_id
 left join dartflow_private.matches m on m.board_id=b.id`;
function manager(row:BoardRow):boolean{return row.physical_manage===true;}
function accessible(row:BoardRow):boolean{return row.status!=='banned'&&!row.owner_blocked&&(row.access==='all'||!['inactive','deleted'].includes(row.club_lifecycle)&&row.status==='active'&&Boolean(row.core_role));}
function assertAccess(row:BoardRow,manage=false):void{
 if(manage?!manager(row):!accessible(row))throw new DomainError('forbidden',manage?'Alleen de actuele locatie-eigenaar of locatiebeheerder kan deze baan beheren.':'Deze baan is niet toegankelijk voor jouw account.',403);
}
async function rowForBoard(client:Client,actor:string,boardId:string):Promise<BoardRow>{
 const {rows}=await client.query<BoardRow>(`${boardSelect} where cb.board_id=$2`,[uuid(actor),uuid(boardId)]);
 if(!rows.length)throw new DomainError('not_found','Deze verenigingsbaan bestaat niet.',404);
 return rows[0];
}
function boardView(_client:Client,row:BoardRow):ClubBoardView{
 return {id:row.board_id,clubId:row.club_id,name:row.name,access:row.access,blocked:row.blocked,occupied:row.occupied,closed:Boolean(row.closed_at),closePending:Boolean(row.close_after_session),canManage:manager(row),playUrl:`/baan/${row.board_id}`,screenUrl:`/baanscherm/${row.board_id}`};
}
/** Only this dedicated board event receives open admission; it never creates club membership. */
export async function clubBoardEventAccess(client:Client,actor:string,eventId:string):Promise<{clubId:string;clubName:string;boardId:string;access:'all'|'club';canManage:boolean}|null>{
 const {rows}=await client.query<BoardRow>(`${boardSelect} where cb.event_id=$2`,[uuid(actor),uuid(eventId)]);
 if(!rows.length)return null;
 const row=rows[0];assertAccess(row);
 return {clubId:row.club_id,clubName:row.club_name,boardId:row.board_id,access:row.access,canManage:manager(row)};
}
export async function listClubBoards(client:Client,actor:string,visibleClubIds?:string[]):Promise<ClubBoardView[]>{
 const {rows}=await client.query<BoardRow>(`${boardSelect} where (($2::uuid[] is null and cm.status='active' and core.user_id is not null) or cb.club_id=any($2::uuid[])) and coalesce(cm.status,'')<>'banned'
 and (cb.access='all' or(cm.status='active' and core.user_id is not null))
 and not exists(select 1 from dartflow_private.platform_relationships r where r.kind='block' and ((r.source_id=$1 and r.target_id=ce.owner_id) or(r.target_id=$1 and r.source_id=ce.owner_id)))
 order by c.name,b.name,cb.board_id limit 250`,[uuid(actor),visibleClubIds?.map(uuid)??null]);
 return Promise.all(rows.filter(accessible).map(row=>boardView(client,row)));
}
export async function revalidateClubBoardCommand(client:Client,actor:string,command:PlatformCommand,response:PlatformResponse):Promise<void>{
 if(!command.action.type.startsWith('club-board.'))return;
 const boardId=command.action.type==='club-board.create'?response.id:command.action.boardId;
 const row=await rowForBoard(client,actor,uuid(boardId));assertAccess(row,true);
}
export async function clubBoardAction(client:Client,actor:string,command:PlatformCommand):Promise<PlatformResponse|null>{
 const a=command.action;
 if(a.type==='club-board.create'){
  const clubId=uuid(a.clubId),name=text(a.name),access=a.access===undefined?'all':a.access;
  if(access!=='all'&&access!=='club')throw new DomainError('invalid_access','Kies iedereen met een account of alleen verenigingsleden.');
  // Lock before reading membership: a role change may have committed while this waited.
  await client.query("select id from dartflow_private.platform_entities where id=$1 and kind='club' for update",[clubId]);
  const club=await client.query(`select ce.id from dartflow_private.platform_entities ce
   join dartflow_private.platform_members cm on cm.entity_id=ce.id and cm.user_id=$2 and cm.status='active' and cm.role in ('owner','admin')
   join dartflow_private.club_memberships core on core.club_id=ce.id and core.user_id=$2 and core.role='organizer'
   where ce.id=$1 and ce.kind='club' and not exists(select 1 from dartflow_private.platform_relationships r where r.kind='block' and ((r.source_id=$2 and r.target_id=ce.owner_id) or(r.target_id=$2 and r.source_id=ce.owner_id)))`,[clubId,actor]);
  if(!club.rowCount)throw new DomainError('forbidden','Alleen de actuele verenigingsbeheerder kan een baan toevoegen.',403);
  const eventId=randomUUID(),boardId=randomUUID();
  await client.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,128)',[eventId,clubId,`Vrij spelen · ${name}`]);
  await client.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[boardId,eventId,name]);
  await client.query('insert into dartflow_private.club_boards(board_id,club_id,event_id,name,access,created_by) values($1,$2,$3,$4,$5,$6)',[boardId,clubId,eventId,name,access,actor]);
  await ensureLegacyPhysicalBoard(client,actor,boardId,eventId,name);
  const row=await rowForBoard(client,actor,boardId);
  return {ok:true,id:boardId,board:await boardView(client,row)};
 }
 if(a.type!=='club-board.update')return null;
 const boardId=uuid(a.boardId),before=await rowForBoard(client,actor,boardId);assertAccess(before,true);
 await client.query('select id from dartflow_private.events where id=$1 for update',[before.event_id]);
 await client.query('select id from dartflow_private.platform_entities where id=$1 for update',[before.club_id]);
 if(before.location_id)await client.query('select id from dartflow_private.locations where id=$1 for update',[before.location_id]);
 const row=await rowForBoard(client,actor,boardId);assertAccess(row,true);
 const name=a.name===undefined?row.name:text(a.name),access=a.access===undefined?row.access:a.access;
 if(access!=='all'&&access!=='club')throw new DomainError('invalid_access','Kies iedereen met een account of alleen verenigingsleden.');
 if(a.blocked!==undefined&&typeof a.blocked!=='boolean')throw new DomainError('invalid_blocked','Kies of de baan geblokkeerd is.');
 const occupied=Boolean(row.state||await boardLease(client,boardId));
 if(occupied&&(access!==row.access||a.blocked===true&&!row.blocked))throw new DomainError('board_occupied','Rond de actieve partij of training eerst af voordat je de toegang wijzigt of de baan blokkeert.',409);
 await client.query('update dartflow_private.club_boards set name=$2,access=$3 where board_id=$1',[boardId,name,access]);
 await client.query('update dartflow_private.boards set name=$2,blocked=$3 where id=$1',[boardId,name,a.blocked??row.blocked]);
 return {ok:true,id:boardId,board:await boardView(client,await rowForBoard(client,actor,boardId))};
}
function visitsForDisplay(visits:Visit[]):Visit[]{return visits.map(v=>({player:`player-${v.playerIndex+1}`,playerIndex:v.playerIndex,score:v.score,darts:v.darts,remainingBefore:v.remainingBefore,remainingAfter:v.remainingAfter,bust:v.bust,leg:v.leg,checkout:v.checkout}));}
function statsForDisplay(stats:Stats[]):Stats[]{return stats.map(s=>({total:s.total,darts:s.darts,oneEighties:s.oneEighties,highestFinish:s.highestFinish,...(s.legsWon===undefined?{}:{legsWon:s.legsWon}),average:s.average??(s.darts?3*s.total/s.darts:0),...(s.measurementComplete===undefined?{}:{measurementComplete:s.measurementComplete})}));}
/** Public, read-only physical display: no actor IDs, capabilities, membership or private state. */
export async function getClubBoardScreen(boardId:string,client?:Client):Promise<ClubBoardScreenView>{
 if(!client){const connection=await database().connect();try{await connection.query('begin isolation level repeatable read read only');const result=await getClubBoardScreen(boardId,connection);await connection.query('commit');return result;}catch(error){await connection.query('rollback');throw error;}finally{connection.release();}}
 const id=uuid(boardId);
 const {rows}=await client.query<{event_id:string;name:string;blocked:boolean;access:'all'|'club';club_name:string;state:MatchState|null}>(`select b.event_id,b.name,b.blocked,cb.access,c.name as club_name,m.state from dartflow_private.club_boards cb
  join dartflow_private.boards b on b.id=cb.board_id and b.event_id=cb.event_id join dartflow_private.clubs c on c.id=cb.club_id
  left join dartflow_private.matches m on m.board_id=b.id where cb.board_id=$1`,[id]);
 if(!rows.length)throw new DomainError('not_found','Deze verenigingsbaan bestaat niet.',404);
 const rawActivity=await readBoardActivity(client,id);
 rows[0].state=await assignedBoardMatch(client,id);
 const row=rows[0],lease=await boardLease(client,id),occupied=Boolean(row.state||lease),location=await locationScreenContext(client,id,row.state?.id??lease?.id);
 let match:PublicSnapshot['match']=null;
 if(row.state){
  const labels=await client.query<{id:string;name:string}>('select id,name from dartflow_private.profile_labels where id=any($1::uuid[])',[matchParticipants(row.state).map(p=>p.id)]);
  row.state=currentPlayerProfiles(row.state,labels.rows);
  const view=matchView(row.state,'',false);
  const currentLegVisits=(view.currentLegVisits??[]).map(visit=>publicMatchVisit(view,visit));
  match={id:`board-${id}`,revision:view.revision,status:view.status,...publicMatchSides(view),...publicBullStart(view),...(view.cricket?{cricket:view.cricket}:{}),...(view.tactics?{tactics:publicTactics(view.tactics)}:{}),players:view.players.map((p,i)=>({id:`player-${i+1}`,name:p.name})),remaining:view.remaining,legs:view.legs,sets:view.sets,turn:view.turn,checkout:view.checkout,visits:currentLegVisits,currentLegVisits,currentLegStartScore:view.currentLegStartScore??view.settings.startScore,scoringMode:view.scoringMode,winnerId:view.winnerId?`player-${view.players.findIndex(p=>p.id===view.winnerId)+1}`:null,resultPublished:view.resultPublished,settings:publicMatchSettings(view.settings),writerId:'',stats:statsForDisplay(view.stats),legNumber:view.legNumber,setNumber:view.setNumber,paused:Boolean(view.paused)};
 }else if(lease?.kind==='training'){
  const game=lease.state.game as Game;
  const profile=await client.query<{name:string}>('select name from dartflow_private.profile_labels where id=$1',[lease.owner_id]);
  const legNumber=game.legs[0]+(game.status==='finished'?0:1),currentLegVisits=visitsForDisplay(game.visits.filter(v=>v.leg===legNumber));
  match={id:`board-${id}`,revision:lease.revision,status:game.status==='finished'?'result':'live',...(game.cricket?{cricket:game.cricket}:{}),...(game.tactics?{tactics:publicTactics(game.tactics)}:{}),players:[{id:'player-1',name:profile.rows[0]?.name??'Speler'}],remaining:[game.remaining[0]],legs:[game.legs[0]],sets:[0],turn:0,checkout:game.status==='live'&&!['cricket','tactics'].includes(game.discipline??'')&&(game.outRule??'double')==='double'?checkout(game.remaining[0]):null,visits:currentLegVisits,currentLegVisits,currentLegStartScore:game.startScore,winnerId:game.status==='finished'?'player-1':null,resultPublished:false,settings:{startScore:game.startScore as 301|501|701,bestOfLegs:1,bestOfSets:1,...(game.discipline?{discipline:game.discipline}:{}),...(game.cricketMode?{cricketMode:game.cricketMode}:{}),...(game.tactics?{tacticsPreset:game.tactics.preset,tacticsMode:game.tactics.mode}:{}),...(game.inRule?{inRule:game.inRule}:{}),...(game.outRule?{outRule:game.outRule}:{}),...(game.sideStartScores?{sideStartScores:game.sideStartScores}:{})},writerId:'',stats:statsForDisplay([{...game.stats[0],average:calculatePlayerMeasures([game],lease.owner_id).average??0}]),legNumber,setNumber:1,paused:false};
 }
 const play=!row.state&&(!lease||lease.kind==='play-session')?await getPublicPlayBoard(id,client):undefined;
 const blocked=row.blocked||Boolean(location?.physical.archived_at);
 const closed=Boolean(location?.physical.closed_at),closePending=Boolean(location?.physical.close_after_session),activity=publicBoardActivity(rawActivity);
 const statistics=await getOcheStatistics(client,{boardId:id,state:row.state,lobbyId:lease?.kind==='lobby'?lease.id:null,allowRecap:!row.state&&!lease&&!play&&!blocked&&!closed&&!closePending&&!location?.reservation});
 return {board:{id,name:row.name,clubName:row.club_name,access:row.access,blocked,occupied:occupied||play?.status==='active',closed,closePending,publicScan:row.access==='all'&&!blocked&&!closed&&!closePending&&!location?.reservation,playUrl:`/baan/${id}`,screenUrl:`/baanscherm/${id}`},status:closed?'closed':match||play?'playing':lease?'waiting':blocked?'blocked':closePending?'closed':location?.reservation?'reserved':'available',snapshot:{board:{id,name:row.name},event:{name:[location?.reservation?.label??row.club_name,await matchEventNotice(client,row.state?.id)].filter(Boolean).join(' · ')},match,...await readSeasonDisplay(client,row.state?.id),...(!row.state?{competitionLobby:await readCompetitionLobbyDisplay(client,id)}:{}),...await readPublicPrecall(client,id,row.state?.eventId??row.event_id),...(statistics?{statistics}:{}),...(activity?{boardActivity:activity}:{}),...(play?{play,sessionKey:play.sessionKey,scoreEvents:[]}:await readBoardScoreEvents(client,id,row.state?.id??lease?.id,match?.revision))},...(location?.reservation?{reservation:location.reservation}:{})};
}
