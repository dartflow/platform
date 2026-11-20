import {newPlayState,normalizePlayRules,restartPlayAttempt,scorePlayVisit} from './play-rules';
import {gameThrowerId} from './match-sides';
import {seriesWinner} from './match-winning-rules';
import type {Game} from './types';
import type {PlayMarksProgress} from './play-types';

export const TACTICS_TARGETS=[20,19,18,17,16,15,14,13,12,11,10,25] as const;
export type TacticsState={preset:'tactics-5'|'tactics-3';mode:'standard'|'no-score';requiredMarks:5|3;marks:[number[],number[]];points:[number,number];creditedMarks:[number,number];attempt:number;replays:{leg:number;attempt:number;starter:number;fromVisit:number;toVisit:number}[]};
export function newTactics(preset:TacticsState['preset']='tactics-5',mode:TacticsState['mode']='standard'):TacticsState{return {preset,mode,requiredMarks:preset==='tactics-5'?5:3,marks:[TACTICS_TARGETS.map(()=>0),TACTICS_TARGETS.map(()=>0)],points:[0,0],creditedMarks:[0,0],attempt:1,replays:[]};}

/** Existing match identities/series/signatures retain authority; only target arithmetic is delegated. */
export function scoreTacticsGame(source:Game,hits:string[]):Game{
 if(source.status!=='live'||!source.tactics)throw new Error('Deze Tactics-leg is niet speelbaar.');
 const before=source.tactics,completed=source.legs[0]+source.legs[1],leg=completed+1,starter=source.legStartOverrides?.[String(leg)]??(source.legStarter+completed)%2;
 const engine=newPlayState(source.id,source.players.map(id=>({id,playerIds:[id]})),normalizePlayRules({mode:'tactics',preset:before.preset,points:before.mode!=='no-score'}),starter);
 engine.turn=source.turn;engine.currentThrowerId=source.players[source.turn];engine.attempt=before.attempt;
 const progress=engine.progress as PlayMarksProgress;progress.marks=structuredClone(before.marks);progress.points=[...before.points];progress.creditedMarks=[...before.creditedMarks];
 const scored=scorePlayVisit(engine,{dartHits:hits}),row=scored.visits.at(-1)!,marks=scored.progress as PlayMarksProgress;
 const next=structuredClone(source),{history,...snapshot}=structuredClone(source);void history;next.history.push(snapshot);
 const side=source.turn;
 next.visits.push({player:source.players[side],playerIndex:side,...(source.sidePlayers?{throwerId:gameThrowerId(source)}:{}),score:row.score,darts:hits.length,remainingBefore:before.points[side],remainingAfter:marks.points[side],bust:false,leg,checkout:row.finish,measurementVersion:1,dartHits:[...hits],observedScore:row.observedScore??0,tactics:{attempt:before.attempt,marksBefore:[...before.marks[side]],marksAfter:[...marks.marks[side]],pointsBefore:before.points[side],pointsAfter:marks.points[side],creditedMarks:marks.creditedMarks[side]-before.creditedMarks[side]}});
 next.stats[side].total+=row.score;next.stats[side].darts+=hits.length;
 next.tactics={...structuredClone(before),marks:structuredClone(marks.marks) as [number[],number[]],points:[...marks.points] as [number,number],creditedMarks:[...marks.creditedMarks] as [number,number]};
 next.remaining=[...marks.points];
 if(scored.status==='replay-required'){
  const replayStarter=(starter+1)%2,replayed=restartPlayAttempt(scored,replayStarter),reset=replayed.progress as PlayMarksProgress;
  next.tactics.replays.push({leg,attempt:before.attempt,starter,fromVisit:source.visits.findIndex(v=>v.leg===leg&&v.tactics?.attempt===before.attempt)+1,toVisit:next.visits.length});
  next.tactics.attempt++;next.tactics.marks=structuredClone(reset.marks) as [number[],number[]];next.tactics.points=[0,0];next.remaining=[0,0];
  next.legStartOverrides??={};next.legStartOverrides[String(leg)]=replayStarter as 0|1;next.turn=replayStarter;return next;
 }
 if(scored.status!=='finished'){next.turn=scored.turn;return next;}
 next.legs[side]++;next.stats[side].legsWon=(next.stats[side].legsWon??0)+1;
 if(next.legLimit?next.legs[0]+next.legs[1]>=next.legLimit:seriesWinner(next.legs,next.bestOf,next.legWinByTwo)!==null){next.status='finished';next.winner=next.legLimit&&next.legs[0]===next.legs[1]?null:next.players[next.legs[0]>next.legs[1]?0:1];next.draw=next.winner===null;}
 else{const reset=newTactics(before.preset,before.mode);next.tactics={...reset,creditedMarks:[...next.tactics.creditedMarks],replays:next.tactics.replays};next.remaining=[0,0];next.turn=(starter+1)%2;next.legStartOverrides??={};next.legStartOverrides[String(leg+1)]=next.turn as 0|1;}
 return next;
}
/** Only public target counters and accepted replay boundaries leave the match state. */
export function publicTactics(value:TacticsState):TacticsState{return {preset:value.preset,mode:value.mode,requiredMarks:value.requiredMarks,marks:value.marks.map(row=>row.slice(0,12)) as [number[],number[]],points:[value.points[0],value.points[1]],creditedMarks:[value.creditedMarks[0],value.creditedMarks[1]],attempt:value.attempt,replays:value.replays.map(row=>({leg:row.leg,attempt:row.attempt,starter:row.starter,fromVisit:row.fromVisit,toVisit:row.toVisit}))};}
