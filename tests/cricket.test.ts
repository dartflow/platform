import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,scoreGame,validateSettings} from '../lib/domain';
import {CRICKET_TARGETS,cricketHit} from '../lib/cricket';
import {dartValue} from '../lib/x01-rules';
import type {Game} from '../lib/types';
const game=(mode:'standard'|'no-score'='standard',bestOfLegs=1)=>newGame('cricket',['a','b'],validateSettings({discipline:'cricket',cricketMode:mode,bestOfLegs}));
const hit=(source:Game,...hits:string[])=>scoreGame(source,hits.reduce((sum,value)=>sum+dartValue(value),0),hits.length,false,undefined,hits);
test('Cricket closes at three, scores only while opposing target remains open and caps closure marks',()=>{
 let state=game();state=hit(state,'T20','T20','D20');assert.equal(state.cricket?.marks[0][0],3);assert.equal(state.cricket?.points[0],100);assert.equal(state.cricket?.creditedMarks[0],8);
 state=hit(state,'T20','T20','S1');assert.equal(state.cricket?.marks[1][0],3);assert.equal(state.cricket?.points[1],0);assert.equal(state.cricket?.creditedMarks[1],3);
 state=hit(state,'T20','T20','T20');assert.equal(state.cricket?.points[0],100);assert.equal(state.cricket?.marks[0][0],3);assert.equal(state.visits.at(-1)?.cricket?.creditedMarks,0);assert.equal(state.visits.at(-1)?.observedScore,180);
});
test('all closed needs equal-or-higher score; equal closure wins, no-score first closure wins',()=>{
 let state=game();state.cricket!.marks[0]=[3,3,3,3,3,3,2];state.cricket!.points=[0,25];state=hit(state,'SB');assert.equal(state.status,'live');assert.equal(state.cricket?.marks[0][6],3);
 state=hit(state,'MISS');state=hit(state,'SB');assert.equal(state.status,'finished');assert.equal(state.winner,'a');assert.equal(state.cricket?.points[0],25);
 let noScore=game('no-score');noScore.cricket!.marks[0]=[3,3,3,3,3,3,2];noScore.cricket!.points=[0,999];noScore=hit(noScore,'SB');assert.equal(noScore.winner,'a');assert.equal(noScore.cricket?.points[0],0);
});
test('Cricket rejects aggregate scores, invalid/extra darts and restores marks and points on undo snapshots',()=>{
 const state=game();assert.throws(()=>scoreGame(state,60),/Cricket-pijlen/);assert.throws(()=>hit(state,'T21'),/pijl|dart|worp|ongeldig/i);
 state.cricket!.marks[0]=[3,3,3,3,3,3,2];assert.throws(()=>hit(state,'SB','T20'),/beslissende/);
 const next=hit(game(),'T20','T20');assert.deepEqual(next.history[0].cricket,game().cricket);assert.equal(next.visits[0].cricket?.pointsAfter,60);assert.deepEqual(next.visits[0].cricket?.marksAfter,[3,0,0,0,0,0,0]);
});
test('new leg resets Cricket field and points with alternating opener, actual targets and separate X01 rules',()=>{
 let state=game('standard',3);state.cricket!.marks[0]=CRICKET_TARGETS.map(()=>3);state.cricket!.marks[0][6]=2;state=hit(state,'SB');assert.deepEqual(state.cricket?.marks,[CRICKET_TARGETS.map(()=>0),CRICKET_TARGETS.map(()=>0)]);assert.deepEqual(state.remaining,[0,0]);assert.equal(state.turn,1);assert.equal(state.legs[0],1);
 assert.deepEqual(cricketHit('DB'),{target:25,marks:2});assert.equal(cricketHit('T14'),null);assert.throws(()=>validateSettings({discipline:'cricket',inRule:'double'}),/Cricket/);
});
