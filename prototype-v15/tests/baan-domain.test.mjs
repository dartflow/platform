import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBoard, boardView, createBoard } from '../worker/baan-domain.js';

const rick = { id: 'rick', name: 'Rick van Dijk' };
const mike = { id: 'mike', name: 'Mike de Bruin' };
const guest = { id: 'guest', name: 'Gast' };
const startTime = 1_700_000_000_000;

function fixture(id = 'duindorp-baan-2') {
  let board = createBoard(id);
  let time = startTime;
  const action = (actor, type, values = {}) => {
    const previous = board;
    const result = applyBoard(board, actor, { type, ...values }, ++time);
    board = result.state;
    if (result.error || result.needsDouble) assert.equal(board, previous);
    return result;
  };
  const ok = (...input) => {
    const result = action(...input);
    assert.equal(result.error, undefined);
    assert.equal(result.needsDouble, undefined);
    return result;
  };
  const view = (actor, after = 0) => boardView(board, actor, time + after);
  const score = (actor, value, darts = 3, doubleConfirmed = false) => ok(actor, 'score', { score: value, darts, doubleConfirmed });
  const settings = { startScore: 301, bestOfLegs: 1, matchId: 'part-1', inviteToken: 'secret-link' };
  const startPair = (mode = 'local', bestOfSets = 1) => {
    ok(rick, 'start', { mode, ...settings, bestOfSets });
    ok(mike, 'join', mode !== 'local' ? { inviteToken: 'secret-link' } : {});
    ok(mike, 'accept');
  };
  const finishPair = (writer = rick) => {
    for (const value of [180, 0, 81, 0]) score(writer, value);
    score(writer, 40, 1, true);
  };
  return { action, ok, view, score, settings, startPair, finishPair };
}

test('the first scanner writes, the second takes over without the first phone and the first loses write rights', () => {
  const { action, ok, view, score, startPair } = fixture();
  startPair();
  assert.equal(view().match.writerId, rick.id);
  assert.match(action(mike, 'score', { score: 60 }).error, /schrijver/);
  score(rick, 180);
  assert.deepEqual(view().match.remaining, [121, 301]);
  assert.equal(view().match.turn, 1);
  assert.match(action(guest, 'take-over').error, /deelnemers/);
  ok(mike, 'take-over');
  assert.equal(view().match.writerId, mike.id);
  assert.match(action(rick, 'score', { score: 100 }).error, /schrijver/);
  score(mike, 100);
  assert.deepEqual(view().match.remaining, [121, 201]);
  assert.ok(view().match.checkout);
  ok(mike, 'undo');
  assert.deepEqual(view().match.remaining, [121, 301]);
  assert.equal(view().match.visits.length, 1);
  ok(rick, 'take-over');
  assert.equal(view().match.writerId, rick.id);
});

test('the second local scanner must agree, a third scanner cannot join and a delayed score cannot enter a new match', () => {
  const { action, ok, view, settings } = fixture();
  ok(rick, 'start', { mode: 'local', ...settings });
  assert.equal(view().status, 'waiting');
  ok(mike, 'join');
  assert.deepEqual(view().match.accepted, [true, false]);
  assert.match(action(guest, 'join').error, /vrije spelersplek/);
  assert.match(action(guest, 'accept').error, /deelnemers/);
  ok(mike, 'accept');
  assert.equal(view().status, 'live');
  assert.match(action(rick, 'score', { score: 60, matchId: 'past' }).error, /gewisseld/);
});

test('the scorecard resets at the next leg and restores its countdown on undo', () => {
  const {ok, view, score, settings} = fixture();
  ok(rick, 'start', {mode:'practice', ...settings, startScore:501, bestOfLegs:3});
  for (const value of [180, 180, 101]) score(rick, value);
  score(rick, 39, 2);
  const match = view().match;
  assert.equal(match.legNumber, 1);
  assert.deepEqual(match.currentLegVisits.map(visit => visit.remainingAfter), [321,141,40,40]);
  assert.equal(match.currentLegVisits.at(-1).bust, true);
  score(rick, 40, 1, true);
  assert.equal(view().match.legNumber, 2);
  assert.deepEqual(view().match.currentLegVisits, []);
  assert.deepEqual(view().match.remaining, [501]);
  ok(rick, 'undo');
  assert.deepEqual(view().match.currentLegVisits, match.currentLegVisits);
});

test('solo uses the same scoring, preserves turn after a bust and keeps a personal result', () => {
  const { action, ok, view, score, settings } = fixture();
  ok(rick, 'start', { mode: 'practice', ...settings });
  assert.equal(view().status, 'live');
  score(rick, 180);
  score(rick, 81);
  assert.equal(view().match.turn, 0);
  assert.deepEqual(view().match.remaining, [40]);
  assert.equal(view().match.checkout, 'D20');
  assert.match(action(rick, 'score', { score: 20, darts: 1, doubleConfirmed: true }).error, /finish is gewijzigd/);
  assert.equal(action(rick, 'score', { score: 40, darts: 1 }).needsDouble, true);
  assert.equal(view().match.remaining[0], 40);
  score(rick, 39, 2);
  assert.equal(view().match.lastVisit.bust, true);
  assert.equal(view().match.remaining[0], 40);
  score(rick, 40, 1, true);
  assert.equal(view().status, 'result');
  assert.equal(view().match.resultPublished, true);
  assert.deepEqual(view(rick).history[0].stats[0], { average: 100.3, total: 301, darts: 9, highestFinish: 40, oneEighties: 1 });
  assert.equal(view(mike).history.length, 0);
  assert.equal(view().history.length, 0);
  assert.equal(view(rick, 40_000).status, 'idle');
  assert.equal(view(rick, 40_000).history.length, 1);
  assert.match(action(rick, 'undo').error, /onbevestigde/);
});

test('best-of sets progresses correctly and undo can cross the set boundary', () => {
  const { ok, view, score, startPair, finishPair } = fixture();
  startPair('local', 3);
  finishPair();
  assert.equal(view().status, 'live');
  assert.deepEqual(view().match.sets, [1, 0]);
  assert.deepEqual(view().match.legs, [0, 0]);
  assert.equal(view().match.turn, 1);
  assert.deepEqual(view().match.remaining, [301, 301]);
  ok(rick, 'undo');
  assert.deepEqual(view().match.sets, [0, 0]);
  assert.deepEqual(view().match.remaining, [40, 301]);
  assert.equal(view().match.turn, 0);
  assert.equal(view().match.visits.length, 4);
  score(rick, 40, 1, true);
  for (const value of [0, 180, 0, 81, 0]) score(rick, value);
  score(rick, 40, 1, true);
  assert.equal(view().status, 'result');
  assert.equal(view().match.winnerId, rick.id);
  assert.deepEqual(view().match.sets, [2, 0]);
  assert.equal(view().match.stats[0].oneEighties, 2);
});

test('remote invitation is private, stale waiting boards expire and an unrelated phone cannot join remote', () => {
  const { action, ok, view, settings } = fixture();
  ok(rick, 'start', { mode: 'remote', ...settings });
  assert.equal(view(rick).match.inviteToken, 'secret-link');
  assert.equal(view(guest).match.inviteToken, undefined);
  assert.equal(view().match.inviteToken, undefined);
  assert.match(action(guest, 'join').error, /persoonlijke wedstrijdlink/);
  assert.equal(view(rick, 300_000).status, 'idle');
  ok(mike, 'join', { inviteToken: 'secret-link' });
  ok(mike, 'accept');
  assert.equal(view(rick).match.inviteToken, undefined);
});

test('scheduled result is released only after two independent confirmations', () => {
  const { action, ok, view, settings, finishPair } = fixture('demo-aabbccddeeff');
  ok(rick, 'prepare', { ...settings, opponent: 'MIKE de  Bruin', label: 'Clubcompetitie · ronde 2', boardTitle: 'Bord 3' });
  assert.equal(view().title, 'Bord 3');
  assert.equal(view().match.inviteRequired, false);
  assert.match(action(guest, 'join', { inviteToken: 'secret-link' }).error, /staat klaar/);
  ok(mike, 'join');
  ok(mike, 'accept');
  finishPair();
  assert.equal(view().match.resultPublished, false);
  assert.equal(view(rick).history.length, 0);
  assert.match(action(rick, 'release').error, /samen/);
  ok(rick, 'confirm');
  assert.match(action(rick, 'undo').error, /onbevestigde/);
  assert.equal(view().match.resultPublished, false);
  ok(mike, 'confirm');
  assert.equal(view().match.resultPublished, true);
  assert.equal(view(mike).history[0].scheduledLabel, 'Clubcompetitie · ronde 2');
  ok(mike, 'release');
  assert.equal(view().status, 'idle');
  assert.equal(view().officialResult.resultPublished, true);
  assert.deepEqual(view().officialResult.legs, [1, 0]);
});
