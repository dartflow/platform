import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevDb } from '../scripts/baan-dev-db.mjs';
import { handleBaanApi } from '../worker/baan-api.js';

function clientHarness() {
  const env = { DB: createDevDb() };
  const call = async (path, { token, data, method = data ? 'POST' : 'GET' } = {}) => {
    const request = new Request('https://dartflow.test/api/baan/' + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const response = await handleBaanApi(request, env);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, ...await response.json() };
  };
  const profile = async name => {
    const result = await call('profile', { data: { name } });
    assert.equal(result.status, 201);
    assert.match(result.token, /^[a-f0-9]{64}$/);
    return result;
  };
  const send = (id, who, revision, action, requestId = crypto.randomUUID()) =>
    call(id, { token: who?.token, data: { revision, action, requestId } });
  return { profile, call, send, db: env.DB };
}

const fixtureId = 'demo-dartflowrace1';
const gameSetup = { startScore: 301, bestOfLegs: 1, bestOfSets: 1 };

test('reads of a free board are write-free and only one concurrent player can start', async () => {
  const { profile, call, send, db } = clientHarness();
  const first = await profile('  Rick  ');
  const other = await profile('Mike');
  const storedProfile = await db.prepare('SELECT token_hash FROM baan_profiles WHERE id = ?').bind(first.actor.id).first();
  assert.notEqual(storedProfile.token_hash, first.token);
  assert.equal(first.actor.name, 'Rick');
  assert.equal((await call(fixtureId)).state.status, 'idle');
  assert.equal((await db.prepare('SELECT count(*) AS total FROM baan_boards').first()).total, 0);

  const requestId = crypto.randomUUID();
  const start = { type: 'start', mode: 'local', ...gameSetup };
  const [a, b] = await Promise.all([
    send(fixtureId, first, 0, start, requestId),
    send(fixtureId, other, 0, start),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const writer = a.status === 200 ? first : other;
  const observer = await call(fixtureId);
  assert.equal(observer.actor, null);
  assert.deepEqual(observer.history, []);
  assert.equal(observer.state.match.writerId, writer.actor.id);
  if (a.status === 200) {
    const repeat = await send(fixtureId, first, 0, start, requestId);
    assert.equal(repeat.revision, 1);
    assert.equal(repeat.state.match.id, a.state.match.id);
  }
});

test('score and handover are serialized across independent players and retries', async () => {
  const { profile, call, send } = clientHarness();
  const one = await profile('Rick');
  const two = await profile('Mike');
  const third = await profile('Supporter');
  const started = await send(fixtureId, one, 0, { type: 'start', mode: 'local', ...gameSetup });
  const joined = await send(fixtureId, two, started.revision, { type: 'join' });
  const accepted = await send(fixtureId, two, joined.revision, { type: 'accept' });
  assert.equal(accepted.state.status, 'live');

  const unauth = await send(fixtureId, null, accepted.revision, { type: 'take-over' });
  assert.equal(unauth.status, 401);
  const unrelated = await send(fixtureId, third, accepted.revision, { type: 'take-over' });
  assert.equal(unrelated.status, 422);
  const [visit, take] = await Promise.all([
    send(fixtureId, one, accepted.revision, { type: 'score', score: 60, darts: 3 }),
    send(fixtureId, two, accepted.revision, { type: 'take-over' }),
  ]);
  assert.deepEqual([visit.status, take.status].sort(), [200, 409]);
  const screen = await call(fixtureId);
  assert.equal(screen.revision, accepted.revision + 1);
  assert.deepEqual(screen.state.match.remaining, visit.status === 200 ? [241, 301] : [301, 301]);

  const handover = take.status === 200 ? take : await send(fixtureId, two, screen.revision, { type: 'take-over' });
  assert.equal(handover.state.match.writerId, two.actor.id);
  const oldWriter = await send(fixtureId, one, handover.revision, { type: 'score', score: 60, darts: 3 });
  assert.equal(oldWriter.status, 422);
  const requestId = crypto.randomUUID();
  const score = { type: 'score', score: 60, darts: 3 };
  const recorded = await send(fixtureId, two, handover.revision, score, requestId);
  const retried = await send(fixtureId, two, handover.revision, score, requestId);
  assert.equal(recorded.status, 200);
  assert.equal(retried.status, 200);
  assert.equal(retried.revision, recorded.revision);
  assert.deepEqual(retried.state.match.remaining, recorded.state.match.remaining);
});

test('an online invitation is server-generated and visible only to the host', async () => {
  const { profile, call, send } = clientHarness();
  const one = await profile('Rick');
  const two = await profile('Mike');
  const chosenToken = 'not-the-server-token';
  const started = await send(fixtureId, one, 0, {
    type: 'start', mode: 'remote', inviteToken: chosenToken, ...gameSetup,
  });
  const token = started.state.match.inviteToken;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, chosenToken);
  assert.equal((await call(fixtureId)).state.match.inviteToken, undefined);
  assert.equal((await call(fixtureId, { token: two.token })).state.match.inviteToken, undefined);
  const rejected = await send(fixtureId, two, started.revision, { type: 'join', inviteToken: chosenToken });
  assert.equal(rejected.status, 422);
  const joined = await send(fixtureId, two, started.revision, { type: 'join', inviteToken: token });
  assert.equal(joined.status, 200);
  assert.equal(joined.state.match.players.length, 2);
  assert.equal(joined.state.match.inviteToken, undefined);
  const ready = await send(fixtureId, two, joined.revision, { type: 'accept' });
  const firstScore = await send(fixtureId, one, ready.revision, { type: 'score', score: 180, darts: 3 });
  const handover = await send(fixtureId, two, firstScore.revision, { type: 'take-over' });
  const secondScore = await send(fixtureId, two, handover.revision, { type: 'score', score: 60, darts: 3 });
  assert.equal(secondScore.status, 200);
  for (const token of [undefined, one.token, two.token]) {
    const client = await call(fixtureId, { token });
    assert.deepEqual(client.state.match.remaining, [121, 241]);
    assert.equal(client.state.match.writerId, two.actor.id);
  }
});

test('scheduled results save both player histories atomically after confirmation', async () => {
  const { profile, call, send } = clientHarness();
  const one = await profile('Rick');
  const two = await profile('Mike');
  const started = await send(fixtureId, one, 0, { type: 'prepare', name: 'Dartflow Cup', opponent: 'Mike', ...gameSetup });
  const joined = await send(fixtureId, two, started.revision, { type: 'join', inviteToken: started.state.match.inviteToken });
  const accepted = await send(fixtureId, two, joined.revision, { type: 'accept' });
  const highVisit = await send(fixtureId, one, accepted.revision, { type: 'score', score: 180, darts: 3 });
  const miss = await send(fixtureId, one, highVisit.revision, { type: 'score', score: 0, darts: 3 });
  const finish = { type: 'score', score: 121, darts: 3 };
  const double = await send(fixtureId, one, miss.revision, finish);
  assert.equal(double.needsDouble, true);
  assert.equal(double.revision, miss.revision);
  const final = await send(fixtureId, one, miss.revision, { ...finish, doubleConfirmed: true });
  assert.equal(final.state.status, 'result');
  assert.deepEqual(final.history, []);
  const first = await send(fixtureId, one, final.revision, { type: 'confirm' });
  assert.deepEqual(first.history, []);
  const second = await send(fixtureId, two, first.revision, { type: 'confirm' });
  assert.equal(second.status, 200);
  assert.equal(second.history[0].outcome, 'lost');
  const after = await call(fixtureId, { token: one.token });
  assert.equal(after.history[0].outcome, 'won');
  assert.equal(after.history[0].stats.highestFinish, 121);
  assert.equal(after.history[0].stats.oneEighties, 1);
  assert.deepEqual((await call(fixtureId)).history, []);
  const release = await send(fixtureId, one, after.revision, { type: 'release' });
  assert.equal(release.state.status, 'idle');
  assert.equal(release.history[0].matchId, final.state.match.id);
});
