import type {Game,MatchState} from './types';
import {matchSideIndex} from './match-sides';
import {countedVisitDarts} from './player-statistics';

export type PlayerContribution={points:number;darts:number;visits:number;average:number|null;oneEighties:number;highestFinish:number;creditedMarks:number;marksPerRound:number|null};
/** Only explicit thrower attribution counts; team points are never split among teammates. */
export function playerContribution(state:Pick<MatchState,'players'|'sideParticipants'|'previousSets'|'game'|'settings'>,actor:string):PlayerContribution{
 const side=matchSideIndex(state,actor),games:Game[]=[...state.previousSets,state.game],result:PlayerContribution={points:0,darts:0,visits:0,average:null,oneEighties:0,highestFinish:0,creditedMarks:0,marksPerRound:null};
 if(side<0)return result;
 for(const visit of games.flatMap(game=>game.visits)){
  if(visit.playerIndex!==side||(state.sideParticipants?.some(roster=>roster.length>1)?visit.throwerId!==actor:(visit.throwerId??visit.player)!==actor))continue;
  const darts=visit.cricket||visit.tactics?visit.dartHits?.length??visit.darts:countedVisitDarts(visit);if(darts===null)continue;
  result.visits++;result.darts+=darts;result.points+=visit.bust?0:visit.score;
  if(visit.cricket||visit.tactics)result.creditedMarks+=(visit.cricket??visit.tactics)!.creditedMarks;
  else{if(visit.score===180&&!visit.bust)result.oneEighties++;if(visit.checkout)result.highestFinish=Math.max(result.highestFinish,visit.score);}
 }
 if(result.darts){if(['cricket','tactics'].includes(state.settings.discipline??''))result.marksPerRound=3*result.creditedMarks/result.darts;else result.average=3*result.points/result.darts;}
 return result;
}
