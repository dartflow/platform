import {test} from 'node:test';
import assert from 'node:assert/strict';
import {circuitPoints,defaultRankingPolicy,effectiveRankingRule,knockoutPlacements,parseRankingPolicy,publishedRatingFormat} from '../lib/ranking-service-domain';
import {knockout,advanceFixtures} from '../lib/platform-domain';

test('published circuit examples validate real field, sport result and shared placing bands',()=>{
 for(const [starters,place,played,complete,disqualified,expected] of [[15,1,true,true,false,0],[16,1,true,true,false,10],[31,3,true,true,false,5],[32,3,true,true,false,7],[32,5,false,true,false,0],[32,1,true,false,false,0],[32,1,true,true,true,0],[64,33,true,true,false,0]]as const)assert.equal(circuitPoints(starters,place,played,complete,disqualified),expected);
});
test('main knockout placings use the nine real entrants and preserve full tied points',()=>{
 const fixtures=knockout(Array.from({length:9},(_,i)=>String(i)));
 for(const fixture of fixtures){advanceFixtures(fixtures);if(fixture.status==='bye')continue;fixture.winnerId=fixture.players[0];fixture.status='confirmed';}
 const places=knockoutPlacements(fixtures);
 assert.equal(places.length,9);assert.deepEqual(places.map(row=>row.place).sort((a,b)=>a-b),[1,2,3,3,5,5,5,5,9]);
});
test('published most-specific rule wins and equal fixture prescriptions block publication',()=>{
 const fixture={id:'slot',phase:'knockout' as const,round:2};
 assert.equal(effectiveRankingRule([{enabled:true},{phase:'knockout',enabled:false},{fixtureId:'slot',enabled:true}],fixture),true);
 assert.throws(()=>effectiveRankingRule([{fixtureId:'slot',enabled:true},{fixtureId:'slot',round:2,enabled:false}],fixture),{code:'ranking_rule_conflict'});
 assert.equal(effectiveRankingRule([{phase:'pool',enabled:true}],fixture),false);
});
test('club policy validation binds thresholds and national format excludes handicaps and special outs',()=>{
 assert.equal(parseRankingPolicy({minimumStarters:2,eventCount:8,bestResults:5},'club-v1').minimumStarters,2);
 assert.throws(()=>parseRankingPolicy({eventCount:4,bestResults:5},'bad'),{code:'invalid_ranking_policy'});
 const policy=defaultRankingPolicy('v1'),settings={startScore:501 as const,bestOfLegs:5,bestOfSets:1};
 assert.equal(publishedRatingFormat(settings,policy),true);
 assert.equal(publishedRatingFormat({...settings,inRule:'double'},policy),false);
 assert.equal(publishedRatingFormat({...settings,outRule:'master'},policy),false);
 assert.equal(publishedRatingFormat({...settings,sideStartScores:[501,501]},policy),false);
});
