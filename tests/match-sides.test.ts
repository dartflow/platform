import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyMatchAction,matchView,newGame,scoreGame} from '../lib/domain';
import {attachMatchSides,gameThrowerId,publicMatchSides,publicMatchVisit} from '../lib/match-sides';
import {playerContribution} from '../lib/player-contributions';
import {isPlayedStatisticsMatch} from '../lib/player-statistics';
import type {MatchState} from '../lib/types';
const settings={startScore:301 as const,bestOfLegs:3,bestOfSets:1};
const sides:[{id:string;name:string}[],{id:string;name:string}[]]=[[{id:'a',name:'Anna'},{id:'b',name:'Bas'}],[{id:'c',name:'Chris'},{id:'d',name:'Dana'}]];
function match():MatchState{const players=sides.map(side=>side[0]),id='double';const state:MatchState={id,players,settings,status:'planned',revision:0,clubId:'club',eventId:'event',boardId:null,writerId:'a',accepted:[false,false],confirmations:[false,false],resultRevision:null,game:newGame(id,players.map(player=>player.id),settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};attachMatchSides(state,sides,['Duo AB','Duo CD']);return state;}
test('doubles attribute each real thrower and rotate first teammate every leg, including undo',()=>{
 let state=match();state.status='live';
 assert.equal(gameThrowerId(state.game),'a');
 state=applyMatchAction(state,'a',false,{type:'score',score:180});
 assert.equal(gameThrowerId(state.game),'c');
 state=applyMatchAction(state,'a',false,{type:'score',score:0});
 assert.equal(gameThrowerId(state.game),'b');
 const before=structuredClone(state);state=applyMatchAction(state,'a',false,{type:'score',score:121,darts:3,doubleConfirmed:true});
 assert.deepEqual(state.game.visits.map(visit=>visit.throwerId),['a','c','b']);assert.equal(state.game.legs[0],1);assert.equal(gameThrowerId(state.game),'d');
 state=applyMatchAction(state,'a',false,{type:'undo'});assert.deepEqual(state.game,before.game);
 state=applyMatchAction(state,'a',false,{type:'score',score:121,darts:3,doubleConfirmed:true});
 assert.equal(playerContribution(state,'a').points,180);assert.equal(playerContribution(state,'a').darts,3);assert.equal(playerContribution(state,'b').points,121);assert.equal(playerContribution(state,'b').highestFinish,121);
 assert.equal(matchView(state,'d',false).permissions.canTakeOver,true);assert.equal(matchView(state,'d',false).currentThrower?.name,'Dana');
 state=applyMatchAction(state,'d',false,{type:'take-over'});assert.equal(state.writerId,'d');
});
test('per-player doubles permit only actual current thrower and opposing side approves corrections',()=>{
 let state=match();state.status='live';state.scoringMode='per-player';
 assert.throws(()=>applyMatchAction(state,'b',false,{type:'score',score:100}),/aan de beurt/);
 state=applyMatchAction(state,'a',false,{type:'score',score:100});state=applyMatchAction(state,'c',false,{type:'score',score:100});state=applyMatchAction(state,'b',false,{type:'score',score:60});
 state=applyMatchAction(state,'b',false,{type:'request-correction',reason:'De laatste beurt was nul.'});
 assert.throws(()=>applyMatchAction(state,'a',false,{type:'approve-correction',correctionId:state.correction!.id}),/tegenstander/);
 state=applyMatchAction(state,'d',false,{type:'approve-correction',correctionId:state.correction!.id});assert.equal(gameThrowerId(state.game),'b');
});
test('sides are immutable after start; public display only uses anonymous member identities; no solo outcome',()=>{
 const state=match();state.status='live';assert.throws(()=>attachMatchSides(state,sides),/vast/);
 state.game=scoreGame(state.game,180);const view=matchView(state,'b',false),safe=publicMatchSides(view),visit=publicMatchVisit(view,state.game.visits[0]);
 assert.equal(safe.currentThrower?.id,'player-2-member-1');assert.equal(visit.throwerId,'player-1-member-1');assert.equal(visit.player,'player-1');assert.equal(safe.sideParticipants?.[0][1].name,'Bas');
 state.status='confirmed';state.resultPublished=true;assert.equal(isPlayedStatisticsMatch({id:state.id,completedAt:new Date().toISOString(),state}),false);
 assert.throws(()=>applyMatchAction({...state,status:'called'},'a',false,{type:'ranking-consent',consent:true}),/individuele/);
});
test('set-boundary teammate starter follows the accumulated leg offset',()=>{
 const game=newGame('next',['a','c'],settings,1,[['a','b'],['c','d']],3);assert.equal(gameThrowerId(game),'d');
});
