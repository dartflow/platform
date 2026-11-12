import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ocheStandbyFrame,OCHE_STANDBY_DURATIONS,OCHE_STANDBY_CYCLE} from '../lib/oche-standby';

test('standby slides occupy exactly five, ten and fifteen seconds of a thirty-second cycle',()=>{
 assert.deepEqual(OCHE_STANDBY_DURATIONS,[5000,10000,15000]);assert.equal(OCHE_STANDBY_CYCLE,30000);
 for(const[elapsed,index]of[[0,0],[4999,0],[5000,1],[14999,1],[15000,2],[29999,2],[30000,0],[34999,0],[35000,1]]as const)assert.equal(ocheStandbyFrame(elapsed).index,index,`elapsed ${elapsed}`);
});

test('visibility resume uses the original clock rather than restarting a slide or accumulating timer drift',()=>{
 assert.equal(ocheStandbyFrame(2500).progress,.5);
 const resumed=ocheStandbyFrame(22400);assert.equal(resumed.index,2);assert.equal(resumed.elapsed,7400);assert.equal(resumed.duration,15000);
 const later=ocheStandbyFrame(94700);assert.equal(later.cycle,3);assert.equal(later.index,0);assert.equal(later.elapsed,4700);
});

test('every cycle has one stable start and progress stays within the active slide',()=>{
 for(const elapsed of[0,5000,15000,30000,35000,45000,300000])assert.equal(ocheStandbyFrame(elapsed).progress,0);
 for(let elapsed=0;elapsed<120000;elapsed+=137){const frame=ocheStandbyFrame(elapsed);assert.ok(frame.progress>=0&&frame.progress<1);}
});
