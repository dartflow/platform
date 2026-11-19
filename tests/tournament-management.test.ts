import {test} from 'node:test';
import assert from 'node:assert/strict';
import {knockout,advanceFixtures,tournamentFixtures} from '../lib/platform-domain';
import {poolStandings} from '../lib/tournament-pools';
import {spreadDraw} from '../lib/tournament-management';
import{consolationFixtures,consolationOutcome}from'../lib/tournament-consolation';
import {effectiveRankingRule,knockoutPlacements} from '../lib/ranking-service-domain';
import type {Fixture} from '../lib/platform-types';

test('club spread reaches the exact feasible minimum while preserving published seed slots',()=>{
 const ids=['a','b','c','d','e','f','g','h'],clubs=new Map(ids.map((id,i)=>[id,i<4?'club-a':'club-b']));
 const spread=spreadDraw(ids,[0,0,0,0,1,1,1,1],clubs,0);assert.equal(spread.collisions,4);assert.equal(new Set(spread.order).size,8);
 const feasible=spreadDraw(ids,[0,0,1,1,2,2,3,3],clubs,1);assert.equal(feasible.collisions,0);assert.equal(feasible.order[0],'a');
 const fixed=spreadDraw(ids,[0,0,1,1,2,2,3,3],clubs,2);assert.equal(fixed.collisions,2);assert.deepEqual(fixed.order.slice(0,2),['a','b']);
});
test('pool mini-table compares the whole remaining tied group only after every mutual game is final',()=>{
 const make=(id:string,a:string,b:string,winner:string|null,status:Fixture['status']='confirmed'):Fixture=>({id,phase:'pool',pool:'A',round:1,players:[a,b],status,winnerId:winner,score:[1,1]});
 const fixtures=[make('ab','a','b','a'),make('ac','a','c','a'),make('bc','b','c','b')];
 const rows=poolStandings(fixtures,['a','b','c'],['points','headToHead','legDifference','legsFor']);assert.equal(rows[0].points,4);assert.equal(rows[0].id,'a');
 const cycle=[make('ab','a','b','a'),make('bc','b','c','b'),make('ca','c','a','c')];
 assert.ok(poolStandings(cycle,['a','b','c']).every(r=>r.shared&&r.position===1&&r.headToHead===2));
 cycle[2].status='live';assert.equal(poolStandings(cycle,['a','b','c']).find(r=>r.id==='c')!.headToHead,null);
});
test('seeded seven-player knockout has independent bronze places and never awards a bye loss',()=>{
 const fixtures=knockout(['a','b','c','d','e','f','g'],{seeded:true,bronze:true});assert.equal(fixtures.filter(f=>f.status==='bye').length,1);
 const bronze=fixtures.find(f=>f.purpose==='bronze')!;assert.equal(bronze.sources?.length,2);assert.ok(bronze.sources!.every(s=>s.outcome==='loser'));
 for(let guard=0;guard<10;guard++){const ready=fixtures.find(f=>f.status==='scheduled'&&f.players.every(Boolean));if(!ready)break;ready.status='confirmed';ready.winnerId=ready.players[0];ready.score=[1,0];advanceFixtures(fixtures);}
 const places=knockoutPlacements(fixtures);assert.equal(places.length,7);assert.equal(places.find(p=>p.playerId===bronze.winnerId)!.place,3);assert.equal(places.find(p=>p.playerId===bronze.players.find(id=>id!==bronze.winnerId))!.place,4);assert.equal(places.filter(p=>p.place===1).length,1);
});
test('four-pool crossover keeps each pools qualifiers in opposite bracket halves',()=>{
 const fixtures=tournamentFixtures(Array.from({length:16},(_,i)=>`p${i}`),'pools-knockout',4),first=fixtures.filter(f=>f.phase==='knockout'&&f.round===1);
 for(const pool of['A','B','C','D']){const halves=first.flatMap((f,index)=>(f.sources??[]).filter(s=>s.pool===pool).map(()=>Math.floor(index/2)));assert.deepEqual(halves,[0,1]);}
});

test('a separate consolation title uses only true first-round losses and never changes main places or inherits broad rating rules',()=>{
 const fixtures=knockout(['a','b','c','d','e','f','g']),cup=consolationFixtures(fixtures);fixtures.push(...cup);assert.equal(cup.length,3);const byePlayer=fixtures.find(f=>!f.purpose&&f.status==='bye')!.winnerId;
 for(let guard=0;guard<20;guard++){const ready=fixtures.find(f=>f.status==='scheduled'&&f.players.every(Boolean));if(!ready)break;ready.status='confirmed';ready.started=true;ready.winnerId=ready.players[0];ready.score=[1,0];advanceFixtures(fixtures);}
 const outcome=consolationOutcome(fixtures,'Loserstitle');assert.equal(outcome.completed,true);assert.equal(outcome.placings.length,3);assert.ok(!outcome.placings.some(p=>p.playerId===byePlayer));assert.deepEqual(knockoutPlacements(fixtures),knockoutPlacements(fixtures.filter(f=>f.purpose!=='consolation')));assert.equal(effectiveRankingRule([{enabled:true}],cup[0]),false);assert.equal(effectiveRankingRule([{enabled:true},{fixtureId:cup[0].id,enabled:true}],cup[0]),true);
 const absent=knockout(['w','x','y','z']);absent.push(...consolationFixtures(absent));for(const f of absent.filter(f=>!f.purpose&&f.round===1)){f.status='confirmed';f.administrative=true;f.winnerId=f.players[0];}advanceFixtures(absent);assert.equal(absent.find(f=>f.purpose==='consolation')!.players.filter(Boolean).length,0);assert.equal(consolationOutcome(absent).championId,undefined);assert.equal(consolationFixtures(knockout(['1','2','3','4','5'])).length,0);
});
