import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advanceFixtures, knockout, newTraining, roundRobin, standings, tournamentFixtures, trainingAction } from '../lib/platform-domain';

test('round robin gives every pair exactly one match and no double booking within a round, including odd entries', () => {
  for (const count of [2, 3, 4, 7, 16]) {
    const ids = Array.from({ length: count }, () => randomUUID()), fixtures = roundRobin(ids);
    assert.equal(fixtures.length, count * (count - 1) / 2);
    assert.equal(new Set(fixtures.map(f => [...f.players].sort().join(':'))).size, fixtures.length);
    for (const round of new Set(fixtures.map(f => f.round))) {
      const players = fixtures.filter(f => f.round === round).flatMap(f => f.players);
      assert.equal(new Set(players).size, players.length);
    }
  }
});
test('knockout separates byes, advances only confirmed winners and yields one final', () => {
  const players = Array.from({ length: 5 }, () => randomUUID()), fixtures = knockout(players);
  const first = fixtures.filter(f => f.round === 1);
  assert.equal(first.length, 4); assert.equal(first.filter(f => f.status === 'bye').length, 3);
  assert.equal(new Set(first.flatMap(f => f.players).filter(Boolean)).size, 5);
  for (const round of [1, 2, 3]) {
    for (const fixture of fixtures.filter(f => f.round === round && f.status !== 'bye')) {
      assert.ok(fixture.players.every(Boolean)); fixture.status = 'confirmed'; fixture.winnerId = fixture.players[0]; fixture.score = [3, 1];
    }
    advanceFixtures(fixtures);
  }
  assert.ok(fixtures.at(-1)?.winnerId); assert.equal(fixtures.at(-1)?.round, 3);
});
test('pool standings remain incomplete until every game is confirmed, then top two seed the knockout once', () => {
  const ids = Array.from({ length: 8 }, () => randomUUID()), fixtures = tournamentFixtures(ids, 'pools-knockout', 2);
  const pools = fixtures.filter(f => f.phase === 'pool');
  assert.equal(pools.length, 12); assert.equal(fixtures.filter(f => f.phase === 'knockout').length, 3);
  const a = pools.find(f => f.pool === 'A')!;
  a.status = 'confirmed'; a.winnerId = null; a.score = [4, 4];
  const draw = standings([a], a.players as string[]); assert.deepEqual(draw.map(r => r.points), [1, 1]);
  advanceFixtures(fixtures); assert.ok(fixtures.filter(f => f.phase === 'knockout').every(f => f.players.every(p => p === null)));
  for (const f of pools) { f.status = 'confirmed'; f.winnerId = f.players[0]; f.score = [3, 1]; }
  advanceFixtures(fixtures);
  assert.ok(fixtures.filter(f => f.phase === 'knockout' && f.round === 1).every(f => f.players.every(Boolean)));
  const before = structuredClone(fixtures); advanceFixtures(fixtures); assert.deepEqual(fixtures, before);
});
test('training persists genuine bust, legal double finish, undo and nine-dart budget without affecting competitive games', () => {
  const id = randomUUID(), actor = randomUUID();
  let state = newTraining(id, actor, { mode: '170' });
  state = trainingAction(state, { type: 'training.score', score: 180, darts: 3 });
  assert.equal(state.game?.remaining[0], 170); assert.equal(state.game?.stats[0].darts, 3); assert.equal(state.game?.visits[0].bust, true);
  assert.throws(() => trainingAction(state, { type: 'training.score', score: 170, darts: 3 }), { code: 'needs_double' });
  state = trainingAction(state, { type: 'training.score', score: 170, darts: 3, doubleConfirmed: true });
  assert.equal(state.completed, true); assert.equal(state.game?.remaining[0], 0);
  state = trainingAction(state, { type: 'training.undo' }); assert.equal(state.completed, false); assert.equal(state.game?.stats[0].darts, 3);
  state = trainingAction(state, { type: 'training.score', score: 0 });
  assert.throws(() => trainingAction(state, { type: 'training.score', score: 1, darts: 4 }), { code: 'darts_exhausted' });
  state = trainingAction(state, { type: 'training.score', score: 0 }); assert.equal(state.completed, true); assert.equal(state.game?.stats[0].darts, 9);
});
test('Dartbot generates legal server turns and undo reverses the whole human/bot exchange', () => {
  let state = newTraining(randomUUID(), randomUUID(), { mode: 'bot', startScore: 301, botAverage: 50 });
  const initial = structuredClone(state.game);
  state = trainingAction(state, { type: 'training.score', score: 60, darts: 3 });
  assert.equal(state.game?.turn, 0); assert.equal(state.game?.visits.length, 2); assert.equal(state.game?.stats[0].total, 60);
  state = trainingAction(state, { type: 'training.undo' }); assert.deepEqual(state.game, initial);
});
test('doubles training records exactly 21 three-dart targets and rejects fabricated hit counts', () => {
  let state = newTraining(randomUUID(), randomUUID(), { mode: 'around' });
  assert.throws(() => trainingAction(state, { type: 'training.score', hits: 4 }), { code: 'invalid_hits' });
  for (let i = 0; i < 21; i++) state = trainingAction(state, { type: 'training.score', hits: i % 4 });
  assert.equal(state.completed, true); assert.equal(state.rounds?.length, 21);
  state = trainingAction(state, { type: 'training.undo' }); assert.equal(state.completed, false); assert.equal(state.rounds?.length, 20);
});
