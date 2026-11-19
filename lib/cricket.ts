import {dartValue} from './x01-rules';
import {gameThrowerId} from './match-sides';
import{seriesWinner}from'./match-winning-rules';
import type {Game} from './types';

export const CRICKET_TARGETS=[20,19,18,17,16,15,25] as const;
export type CricketState={marks:[number[],number[]];points:[number,number];creditedMarks:[number,number]};
export const newCricket=():CricketState=>({marks:[CRICKET_TARGETS.map(()=>0),CRICKET_TARGETS.map(()=>0)],points:[0,0],creditedMarks:[0,0]});
export function cricketHit(hit:string):{target:number;marks:number}|null{
 dartValue(hit);
 if(hit==='SB'||hit==='DB')return {target:25,marks:hit==='DB'?2:1};
 const match=/^([SDT])(\d+)$/.exec(hit);if(!match||Number(match[2])<15)return null;
 return {target:Number(match[2]),marks:match[1]==='T'?3:match[1]==='D'?2:1};
}
/** Cricket has its own marks/points. No X01 remaining-score or checkout arithmetic. */
export function scoreCricketGame(source:Game,hits:string[]):Game{
 if(source.status!=='live'||!source.cricket)throw new Error('Deze Cricket-leg is niet speelbaar.');
 if(!Array.isArray(hits)||!hits.length||hits.length>3)throw new Error('Registreer één tot drie werkelijk geworpen pijlen.');
 const next=structuredClone(source),{history,...snapshot}=structuredClone(source);void history;next.history.push(snapshot);
 const side=source.turn,other=1-side,cricket=next.cricket!,before=structuredClone(cricket),mode=source.cricketMode??'standard';let won=false,credited=0;
 for(const [index,hit] of hits.entries()){
  if(won)throw new Error('Er zijn pijlen geregistreerd na de beslissende Cricket-pijl.');
  const value=cricketHit(hit);
  if(value){const target=CRICKET_TARGETS.indexOf(value.target as typeof CRICKET_TARGETS[number]),closing=Math.min(3-cricket.marks[side][target],value.marks),extra=value.marks-closing;cricket.marks[side][target]+=closing;credited+=closing;
   if(mode==='standard'&&cricket.marks[other][target]<3){cricket.points[side]+=extra*value.target;credited+=extra;}
  }
  won=cricket.marks[side].every(marks=>marks===3)&&(mode==='no-score'||cricket.points[side]>=cricket.points[other]);
  if(won&&index<hits.length-1)throw new Error('Er zijn pijlen geregistreerd na de beslissende Cricket-pijl.');
 }
 const darts=won?hits.length:3,score=cricket.points[side]-before.points[side];cricket.creditedMarks[side]+=credited;
 next.stats[side].total+=score;next.stats[side].darts+=darts;
 const completed=source.legs[0]+source.legs[1];
 next.visits.push({player:source.players[side],playerIndex:side,...(source.sidePlayers?{throwerId:gameThrowerId(source)}:{}),score,darts,leg:completed+1,bust:false,checkout:won,measurementVersion:1,remainingBefore:before.points[side],remainingAfter:cricket.points[side],dartHits:[...hits],observedScore:hits.reduce((sum,hit)=>sum+dartValue(hit),0),cricket:{marksBefore:before.marks[side],marksAfter:[...cricket.marks[side]],pointsBefore:before.points[side],pointsAfter:cricket.points[side],creditedMarks:credited}});
 next.remaining=[...cricket.points];
 if(!won){next.turn=other;return next;}
 next.legs[side]++;next.stats[side].legsWon=(next.stats[side].legsWon??0)+1;
 if(next.legLimit?next.legs[0]+next.legs[1]>=next.legLimit:seriesWinner(next.legs,next.bestOf,next.legWinByTwo)!==null){next.status='finished';next.winner=next.legLimit&&next.legs[0]===next.legs[1]?null:next.players[next.legs[0]>next.legs[1]?0:1];next.draw=next.winner===null;}
 else{next.cricket={...newCricket(),creditedMarks:cricket.creditedMarks};next.remaining=[0,0];next.turn=(next.legStarter+next.legs[0]+next.legs[1])%2;}
 return next;
}
