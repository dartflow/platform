import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { checkDatabaseReady, closeDatabase, consumeRateLimit, createScreen, executeEventCommand, executeMatchCommand, getMatch, getOverview, getPublicSnapshot, revokeScreen } from '../lib/db';
import type { MatchAction } from '../lib/types';
try { process.loadEnvFile('.env.local'); } catch { /* CI injects the connection strings. */ }
const isLoopback = (value: string | undefined) => { try { return Boolean(value && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)); } catch { return false; } };
// Integration fixtures are never created against hosted staging or production.
const configured = process.env.DARTFLOW_DATA_MODE === 'local' && isLoopback(process.env.DARTFLOW_DATABASE_ADMIN_URL) && isLoopback(process.env.DARTFLOW_DATABASE_URL);
test('Postgres transactions enforce scopes, retry identity, exclusive assignments, writer ownership and one result', { skip: !configured }, async t => {
  const owner = new pg.Client({ connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL });
  await owner.connect();
  const organizer = randomUUID(), p1 = randomUUID(), p2 = randomUUID(), outsider = randomUUID(), club = randomUUID(), otherClub = randomUUID(), event = randomUUID(), board = randomUUID(), board2 = randomUUID();
  const people = [organizer, p1, p2, outsider];
  try {
    for (const [i, id] of people.entries()) await owner.query('insert into dartflow_private.profiles(id,name,display_name) values($1,$2,$3)', [id, `integration${id.slice(0,8)}`, `Integration ${i}`]);
    for (const id of [club, otherClub]) await owner.query('insert into dartflow_private.clubs(id,name) values($1,$2)', [id, `Test ${id}`]);
    for (const id of [organizer, p1, p2]) await owner.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)', [club, id, id === organizer ? 'organizer' : 'player']);
    await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player')", [otherClub, outsider]);
    await owner.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,2)', [event, club, 'Integration evening']);
    await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)', [event, organizer]);
    for (const id of [board, board2]) await owner.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)', [id, event, 'Test board']);
    await executeEventCommand(p1, event, { type: 'register' }); await executeEventCommand(p2, event, { type: 'register' });
    await executeEventCommand(organizer, event, { type: 'register' });
    let overview = await getOverview(organizer, club);
    assert.equal(overview.participants.find(p => p.playerId === organizer)?.status, 'waitlisted');
    await executeEventCommand(p1, event, { type: 'check-in' }); await executeEventCommand(p2, event, { type: 'check-in' });
    const planned = await executeEventCommand(organizer, event, { type: 'plan', playerIds: [p1, p2], settings: { startScore: 301, bestOfLegs: 1 } });
    const id = planned.matchId!;
    let state = await getMatch(p1, id);
    const action = async (actor: string, value: MatchAction) => { state = await executeMatchCommand(actor, { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action: value }); return state; };
    await t.test('other club and organizer privileges cannot be forged', async () => {
      await assert.rejects(getOverview(outsider, club), { status: 403 });
      await assert.rejects(getMatch(outsider, id), { status: 403 });
      await assert.rejects(executeMatchCommand(p1, { requestId: randomUUID(), matchId: id, expectedRevision: 0, action: { type: 'call', boardId: board } }), { status: 403 });
      await assert.rejects(executeEventCommand(outsider, event, { type: 'register' }), { status: 403 });
      await assert.rejects(executeEventCommand(p1, event, { type: 'check-in', playerId: p2 }), { status: 403 });
    });
    await t.test('competing matches on different boards serialize shared-player assignment', async () => {
      const competitor = await executeEventCommand(organizer, event, { type: 'plan', playerIds: [p1, p2] });
      const attempts = await Promise.allSettled([
        executeMatchCommand(organizer, { requestId: randomUUID(), matchId: id, expectedRevision: 0, action: { type: 'call', boardId: board } }),
        executeMatchCommand(organizer, { requestId: randomUUID(), matchId: competitor.matchId!, expectedRevision: 0, action: { type: 'call', boardId: board2 } }),
      ]);
      assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(a => a.status === 'rejected').length, 1);
      const rejected = attempts.find(a => a.status === 'rejected');
      assert.equal(rejected?.status === 'rejected' ? rejected.reason.code : undefined, 'players_busy');
      // Reset the synthetic fixture only; normal application mutations cannot replace state.
      await owner.query(`update dartflow_private.matches set board_id=null,state=jsonb_set(jsonb_set(state,'{boardId}','null'),'{status}','"planned"') where id=any($1::uuid[])`, [[id, competitor.matchId!]]);
      state = await getMatch(p1, id);
    });
    await action(organizer, { type: 'call', boardId: board });
    await t.test('same players cannot be called concurrently on a second board', async () => {
      const second = await executeEventCommand(organizer, event, { type: 'plan', playerIds: [p1, p2] });
      await assert.rejects(executeMatchCommand(organizer, { requestId: randomUUID(), matchId: second.matchId!, expectedRevision: 0, action: { type: 'call', boardId: board2 } }), { code: 'players_busy' });
      await assert.rejects(executeEventCommand(p1, event, { type: 'withdraw' }), { code: 'active_match' });
    });
    await action(p1, { type: 'accept' }); await action(p2, { type: 'accept' }); await action(p1, { type: 'start' });
    await t.test('parallel retry applies one visit and another write gets a revision conflict', async () => {
      const request = { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action: { type: 'score' as const, score: 180 } };
      const competingRequest = { ...request, requestId: randomUUID() };
      const concurrent = await Promise.allSettled([executeMatchCommand(p1, request), executeMatchCommand(p1, request), executeMatchCommand(p1, competingRequest)]);
      // Pool acquisition order is intentionally irrelevant: either request may win.
      const successes = concurrent.filter(r => r.status === 'fulfilled');
      assert.ok(successes.length === 1 || successes.length === 2);
      assert.ok(concurrent.some(r => r.status === 'rejected'));
      const first = successes[0];
      assert.ok(first && first.status === 'fulfilled');
      state = first.value;
      const winningRequest = concurrent[0].status === 'fulfilled' ? request : competingRequest;
      assert.equal(state.visits.length, 1); assert.equal(state.remaining[0], 121);
      for (const success of successes) assert.deepEqual(success.value, first.value);
      const retry = await executeMatchCommand(p1, winningRequest); assert.deepEqual(retry, first.value);
      await assert.rejects(executeMatchCommand(p1, { ...winningRequest, expectedRevision: request.expectedRevision + 1 }), { code: 'request_reused' });
      await assert.rejects(executeMatchCommand(p1, { ...winningRequest, action: { type: 'score', score: 60 } }), { code: 'request_reused' });
      assert.equal((await owner.query('select count(*)::int as n from dartflow_private.visits where match_id=$1', [id])).rows[0].n, 1);
    });
    await t.test('takeover invalidates old writer even with the current revision', async () => {
      await action(p2, { type: 'take-over' });
      await assert.rejects(executeMatchCommand(p1, { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action: { type: 'score', score: 0 } }), { code: 'not_writer' });
      await action(p2, { type: 'score', score: 0 });
      await action(p2, { type: 'score', score: 121, darts: 3, doubleConfirmed: true });
      assert.equal(state.status, 'result');
    });
    await t.test('dispute blocks publication and recovery is audited', async () => {
      await action(p1, { type: 'dispute', reason: 'Dubbel betwist' });
      await assert.rejects(executeMatchCommand(p2, { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action: { type: 'confirm' } }), { code: 'invalid_action' });
      await action(organizer, { type: 'resolve', decision: 'accept', reason: 'Scorekaart gecontroleerd' });
      const audit = await owner.query("select detail from dartflow_private.audit_events where match_id=$1 and action='resolve'", [id]);
      assert.equal(audit.rowCount, 1); assert.equal(audit.rows[0].detail.action.reason, 'Scorekaart gecontroleerd');
    });
    await t.test('two confirmations publish history and standings once, including retry and recovery', async () => {
      await action(p1, { type: 'confirm' }); assert.equal(state.resultPublished, false);
      assert.equal((await owner.query('select 1 from dartflow_private.match_results where match_id=$1', [id])).rowCount, 0);
      const request = { requestId: randomUUID(), matchId: id, expectedRevision: state.revision, action: { type: 'confirm' as const } };
      state = await executeMatchCommand(p2, request); await executeMatchCommand(p2, request); await action(organizer, { type: 'recover' });
      assert.equal(state.resultPublished, true);
      assert.equal((await owner.query('select 1 from dartflow_private.match_results where match_id=$1', [id])).rowCount, 1);
      overview = await getOverview(p1, club); assert.equal(overview.history.length, 1); assert.equal(overview.standings.find(s => s.playerId === p1)?.played, 1); assert.equal(overview.standings.find(s => s.playerId === p1)?.points, 3);
    });
    await t.test('screen capabilities contain a narrow projection and can be revoked', async () => {
      const screen = await createScreen(organizer, event, board);
      const snapshot = await getPublicSnapshot(screen.token);
      assert.equal(snapshot.match?.id, id); assert.equal(snapshot.match?.players[0].id, 'player-1');
      assert.match(snapshot.match!.writerId,/^(?:player-[12]|writer-external)$/); assert.equal('permissions' in snapshot.match!, false);
      for(const authId of [organizer,p1,p2])assert.equal(JSON.stringify(snapshot).includes(authId),false);
      await assert.rejects(createScreen(p1, event, board), { status: 403 });
      await assert.rejects(revokeScreen(p1, screen.id), { status: 403 });
      await revokeScreen(organizer, screen.id); await assert.rejects(getPublicSnapshot(screen.token), { status: 404 });
    });
    await action(organizer, { type: 'release' });
    await t.test('waitlist promotes once when a place becomes free', async () => {
      await executeEventCommand(p1, event, { type: 'withdraw' }); await executeEventCommand(p1, event, { type: 'withdraw' });
      overview = await getOverview(organizer, club); assert.equal(overview.participants.find(p => p.playerId === organizer)?.status, 'registered');
    });
    await t.test('database health and rate limits work across concurrent callers', async () => {
      assert.deepEqual(await checkDatabaseReady(), { ready: true, schemaVersion: 1 });
      const key = `integration:${randomUUID()}`;
      const limits = await Promise.all(Array.from({ length: 10 }, () => consumeRateLimit(key, 3, 60)));
      assert.equal(limits.filter(r => r.allowed).length, 3); assert.ok(limits.filter(r => !r.allowed).every(r => r.retryAfter > 0));
      await owner.query('delete from dartflow_private.auth_limits where key=$1', [key]);
      const grants = await owner.query("select has_table_privilege('dartflow_app','dartflow_private.match_results','UPDATE') as update_results,has_table_privilege('dartflow_app','dartflow_private.audit_events','DELETE') as delete_audit");
      assert.equal(grants.rows[0].update_results, false); assert.equal(grants.rows[0].delete_audit, false);
    });
  } finally {
    await owner.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]))',[people]);
    await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);
    await owner.query('delete from dartflow_private.mail_events where actor_id=any($1::uuid[]) or recipient_key=any($2::text[])',[people,people.map(id=>`user:${id}`)]);
    for (const table of ['action_receipts','match_confirmations','visits']) await owner.query(`delete from dartflow_private.${table} where match_id in (select id from dartflow_private.matches where event_id=$1)`, [event]);
    for (const table of ['match_results','standings','audit_events','screen_capabilities']) await owner.query(`delete from dartflow_private.${table} where event_id=$1`, [event]);
    await owner.query('delete from dartflow_private.match_players where match_id in (select id from dartflow_private.matches where event_id=$1)', [event]);
    for (const table of ['matches','entries','boards','event_staff']) await owner.query(`delete from dartflow_private.${table} where event_id=$1`, [event]);
    await owner.query('delete from dartflow_private.events where id=$1', [event]);
    await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])', [[club, otherClub]]);
    await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])', [[club, otherClub]]);
    await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])', [people]);
    await owner.end(); await closeDatabase();
  }
});
