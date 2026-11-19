import {matchParticipants} from './match-sides';
import {createHash,randomUUID} from 'node:crypto';
import type {Client} from './platform-store';
import type {MatchState,MatchCommand,PublicSnapshot,Visit} from './types';

export type ScoreEvent = {id:string;revision:number;kind:'score'|'undo';score?:number;checkout?:boolean;bust?:boolean;playerIndex?:number;playerName?:string};
const opaque=(value:string)=>createHash('sha256').update(`oche-session:${value}`).digest('hex').slice(0,32);
type PublicVisit=Pick<ScoreEvent,'score'|'checkout'|'bust'|'playerIndex'|'playerName'>;
export async function recordScoreEvents(client:Client,boardId:string|undefined|null,sourceId:string,revision:number,kind:'score'|'undo',visits:PublicVisit[]=[]):Promise<void>{
 if(!boardId)return;
 for(const [ordinal,visit] of (kind==='undo'?[null]:visits).entries())await client.query('insert into dartflow_private.board_score_events(id,board_id,source_id,revision,ordinal,kind,visit) values($1,$2,$3,$4,$5,$6,$7) on conflict(source_id,revision,ordinal) do nothing',[randomUUID(),boardId,sourceId,revision,ordinal,kind,visit===null?null:JSON.stringify(visit)]);
}
const allVisits=(match:MatchState):Visit[]=>[...match.previousSets,match.game].flatMap(game=>game.visits);
export async function recordMatchScoreEvent(client:Client,source:MatchState,next:MatchState,command:MatchCommand):Promise<void>{
 if(command.action.type==='score'){
  const visit=allVisits(next).at(-1);
  if(visit)await recordScoreEvents(client,next.boardId||source.boardId,next.id,next.revision,'score',[{score:visit.score,checkout:visit.checkout,bust:visit.bust,playerIndex:visit.playerIndex,playerName:matchParticipants(next).find(player=>player.id===(visit.throwerId??visit.player))?.name}]);
 }else if(allVisits(next).length<allVisits(source).length)await recordScoreEvents(client,next.boardId||source.boardId,next.id,next.revision,'undo');
}
/** Called only after display authorization. Fresh loads/reconnects baseline these events. */
export async function readBoardScoreEvents(client:Client,boardId:string,sourceId?:string,revision?:number):Promise<Pick<PublicSnapshot,'sessionKey'|'scoreEvents'>>{
 if(!sourceId){
  const latest=await client.query<{source_id:string}>('select source_id from dartflow_private.board_score_events where board_id=$1 and created_at>now()-interval \'10 minutes\' order by created_at desc,id desc limit 1',[boardId]);
  sourceId=latest.rows[0]?.source_id;
 }
 if(!sourceId)return {sessionKey:`idle-${opaque(boardId)}`,scoreEvents:[]};
 const result=await client.query<{id:string;revision:number;kind:'score'|'undo';visit:PublicVisit|null}>('select id,revision,kind,visit from (select id,revision,ordinal,kind,visit from dartflow_private.board_score_events where source_id=$2 and (board_id=$1 or exists(select 1 from dartflow_private.board_activity_links l join dartflow_private.board_activity_sessions s on s.id=l.session_id where l.board_id=$1 and s.source_id=$2)) and ($3::int is null or revision<=$3) order by revision desc,ordinal desc limit 64) e order by revision,ordinal',[boardId,sourceId,revision??null]);
 return {sessionKey:opaque(sourceId),scoreEvents:result.rows.map(row=>({id:row.id,revision:row.revision,kind:row.kind,...row.visit}))};
}
