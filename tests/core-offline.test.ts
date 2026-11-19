import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,matchView} from '../lib/domain';
import {acceptCoreReplayResponse,enqueueCoreScore,projectCoreQueue,type CoreScoreQueue} from '../lib/core-offline';
import type {MatchState,MatchCommand} from '../lib/types';
function record(remote=false):CoreScoreQueue{const players=[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}],settings={startScore:301 as const,bestOfLegs:1,bestOfSets:1},game=newGame('match',players.map(p=>p.id),settings);const state:MatchState={id:'match',clubId:'club',eventId:'event',boardId:null,revision:5,status:'live',players,writerId:'alice',settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game,previousSets:[],winnerId:null,resultPublished:false,dispute:null,scoringMode:remote?'per-player':'shared-writer'};const base=matchView(state,'alice',false);base.scoringState=game;return{version:1,actorId:'alice',matchId:'match',base,commands:[]};}
function command(r:CoreScoreQueue,score:number,id:string):MatchCommand{return{requestId:id,matchId:r.matchId,expectedRevision:r.base.revision+r.commands.length,offline:true,action:{type:'score',score}};}
test('official local writer can durably project several own-position turns with canonical engine and no signatures',()=>{let r=record();for(const[n,i]of[60,0,100].entries())r=enqueueCoreScore(r,command(r,i,`visit${n}`));const restored=JSON.parse(JSON.stringify(r))as CoreScoreQueue,p=projectCoreQueue(restored);assert.deepEqual(p.remaining,[141,301]);assert.equal(p.turn,1);assert.equal(p.visits.length,3);assert.equal(p.permissions.canConfirm,false);assert.equal(p.resultPublished,false);assert.equal(r.base.visits.length,0);});
test('remote writer cannot locally manufacture the opposite position turn',()=>{let r=record(true);r=enqueueCoreScore(r,command(r,60,'own'));assert.equal(projectCoreQueue(r).permissions.canScore,false);assert.throws(()=>enqueueCoreScore(r,command(r,0,'opponent')),/tegenstander/);assert.equal(r.commands.length,1);});
test('offline finish waits for the canonical set and start procedure before another score',()=>{let r=record();r.base.scoringState!.remaining[0]=40;r.base.remaining[0]=40;r=enqueueCoreScore(r,{requestId:'finish',matchId:r.matchId,expectedRevision:5,offline:true,action:{type:'score',score:40,darts:1,doubleConfirmed:true}});const p=projectCoreQueue(r);assert.equal(p.scoringState?.status,'finished');assert.equal(p.permissions.canScore,false);assert.throws(()=>enqueueCoreScore(r,command(r,0,'after-finish')),/schrijfrecht/);});

test('accepted prefix remains stable proof when a newer writer revision arrives before the replay tail',()=>{
 let original=record();original=enqueueCoreScore(original,command(original,60,'accepted-prefix'));const sent=structuredClone(original);original=enqueueCoreScore(original,command(original,40,'pending-tail'));
 const newer={...projectCoreQueue(sent),revision:sent.base.revision+2,writerId:'bob'},kept=acceptCoreReplayResponse(original,{accepted:['accepted-prefix']},newer);
 assert.equal(kept.base.revision,5);assert.deepEqual(kept.commands.map(c=>[c.requestId,c.expectedRevision]),[['accepted-prefix',5],['pending-tail',6]]);assert.deepEqual(kept.acknowledged,['accepted-prefix']);assert.deepEqual(projectCoreQueue(kept).remaining,[241,261]);
 const conflict=acceptCoreReplayResponse(kept,{accepted:['accepted-prefix'],conflict:{message:'Controle nodig'}},newer);assert.deepEqual(conflict.commands,original.commands);assert.deepEqual(conflict.acknowledged,['accepted-prefix']);
 const resolved=acceptCoreReplayResponse(kept,{accepted:['accepted-prefix','pending-tail']},{...newer,revision:9});assert.equal(resolved.commands.length,0);assert.equal(resolved.base.revision,9);
});
test('a coherent accepted prefix rebases only the remaining input appended during its request',()=>{
 let r=record();r=enqueueCoreScore(r,command(r,60,'first'));const accepted=projectCoreQueue(r);r=enqueueCoreScore(r,command(r,40,'second'));
 const next=acceptCoreReplayResponse(r,{accepted:['first']},accepted);assert.equal(next.base.revision,6);assert.deepEqual(next.commands.map(c=>[c.requestId,c.expectedRevision]),[['second',6]]);assert.deepEqual(projectCoreQueue(next).remaining,[241,261]);
});
