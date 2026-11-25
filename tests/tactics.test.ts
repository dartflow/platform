import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyMatchAction,matchView,newGame,scoreGame,validateSettings} from '../lib/domain';
import {publicTactics,TACTICS_TARGETS} from '../lib/tactics';
import {parseTournamentRuleOverrides,tournamentFixtureSettings} from '../lib/tournament-rule-overrides';
import {newTraining} from '../lib/platform-domain';
import {dartValue} from '../lib/x01-rules';
import {isPlayedStatisticsMatch} from '../lib/player-statistics';
import {playerContribution} from '../lib/player-contributions';
import {nationalRatingFormat} from '../lib/ranking-domain';
import {defaultRankingPolicy,publishedRatingFormat} from '../lib/ranking-service-domain';
import type {Game,MatchState} from '../lib/types';
const settings=(preset:'tactics-5'|'tactics-3'='tactics-5',bestOfLegs=1)=>validateSettings({discipline:'tactics',tacticsPreset:preset,bestOfLegs});
const hit=(state:Game,...dartHits:string[])=>scoreGame(state,dartHits.reduce((sum,hit)=>sum+dartValue(hit),0),dartHits.length,false,undefined,dartHits);
const match=():MatchState=>{const rules=settings('tactics-3');return {id:'match',clubId:'club',eventId:'event',boardId:'board',revision:1,status:'live',players:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],writerId:'a',settings:rules,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame('match',['a','b'],rules),previousSets:[],winnerId:null,resultPublished:false,dispute:null};};
test('canonical Tactics settings freeze preset and reject X01-only rules without changing legacy 301 semantics',()=>{
 assert.equal(validateSettings({discipline:'tactics'}).tacticsPreset,'tactics-5');assert.equal(validateSettings({discipline:'tactics'}).tacticsMode,'standard');
 assert.throws(()=>validateSettings({discipline:'tactics',inRule:'double'}));assert.throws(()=>validateSettings({discipline:'tactics',sideStartScores:[20,20]}));assert.throws(()=>validateSettings({discipline:'tactics',tacticsPreset:'unknown' as never}));
 assert.equal(validateSettings({startScore:301}).inRule,undefined);assert.deepEqual(newGame('legacy',['a','b'],validateSettings({startScore:301})).remaining,[301,301]);
});
test('canonical Tactics delegates one-dart overshoot, records actual darts and restores full marks through undo history',()=>{
 let state=newGame('same-id',['a','b'],settings());state=hit(state,'D20','D20');state=hit(state,'MISS');const before=structuredClone(state);state=hit(state,'T20');
 assert.equal(state.id,'same-id');assert.equal(state.tactics?.marks[0][0],5);assert.equal(state.tactics?.points[0],40);assert.equal(state.visits.at(-1)?.darts,1);assert.equal(state.visits.at(-1)?.tactics?.creditedMarks,3);
 assert.deepEqual(state.history.at(-1),(({history,...rest})=>{void history;return rest;})(before));assert.throws(()=>scoreGame(state,60),{code:'dart_detail_required'});
});
test('canonical Tactics 5 tie keeps one leg and match identity, records replay and uses alternating actual opener',()=>{
 let state=newGame('stable',['a','b'],settings());
 for(const target of TACTICS_TARGETS){const darts=target===25?['DB','DB','SB']:['T'+target,'D'+target];state=hit(state,...darts);state=hit(state,...darts);}
 assert.equal(state.status,'live');assert.deepEqual(state.legs,[0,0]);assert.equal(state.tactics?.attempt,2);assert.equal(state.tactics?.replays.length,1);assert.equal(state.visits.at(-1)?.tactics?.attempt,1);assert.equal(state.visits.at(-1)?.checkout,false);assert.equal(state.turn,1);assert.equal(state.legStartOverrides?.['1'],1);
 assert.equal(state.history.at(-1)?.tactics?.attempt,1);assert.equal(state.history.at(-1)?.tactics?.marks[1][11],0);
});
test('real canonical match reaches result, undo reopens final target, signatures publish once and X01 ratings/statistics exclude it',()=>{
 let state=match();const act=(dartHits:string[])=>{state=applyMatchAction(state,'a',false,{type:'score',score:dartHits.reduce((sum,h)=>sum+dartValue(h),0),darts:dartHits.length,dartHits});};
 for(let target=20;target>=10;target--){act(['T'+target]);act(['MISS']);}
 act(['DB','SB']);assert.equal(state.status,'result');assert.equal(state.winnerId,'a');const id=state.id;
 state=applyMatchAction(state,'a',false,{type:'undo'});assert.equal(state.status,'live');assert.equal(state.game.tactics?.marks[0][11],0);assert.equal(state.game.turn,0);act(['DB','SB']);
 state=applyMatchAction(state,'a',false,{type:'confirm'});state=applyMatchAction(state,'b',false,{type:'confirm'});assert.equal(state.status,'confirmed');assert.equal(state.resultPublished,true);assert.equal(state.id,id);
 assert.equal(nationalRatingFormat(state.settings),false);assert.equal(publishedRatingFormat(state.settings,defaultRankingPolicy('1')),false);assert.equal(isPlayedStatisticsMatch({id,completedAt:'2026-11-19T12:00:00Z',state}),false);
 const view=matchView(state,'a',false);assert.equal(view.checkout,null);assert.equal(view.stats[0].measurementComplete,false);assert.equal(view.stats[0].average,undefined);assert.equal(view.tactics?.requiredMarks,3);
 const contribution=playerContribution(state,'a');assert.equal(contribution.average,null);assert.equal(contribution.darts,13);assert.equal(contribution.creditedMarks,36);assert.ok(contribution.marksPerRound!>0);
});
test('Tactics series advances the same game while preserving target resets and per-set undo snapshots',()=>{
 let state=newGame('series',['a','b'],settings('tactics-3',3));
 for(let leg=0;leg<2;leg++){
  const winner=state.turn;
  for(const target of TACTICS_TARGETS){state=hit(state,...(target===25?['DB','SB']:['T'+target]));if(state.status==='live'&&state.legs[winner]===leg)state=hit(state,'MISS');}
  if(leg===0){assert.deepEqual(state.legs,[1,0]);assert.equal(state.tactics?.marks.flat().every(n=>n===0),true);assert.equal(state.turn,1);state=hit(state,'MISS');}
 }
 assert.equal(state.status,'finished');assert.deepEqual(state.legs,[2,0]);
});
test('public Tactics projection whitelists counters and replay evidence without copying future private fields',()=>{
 const state=newGame('private',['a','b'],settings()).tactics!;Object.assign(state,{token:'secret',actorId:'private'});state.replays.push({leg:1,attempt:1,starter:0,fromVisit:1,toVisit:24,...{privateEvidence:'hidden'}});
 const visible=JSON.stringify(publicTactics(state));assert.doesNotMatch(visible,/secret|private|hidden|actorId|token/);assert.equal(JSON.parse(visible).requiredMarks,5);
});

test('legacy aggregate training rejects Tactics and directs to the dedicated per-dart play engine',()=>{for(const mode of ['solo','bot','around','170'])assert.throws(()=>newTraining('session','actor',{mode,discipline:'tactics'}),{code:'training_rules_unavailable'});});

test('phase discipline switch discards former X01 opening/handicap but still validates explicit incompatible fields',()=>{
 const base=validateSettings({startScore:301,inRule:'double',outRule:'master',sideStartScores:[201,301],bestOfLegs:5});
 const overrides=parseTournamentRuleOverrides([{phase:'pool',settings:{discipline:'tactics',tacticsPreset:'tactics-3'}},{phase:'pool',round:2,settings:{tacticsMode:'no-score'}}],base);
 const one=tournamentFixtureSettings(base,overrides,{phase:'pool',round:1}),two=tournamentFixtureSettings(base,overrides,{phase:'pool',round:2});
 assert.equal(one.discipline,'tactics');assert.equal(one.tacticsPreset,'tactics-3');assert.equal(one.inRule,undefined);assert.equal(one.outRule,undefined);assert.equal(one.sideStartScores,undefined);assert.equal(two.tacticsMode,'no-score');assert.equal(two.tacticsPreset,'tactics-3');
 assert.deepEqual(tournamentFixtureSettings(base,overrides,{phase:'knockout',round:1}),base);
 assert.throws(()=>parseTournamentRuleOverrides([{phase:'pool',settings:{discipline:'tactics',inRule:'double'}}],base),{code:'invalid_action'});
});
