import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateElo, freeMatchCapacity, nationalRatingFormat, rankRatingRows, ratingActive, replayRatings, roundRating } from '../lib/ranking-domain';
import { applyMatchAction, newGame, validateSettings } from '../lib/domain';
import type { MatchState } from '../lib/types';

const hour = 3_600_000;
test('published handoff Elo examples keep full precision and equal opposite mutations', () => {
  for (const [a, b, expected] of [[1500, 1500, [1516, 1484]], [1400, 1600, [1424.311901653, 1575.688098347]], [1600, 1400, [1607.688098347, 1392.311901653]]] as [number, number, number[]][]) {
    const result = calculateElo(a, b, true);
    result.after.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9));
    assert.equal(result.deltas[0] + result.deltas[1], 0);
    assert.ok(Math.abs(result.after[0] + result.after[1] - a - b) < 1e-10);
  }
  assert.deepEqual(calculateElo(1500, 1500, false).after, [1484, 1516]);
  assert.equal(roundRating(1516.5), 1517);
  assert.equal(roundRating(-1.25, 1), -1.3);
});

test('corrected source replay follows server sequence and recomputes later opponents', () => {
  const ratings = replayRatings([{ sequence: 2, players: ['A', 'C'], winnerId: 'A' }, { sequence: 1, players: ['A', 'B'], winnerId: 'B' }]);
  assert.ok(Math.abs(ratings.A - 1500.7363067935) < 1e-9);
  assert.equal(ratings.B, 1516);
  assert.ok(Math.abs(ratings.C - 1483.2636932065) < 1e-9);
  assert.throws(() => replayRatings([{ sequence: 1, players: ['A', 'B'], winnerId: 'C' }]));
});

test('activity and rolling rematch limits use the exact exclusive old boundary', () => {
  const last = '2026-08-01T12:00:00.000Z', now = Date.parse(last);
  assert.equal(ratingActive(last, now + 2159 * hour), true);
  assert.equal(ratingActive(last, now + 2160 * hour), false);
  assert.equal(ratingActive(null, now), false);
  assert.equal(freeMatchCapacity([0, 24 * hour], 168 * hour), true);
  assert.equal(freeMatchCapacity([0.01 * hour, 24 * hour], 168 * hour), false);
});

test('placement requires both ten matches and five opponents; equal unrounded ratings share sporting rank', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const player = (playerId: string, rating: number, played = 10, uniqueOpponents = 5) => ({ playerId, name: playerId, rating, played, uniqueOpponents, lastPlayedAt: new Date(now - hour).toISOString() });
  const rows = rankRatingRows([player('b', 1600), player('a', 1600), player('c', 1599.9), player('new', 1900, 9, 5), player('repeat', 1800, 10, 4), { ...player('old', 2000), lastPlayedAt: new Date(now - 2160 * hour).toISOString() }], now);
  assert.deepEqual(rows.slice(0, 3).map(p => [p.playerId, p.position]), [['a', 1], ['b', 1], ['c', 3]]);
  assert.equal(rows.find(p => p.playerId === 'new')!.provisional, true);
  assert.equal(rows.find(p => p.playerId === 'repeat')!.provisional, true);
  assert.equal(rows.find(p => p.playerId === 'old')!.active, false);
  assert.ok(rows.slice(3).every(p => p.position === null));
  assert.equal(rows[2].displayRating, 1600, 'display rounding must not manufacture a sporting tie');
});

test('national format includes every published odd best-of and excludes sets, fixed legs and 301', () => {
  for (const bestOfLegs of [5, 7, 9, 11, 13, 15, 17, 19]) assert.equal(nationalRatingFormat(validateSettings({ bestOfLegs })), true);
  for (const settings of [{ startScore: 301 as const }, { bestOfSets: 3 }, { legLimit: 8 }, { bestOfLegs: 3 }]) assert.equal(nationalRatingFormat(validateSettings(settings)), false);
});

test('each player controls only their own ranking consent and the choice freezes at start', () => {
  const settings = validateSettings({ bestOfLegs: 5 });
  const state: MatchState = { id: 'm', clubId: 'c', eventId: 'e', boardId: null, revision: 0, status: 'ready', players: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], settings, writerId: 'A', accepted: [true, true], confirmations: [false, false], resultRevision: null, game: newGame('m', ['A', 'B'], settings), previousSets: [], winnerId: null, resultPublished: false, dispute: null };
  const a = applyMatchAction(state, 'A', false, { type: 'ranking-consent', consent: true });
  assert.deepEqual(a.ranking?.consents, [true, false]);
  assert.equal(state.ranking, undefined);
  const both = applyMatchAction(a, 'B', false, { type: 'ranking-consent', consent: true });
  assert.deepEqual(both.ranking?.consents, [true, true]);
  assert.throws(() => applyMatchAction(both, 'organizer', true, { type: 'ranking-consent', consent: true }), { code: 'forbidden' });
  const started = applyMatchAction(both, 'A', false, { type: 'start' });
  assert.throws(() => applyMatchAction(started, 'A', false, { type: 'ranking-consent', consent: false }), { code: 'ranking_locked' });
  const booked = { ...both, status: 'confirmed' as const, resultPublished: true, confirmations: [true, true], ranking: { ...both.ranking!, status: 'booked' as const } };
  for (const action of [{ type: 'undo' }, { type: 'resolve', reason: 'change', decision: 'resume' }, { type: 'dispute', reason: 'change' }] as const) assert.throws(() => applyMatchAction(booked, 'A', true, action));
});
