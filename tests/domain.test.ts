import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchAction, newGame, scoreGame, validateSettings, checkout } from '../lib/domain';
import type { MatchState, Settings } from '../lib/types';
const settings: Settings = { startScore: 301, bestOfLegs: 1, bestOfSets: 1 };
function match(overrides: Partial<MatchState> = {}): MatchState { return { id: 'match', clubId: 'club', eventId: 'event', boardId: 'board', revision: 0, status: 'live', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], writerId: 'a', settings, accepted: [true, true], confirmations: [false, false], resultRevision: null, game: newGame('match', ['a', 'b'], settings), previousSets: [], winnerId: null, resultPublished: false, dispute: null, ...overrides }; }
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
  assert.throws(() => validateSettings({ legLimit: 8, bestOfSets: 3 }), /Vaste acht/);
});
test('set transition alternates starter and undo crosses the set boundary', () => {
  const multi = { ...settings, bestOfSets: 3 };
  const source = match({ settings: multi, game: { ...newGame('match', ['a', 'b'], multi), remaining: [40, 301] } });
  const next = applyMatchAction(source, 'a', false, { type: 'score', score: 40, darts: 1, doubleConfirmed: true });
  assert.equal(next.previousSets.length, 1); assert.equal(next.game.turn, 1); assert.equal(next.status, 'live');
  const restored = applyMatchAction(next, 'a', false, { type: 'undo' });
  assert.deepEqual(restored.game, source.game); assert.equal(restored.previousSets.length, 0);
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
