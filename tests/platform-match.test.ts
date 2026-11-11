import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchAction, matchView, newGame } from '../lib/domain';
import { boardCallApplicable } from '../lib/integrations-mail';
import type { MatchState, Settings } from '../lib/types';
const settings: Settings={startScore:301,bestOfLegs:1,bestOfSets:1};
function match(overrides:Partial<MatchState>={}):MatchState{return {id:'match-a',eventId:'event',clubId:'club',boardId:'board',revision:0,status:'live',players:[{id:'a',name:'A'},{id:'b',name:'B'}],writerId:'a',settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame('match-a',['a','b'],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null,...overrides};}
const score=(state:MatchState,value:number)=>applyMatchAction(state,state.writerId,false,{type:'score',score:value});
test('pause and resume are authorized server states that block scoring and offline undo',()=>{
 let state=score(match(),60);const game=structuredClone(state.game);
 assert.throws(()=>applyMatchAction(state,'stranger',false,{type:'pause'}),{code:'forbidden'});
 state=applyMatchAction(state,'b',false,{type:'pause'});assert.equal(state.paused,true);assert.equal(matchView(state,'a',false).permissions.canScore,false);
 assert.throws(()=>score(state,40),{code:'match_paused'});assert.throws(()=>applyMatchAction(state,'a',false,{type:'undo'}),{code:'match_paused'});
 state=applyMatchAction(state,'a',false,{type:'resume'});assert.deepEqual(state.game,game);assert.equal(state.paused,false);assert.equal(matchView(state,'a',false).permissions.canScore,true);
});
test('opponent approval atomically rewinds the requested own visit and subsequent opponent visit',()=>{
 let state=score(score(match(),60),40);const scoringRevision=state.scoringRevision;
 state=applyMatchAction(state,'a',false,{type:'request-correction',reason:'Mijn eerste beurt was onjuist.'});const id=state.correction!.id;
 assert.equal(state.correction?.undoCount,2);assert.equal(state.correction?.scoringRevision,scoringRevision);
 assert.throws(()=>score(state,60),{code:'correction_pending'});assert.throws(()=>applyMatchAction(state,'a',false,{type:'undo'}),{code:'correction_pending'});
 assert.throws(()=>applyMatchAction(state,'a',false,{type:'approve-correction',correctionId:id}),{code:'forbidden'});
 assert.throws(()=>applyMatchAction(state,'organizer',true,{type:'approve-correction',correctionId:id}),{code:'forbidden'});
 // Writer takeover is independent of the unchanged score and invalidates the old writer.
 state=applyMatchAction(state,'b',false,{type:'take-over'});state=applyMatchAction(state,'b',false,{type:'approve-correction',correctionId:id});
 assert.deepEqual(state.game.remaining,[301,301]);assert.equal(state.game.visits.length,0);assert.equal(state.writerId,'b');assert.equal(state.correction,null);
 assert.throws(()=>applyMatchAction(state,'a',false,{type:'score',score:60}),{code:'not_writer'});
 assert.throws(()=>applyMatchAction(state,'b',false,{type:'approve-correction',correctionId:id}),{code:'correction_conflict'});
});
test('reject and cancel preserve score; a changed scoring base or another match correction ID cannot be approved',()=>{
 let state=score(score(match(),60),40);const original=structuredClone(state.game);
 state=applyMatchAction(state,'a',false,{type:'request-correction',reason:'Controleer mijn beurt.'});let id=state.correction!.id;
 const stale={...state,scoringRevision:state.scoringRevision!+1};assert.throws(()=>applyMatchAction(stale,'b',false,{type:'approve-correction',correctionId:id}),{code:'correction_conflict'});
 assert.throws(()=>applyMatchAction(state,'b',false,{type:'approve-correction',correctionId:'another-match:3'}),{code:'correction_conflict'});
 state=applyMatchAction(state,'b',false,{type:'reject-correction',correctionId:id});assert.deepEqual(state.game,original);assert.equal(state.correction,null);
 state=applyMatchAction(state,'b',false,{type:'request-correction',reason:'Laatste eigen beurt.'});id=state.correction!.id;
 assert.throws(()=>applyMatchAction(state,'a',false,{type:'cancel-correction',correctionId:id}),{code:'forbidden'});
 state=applyMatchAction(state,'b',false,{type:'cancel-correction',correctionId:id});assert.deepEqual(state.game,original);
});
test('a correction across a set boundary restores sets, winner, visits and statistics without stale publication',()=>{
 const multi={...settings,bestOfSets:3};let state=match({settings:multi,game:{...newGame('match-a',['a','b'],multi),remaining:[40,301]}});
 state=applyMatchAction(state,'a',false,{type:'score',score:40,darts:1,doubleConfirmed:true});assert.equal(state.previousSets.length,1);
 state=applyMatchAction(state,'a',false,{type:'request-correction',reason:'De dubbel raakte niet.'});const id=state.correction!.id;
 state=applyMatchAction(state,'b',false,{type:'approve-correction',correctionId:id});assert.equal(state.previousSets.length,0);assert.deepEqual(state.game.remaining,[40,301]);assert.equal(state.game.stats[0].darts,0);assert.equal(state.winnerId,null);assert.equal(state.resultRevision,null);
 let finish=match({game:{...newGame('match-a',['a','b'],settings),remaining:[40,301]}});finish=applyMatchAction(finish,'a',false,{type:'score',score:40,darts:1,doubleConfirmed:true});finish=applyMatchAction(finish,'a',false,{type:'request-correction',reason:'Laatste dubbel controleren.'});assert.throws(()=>applyMatchAction(finish,'b',false,{type:'confirm'}),{code:'correction_pending'});assert.equal(finish.resultPublished,false);
 finish=applyMatchAction(finish,'b',false,{type:'approve-correction',correctionId:finish.correction!.id});assert.equal(finish.status,'live');assert.equal(finish.resultRevision,null);
});

test('board mail belongs to one call generation and remains valid for the unaccepted opponent after readiness changes',()=>{
 const called=match({status:'called',revision:1,callRef:'call-one',accepted:[false,false]}),ref={ref:'call-one',boardId:'board'};
 assert.equal(boardCallApplicable(called,ref,'a'),true);assert.equal(boardCallApplicable(called,ref,'b'),true);
 const accepted=applyMatchAction(called,'a',false,{type:'accept'});assert.equal(accepted.revision,2);assert.equal(boardCallApplicable(accepted,ref,'a'),false);assert.equal(boardCallApplicable(accepted,ref,'b'),true);
 assert.equal(boardCallApplicable({...accepted,callRef:'call-two'},ref,'b'),false);assert.equal(boardCallApplicable({...accepted,boardId:null},ref,'b'),false);assert.equal(boardCallApplicable({...accepted,status:'live'},ref,'b'),false);assert.equal(boardCallApplicable(accepted,ref,'stranger'),false);assert.equal(boardCallApplicable(accepted,undefined,'b'),false);
});
