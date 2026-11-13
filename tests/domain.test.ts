import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchAction, newGame, scoreGame, validateSettings, checkout, matchView } from '../lib/domain';
import type { MatchState, Settings } from '../lib/types';
const settings: Settings = { startScore: 301, bestOfLegs: 1, bestOfSets: 1 };
function match(overrides: Partial<MatchState> = {}): MatchState { return { id: 'match', clubId: 'club', eventId: 'event', boardId: 'board', revision: 0, status: 'live', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], writerId: 'a', settings, accepted: [true, true], confirmations: [false, false], resultRevision: null, game: newGame('match', ['a', 'b'], settings), previousSets: [], winnerId: null, resultPublished: false, dispute: null, ...overrides }; }
test('current-leg display projection never mixes equal leg numbers from previous sets',()=>{
  const multi={...settings,bestOfSets:3};
  const previous=scoreGame(newGame('match',['a','b'],multi),180);
  previous.status='finished';previous.winner='a';previous.legs=[1,0];
  const current=scoreGame(newGame('match',['a','b'],multi),60);
  const view=matchView(match({settings:multi,previousSets:[previous],game:current}),'a',false);
  assert.deepEqual(view.visits.map(visit=>visit.score),[180,60]);
  assert.deepEqual(view.currentLegVisits?.map(visit=>visit.score),[60]);
  assert.equal(view.currentLegStartScore,301);assert.equal(view.setNumber,2);assert.equal(view.legNumber,1);
});
test('discarded free games cannot mutate; an official interruption can only resume through an authorized fresh call',()=>{
  const game=scoreGame(newGame('match',['a','b'],settings),60);
  const abandoned=match({status:'abandoned',boardId:null,game});
  for(const action of [{type:'score',score:60},{type:'undo'},{type:'call',boardId:'next-board'}] as const)assert.throws(()=>applyMatchAction(abandoned,'a',true,action),{code:'board_session_released',status:410});
  const interrupted=match({status:'interrupted',boardId:null,game,paused:true});
  assert.throws(()=>applyMatchAction(interrupted,'a',false,{type:'score',score:20}),{code:'match_interrupted'});
  assert.throws(()=>applyMatchAction(interrupted,'a',false,{type:'call',boardId:'next-board'}),{code:'forbidden'});
  let resumed=applyMatchAction(interrupted,'organizer',true,{type:'call',boardId:'next-board'});
  assert.deepEqual(resumed.game,game);assert.equal(resumed.paused,false);assert.deepEqual(resumed.accepted,[false,false]);
  resumed=applyMatchAction(resumed,'a',false,{type:'accept'});resumed=applyMatchAction(resumed,'b',false,{type:'accept'});resumed=applyMatchAction(resumed,'a',false,{type:'start'});
  assert.equal(resumed.status,'live');assert.deepEqual(resumed.game,game);assert.equal(resumed.boardId,'next-board');
});
test('x01 rejects impossible visits; bust preserves remaining but counts darts; finish requires explicit double', () => {
  for (const startScore of [301, 501, 701] as const) {
    const game = newGame('match', ['a', 'b'], { ...settings, startScore });
    assert.throws(() => scoreGame(game, 179), /niet mogelijk/);
    const first = scoreGame(game, 180);
    assert.equal(first.remaining[0], startScore - 180);
    assert.equal(game.remaining[0], startScore);
  }
  const game = { ...newGame('match', ['a', 'b'], settings), remaining: [40, 301] };
  const bust = scoreGame(game, 39);
  assert.equal(bust.remaining[0], 40); assert.equal(bust.visits[0].bust, true); assert.equal(bust.stats[0].darts, 3); assert.equal(bust.stats[0].total, 0);
  assert.throws(() => scoreGame(game, 40, 1), /dubbel/);
  assert.equal(scoreGame(game, 40, 1, true).winner, 'a');
  assert.equal(checkout(40), 'D20'); assert.equal(checkout(169), null);
});
test('fixed eight legs supports 4–4 and undo restores the complete match state', () => {
  const fixed = { ...settings, legLimit: 8 };
  const source = match({ settings: fixed, game: { ...newGame('match', ['a', 'b'], fixed), legs: [3, 4], remaining: [40, 301] } });
  const done = applyMatchAction(source, 'a', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  assert.equal(done.status, 'result'); assert.equal(done.game.draw, true); assert.equal(done.winnerId, null); assert.deepEqual(done.game.legs, [4, 4]);
  const restored = applyMatchAction(done, 'a', false, { type: 'undo' });
  assert.deepEqual(restored.game, source.game); assert.equal(restored.status, 'live'); assert.equal(restored.resultRevision, null);
  assert.throws(() => validateSettings({ legLimit: 8, bestOfSets: 3 }), /Vaste zes, acht of tien/);
});
test('set transition alternates starter and undo crosses the set boundary', () => {
  const multi = { ...settings, bestOfSets: 3 };
  const source = match({ settings: multi, game: { ...newGame('match', ['a', 'b'], multi), remaining: [40, 301] } });
  const next = applyMatchAction(source, 'a', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  assert.equal(next.previousSets.length, 1); assert.equal(next.game.turn, 1); assert.equal(next.status, 'live');
  const restored = applyMatchAction(next, 'a', false, { type: 'undo' });
  assert.deepEqual(restored.game, source.game); assert.equal(restored.previousSets.length, 0);
});
test('explicit delegated writer scores but cannot confirm for a player and loses input after takeover', () => {
  const source=match({writerId:'writer',delegatedWriterId:'writer'});
  const next=applyMatchAction(source,'writer',false,{type:'score',score:60});
  assert.equal(next.game.remaining[0],241);
  assert.throws(()=>applyMatchAction(next,'writer',false,{type:'confirm'}),/toegewezen spelers/);
  const taken=applyMatchAction(next,'b',false,{type:'take-over'});
  assert.throws(()=>applyMatchAction(taken,'writer',false,{type:'score',score:60}),/huidige schrijver/);
  assert.throws(()=>applyMatchAction(source,'outsider',true,{type:'score',score:60}),/toegewezen spelers/);
});
test('fixed ten legs continues through a majority and permits the v15 five-all draw', () => {
  const fixed = validateSettings({ ...settings, legLimit: 10 });
  const source = match({ settings: fixed, game: { ...newGame('match', ['a', 'b'], fixed), legs: [4, 5], remaining: [40, 301] } });
  const done = applyMatchAction(source, 'a', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  assert.equal(done.status, 'result');
  assert.deepEqual(done.game.legs, [5, 5]);
  assert.equal(done.winnerId, null);
  const restored = applyMatchAction(done, 'a', false, { type: 'undo' });
  assert.deepEqual(restored.game, source.game);
});
test('takeover revokes prior writer and publication requires both assigned players', () => {
  let state = match();
  state = applyMatchAction(state, 'b', false, { type: 'take-over' });
  assert.throws(() => applyMatchAction(state, 'a', false, { type: 'score', score: 60 }), /huidige schrijver/);
  assert.throws(() => applyMatchAction(state, 'outsider', true, { type: 'score', score: 60 }), /toegewezen spelers/);
  state.game.remaining[0] = 40;
  state = applyMatchAction(state, 'b', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  const resultRevision = state.resultRevision;
  state = applyMatchAction(state, 'a', false, { type: 'confirm' }); assert.equal(state.resultPublished, false);
  assert.throws(() => applyMatchAction(state, 'a', false, { type: 'undo' }), /onbevestigde/);
  state = applyMatchAction(state, 'b', false, { type: 'confirm' }); assert.equal(state.resultPublished, true); assert.equal(state.resultRevision, resultRevision);
});
test('per-player scoring switches input with the turn and forbids host, organizer and takeover bypass',()=>{
 let state=match({scoringMode:'per-player'});
 assert.equal(matchView(state,'a',false).permissions.canWrite,true);
 assert.equal(matchView(state,'b',false).permissions.canWrite,false);
 assert.throws(()=>applyMatchAction(state,'b',true,{type:'score',score:60}),{code:'not_your_turn'});
 assert.throws(()=>applyMatchAction(state,'b',false,{type:'take-over'}),{code:'per_player_scoring'});
 assert.throws(()=>applyMatchAction({...state,delegatedWriterId:'outsider',writerId:'outsider'},'outsider',true,{type:'score',score:60}),{code:'forbidden'});
 state=applyMatchAction(state,'a',false,{type:'score',score:60});
 assert.equal(state.writerId,'b');assert.equal(state.game.turn,1);
 assert.equal(matchView(state,'a',true).permissions.canScore,false);
 assert.equal(matchView(state,'b',false).permissions.canWrite,true);
 assert.equal(matchView(state,'b',false).permissions.canTakeOver,false);
 assert.throws(()=>applyMatchAction(state,'a',true,{type:'score',score:60}),{code:'not_your_turn'});
 state=applyMatchAction(state,'b',false,{type:'score',score:45});
 assert.deepEqual(state.game.remaining,[241,256]);assert.equal(state.writerId,'a');
 assert.equal(matchView({...state,paused:true},'a',false).permissions.canWrite,false);
});
test('per-player undo belongs to the last thrower and older corrections still require the opponent',()=>{
 let state=match({scoringMode:'per-player'});
 state=applyMatchAction(state,'a',false,{type:'score',score:60});
 assert.equal(matchView(state,'a',false).permissions.canUndo,true);
 assert.equal(matchView(state,'b',false).permissions.canUndo,false);
 assert.throws(()=>applyMatchAction(state,'b',true,{type:'undo'}),{code:'forbidden'});
 let undone=applyMatchAction(state,'a',false,{type:'undo'});assert.equal(undone.game.turn,0);assert.equal(undone.writerId,'a');assert.deepEqual(undone.game.remaining,[301,301]);
 state=applyMatchAction(state,'b',false,{type:'score',score:45});
 assert.throws(()=>applyMatchAction(state,'a',false,{type:'undo'}),{code:'forbidden'});
 state=applyMatchAction(state,'a',false,{type:'request-correction',reason:'Mijn vorige worp was onjuist'});
 assert.equal(matchView(state,'a',false).permissions.canWrite,false);
 assert.equal(state.correction!.undoCount,2);
 assert.throws(()=>applyMatchAction(state,'a',true,{type:'approve-correction',correctionId:state.correction!.id}),{code:'forbidden'});
 undone=applyMatchAction(state,'b',false,{type:'approve-correction',correctionId:state.correction!.id});
 assert.equal(undone.writerId,'a');assert.equal(undone.game.visits.length,0);assert.deepEqual(undone.game.remaining,[301,301]);
});
test('per-player set transitions and finishing undo keep the authoritative starter as scorer',()=>{
 const multi={...settings,bestOfSets:3};
 const source=match({scoringMode:'per-player',settings:multi,game:{...newGame('match',['a','b'],multi),remaining:[40,301]}});
 const next=applyMatchAction(source,'a',false,{type:'score',score:40,darts:1,doubleConfirmed:true});
 assert.equal(next.game.turn,1);assert.equal(next.writerId,'b');assert.equal(matchView(next,'b',false).permissions.canWrite,true);
 const restored=applyMatchAction(next,'a',false,{type:'undo'});assert.deepEqual(restored.game,source.game);assert.equal(restored.writerId,'a');
 const final=applyMatchAction(match({scoringMode:'per-player',game:{...newGame('match',['a','b'],settings),remaining:[40,301]}}),'a',false,{type:'score',score:40,darts:1,doubleConfirmed:true});
 assert.equal(final.status,'result');assert.equal(matchView(final,'b',false).permissions.canUndo,false);
 assert.equal(applyMatchAction(final,'a',false,{type:'undo'}).status,'live');
});
test('legacy and explicit local matches retain one shared writer for both players',()=>{
 for(const scoringMode of [undefined,'shared-writer'] as const){
  let state=match({scoringMode});state=applyMatchAction(state,'a',false,{type:'score',score:60});
  assert.equal(state.game.turn,1);assert.equal(state.writerId,'a');assert.equal(matchView(state,'a',false).permissions.canWrite,true);
  assert.equal(matchView(state,'b',false).permissions.canWrite,false);
  state=applyMatchAction(state,'a',false,{type:'score',score:45});assert.deepEqual(state.game.remaining,[241,256]);
 }
});
test('a dispute requires an organizer decision with reason; resume reverses final visit', () => {
  let state = match({ game: { ...newGame('match', ['a', 'b'], settings), remaining: [40, 301] } });
  state = applyMatchAction(state, 'a', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  state = applyMatchAction(state, 'b', false, { type: 'dispute', reason: 'Dubbel betwist' });
  assert.throws(() => applyMatchAction(state, 'a', false, { type: 'confirm' }), /geen uitslag/);
  assert.throws(() => applyMatchAction(state, 'a', false, { type: 'resolve', reason: 'Herstel', decision: 'resume' }), /wedstrijdleiding/);
  state = applyMatchAction(state, 'organizer', true, { type: 'resolve', reason: 'Laatste dubbel ongeldig', decision: 'resume' });
  assert.equal(state.status, 'live'); assert.equal(state.game.remaining[0], 40); assert.deepEqual(state.confirmations, [false, false]);
});

for (const startScore of [301, 501, 701] as const) {
  test(`${startScore} preserves scoring, leg alternation, stats and winner through a complete best-of-three`, () => {
    const format: Settings = { startScore, bestOfLegs: 3, bestOfSets: 1 };
    let game = newGame('parity', ['a', 'b'], format);
    // Give A two full legs; zero visits from B preserve normal alternating turns.
    while (game.status === 'live') {
      if (game.turn === 1) game = scoreGame(game, 0);
      else {
        const remaining = game.remaining[0];
        const score = remaining > 180 ? Math.min(180, remaining - 40) : remaining;
        game = scoreGame(game, score, score === remaining && score === 40 ? 1 : 3, score === remaining);
      }
    }
    assert.equal(game.winner, 'a'); assert.deepEqual(game.legs, [2, 0]);
    assert.equal(game.stats[0].total, startScore * 2); assert.equal(game.stats[1].total, 0);
    assert.equal(game.visits.filter(v => v.checkout).length, 2);
    assert.equal(game.visits.find(v => v.leg === 2)?.player, 'b');
    assert.equal(game.history.length, game.visits.length);
  });
}
