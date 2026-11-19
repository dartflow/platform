import{test}from'node:test';
import assert from'node:assert/strict';
import{applyMatchAction,newGame,scoreGame,setScore,validateSettings}from'../lib/domain';
import{nationalRatingFormat}from'../lib/ranking-domain';
import{publishedRatingFormat,defaultRankingPolicy}from'../lib/ranking-service-domain';
import{publicMatchSettings}from'../lib/match-sides';
import type{Game,MatchState}from'../lib/types';
const ids=['player-a','player-b'];
function leg(g:Game,winner:number):Game{
 let guard=0;while(g.status==='live'){assert.ok(guard++<4);const side=g.turn;g=scoreGame(g,side===winner?2:0,side===winner?1:3,side===winner);if(side===winner)return g;}throw Error('Series ended before this leg.');
}
test('two clear legs extends the base best-of and finishes at the published absolute cap',()=>{
 const settings=validateSettings({bestOfLegs:5,sideStartScores:[2,2],legWinByTwo:{maximum:11}});let g=newGame('margin',ids,settings);
 for(const winner of[0,1,0,1,0])g=leg(g,winner);assert.deepEqual(g.legs,[3,2]);assert.equal(g.status,'live');
 for(const winner of[1,0,0])g=leg(g,winner);assert.deepEqual(g.legs,[5,3]);assert.equal(g.status,'finished');assert.equal(g.winner,ids[0]);
 g=newGame('cap',ids,settings);for(const winner of[0,1,0,1,0,1,0,1,0,1])g=leg(g,winner);assert.deepEqual(g.legs,[5,5]);assert.equal(g.status,'live');g=leg(g,1);assert.deepEqual(g.legs,[5,6]);assert.equal(g.status,'finished');
});
test('two clear sets keeps completed sets and a real final checkout can be undone and replayed',()=>{
 const settings=validateSettings({bestOfLegs:1,bestOfSets:3,sideStartScores:[2,2],setWinByTwo:{maximum:5}});
 let s:MatchState={id:'set-cap',clubId:'club',eventId:'event',boardId:null,revision:0,status:'ready',players:ids.map(id=>({id,name:id})),writerId:ids[0],settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame('set-cap',ids,settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};
 s=applyMatchAction(s,ids[0],false,{type:'start'});
 function win(winner:number){let guard=0;const before=setScore(s).reduce((a,b)=>a+b,0);while(setScore(s).reduce((a,b)=>a+b,0)===before){assert.ok(guard++<4);const score=s.game.turn===winner?2:0;s=applyMatchAction(s,ids[0],false,{type:'score',score,darts:score?1:3,doubleConfirmed:score>0});}}
 for(const w of[0,1,0])win(w);assert.deepEqual(setScore(s),[2,1]);assert.equal(s.status,'live');win(1);assert.deepEqual(setScore(s),[2,2]);win(0);assert.equal(s.status,'result');assert.deepEqual(setScore(s),[3,2]);assert.equal(s.winnerId,ids[0]);
 const acceptedVisits=[...s.previousSets,s.game].flatMap(g=>g.visits).length;s=applyMatchAction(s,ids[0],false,{type:'undo'});assert.equal(s.status,'live');assert.deepEqual(setScore(s),[2,2]);assert.equal(s.winnerId,null);assert.equal([...s.previousSets,s.game].flatMap(g=>g.visits).length,acceptedVisits-1);win(0);assert.equal(s.winnerId,ids[0]);assert.equal([...s.previousSets,s.game].flatMap(g=>g.visits).length,acceptedVisits);
});
test('extended rules are validated, deeply projected and excluded from ordinary official rating profiles',()=>{
 for(const input of[{bestOfLegs:5,legWinByTwo:{maximum:4}},{bestOfLegs:5,legWinByTwo:{maximum:101}},{bestOfLegs:1,legWinByTwo:{maximum:5}},{legLimit:6,legWinByTwo:{maximum:11}},{bestOfSets:1,setWinByTwo:{maximum:5}}])assert.throws(()=>validateSettings(input));
 const settings=validateSettings({bestOfLegs:5,legWinByTwo:{maximum:11}});assert.equal(nationalRatingFormat(settings),false);assert.equal(publishedRatingFormat(settings,defaultRankingPolicy('proof')),false);
 const polluted={...settings,legWinByTwo:{maximum:11,privateNote:'must-never-be-public'}};assert.deepEqual(publicMatchSettings(polluted).legWinByTwo,{maximum:11});
 assert.equal(scoreGame(newGame('legacy',ids,validateSettings({bestOfLegs:1,sideStartScores:[2,2]})),2,1,true).status,'finished');
});
test('Cricket records each accepted visit once and uses the same bounded leg extension',()=>{
 let g=newGame('cricket',ids,validateSettings({discipline:'cricket',bestOfLegs:5,legWinByTwo:{maximum:11}}));g=scoreGame(g,120,2,false,undefined,['T20','T20']);assert.equal(g.stats[0].darts,3);assert.equal(g.stats[0].total,60);assert.equal(g.cricket?.points[0],60);assert.equal(g.visits.length,1);
 const before=g.history[0];assert.equal(before.stats[0].darts,0);assert.equal(before.stats[0].total,0);
 g=newGame('cricket-cap',ids,validateSettings({discipline:'cricket',cricketMode:'no-score',bestOfLegs:3,legWinByTwo:{maximum:5}}));
 function win(winner:number){const before=g.legs.reduce((a,b)=>a+b,0);let guard=0;while(g.legs.reduce((a,b)=>a+b,0)===before){assert.ok(guard++<30);const target=g.cricket!.marks[winner].findIndex(n=>n<3),hit=g.turn!==winner?'MISS':target===6?(g.cricket!.marks[winner][6]===0?'DB':'SB'):`T${20-target}`,score=hit==='MISS'?0:hit==='DB'?50:hit==='SB'?25:Number(hit.slice(1))*3;g=scoreGame(g,score,1,false,undefined,[hit]);}}
 for(const winner of[0,1,0])win(winner);assert.deepEqual(g.legs,[2,1]);assert.equal(g.status,'live');win(1);win(1);assert.deepEqual(g.legs,[2,3]);assert.equal(g.status,'finished');assert.equal(g.winner,ids[1]);
});
