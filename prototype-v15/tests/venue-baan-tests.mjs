import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createVenueDemo, venueAction, venueBaanQuery, venueStandings} from '../public/venue-engine.js';
import {applyBoard, boardView, createBoard} from '../worker/baan-domain.js';

const now = 1_800_000_000_000;
const roomId = 'demo-0123456789abcdef01234567';

function calledFixture() {
  const scheduled = venueAction(createVenueDemo(now), 'schedule', {}, now);
  assert.ok(scheduled.assigned.length > 0);
  const {matchId, boardId} = scheduled.assigned[0];
  return {state: scheduled.state, matchId, boardId};
}

test('an unscored called fixture keeps its venue board reserved for Baanmodus', () => {
  const {state, matchId, boardId} = calledFixture();
  const link = venueAction(state, 'link-baan', {matchId, roomId}, now + 1);
  assert.equal(link.error, undefined);
  const match = link.state.matches.find(item => item.id === matchId);
  const board = link.state.boards.find(item => item.id === boardId);
  assert.equal(match.status, 'playing');
  assert.equal(match.realtimeRoom.id, roomId);
  assert.equal(match.writerId, null);
  assert.equal(board.matchId, matchId);
  const query = venueBaanQuery(link.state, match, 'De Puinruimers');
  assert.deepEqual([query.first, query.opponent], match.players.map(id => state.players.find(player => player.id === id).name));
  assert.equal(query.boardTitle, board.name);
  assert.equal(venueAction(link.state, 'tick', {}, now + 300_000).state.boards.find(item => item.id === boardId).matchId, matchId);
  assert.match(venueAction(link.state, 'score', {matchId, score: 60}, now + 2).error, /live baan/);
  assert.match(venueAction(state, 'link-baan', {matchId: 'P-A-1-2', roomId}, now + 2).error, /eerste beurt/);

  const unlinked = venueAction(link.state, 'unlink-baan', {matchId}, now + 2);
  assert.equal(unlinked.error, undefined);
  assert.equal(unlinked.state.matches.find(item => item.id === matchId).status, 'waiting');
  assert.equal(unlinked.state.boards.find(item => item.id === boardId).matchId, null);
});

test('only a matching confirmed Baanmodus result changes the venue standings once', () => {
  const {state, matchId, boardId} = calledFixture();
  const linked = venueAction(state, 'link-baan', {matchId, roomId}, now + 1).state;
  const match = linked.matches.find(item => item.id === matchId);
  const room = match.realtimeRoom;
  const players = room.players.map((name, i) => ({id: `profile-${i}`, name}));
  let shared = createBoard(roomId);
  let time = now + 1;
  function move(actor, type, fields = {}) {
    const update = applyBoard(shared, actor, {type, ...fields}, ++time);
    assert.equal(update.error, undefined, update.error);
    assert.equal(update.needsDouble, undefined);
    shared = update.state;
  }
  const [firstPlayer, secondPlayer] = players;
  move(firstPlayer, 'prepare', {matchId: 'live-fixture', opponent: secondPlayer.name,
    startScore: room.startScore, bestOfLegs: room.bestOfLegs, bestOfSets: 1});
  move(secondPlayer, 'join');
  move(secondPlayer, 'accept');
  let writer = firstPlayer;
  for (let i = 0; shared.status === 'live'; i++) {
    assert.ok(i < 40, 'The shared match should finish');
    if (i === 5) {
      move(secondPlayer, 'take-over');
      writer = secondPlayer;
    }
    const {turn, remaining} = boardView(shared, writer, time).match;
    const leave = remaining[turn];
    const score = turn === 1 ? 0 : leave === 40 ? 40 : leave === 141 ? 101 : 180;
    move(writer, 'score', {score, darts: score === 40 ? 1 : 3, doubleConfirmed: score === 40});
  }
  move(firstPlayer, 'confirm');
  assert.equal(boardView(shared, null, time).officialResult, null);
  move(secondPlayer, 'confirm');
  move(firstPlayer, 'release');
  const result = boardView(shared, null, time).officialResult;
  assert.deepEqual(result.legs, [3, 0]);
  const importScore = (source, score, id = roomId) => venueAction(source, 'import-baan', {matchId, roomId: id, result: score}, time + 1);
  for (const rejected of [
    importScore(linked, {...result, resultPublished: false}),
    importScore(linked, {...result, mode: 'local'}),
    importScore(linked, {...result, players: players.toReversed()}),
    importScore(linked, {...result, settings: {...result.settings, bestOfSets: 3}}),
    importScore(linked, {...result, winnerId: players[1].id}),
    importScore(linked, result, 'demo-0123456789abcdef01234568'),
  ]) {
    assert.ok(rejected.error);
    assert.equal(rejected.state, linked);
  }

  const count = snapshot => venueStandings(snapshot, match.poolId).find(player => player.id === match.players[0]).played;
  const first = importScore(linked, result);
  assert.equal(first.error, undefined);
  const confirmed = first.state.matches.find(item => item.id === matchId);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.winnerId, match.players[0]);
  assert.deepEqual(confirmed.score, result.legs);
  assert.equal(first.state.boards.find(board => board.id === boardId).matchId, null);
  assert.equal(count(first.state), count(linked) + 1);
  const repeated = importScore(first.state, result);
  assert.equal(repeated.error, undefined);
  assert.equal(count(repeated.state), count(first.state));
  assert.equal(repeated.state.sequence, first.state.sequence);
});
