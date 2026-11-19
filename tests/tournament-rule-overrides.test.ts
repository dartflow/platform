import{test}from'node:test';import assert from'node:assert/strict';
import{parseTournamentRuleOverrides,tournamentFixtureSettings,snapshotTournamentRules}from'../lib/tournament-rule-overrides';
import type{Fixture}from'../lib/platform-types';
const base={startScore:501 as const,bestOfLegs:5,bestOfSets:1};
test('phase rules inherit the base and a specific round overrides the phase without changing another phase',()=>{
 const rules=parseTournamentRuleOverrides([{phase:'knockout',settings:{bestOfLegs:7,startProcedure:'home-first'}},{phase:'pool',settings:{startScore:301,inRule:'double'}},{phase:'knockout',round:3,settings:{bestOfLegs:11,legWinByTwo:{maximum:15}}}],base);
 assert.deepEqual(tournamentFixtureSettings(base,rules,{phase:'knockout',round:2}),{...base,bestOfLegs:7,startProcedure:'home-first'});
 assert.deepEqual(tournamentFixtureSettings(base,rules,{phase:'knockout',round:3}),{...base,bestOfLegs:11,startProcedure:'home-first',legWinByTwo:{maximum:15}});
 assert.deepEqual(tournamentFixtureSettings(base,rules,{phase:'pool',round:1}),{...base,startScore:301,inRule:'double'});assert.deepEqual(tournamentFixtureSettings(base,rules,{phase:'swiss',round:1}),base);
 assert.deepEqual(tournamentFixtureSettings(base,rules,{phase:'pool',round:99,purpose:'pool-decider'}),{startScore:501,bestOfLegs:5,bestOfSets:1});assert.deepEqual(base,{startScore:501,bestOfLegs:5,bestOfSets:1});
});
test('conflicting phase declarations, impossible rules and unexpected private fields cannot be published',()=>{
 assert.throws(()=>parseTournamentRuleOverrides([{phase:'pool',settings:{bestOfLegs:7}},{phase:'pool',settings:{bestOfLegs:3}}],base),{code:'phase_rule_conflict'});
 for(const value of[[{phase:'wrong',settings:{}}],[{phase:'pool',round:0,settings:{}}],[{phase:'pool',settings:{bestOfLegs:4}}],[{phase:'pool',settings:{privateEvidence:'secret'}}],[{phase:'pool',settings:{bestOfLegs:9,legWinByTwo:{maximum:7}}}]])assert.throws(()=>parseTournamentRuleOverrides(value,base));
 const rules=parseTournamentRuleOverrides([{phase:'knockout',settings:{legWinByTwo:{maximum:11,privateNote:'hidden'}}}],base);assert.deepEqual(rules[0].settings,{legWinByTwo:{maximum:11}});
});
test('fixtures retain published effective rules and later snapshots do not overwrite an existing match',()=>{
 const fixtures:Fixture[]=[{id:'pool',phase:'pool',round:1,players:['a','b'],status:'scheduled'},{id:'live',phase:'knockout',round:1,players:['a','b'],status:'live',matchId:'real-match',settings:{...base,bestOfLegs:9}},{id:'decider',phase:'pool',round:99,purpose:'pool-decider',players:['a','b'],status:'scheduled',settings:base}],state={settings:base,tournamentRuleOverrides:parseTournamentRuleOverrides([{phase:'pool',settings:{startScore:301}}],base),fixtures};
 snapshotTournamentRules(state);assert.equal(fixtures[0].settings?.startScore,301);assert.equal(fixtures[1].settings?.bestOfLegs,9);assert.equal(fixtures[2].settings?.startScore,501);state.tournamentRuleOverrides[0].settings.startScore=701;assert.equal(fixtures[0].settings?.startScore,301);
});
