import{test}from'node:test';
import assert from'node:assert/strict';
import{replayStoredCoreQueue,type CoreScoreQueue}from'../lib/core-offline';
import type{MatchView}from'../lib/types';
const record=()=>({version:1,actorId:'former-writer',matchId:'original-match',base:{revision:9},commands:[{matchId:'original-match',requestId:'stable-visit',expectedRevision:9,offline:true,action:{type:'score',score:60}}]})as CoreScoreQueue;
const failure=(status:number)=>Object.assign(Error(`HTTP ${status}`),{status});
test('current read 403 permits the exact historical batch but read denial after replay keeps the complete local evidence',async()=>{
 const r=record(),original=structuredClone(r);let reads=0,sends=0;const result=await replayStoredCoreQueue(r,async()=>{reads++;throw failure(403);},async body=>{sends++;assert.deepEqual(body,{matchId:r.matchId,baseRevision:9,commands:original.commands});return{accepted:[],conflict:{message:'Beoordeel de eerdere schrijver.'}};});
 assert.equal(reads,2);assert.equal(sends,1);assert.equal(result.controlNeeded,true);assert.equal(result.latest,undefined);assert.deepEqual(r,original);
});
test('non-authority read failures stop replay and keep the same request IDs for a later retry',async()=>{
 for(const status of[401,404,409,503]){const r=record(),original=structuredClone(r);let sends=0;await assert.rejects(replayStoredCoreQueue(r,async()=>{throw failure(status);},async()=>{sends++;return{accepted:[]};}),{status});assert.equal(sends,0);assert.deepEqual(r,original);}
});
test('an accepted batch without a readable final state is retained and can receive the same receipt on retry',async()=>{
 const r=record();let reads=0,sends=0;await assert.rejects(replayStoredCoreQueue(r,async()=>{if(++reads===1)return r.base;throw failure(503);},async body=>{sends++;assert.equal(body.commands[0].requestId,'stable-visit');return{accepted:['stable-visit']};}),{status:503});assert.equal(r.commands.length,1);
 const latest={...r.base,revision:10} as MatchView,result=await replayStoredCoreQueue(r,async()=>latest,async body=>{sends++;assert.equal(body.commands[0].requestId,'stable-visit');return{accepted:['stable-visit']};});assert.equal(sends,2);assert.equal(result.latest?.revision,10);assert.deepEqual(result.response.accepted,['stable-visit']);
});
