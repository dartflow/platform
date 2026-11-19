import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dartValue,evaluateX01Visit} from '../lib/x01-rules';
import {newGame,scoreGame,validateSettings} from '../lib/domain';

test('double in counts only the opening double and restores opening on a same-turn bust',()=>{
 assert.deepEqual(evaluateX01Visit({remaining:301,opened:false,hits:['S20','D20','T20']}),{remaining:201,opened:true,endReason:'turn',observedScore:120,points:100,countedDarts:3});
 assert.deepEqual(evaluateX01Visit({remaining:32,opened:false,hits:['S20','D15','T20']}),{remaining:32,opened:false,endReason:'bust',observedScore:110,points:0,countedDarts:3});
});
test('out rules apply to the actual last dart and prohibit darts after an ended turn',()=>{
 assert.equal(evaluateX01Visit({remaining:60,outRule:'master',hits:['T20']}).endReason,'finish');
 assert.equal(evaluateX01Visit({remaining:20,hits:['S20']}).endReason,'bust');
 assert.equal(evaluateX01Visit({remaining:1,outRule:'straight',hits:['S1']}).endReason,'finish');
 assert.throws(()=>evaluateX01Visit({remaining:40,hits:['D20','MISS']}),/geen pijl/);
 assert.throws(()=>evaluateX01Visit({remaining:21,hits:['S20','MISS']}),/geen pijl/);
 for(const invalid of ['S0','T21','D25','180','DBULL',''])assert.throws(()=>dartValue(invalid));
});
test('accepted handicap and opening state survive turns, undo snapshots and reset for every new leg',()=>{
 const settings=validateSettings({startScore:301,bestOfLegs:3,inRule:'double',outRule:'master',sideStartScores:[60,101]});
 const initial=newGame('x',['a','b'],settings);assert.deepEqual(initial.remaining,[60,101]);assert.deepEqual(initial.opened,[false,false]);
 const opened=scoreGame(initial,40,1,false,undefined,['D20']);assert.deepEqual(opened.remaining,[20,101]);assert.deepEqual(opened.opened,[true,false]);
 assert.deepEqual(opened.history[0].remaining,[60,101]);assert.deepEqual(opened.history[0].opened,[false,false]);
 const reply=scoreGame(opened,0,1,false,undefined,['MISS']),finished=scoreGame(reply,20,1,false,undefined,['D10']);assert.deepEqual(finished.legs,[1,0]);assert.deepEqual(finished.remaining,[60,101]);assert.deepEqual(finished.opened,[false,false]);assert.equal(finished.turn,1);
 assert.throws(()=>scoreGame(initial,40,1),{code:'dart_detail_required'});
 assert.throws(()=>scoreGame(initial,20,1,false,undefined,['D20']),{code:'invalid_darts'});
});
test('explicit aggregate bust stores zero points and three counting darts without invented hit details',()=>{
 const initial=newGame('x',['a','b'],validateSettings());const next=scoreGame(initial,0,3,false,undefined,undefined,true);
 assert.equal(next.visits[0].bust,true);assert.equal(next.visits[0].score,0);assert.equal(next.visits[0].dartHits,undefined);assert.equal(next.stats[0].darts,3);assert.equal(next.remaining[0],501);
});
