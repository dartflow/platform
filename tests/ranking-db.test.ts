import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeDatabase, database, executeMatchCommand, getMatch } from '../lib/db';
import { newGame, validateSettings } from '../lib/domain';
import { getRankings } from '../lib/rankings';
import{executeMatchCorrectionCommand}from'../lib/match-corrections';
import type { MatchAction, MatchState, MatchView } from '../lib/types';

try { process.loadEnvFile('.env.local'); } catch { /* CI injects loopback credentials. */ }
const local = (value?: string) => { try { return !!value && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname); } catch { return false; } };
const configured = process.env.DARTFLOW_DATA_MODE === 'local' && local(process.env.DARTFLOW_DATABASE_URL) && local(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('real match transactions require prior separate consent and book both ratings exactly once', { skip: !configured }, async t => {
  const admin = new pg.Client({ connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL });
  await admin.connect();
  const players = [randomUUID(), randomUUID(), randomUUID()], club = randomUUID();
  const events: string[] = [], matches: string[] = [], entities: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  async function fixture(kind: 'lobby' | 'tournament' = 'lobby', companion = false): Promise<MatchView> {
    const event = randomUUID(), id = randomUUID(), entity = randomUUID(), settings = validateSettings({ bestOfLegs: 5 });
    events.push(event); matches.push(id); entities.push(entity);
    await admin.query("insert into dartflow_private.events(id,club_id,name,date,capacity)values($1,$2,'Rating transaction test',current_date,4)", [event, club]);
    await admin.query('insert into dartflow_private.event_staff(event_id,user_id)values($1,$2)', [event, players[0]]);
    await admin.query(`insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state) values($1,$2,$3,'private',$4)`, [entity, kind, players[0], JSON.stringify({ name: 'Ranking source', eventId: event, coreClubId: club, setup: 'localtwo' })]);
    const state: MatchState = { id, eventId: event, clubId: club, boardId: null, revision: 0, status: 'ready', players: players.slice(0, 2).map((player, index) => ({ id: player, name: `Ranking ${index} ${suffix}` })), writerId: players[0], settings, accepted: [true, true], confirmations: [false, false], resultRevision: null, game: newGame(id, players.slice(0, 2), settings), previousSets: [], winnerId: null, resultPublished: false, dispute: null, ...(companion ? { localCompanion: { playerId: players[1], writerId: players[0], lobbyId: entity } } : {}) };
    await admin.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state)values($1,$2,$3,0,$4)', [id, club, event, JSON.stringify(state)]);
    for (const [index, player] of players.slice(0, 2).entries()) await admin.query('insert into dartflow_private.match_players(match_id,user_id,position)values($1,$2,$3)', [id, player, index]);
    await admin.query('insert into dartflow_private.platform_match_links(match_id,entity_id,fixture_id)values($1,$2,$3)', [id, entity, 'free']);
    return getMatch(players[0], id);
  }
  async function act(view: MatchView, actor: string, action: MatchAction): Promise<MatchView> {
    return executeMatchCommand(actor, { matchId: view.id, requestId: randomUUID(), expectedRevision: view.revision, action });
  }
  async function consent(view: MatchView): Promise<MatchView> {
    view = await act(view, players[0], { type: 'ranking-consent', consent: true });
    return act(view, players[1], { type: 'ranking-consent', consent: true });
  }
  async function finish(view: MatchView): Promise<MatchView> {
    let guard = 0;
    while (view.status === 'live') {
      assert.ok(guard++ < 100);
      const score = view.turn === 0 ? Math.min(180, view.remaining[0]) : 0;
      view = await act(view, players[0], { type: 'score', score, darts: 3, doubleConfirmed: score > 0 && score === view.remaining[0] });
    }
    return view;
  }
  try {
    for (const [index, player] of players.entries()) await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,true)', [player, `rating_${suffix}_${index}`, `Ranking ${index} ${suffix}`]);
    await admin.query("insert into dartflow_private.clubs(id,name)values($1,'Rating integration club')", [club]);
    for (const player of players.slice(0, 2)) await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,$3)', [club, player, player === players[0] ? 'organizer' : 'player']);

    await t.test('personal or event sources and automatic companion signatures cannot obtain ranking rights', async () => {
      for (const view of [await fixture('tournament'), await fixture('lobby', true)]) {
        assert.equal(view.rankingEligibility?.eligible, false);
        await assert.rejects(act(view, players[0], { type: 'ranking-consent', consent: true }), { code: 'ranking_ineligible' });
      }
      assert.equal((await admin.query('select count(*)::int n from dartflow_private.ranking_accounts where player_id=any($1::uuid[])', [players])).rows[0].n, 0);
    });

    let first = await fixture();
    await t.test('commands retain revision/idempotency and neither organizer nor a player can sign for an opponent', async () => {
      assert.equal(first.rankingEligibility?.eligible, true);
      await assert.rejects(act(first, players[2], { type: 'ranking-consent', consent: true }), { code: 'forbidden' });
      const command = { matchId: first.id, requestId: randomUUID(), expectedRevision: first.revision, action: { type: 'ranking-consent' as const, consent: true } };
      first = await executeMatchCommand(players[0], command);
      assert.deepEqual(await executeMatchCommand(players[0], command), first);
      assert.deepEqual(first.ranking?.consents, [true, false]);
      await assert.rejects(executeMatchCommand(players[0], { ...command, action: { type: 'ranking-consent', consent: false } }), { code: 'request_reused' });
      first = await act(first, players[1], { type: 'ranking-consent', consent: true });
      first = await act(first, players[0], { type: 'start' });
      assert.equal(first.ranking?.status, 'reserved');
      await assert.rejects(act(first, players[1], { type: 'ranking-consent', consent: false }), { code: 'ranking_locked' });
      assert.equal((await admin.query('select 1 from dartflow_private.ranking_bookings where match_id=$1', [first.id])).rowCount, 0);
    });

    await t.test('a played, mutually confirmed result updates both players and one durable source atomically', async () => {
      first = await finish(first);
      first = await act(first, players[0], { type: 'dispute', reason: 'Controleer de beslissende dubbel.' });
      await assert.rejects(act(first, players[0], { type: 'resolve', reason: 'Eigen uitslag goedkeuren', decision: 'accept' }), { code: 'ranking_independent_review_required' });
      await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'organizer')", [club, players[2]]);
      await admin.query('insert into dartflow_private.event_staff(event_id,user_id)values($1,$2)', [first.eventId, players[2]]);
      first = await act(first, players[2], { type: 'resolve', reason: 'Onafhankelijke scorekaartcontrole', decision: 'accept' });
      first = await act(first, players[0], { type: 'confirm' });
      assert.equal((await getRankings(players[0])).me?.played, 0);
      const command = { matchId: first.id, requestId: randomUUID(), expectedRevision: first.revision, action: { type: 'confirm' as const } };
      const results = await Promise.all([executeMatchCommand(players[1], command), executeMatchCommand(players[1], command)]);
      assert.deepEqual(results[0], results[1]);
      first = results[0];
      assert.equal(first.ranking?.status, 'booked');
      assert.deepEqual(first.ranking?.booking?.before, [1500, 1500]);
      assert.deepEqual(first.ranking?.booking?.after, [1516, 1484]);
      first = await act(first, players[0], { type: 'recover' });
      const mine = await getRankings(players[0]), other = await getRankings(players[1]);
      assert.equal(mine.me?.rating, 1516); assert.equal(other.me?.rating, 1484);
      assert.equal(mine.me?.played, 1); assert.equal(other.me?.played, 1);
      assert.equal(mine.me?.uniqueOpponents, 1); assert.equal(mine.me?.position, null);
      assert.equal(mine.history[0].delta, 16); assert.equal(mine.history[0].matchId, first.id);
      assert.equal((await admin.query('select count(*)::int n from dartflow_private.ranking_bookings where match_id=$1', [first.id])).rows[0].n, 1);
      await assert.rejects(database().query('update dartflow_private.ranking_bookings set result_revision=99 where match_id=$1', [first.id]), { code: '42501' });
      await assert.rejects(act(first, players[0], { type: 'undo' }), { status: 403 });
    });

    await t.test('reviewed free result correction reuses the original reservation and immutable booking receipt',async()=>{
      const reservation=(await admin.query('select reserved_at,first_throw_at,declaration_revision from dartflow_private.ranking_reservations where match_id=$1',[first.id])).rows[0],originalRevision=first.resultRevision;
      const request=await executeMatchCorrectionCommand(players[1],{requestId:randomUUID(),action:{type:'correction.request',matchId:first.id,expectedRevision:first.revision,undoCount:1,reason:'De laatste werkelijke finishbeurt moet opnieuw ingevoerd worden.'}});
      await executeMatchCorrectionCommand(first.players.find(p=>p.id!==players[1])!.id,{requestId:randomUUID(),action:{type:'correction.respond',correctionId:request.id,reason:'Tegenpartij is gehoord over de aangeduide worp.'}});
      await executeMatchCorrectionCommand(players[2],{requestId:randomUUID(),action:{type:'correction.decide',correctionId:request.id,decision:'approve',reason:'Onafhankelijke controle van de werkelijk gegooide laatste beurt.'}});
      assert.equal((await getRankings(players[0])).me?.played,0);first=await finish(await getMatch(players[0],first.id));first=await act(first,players[0],{type:'confirm'});first=await act(first,players[1],{type:'confirm'});
      assert.notEqual(first.resultRevision,originalRevision);assert.equal((await getRankings(players[0])).me?.rating,1516);assert.equal((await getRankings(players[0])).me?.played,1);
      assert.deepEqual((await admin.query('select reserved_at,first_throw_at,declaration_revision from dartflow_private.ranking_reservations where match_id=$1',[first.id])).rows[0],reservation);
      assert.equal((await admin.query('select 1 from dartflow_private.ranking_bookings where match_id=$1',[first.id])).rowCount,1);assert.equal((await admin.query('select 1 from dartflow_private.match_result_versions where match_id=$1',[first.id])).rowCount,2);
      await assert.rejects(database().query("update dartflow_private.match_correction_decisions set reason='forged' where request_id=$1",[request.id]),{code:'42501'});
    });

    await t.test('a canceled untouched reservation is refunded but a first throw stays consumed after undo', async () => {
      let canceled = await consent(await fixture());
      canceled = await act(canceled, players[0], { type: 'start' });
      await admin.query("update dartflow_private.matches set state=jsonb_set(state,'{status}','\"abandoned\"') where id=$1", [canceled.id]);
      let played = await consent(await fixture());
      played = await act(played, players[0], { type: 'start' });
      played = await act(played, players[0], { type: 'score', score: 0 });
      played = await act(played, players[0], { type: 'undo' });
      assert.equal(played.visits.length, 0);
      await admin.query("update dartflow_private.matches set state=jsonb_set(state,'{status}','\"abandoned\"') where id=$1", [played.id]);
      const denied = await consent(await fixture());
      await assert.rejects(act(denied, players[0], { type: 'start' }), { code: 'ranking_rematch_limit' });
      const free = await act(denied, players[0], { type: 'ranking-consent', consent: false });
      assert.equal((await act(free, players[0], { type: 'start' })).status, 'live');
      assert.equal((await getRankings(players[0])).me?.played, 1);
    });

    await t.test('concurrent starts across events cannot exceed the pair window', async () => {
      await admin.query("update dartflow_private.ranking_reservations set reserved_at=clock_timestamp()-interval '8 days' where match_id=any($1::uuid[])", [matches]);
      let one = await consent(await fixture());
      one = await act(one, players[0], { type: 'start' });
      assert.equal(one.ranking?.status,'reserved');
      const two = await consent(await fixture()), three = await consent(await fixture());
      const attempts = await Promise.allSettled([act(two, players[0], { type: 'start' }), act(three, players[0], { type: 'start' })]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = attempts.find(result => result.status === 'rejected');
      assert.equal(rejected?.status === 'rejected' ? rejected.reason.code : undefined, 'ranking_rematch_limit');
    });

    await t.test('new private storage denies Data API roles and ledger mutation', async () => {
      const relations = (await admin.query("select relname,relrowsecurity from pg_class where relnamespace='dartflow_private'::regnamespace and relname=any($1::text[])", [['ranking_policies', 'ranking_accounts', 'ranking_bookings', 'ranking_opponents', 'ranking_reservations']])).rows;
      assert.equal(relations.length, 5); assert.ok(relations.every(row => row.relrowsecurity));
      const permissions = await admin.query("select has_table_privilege('dartflow_app','dartflow_private.ranking_bookings','update') as update,has_table_privilege('dartflow_app','dartflow_private.ranking_bookings','delete') as delete");
      assert.deepEqual(permissions.rows[0], { update: false, delete: false });
    });
    await t.test('status filters are applied before the Top 50 window and preserve global sporting rank',async()=>{
      for(let index=0;index<56;index++){
        const id=randomUUID();players.push(id);
        await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed)values($1,$2,true)',[id,`rank_page_${suffix}_${index}`]);
        await admin.query("insert into dartflow_private.ranking_generation_accounts(generation_id,player_id,rating,played,unique_opponents,last_played_at)select active_generation,$1,1700,10,5,clock_timestamp()-make_interval(days=>$2::integer)from dartflow_private.ranking_lists where id='10000000-0000-4000-8000-000000000001'",[id,index===55?91:1]);
      }
      assert.equal((await getRankings(players[0])).rows.some(row=>row.playerId===players[0]),false);
      const provisional=await getRankings(players[0],{status:'provisional'});
      assert.equal(provisional.rows.some(row=>row.playerId===players[0]),true);
      assert.ok(provisional.rows.every(row=>row.provisional));
      const inactive=await getRankings(players[0],{status:'inactive'});
      assert.equal(inactive.rows.some(row=>row.playerId===players.at(-1)),true);
      const active=await getRankings(players[0],{status:'active'});
      assert.equal(active.rows.length,50);
      assert.ok(active.rows.every(row=>row.active&&!row.provisional&&row.position===1));
    });
  } finally {
    try {
      await admin.query('delete from dartflow_private.ranking_opponents where player_id=any($1::uuid[]) or opponent_id=any($1::uuid[])', [players]);
      await admin.query('delete from dartflow_private.ranking_accounts where player_id=any($1::uuid[])', [players]);
      await admin.query('delete from dartflow_private.feed_items where author_id=any($1::uuid[])', [players]);
      for (const table of ['mail_outbox', 'mail_events']) await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`, [players.map(id => `user:${id}`)]);
      for (const table of ['player_match_kickoffs', 'match_results', 'match_confirmations', 'action_receipts', 'visits', 'match_players', 'platform_match_links']) await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`, [matches]);
      await admin.query('delete from dartflow_private.audit_events where event_id=any($1::uuid[])', [events]);
      await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])', [matches]);
      await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])', [entities]);
      await admin.query('delete from dartflow_private.event_staff where event_id=any($1::uuid[])', [events]);
      await admin.query('delete from dartflow_private.events where id=any($1::uuid[])', [events]);
      await admin.query('delete from dartflow_private.club_memberships where club_id=$1', [club]);
      await admin.query('delete from dartflow_private.clubs where id=$1', [club]);
      await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])', [players]);
    } finally { await admin.end(); await closeDatabase(); }
  }
});
