import{test}from'node:test';import assert from'node:assert/strict';
import{buildTournamentPlan,parseTournamentPlanning,schedulePlanningFixtures}from'../lib/tournament-planning';
test('sixteen players in four pools then eight-player KO has 31 real matches and 155 minute floor',()=>{
 const plan=buildTournamentPlan(parseTournamentPlanning({players:16,pools:4,qualifyPerPool:2,boards:4,matchMinutes:20,finalMinutes:20,restMinutes:0}));
 assert.equal(plan.matchCount,31);assert.equal(plan.lowerBoundMinutes,155);assert.equal(plan.fixtures.filter(f=>f.phase==='pool').length,24);assert.ok(plan.plannedMinutes>=155);
 for(const f of plan.fixtures)for(const dependency of f.dependsOn)assert.ok(f.startMinute>=plan.fixtures.find(x=>x.id===dependency)!.endMinute);
});
test('three boards, required rest and longer final increase a feasible schedule without overlapping actors or boards',()=>{
 const base=parseTournamentPlanning({players:16,pools:4,qualifyPerPool:2,boards:4,matchMinutes:20,finalMinutes:20,restMinutes:0});
 const simple=buildTournamentPlan(base),plan=buildTournamentPlan({...base,boards:3,restMinutes:5,changeMinutes:2,finalMinutes:40});assert.ok(plan.plannedMinutes>simple.plannedMinutes);assert.equal(plan.fixtures.find(f=>f.phase==='final')?.durationMinutes,40);
 for(const[aIndex,a]of plan.fixtures.entries())for(const b of plan.fixtures.slice(aIndex+1)){if(a.board===b.board)assert.ok(a.endMinute+2<=b.startMinute||b.endMinute+2<=a.startMinute);if(a.players.some(p=>b.players.includes(p)))assert.ok(a.endMinute+5<=b.startMinute||b.endMinute+5<=a.startMinute);}
});
test('deadline, unequal pools and reset are explicit warnings; invalid dependencies fail',()=>{
 const input=parseTournamentPlanning({startAt:'2026-11-19T18:00:00Z',deadline:'2026-11-19T19:00:00Z'}),plan=buildTournamentPlan(input);assert.ok(plan.warnings.some(w=>w.includes('eindtijd')));assert.ok(plan.endAt);
 assert.ok(buildTournamentPlan({...input,players:17}).warnings.some(w=>w.includes('ongelijk')));
 assert.equal(buildTournamentPlan({...input,format:'double-elimination',players:8}).matchCount,15);
 assert.throws(()=>schedulePlanningFixtures([{id:'a',phase:'final',round:1,players:[],durationMinutes:20,dependsOn:['a']}],input),/kring/);
 assert.throws(()=>parseTournamentPlanning({boards:0}));
});
test('explicit writer dependencies receive the same rest and overlap protection as players',()=>{
 const plan=schedulePlanningFixtures([{id:'one',phase:'pool',round:1,players:['a','b'],writerId:'writer',dependsOn:[],durationMinutes:20},{id:'two',phase:'pool',round:1,players:['c','d'],writerId:'writer',dependsOn:[],durationMinutes:20}],parseTournamentPlanning({boards:2,restMinutes:5}));assert.equal(plan.fixtures[1].startMinute,25);
});

test('large round-robin remains bounded and the smallest pool must support every qualifier',()=>{
 const start=performance.now(),plan=buildTournamentPlan(parseTournamentPlanning({format:'round-robin',players:256,boards:64}));assert.equal(plan.matchCount,32640);assert.ok(performance.now()-start<3000,'large planning must remain bounded on the test runner');assert.throws(()=>parseTournamentPlanning({players:17,pools:4,qualifyPerPool:5}),/Iedere poule/);
});
test('a separate consolation cup adds only real first-round losers and waits for their source matches',()=>{
 const plan=buildTournamentPlan({players:16,pools:4,qualifyPerPool:2,boards:4,matchMinutes:20,finalMinutes:20,restMinutes:0,changeMinutes:0,format:'knockout',consolation:true});assert.equal(plan.matchCount,22);const extra=plan.fixtures.filter(f=>f.phase==='consolation');assert.equal(extra.length,7);for(const fixture of extra)for(const source of fixture.dependsOn){const predecessor=plan.fixtures.find(f=>f.id===source)!;assert.ok(predecessor.endMinute<=fixture.startMinute);}
 const odd=buildTournamentPlan({...plan.input,players:5});assert.equal(odd.matchCount,4);assert.equal(odd.fixtures.filter(f=>f.phase==='consolation').length,0);assert.throws(()=>buildTournamentPlan({...plan.input,format:'swiss'}));
});
