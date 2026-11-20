import {scoreGame,checkout} from './domain';
import {gameThrowerId} from './match-sides';
import type {MatchCommand,MatchView} from './types';
export type CoreScoreQueue={version:1;actorId:string;matchId:string;base:MatchView;commands:MatchCommand[];acknowledged?:string[];resolution?:{reason:string;decision:string;at:string}};
export function projectCoreQueue(record:CoreScoreQueue):MatchView{
 const base=record.base;if(!record.commands.length)return base;if(!base.scoringState)throw Error('Open de actuele partij als bevoegde schrijver om offline in te voeren.');let game=structuredClone(base.scoringState);let stop=false;
 for(const [i,c]of record.commands.entries()){
  if(stop||c.matchId!==base.id||c.expectedRevision!==base.revision+i||!base.permissions.canScore||c.action.type!=='score')throw Error('Deze offline reeks sluit niet aan op je schrijfrecht.');
  if(base.scoringMode==='per-player'&&(base.remoteWriterIds?.[game.turn]??gameThrowerId(game))!==record.actorId)throw Error('Wacht op de bevestigde beurt van de tegenstander.');
  const a=c.action;game=scoreGame(game,a.score,a.darts??3,a.doubleConfirmed??false,a.doubleAttempts,a.dartHits,a.bust??false);stop=game.status==='finished'||base.settings.decidingLeg==='rebull'&&game.legs.some((v,k)=>v!==base.scoringState!.legs[k]);
 }
 const canScore=!stop&&(base.scoringMode!=='per-player'||(base.remoteWriterIds?.[game.turn]??gameThrowerId(game))===record.actorId);
 return{...base,revision:base.revision+record.commands.length,remaining:game.remaining,legs:game.legs,turn:game.turn,visits:[...base.visits.slice(0,Math.max(0,base.visits.length-base.scoringState.visits.length)),...game.visits],stats:game.stats,legNumber:game.legs.reduce((n,v)=>n+v,0)+1,currentLegVisits:game.visits.filter(v=>v.leg===game.legs.reduce((n,v)=>n+v,0)+1),checkout:game.discipline&&game.discipline!=='x01'?null:checkout(game.remaining[game.turn]),cricket:game.cricket,tactics:game.tactics,scoringState:game,permissions:{...base.permissions,canScore,canUndo:false,canConfirm:false}};
}
export function enqueueCoreScore(record:CoreScoreQueue,command:MatchCommand):CoreScoreQueue{if(record.commands.length>=100)throw Error('Synchroniseer eerst de bewaarde beurten.');const next={...record,commands:[...record.commands,command]};projectCoreQueue(next);return next;}

export type CoreReplayResponse={accepted:string[];conflict?:{message:string}};
/** Retain acknowledged prefix proof when an intervening revision prevents rebasing the tail. */
export function acceptCoreReplayResponse(current:CoreScoreQueue,response:CoreReplayResponse,latest:MatchView):CoreScoreQueue{
 const acknowledged=new Set([...(current.acknowledged??[]),...response.accepted]),remaining=current.commands.filter(command=>!acknowledged.has(command.requestId));
 if(acknowledged.size&&!response.conflict&&(!remaining.length||remaining[0].expectedRevision===latest.revision))return{...current,base:latest,commands:remaining,acknowledged:[]};
 return{...current,acknowledged:[...acknowledged]};
}
/** A former writer may submit only the exact retained batch for server proof. */
export async function replayStoredCoreQueue(record:CoreScoreQueue,readCurrent:()=>Promise<MatchView>,send:(body:{matchId:string;baseRevision:number;commands:MatchCommand[]})=>Promise<CoreReplayResponse>):Promise<{response:CoreReplayResponse;latest?:MatchView;controlNeeded?:true}>{
 const forbidden=(error:unknown)=>Boolean(error&&typeof error==='object'&&'status'in error&&error.status===403);
 try{await readCurrent();}catch(error){if(!forbidden(error))throw error;}
 const response=await send({matchId:record.matchId,baseRevision:record.base.revision,commands:record.commands});
 try{return{response,latest:await readCurrent()};}catch(error){if(!forbidden(error))throw error;return{response,controlNeeded:true};}
}
