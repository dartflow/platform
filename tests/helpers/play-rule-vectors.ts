import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {newPlayState,normalizePlayRules,restartPlayAttempt,scorePlayVisit,undoPlayVisit} from '../../lib/play-rules';
import type {PlaySide,PlayState,PlayVisitInput} from '../../lib/play-types';
type Action={type:'visit';input:PlayVisitInput}|{type:'undo'}|{type:'restart';starter?:number};
type Case={id:string;rules:Record<string,unknown>;sides:PlaySide[];starter:number;actions:Action[]};
const solo=[{id:'a',playerIds:['alice']}],pair=[...solo,{id:'b',playerIds:['bob']}];
const hit=(...dartHits:string[]):Action=>({type:'visit',input:{dartHits}});
const source={matchId:'source',version:'v1',playerId:'historic',startScore:301,inRule:'single',outRule:'double',valid:true,visits:[{score:180,remainingBefore:301,remainingAfter:121,bust:false,checkout:false,actualDarts:3},{score:121,remainingBefore:121,remainingAfter:0,bust:false,checkout:true}]};
const cases:Case[]=[
 {id:'301-opening-undo',rules:{mode:'x01',startScore:301},sides:solo,starter:0,actions:[hit('S20','D16','T20'),{type:'undo'},hit('S20','D16','T20'),{type:'visit',input:{score:60}}]},
 {id:'cricket-overshoot',rules:{mode:'cricket'},sides:pair,starter:0,actions:[hit('D20'),hit('MISS'),hit('T20'),hit('T20'),hit('T20')]},
 {id:'tactics-five-replay',rules:{mode:'tactics'},sides:pair,starter:0,actions:[...Array.from({length:11},(_,i)=>20-i).flatMap(n=>[hit('T'+n,'D'+n),hit('T'+n,'D'+n)]),hit('DB','DB','SB'),hit('DB','DB','SB'),{type:'restart',starter:1}]},
 {id:'around-targets',rules:{mode:'around',hitsPerTarget:1},sides:pair,starter:0,actions:[hit('T1','S2','D3'),hit('MISS','S1','T2'),{type:'undo'}]},
 {id:'bingo-team-order',rules:{mode:'bingo',cardCode:'DFB1-010203040506070809'},sides:[{id:'a',playerIds:['alice','alex']},{id:'b',playerIds:['bob','bea']}],starter:0,actions:[hit('D1','D1','S2'),hit('MISS'),hit('D2'),hit('MISS'),hit('D3')]},
 {id:'finish-bust-five-attempts',rules:{mode:'finish',target:40},sides:solo,starter:0,actions:[hit('S20'),hit('T20'),...Array.from({length:4},()=>({type:'visit' as const,input:{dartHits:['D20'],intendedTargets:['D20']}}))]},
 {id:'challenge-legacy-turn-comparison',rules:{mode:'leg-challenge',source},sides:solo,starter:0,actions:[{type:'visit',input:{score:180}},{type:'visit',input:{score:121,darts:3,doubleConfirmed:true}}]},
 {id:'challenge-dart-loss-boundary',rules:{mode:'leg-challenge',source:{...source,visits:source.visits.map(v=>({...v,actualDarts:3}))}},sides:solo,starter:0,actions:[hit('MISS','MISS','MISS'),hit('MISS','MISS'),hit('MISS')]}
];
export function playVectorView(state:PlayState){return {mode:state.mode,progress:state.progress,turn:state.turn,status:state.status,legs:state.legs,sets:state.sets,attempt:state.attempt,currentThrowerId:state.currentThrowerId,result:state.result};}
export function buildPlayRuleVectors(){return {version:1,contract:'Accepted pure engine state only; no actor authorization, offline persistence or hosted/device proof.',cases:cases.map(example=>{let state=newPlayState(example.id,example.sides,normalizePlayRules(example.rules),example.starter);const initial=playVectorView(state);const steps=example.actions.map(action=>{state=action.type==='visit'?scorePlayVisit(state,action.input):action.type==='undo'?undoPlayVisit(state):restartPlayAttempt(state,action.starter);return {action,expected:playVectorView(state)};});return {id:example.id,rules:example.rules,sides:example.sides,starter:example.starter,initial,steps};})};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeFileSync(new URL('../fixtures/play-rules.json',import.meta.url),JSON.stringify(buildPlayRuleVectors(),null,2)+'\n');
