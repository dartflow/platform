import {isMultiPlayerMatch} from './match-sides';
import type {Game, MatchState, Profile, Visit} from './types';
import type {OpponentStatistics, PlayerMeasures, PracticeStatistics, StatisticsFilter, StatisticsMatch, StatisticsMatchRow, StatisticsSummary, TrainingStatisticsSource} from './player-statistics-types';

export const DEFAULT_STATISTICS_FILTER:StatisticsFilter={startScore:501,outRule:'double-out'};
const validDarts=(n:unknown):n is number=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=3;
const empty=():PlayerMeasures=>({points:0,darts:0,visits:0,average:null,complete:true,oneEighties:0,hundredPlus:0,hundredFortyPlus:0,distribution:{under100:0,hundredTo139:0,hundredFortyTo179:0,oneEighty:0},highestFinish:0,hundredPlusFinishes:0,bestLegDarts:null,firstNine:null,firstNinePoints:0,firstNineDarts:0,doubleAttempts:null,checkouts:0,checkoutPercentage:null,hundredPlusPer100:null,finishes:[]});
/** A non-checkout counts as a full three-dart visit, including a bust or valid zero. */
export function countedVisitDarts(visit:Visit):number|null{
 if(!validDarts(visit.darts))return null;
 if(!visit.checkout&&visit.darts!==3&&visit.measurementVersion!==1)return null;
 return visit.checkout?visit.darts:3;
}
const validVisit=(v:Visit,outRule?:Game['outRule'])=>Number.isInteger(v.score)&&v.score>=0&&v.score<=180&&Number.isInteger(v.remainingBefore)&&Number.isInteger(v.remainingAfter)&&Number.isInteger(v.leg)&&v.leg>=1&&v.remainingBefore>=(outRule==='straight'?1:2)&&v.remainingAfter>=0&&(v.bust?v.remainingAfter===v.remainingBefore:v.remainingAfter===v.remainingBefore-v.score)&&(!v.checkout||(!v.bust&&v.remainingAfter===0&&v.score===v.remainingBefore));
/** One calculator for live cards, profiles, tournaments and recap. Never use rounded averages as input. */
export function calculatePlayerMeasures(games:Game[],playerId:string):PlayerMeasures{
 const result=empty();let attempts=0,attemptsComplete=true;
 for(const [setIndex,game]of games.entries()){
  if(game.outRule&&game.outRule!=='double')attemptsComplete=false;
  const playerIndex=game.players.indexOf(playerId);if(playerIndex<0){result.complete=false;continue;}
  const own=(game.visits??[]).map((visit,sequence)=>({visit,sequence})).filter(({visit})=>visit.player===playerId&&visit.playerIndex===playerIndex);
  const grouped=new Map<number,{visit:Visit;sequence:number}[]>();
  for(const item of own){const list=grouped.get(item.visit.leg)??[];list.push(item);grouped.set(item.visit.leg,list);}
  let gamePoints=0,gameDarts=0,ownCheckouts=0;
  for(const [leg,items]of grouped){let expected=game.sideStartScores?.[playerIndex]??game.startScore,legDarts=0,firstPoints=0,firstDarts=0,legComplete=true,firstReliable=true;
   for(const {visit:v,sequence}of items){
    const valid=validVisit(v,game.outRule),continuous=v.remainingBefore===expected;expected=v.remainingAfter;const count=countedVisitDarts(v);
    if(!valid||!continuous||count===null){result.complete=false;legComplete=false;if(firstDarts<9)firstReliable=false;}
    if(!valid)continue;
    const points=v.bust?0:v.score;result.visits++;gamePoints+=points;gameDarts+=count??0;legDarts+=count??0;
    if(firstDarts<9&&count!==null){if(firstDarts+count<=9){firstDarts+=count;firstPoints+=points;}else{legComplete=false;firstReliable=false;}}
    if(points>=100)result.hundredPlus++;if(points>=140)result.hundredFortyPlus++;if(points===180)result.oneEighties++;
    if(points===180)result.distribution.oneEighty++;else if(points>=140)result.distribution.hundredFortyTo179++;else if(points>=100)result.distribution.hundredTo139++;else result.distribution.under100++;
    if(v.doubleAttempts===undefined||v.doubleAttempts===null)attemptsComplete=false;else if(!Number.isInteger(v.doubleAttempts)||v.doubleAttempts<0||v.doubleAttempts>(v.checkout?v.darts:3)||(v.checkout&&v.doubleAttempts<1)){attemptsComplete=false;}else attempts+=v.doubleAttempts;
    if(v.checkout){ownCheckouts++;result.checkouts++;result.highestFinish=Math.max(result.highestFinish,v.score);if(v.score>=100)result.hundredPlusFinishes++;result.finishes.push({score:v.score,set:setIndex+1,leg,sequence});}
   }
   if(firstReliable&&firstDarts===9){result.firstNinePoints+=firstPoints;result.firstNineDarts+=9;}
   if(legComplete&&items.at(-1)?.visit.checkout&&legDarts>0)result.bestLegDarts=result.bestLegDarts===null?legDarts:Math.min(result.bestLegDarts,legDarts);
  }
  // Old snapshots with missing turns may still count as a result, never as a measured average.
  if(ownCheckouts!==(game.legs[playerIndex]??0))result.complete=false;
  if(!own.length&&(game.legs.reduce((a,b)=>a+b,0)>0||game.status==='finished'))result.complete=false;
  if(own.some(({visit})=>!validVisit(visit,game.outRule)))result.complete=false;
  if(game.stats?.[playerIndex]&&(game.stats[playerIndex].total!==gamePoints||game.stats[playerIndex].darts!==gameDarts))result.complete=false;
  result.points+=gamePoints;result.darts+=gameDarts;
 }
 result.average=result.complete&&result.darts>0?3*result.points/result.darts:null;
 result.firstNine=result.firstNineDarts?3*result.firstNinePoints/result.firstNineDarts:null;
 result.doubleAttempts=attemptsComplete&&result.visits>0?attempts:null;
 result.checkoutPercentage=result.doubleAttempts!==null&&result.doubleAttempts>0?100*result.checkouts/result.doubleAttempts:null;
 result.hundredPlusPer100=result.visits?100*result.hundredPlus/result.visits:null;
 return result;
}
export function combinePlayerMeasures(values:PlayerMeasures[]):PlayerMeasures{
 const result=empty();let doubles=0,allDoubles=values.length>0;
 for(const v of values){result.complete&&=v.complete;if(v.complete){result.points+=v.points;result.darts+=v.darts;}result.visits+=v.visits;result.oneEighties+=v.oneEighties;result.hundredPlus+=v.hundredPlus;result.hundredFortyPlus+=v.hundredFortyPlus;for(const key of Object.keys(result.distribution)as(keyof PlayerMeasures['distribution'])[])result.distribution[key]+=v.distribution[key];result.highestFinish=Math.max(result.highestFinish,v.highestFinish);result.hundredPlusFinishes+=v.hundredPlusFinishes;result.checkouts+=v.checkouts;result.firstNinePoints+=v.firstNinePoints;result.firstNineDarts+=v.firstNineDarts;if(v.bestLegDarts!==null)result.bestLegDarts=result.bestLegDarts===null?v.bestLegDarts:Math.min(result.bestLegDarts,v.bestLegDarts);if(v.doubleAttempts===null)allDoubles=false;else doubles+=v.doubleAttempts;}
 result.average=result.darts?3*result.points/result.darts:null;result.firstNine=result.firstNineDarts?3*result.firstNinePoints/result.firstNineDarts:null;result.doubleAttempts=allDoubles?doubles:null;result.checkoutPercentage=allDoubles&&doubles>0?100*result.checkouts/doubles:null;result.hundredPlusPer100=result.visits?100*result.hundredPlus/result.visits:null;return result;
}
export function matchGames(state:MatchState):Game[]{return[...state.previousSets,state.game];}
export function isPlayedStatisticsMatch(record:StatisticsMatch):boolean{return record.state.settings.discipline!=='cricket'&&!isMultiPlayerMatch(record.state)&&record.state.resultPublished&&record.state.status==='confirmed'&&!record.state.administrativeDecision&&record.state.players.length===2&&record.state.players[0].id!==record.state.players[1].id;}
export function statisticsMatchOrder(a:StatisticsMatch,b:StatisticsMatch):number{return b.completedAt.localeCompare(a.completedAt)||b.id.localeCompare(a.id);}
export function uniqueStatisticsMatches(records:StatisticsMatch[]):StatisticsMatch[]{const map=new Map<string,StatisticsMatch>();for(const record of records){const prior=map.get(record.id);if(!prior||record.state.revision>prior.state.revision)map.set(record.id,record);}return[...map.values()].filter(isPlayedStatisticsMatch).sort(statisticsMatchOrder);}
export function statisticsMatchRow(record:StatisticsMatch,actor:string):StatisticsMatchRow{
 const state=record.state,index=state.players.findIndex(p=>p.id===actor),profiles=state.players.map(p=>record.profiles?.find(current=>current.id===p.id)??p),games=matchGames(state),measures=calculatePlayerMeasures(games,actor);
 return{id:record.id,completedAt:record.completedAt,players:profiles,opponent:profiles[1-index]??null,result:state.winnerId===null?'G':state.winnerId===actor?'W':'V',legs:profiles.map((_p,i)=>games.reduce((sum,g)=>sum+(g.legs[i]??0),0)),sets:profiles.map(p=>games.filter(g=>g.status==='finished'&&g.winner===p.id).length),startScore:state.settings.startScore,outRule:`${state.settings.outRule??'double'}-out` as StatisticsMatchRow['outRule'],average:measures.average,measured:measures.complete&&measures.darts>0,...(record.competition?{competition:record.competition}:{})};
}
export function statisticsRulesMatch(state:MatchState,filter:StatisticsFilter){return state.settings.startScore===filter.startScore&&`${state.settings.outRule??'double'}-out`===filter.outRule&&(state.settings.inRule??'single')===(filter.inRule??'single')&&Boolean(state.settings.sideStartScores)===Boolean(filter.handicap);}
export function summarizePlayerStatistics(records:StatisticsMatch[],actor:string,filter:StatisticsFilter=DEFAULT_STATISTICS_FILTER):StatisticsSummary{
 const all=uniqueStatisticsMatches(records).filter(r=>r.state.players.some(p=>p.id===actor)),selected=all.filter(r=>statisticsRulesMatch(r.state,filter)),rows=selected.map(r=>statisticsMatchRow(r,actor)),measures=selected.map(r=>calculatePlayerMeasures(matchGames(r.state),actor)),window=selected.slice(0,50),windowMeasures=window.map(r=>calculatePlayerMeasures(matchGames(r.state),actor)),reliable=windowMeasures.filter(m=>m.complete&&m.darts>0),weighted=combinePlayerMeasures(reliable);
 const topFinishes=selected.flatMap((record,index)=>measures[index].finishes.map(f=>({...f,completedAt:record.completedAt,matchId:record.id,opponent:rows[index].opponent}))).sort((a,b)=>b.score-a.score||b.completedAt.localeCompare(a.completedAt)||b.matchId.localeCompare(a.matchId)||a.set-b.set||a.leg-b.leg||a.sequence-b.sequence).slice(0,10);
 return{played:rows.length,won:rows.filter(r=>r.result==='W').length,lost:rows.filter(r=>r.result==='V').length,drawn:rows.filter(r=>r.result==='G').length,winPercentage:rows.length?100*rows.filter(r=>r.result==='W').length/rows.length:null,legsWon:rows.reduce((sum,r)=>sum+(r.legs[r.players.findIndex(p=>p.id===actor)]??0),0),legsLost:rows.reduce((sum,r)=>sum+(r.legs[1-r.players.findIndex(p=>p.id===actor)]??0),0),form:rows.slice(0,5),measures:combinePlayerMeasures(measures),last50:{window:window.length,measured:reliable.length,average:weighted.average,label:`Gemeten in ${reliable.length} van ${window.length} duels`,trend:window.map((r,i)=>({id:r.id,completedAt:r.completedAt,average:windowMeasures[i].average})).reverse()},topFinishes};
}
export function buildOpponentStatistics(records:StatisticsMatch[],actor:string):OpponentStatistics[]{
 const groups=new Map<string,StatisticsMatch[]>();for(const record of uniqueStatisticsMatches(records)){const other=record.state.players.find(p=>p.id!==actor);if(!other||!record.state.players.some(p=>p.id===actor))continue;const list=groups.get(other.id)??[];list.push(record);groups.set(other.id,list);}
 return[...groups.entries()].map(([id,list])=>{const rows=list.map(r=>statisticsMatchRow(r,actor)),opponent=rows[0].players.find(p=>p.id===id)!;return{opponent,played:rows.length,won:rows.filter(r=>r.result==='W').length,lost:rows.filter(r=>r.result==='V').length,drawn:rows.filter(r=>r.result==='G').length,legsWon:rows.reduce((sum,r)=>sum+r.legs[r.players.findIndex(p=>p.id===actor)],0),legsLost:rows.reduce((sum,r)=>sum+r.legs[1-r.players.findIndex(p=>p.id===actor)],0),lastPlayedAt:rows[0].completedAt,lastResult:rows[0],recent:rows.slice(0,5)};}).sort((a,b)=>b.lastPlayedAt.localeCompare(a.lastPlayedAt)||a.opponent.id.localeCompare(b.opponent.id));
}
export function practiceStatistics(source:TrainingStatisticsSource,actor:string):PracticeStatistics|null{
 if(!source.completed||source.discarded)return null;const game=source.game,measures=game?calculatePlayerMeasures([game],actor):null;const rounds=source.rounds??[],hits=source.mode==='around'?rounds.reduce((a,b)=>a+b,0):null;
 return{id:source.id,name:source.name,mode:source.mode,completedAt:source.completedAt,startScore:source.mode==='around'?null:game?.startScore??null,average:game?.startScore===501&&['solo','bot'].includes(source.mode)?measures?.average??null:null,darts:measures?.darts??null,highestFinish:measures?.highestFinish??null,bestLegDarts:measures?.bestLegDarts??null,hits,attempts:source.mode==='around'?rounds.length*3:null,progress:source.mode==='around'?rounds.length:game?game.startScore-game.remaining[0]:null};
}
export function currentPlayerProfiles(state:MatchState,profiles:Profile[]):MatchState{return{...state,players:state.players.map(p=>profiles.find(current=>current.id===p.id)??p),...(state.sideParticipants?{sideParticipants:state.sideParticipants.map(side=>side.map(p=>profiles.find(current=>current.id===p.id)??p)) as [Profile[],Profile[]]}:{})};}
