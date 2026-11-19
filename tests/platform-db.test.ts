import {readPublicPrecall} from '../lib/competition-precalls';
import {beginFixtureCleanup} from './helpers/cleanup-v17';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeDatabase, database, executeMatchCommand, getBoardForActor, getMatch, getPublicSnapshot } from '../lib/db';
import { executePlatformCommand, getPlatformTraining, getMatchSignals, getPlatformCast, getPlatformMessages, getPlatformOverview, reconcilePlatformCalls, reconcilePlatformResults, replayMatchCommands, exportPlatformCsv, sendMatchChat, getMatchChat, sendMatchSignal } from '../lib/platform';
import {mediaConfiguration}from'../lib/media';
import {getEventBoards} from '../lib/event-boards';
import {getPlayerStatistics} from '../lib/player-statistics-db';
import type { MatchAction,MatchState } from '../lib/types';
import type { PlatformCommand } from '../lib/platform-types';
try { process.loadEnvFile('.env.local'); } catch { /* CI provides loopback credentials. */ }
const local = (v: string | undefined) => { try { return Boolean(v && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(v).hostname)); } catch { return false; } };
const configured = process.env.DARTFLOW_DATA_MODE === 'local' && local(process.env.DARTFLOW_DATABASE_ADMIN_URL) && local(process.env.DARTFLOW_DATABASE_URL);

test('v15 Postgres platform has real persistence, private scopes, capacity serialization and one score source', { skip: !configured }, async t => {
  const owner = new pg.Client({ connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL }); await owner.connect();
  const admin = randomUUID(), alice = randomUUID(), bob = randomUUID(), carol = randomUUID(), outsider = randomUUID(), people = [admin, alice, bob, carol, outsider];
  const run = (actor: string, action: PlatformCommand['action'], expectedRevision?: number, requestId = randomUUID()) => executePlatformCommand(actor, { requestId, action, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  try {
    for (const [i, id] of people.entries()) await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)', [id, `Platform fixture ${i}`]);
    for(const id of people)await owner.query("insert into dartflow_private.player_safety_acceptances(user_id,version,age_confirmed) values($1,'2026-11-18',true)",[id]);
    await owner.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'owner')", [admin]);
    const club = (await run(admin, { type: 'club.create', name: 'Platform fixture club', capacity: 8 })).id!;
    const second = (await run(outsider, { type: 'club.create', name: 'Platform fixture second', capacity: 8 })).id!;
    for (const user of [alice, bob, carol]) { await run(user, { type: 'club.request', id: club }); await run(admin, { type: 'club.approve', id: club, userId: user }); }
    await run(alice, { type: 'club.request', id: second }); await run(outsider, { type: 'club.approve', id: second, userId: alice });
    await t.test('physical board sessions serialize claims, publish solo Sprint and never survive scope or lease loss',async()=>{
      const event=await run(admin,{type:'tournament.create',name:'Platform fixture free boards',clubId:club,format:'knockout',boards:1,requireWriter:false});
      const board=String((await owner.query('select id from dartflow_private.boards where event_id=$1',[event.entity!.state.eventId])).rows[0].id);
      const race=await Promise.allSettled([run(alice,{type:'board.start',boardId:board,mode:'solo'}),run(bob,{type:'board.start',boardId:board,mode:'solo'})]);
      assert.equal(race.filter(r=>r.status==='fulfilled').length,1);const first=race[0].status==='fulfilled'?race[0].value:(race[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value,player=race[0].status==='fulfilled'?alice:bob,other=player===alice?bob:alice;
      assert.equal(first.kind,'training');assert.equal((await getBoardForActor(player,board)).practiceId,first.id);assert.equal((await getBoardForActor(other,board)).practiceId,undefined);assert.equal((await getBoardForActor(other,board)).canStart,false);
      const targeted=await getPlatformTraining(player,first.id!);assert.equal(targeted.entity.boardActivity?.sourceId,first.id);assert.equal(targeted.entity.boardActivity?.deadlineAt,first.entity!.state.boardLeaseUntil);assert.equal(targeted.entity.boardActivity?.extensionsUsed,0);assert.equal(targeted.entity.revision,first.entity!.revision);await assert.rejects(getPlatformTraining(other,first.id!),{status:403});
      const token=String(first.screenUrl).split('/').at(-1)!;assert.equal(token.length,64);assert.equal((await getPublicSnapshot(token)).match?.players.length,1);
      const scored=await run(player,{type:'training.score',id:first.id,score:180},first.entity!.revision);assert.equal((await getPublicSnapshot(token)).match?.remaining[0],321);
      const screenRequest=randomUUID();await run(player,{type:'board.screen',boardId:board},undefined,screenRequest);await owner.query('delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,player]);await assert.rejects(getPublicSnapshot(token),{status:404});await assert.rejects(run(player,{type:'board.screen',boardId:board},undefined,screenRequest),{status:403});
      await assert.rejects(run(player,{type:'training.score',id:first.id,score:60},scored.entity!.revision),{status:403});await assert.rejects(run(player,{type:'training.undo',id:first.id},scored.entity!.revision),{status:403});await assert.rejects(run(player,{type:'board.screen',boardId:board}),{status:403});
      await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player')",[club,player]);
      // Hold the authoritative event lock past expiry: a blocked renewal cannot resurrect an expired lease.
      const lock=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await lock.connect();await lock.query('begin');await lock.query('select id from dartflow_private.events where id=$1 for update',[event.entity!.state.eventId]);
      await owner.query("update dartflow_private.board_activity_sessions set activity_at=to_timestamp(($2::double precision-180000)/1000),deadline_at=to_timestamp($2::double precision/1000) where source_id=$1 and status='active'",[first.id,Date.now()+120]);
      const renewal=run(player,{type:'training.score',id:first.id,score:60},scored.entity!.revision),newClaim=run(other,{type:'board.start',boardId:board,mode:'solo'}),settled=Promise.allSettled([renewal,newClaim]);await new Promise(resolve=>setTimeout(resolve,160));await lock.query('commit');await lock.end();
      const outcomes=await settled;assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');const next=(outcomes[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value;
      await assert.rejects(getPublicSnapshot(token),{status:404});await assert.rejects(run(player,{type:'training.undo',id:first.id},scored.entity!.revision),{code:'board_session_expired'});
      await assert.rejects(run(player,{type:'training.finish',id:first.id},scored.entity!.revision),{code:'board_session_expired'});assert.equal((await getBoardForActor(other,board)).practiceId,next.id);
      await run(other,{type:'training.finish',id:next.id},next.entity!.revision);assert.equal((await getBoardForActor(alice,board)).canStart,true);
      await owner.query('begin');await owner.query('select id from dartflow_private.events where id=$1 for update',[event.entity!.state.eventId]);
      const queuedStart=Promise.allSettled([run(alice,{type:'board.start',boardId:board,mode:'solo'})]);await new Promise(resolve=>setTimeout(resolve,30));await owner.query('delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,alice]);await owner.query('commit');const denied=(await queuedStart)[0];assert.equal(denied.status,'rejected');assert.equal(denied.status==='rejected'?denied.reason.status:null,403);await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player')",[club,alice]);
      const local=await run(alice,{type:'board.start',boardId:board,mode:'local',startScore:301,bestOfLegs:1});assert.equal((await getBoardForActor(alice,board)).ownLobbyId,local.id);assert.equal((await getBoardForActor(bob,board)).pendingLobbyId,local.id);
      await assert.rejects(run(outsider,{type:'lobby.join',id:local.id,boardId:board}),{status:403});await run(bob,{type:'lobby.join',id:local.id,boardId:board});await run(alice,{type:'lobby.ready',id:local.id});await run(bob,{type:'lobby.ready',id:local.id});
      const started=await run(alice,{type:'lobby.start',id:local.id});let match=await getMatch(alice,started.matchId!);assert.equal(match.boardId,board);assert.equal(match.status,'called');
      const send=async(actor:string,action:MatchAction)=>{match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});};await send(alice,{type:'accept'});await send(bob,{type:'accept'});await send(bob,{type:'start'});await send(alice,{type:'score',score:180});await send(alice,{type:'score',score:0});await send(alice,{type:'score',score:121,doubleConfirmed:true});await send(alice,{type:'confirm'});await send(bob,{type:'confirm'});await reconcilePlatformResults();assert.equal((await getBoardForActor(alice,board)).canStart,true);await assert.rejects(getPublicSnapshot(String(local.screenUrl).split('/').at(-1)!),{status:404});
      const remote=await run(alice,{type:'board.start',boardId:board,mode:'remote'});await assert.rejects(run(bob,{type:'lobby.join',id:remote.id,boardId:board}),{code:'invite_required'});await owner.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{boardLeaseUntil}','0') where id=$1",[remote.id]);const replacement=await run(bob,{type:'board.start',boardId:board,mode:'solo'});await assert.rejects(run(alice,{type:'lobby.ready',id:remote.id}),{code:'board_session_expired'});await assert.rejects(run(bob,{type:'lobby.join',id:remote.id,code:remote.code}),{code:'board_session_expired'});await run(bob,{type:'training.finish',id:replacement.id},replacement.entity!.revision);
    });
    await t.test('personal organizers need no club and keep private invitations, ownership and official destinations enforced',async()=>{
      const requestId=randomUUID(),action={type:'tournament.create',ownership:'personal',name:'Platform fixture personal',format:'knockout',capacity:4,boards:2,requireWriter:false};
      const made=await run(outsider,action,undefined,requestId),again=await run(outsider,action,undefined,requestId);
      assert.equal(made.id,again.id);assert.equal(made.entity!.clubId,null);assert.equal(made.entity!.state.ownership,'personal');assert.equal(made.entity!.visibility,'private');assert.deepEqual(made.entity!.state.rankingDestinations,[]);
      assert.equal((await getPlatformOverview(outsider)).tournaments.find(e=>e.id===made.id)?.canManage,true);
      assert.equal((await getPlatformOverview(bob)).tournaments.some(e=>e.id===made.id),false);
      await run(outsider,{type:'competition.settings',id:made.id,eligibility:'code'});
      await run(outsider,{type:'competition.settings',id:made.id,eligibility:'all'});
      assert.equal((await getPlatformOverview(outsider)).tournaments.find(e=>e.id===made.id)?.visibility,'private');
      assert.equal((await getPlatformOverview(bob)).tournaments.some(e=>e.id===made.id),false);
      assert.equal((await getEventBoards(outsider,made.entity!.state.eventId!)).boards.length,2);
      await assert.rejects(getEventBoards(bob,made.entity!.state.eventId!),{status:403});
      await assert.rejects(run(bob,{type:'competition.register',id:made.id}),{code:'invite_required'});
      await assert.rejects(run(outsider,{...action,ownership:'platform'}),{status:403});
      await assert.rejects(run(outsider,{...action,ownership:'club',clubId:club}),{status:403});
      await assert.rejects(run(outsider,{...action,clubId:club}),{code:'invalid_ownership'});
      await assert.rejects(run(outsider,{...action,rankingDestinations:['national-rating']}),{code:'ranking_not_authorized'});
      await assert.rejects(run(outsider,{type:'competition.settings',id:made.id,ownership:'club',clubId:club}),{code:'ownership_locked'});
      await assert.rejects(run(alice,{type:'competition.plan',id:made.id}),{status:403});
      for(const actor of [outsider,bob]){await run(actor,{type:'competition.register',id:made.id,code:made.code});await run(actor,{type:'competition.checkin',id:made.id});}
      await run(outsider,{type:'competition.plan',id:made.id});
      const planned=(await getPlatformOverview(outsider)).tournaments.find(e=>e.id===made.id)!;
      assert.equal(planned.state.fixtures?.length,1);assert.deepEqual(planned.state.rankingDestinations,[]);
      await assert.rejects(getEventBoards(bob,made.entity!.state.eventId!),{status:403});
    });
    await t.test('nonstandard rules use the same persisted native/web match actions and distinct statistics',async()=>{
      const made=await run(alice,{type:'lobby.create',name:'Platform fixture double in master handicap',setup:'remote',startScore:301,bestOfLegs:1,inRule:'double',outRule:'master',sideStartScores:[60,101]});
      await run(bob,{type:'lobby.join',id:made.id,code:made.code});await run(alice,{type:'lobby.ready',id:made.id});await run(bob,{type:'lobby.ready',id:made.id});
      const started=await run(alice,{type:'lobby.start',id:made.id});let match=await getMatch(alice,started.matchId!);
      const send=async(actor:string,action:MatchAction)=>{match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});};
      await send(alice,{type:'accept'});await send(bob,{type:'accept'});await send(alice,{type:'start'});
      await assert.rejects(send(alice,{type:'score',score:40,darts:1}),{code:'dart_detail_required'});
      await send(alice,{type:'score',score:40,darts:1,dartHits:['D20']});assert.deepEqual(match.remaining,[20,101]);
      await send(bob,{type:'score',score:0,darts:1,dartHits:['MISS']});await send(alice,{type:'score',score:20,darts:1,dartHits:['D10']});
      assert.equal(match.status,'result');assert.equal(match.rankingEligibility?.eligible,false);await send(alice,{type:'confirm'});await send(bob,{type:'confirm'});
      const ordinary=await getPlayerStatistics(alice,{startScore:301}),special=await getPlayerStatistics(alice,{startScore:301,outRule:'master-out',inRule:'double',handicap:true});
      assert.equal(ordinary.matches.some(row=>row.id===match.id),false);assert.equal(special.matches.filter(row=>row.id===match.id).length,1);assert.equal(special.matches.find(row=>row.id===match.id)?.outRule,'master-out');
    });
    await t.test('Swiss and both double-elimination variants finish real persisted matches through the existing command service',async()=>{
      for(const format of ['swiss','double-elimination-reset','double-elimination-single']){
        const created=await run(admin,{type:'tournament.create',ownership:'personal',name:`Platform fixture ${format}`,format,startScore:301,bestOfLegs:1,capacity:4,boards:1,requireWriter:false,swissRounds:2});
        const players=[alice,bob,carol,outsider];for(const actor of players){await run(actor,{type:'competition.register',id:created.id,code:created.code});await run(actor,{type:'competition.checkin',id:created.id});}
        await run(admin,{type:'competition.settings',id:created.id,restSeconds:0,cooldownSeconds:0});await run(admin,{type:'competition.plan',id:created.id});
        let completed=false,resetPlayed=false;
        for(let guard=0;guard<40;guard++){
          const event=(await getPlatformOverview(admin)).tournaments.find(row=>row.id===created.id)!;
          if(event.state.completed){completed=true;assert.equal((event.state.placings as unknown[]).length,4);break;}
          const fixture=event.state.fixtures!.find(f=>f.status==='scheduled'&&f.players.every(Boolean));
          if(!fixture){assert.equal(format,'swiss');await run(admin,{type:'competition.next-round',id:event.id},event.revision);continue;}
          const started=await run(fixture.players[0]!,{type:'fixture.start',id:event.id,fixtureId:fixture.id});let match=await getMatch(fixture.players[0]!,started.matchId!);
          const send=async(actor:string,action:MatchAction)=>{match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});};
          const a=match.players[0].id,b=match.players[1].id;await send(a,{type:'accept'});await send(b,{type:'accept'});await send(a,{type:'start'});
          const secondWins=fixture.phase==='final'&&format==='double-elimination-reset';
          if(secondWins)await send(a,{type:'score',score:0});await send(a,{type:'score',score:180});await send(a,{type:'score',score:0});await send(a,{type:'score',score:121,doubleConfirmed:true});
          await send(a,{type:'confirm'});await send(b,{type:'confirm'});resetPlayed||=fixture.phase==='reset';
        }
        assert.equal(completed,true,`${format} must complete within its finite graph`);if(format==='double-elimination-reset')assert.equal(resetPlayed,true);
      }
    });
    await t.test('a match-point precall is a revocable expectation and never replaces the active board assignment',async()=>{
      const created=await run(admin,{type:'tournament.create',ownership:'personal',name:'Platform fixture precall',format:'knockout',capacity:4,boards:1,requireWriter:false,startScore:301,bestOfLegs:1});
      for(const actor of [alice,bob,carol,outsider]){await run(actor,{type:'competition.register',id:created.id,code:created.code});await run(actor,{type:'competition.checkin',id:created.id});}
      await run(admin,{type:'competition.settings',id:created.id,restSeconds:0,cooldownSeconds:0,autoSchedule:false});await run(admin,{type:'competition.plan',id:created.id});
      let event=(await getPlatformOverview(admin)).tournaments.find(event=>event.id===created.id)!;
      const first=event.state.fixtures!.find(f=>f.status==='scheduled'&&f.players.every(Boolean))!,physical=(await owner.query('select id from dartflow_private.boards where event_id=$1',[event.state.eventId])).rows[0].id,started=await run(admin,{type:'fixture.assign',id:event.id,fixtureId:first.id,boardId:physical});let match=await getMatch(admin,started.matchId!);
      const send=async(actor:string,action:MatchAction)=>{match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});};
      await send(match.players[0].id,{type:'accept'});await send(match.players[1].id,{type:'accept'});await send(match.players[0].id,{type:'start'});
      event=(await getPlatformOverview(admin)).tournaments.find(event=>event.id===created.id)!;const next=event.state.fixtures!.find(f=>f.status==='scheduled'&&f.players.every(Boolean))!,boardId=match.boardId!,action={type:'fixture.precall',id:event.id,boardId,fixtureId:next.id,showOnDisplay:true},requestId=randomUUID();
      await assert.rejects(run(outsider,action,event.revision),{status:403});
      // Only one side satisfying both thresholds can finish this current leg's match.
      const original=(await owner.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[match.id])).rows[0].state,opposed=structuredClone(original);opposed.settings.bestOfLegs=5;opposed.settings.bestOfSets=3;opposed.game.legs=[0,2];opposed.previousSets=[{...structuredClone(opposed.game),winner:opposed.players[0].id,status:'finished'}];
      await owner.query('update dartflow_private.matches set state=$2 where id=$1',[match.id,JSON.stringify(opposed)]);await assert.rejects(run(admin,action),{code:'precall_too_early'});opposed.game.legs=[2,0];await owner.query('update dartflow_private.matches set state=$2 where id=$1',[match.id,JSON.stringify(opposed)]);await run(admin,action);await owner.query('update dartflow_private.matches set state=$2 where id=$1',[match.id,JSON.stringify(original)]);
      event=(await getPlatformOverview(admin)).tournaments.find(event=>event.id===created.id)!;

      await run(admin,action,event.revision,requestId);await run(admin,action,event.revision,requestId);
      const projection=await readPublicPrecall(database(),boardId,match.eventId);assert.equal(projection.pendingCall?.players.length,2);assert.equal(JSON.stringify(projection).includes(next.players[0]!),false);
      assert.equal((await owner.query('select id from dartflow_private.matches where board_id=$1',[boardId])).rows[0].id,match.id);
      // A public read remains safe in an actual read-only transaction, without lock errors.
      const readOnly=async()=>{const connection=await database().connect();try{await connection.query('begin read only');const value=await readPublicPrecall(connection,boardId,match.eventId);await connection.query('commit');return value;}finally{await connection.query('rollback');connection.release();}};
      await owner.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{primaryCorrectionHold}',$2::jsonb)where id=$1",[event.id,JSON.stringify({requestId:randomUUID(),matchId:match.id,downstreamFixtureIds:[next.id]})]);await assert.rejects(run(admin,action),{code:'primary_correction_dependency_hold'});assert.deepEqual(await readOnly(),{});
      await owner.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{primaryCorrectionHold}',$2::jsonb)where id=$1",[event.id,JSON.stringify({requestId:randomUUID(),matchId:match.id,downstreamFixtureIds:[first.id]})]);await run(admin,action);assert.equal((await readOnly()).pendingCall?.players.length,2,'a different held branch does not suppress this valid expectation');
      await owner.query("update dartflow_private.platform_entities set state=(state-'primaryCorrectionHold')||$2::jsonb where id=$1",[event.id,JSON.stringify({circuitQualification:{listId:'10000000-0000-4000-8000-000000000002',sourceGeneration:randomUUID(),proofs:[]}})]);await assert.rejects(run(admin,action),{code:'circuit_qualification_stale'});assert.deepEqual(await readOnly(),{});await owner.query("update dartflow_private.platform_entities set state=state-'circuitQualification' where id=$1",[event.id]);assert.equal((await readOnly()).pendingCall?.players.length,2);

      await run(next.players[0]!,{type:'competition.available',id:event.id,available:false});assert.deepEqual(await readPublicPrecall(database(),boardId,match.eventId),{});
      await run(next.players[0]!,{type:'competition.available',id:event.id,available:true});await run(admin,{type:'fixture.precall',id:event.id,boardId,enabled:false});assert.deepEqual(await readPublicPrecall(database(),boardId,match.eventId),{});
      await send(match.writerId,{type:'score',score:180});await send(match.writerId,{type:'score',score:0});await send(match.writerId,{type:'score',score:121,doubleConfirmed:true});await send(match.players[0].id,{type:'confirm'});await send(match.players[1].id,{type:'confirm'});assert.equal(match.status,'confirmed');
    });
    await t.test('different events cannot simultaneously call the same real players onto two boards',async()=>{
      const prepared:{matchId:string;boardId:string}[]=[];
      for(let i=0;i<2;i++){
        const event=await run(admin,{type:'tournament.create',name:`Platform fixture global occupancy ${i}`,clubId:club,format:'knockout',boards:1,requireWriter:false});for(const player of [alice,bob]){await run(player,{type:'competition.register',id:event.id});await run(player,{type:'competition.checkin',id:event.id});}await run(admin,{type:'competition.plan',id:event.id});if(i===0){const board=(await owner.query('select id from dartflow_private.boards where event_id=$1',[event.entity!.state.eventId])).rows[0].id,practice=await run(carol,{type:'board.start',boardId:board,mode:'solo'});assert.deepEqual((await run(admin,{type:'competition.autoplan',id:event.id})).assignments,[]);await run(carol,{type:'training.finish',id:practice.id},practice.entity!.revision);}const result=await run(admin,{type:'competition.autoplan',id:event.id}),assignment=(result.assignments as {matchId:string;boardId:string}[])[0];assert.ok(assignment,`event assignment ${i}`);const match=await getMatch(admin,assignment.matchId);await owner.query("update dartflow_private.matches set board_id=null,state=jsonb_set(jsonb_set(state,'{boardId}','null'),'{status}','\"planned\"') where id=$1",[match.id]);prepared.push(assignment);
      }
      const practice=await run(carol,{type:'board.start',boardId:prepared[0].boardId,mode:'solo'}),blockedMatch=await getMatch(admin,prepared[0].matchId);await assert.rejects(executeMatchCommand(admin,{requestId:randomUUID(),matchId:blockedMatch.id,expectedRevision:blockedMatch.revision,action:{type:'call',boardId:prepared[0].boardId}}),{code:'board_reserved'});await run(carol,{type:'training.finish',id:practice.id},practice.entity!.revision);
      const matches=await Promise.all(prepared.map(p=>getMatch(admin,p.matchId)));const outcomes=await Promise.allSettled(matches.map((m,i)=>executeMatchCommand(admin,{requestId:randomUUID(),matchId:m.id,expectedRevision:m.revision,action:{type:'call',boardId:prepared[i].boardId}})));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const failure=outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'players_busy');const winner=(outcomes.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<typeof matches[0]>).value;await owner.query("update dartflow_private.matches set board_id=null,state=jsonb_set(jsonb_set(state,'{boardId}','null'),'{status}','\"planned\"') where id=$1",[winner.id]);
    });
    await t.test('tournament request, approval, changes and rejection emit only their genuine durable mail transition',async()=>{
      const event=await run(admin,{type:'tournament.create',name:'Platform fixture reviewed tournament',clubId:club,approvalRequired:true,capacity:2,boards:1});
      const requestId=randomUUID();await run(alice,{type:'competition.register',id:event.id},undefined,requestId);await run(alice,{type:'competition.register',id:event.id},undefined,requestId);assert.equal((await getPlatformOverview(admin)).tournaments.find(e=>e.id===event.id)?.members.find(m=>m.id===alice)?.status,'pending');assert.equal((await owner.query('select 1 from dartflow_private.entries where event_id=$1 and user_id=$2',[event.entity!.state.eventId,alice])).rowCount,0);await assert.rejects(run(alice,{type:'competition.checkin',id:event.id}),{code:'registration_required'});await assert.rejects(run(bob,{type:'competition.approve',id:event.id,userId:alice}),{status:403});
      await run(admin,{type:'competition.approve',id:event.id,userId:alice});await run(bob,{type:'competition.register',id:event.id});await run(admin,{type:'competition.reject',id:event.id,userId:bob,reason:'Aanvraag beoordeeld'});
      const changed=randomUUID();await run(admin,{type:'competition.settings',id:event.id,name:'Platform fixture changed tournament',location:'Zaal A'},undefined,changed);await run(admin,{type:'competition.settings',id:event.id,name:'Platform fixture changed tournament',location:'Zaal A'},undefined,changed);await run(admin,{type:'competition.settings',id:event.id,name:'Platform fixture changed tournament',location:'Zaal A'});
      const mail=(await owner.query("select template_id,recipient_key,count(*)::integer as n from dartflow_private.mail_outbox where entity_id=$1 group by template_id,recipient_key",[event.id])).rows;
      assert.equal(mail.find(m=>m.template_id==='tournament-entry'&&m.recipient_key===`user:${alice}`)?.n,1);assert.equal(mail.find(m=>m.template_id==='tournament-approved'&&m.recipient_key===`user:${alice}`)?.n,1);assert.equal(mail.find(m=>m.template_id==='tournament-rejected'&&m.recipient_key===`user:${bob}`)?.n,1);assert.equal(mail.find(m=>m.template_id==='tournament-changed'&&m.recipient_key===`user:${alice}`)?.n,1);assert.equal(mail.some(m=>m.template_id==='tournament-changed'&&m.recipient_key===`user:${bob}`),false);
    });
    await t.test('independent accounts keep multiple clubs, fresh roles and directory privacy', async () => {
      const overview = await getPlatformOverview(alice); assert.equal(overview.clubs.filter(c => c.members.some(m => m.id === alice && m.status === 'active')).length, 2);
      await assert.rejects(run(alice, { type: 'club.role', id: club, userId: bob, role: 'owner' }), { status: 403 });
      await run(bob, { type: 'preferences.update', discoverable: false, allowRequests: false });
      assert.equal((await getPlatformOverview(alice)).players.some(p => p.id === bob), false);
      await assert.rejects(run(alice, { type: 'friend.request', userId: bob }), { code: 'privacy_restricted' });
      await run(bob, { type: 'preferences.update', allowRequests: true });
      await run(alice, { type: 'friend.request', userId: bob });
      assert.equal((await getPlatformOverview(bob)).friends.find(f => f.id === alice)?.status, 'incoming');
      await assert.rejects(run(alice, { type: 'friend.accept', userId: bob }), { code: 'request_missing' });
      await run(bob, { type: 'friend.accept', userId: alice }); await run(alice, { type: 'friend.favorite', userId: bob });
      assert.equal((await getPlatformOverview(alice)).friends.find(f => f.id === bob)?.favorite, true);
    });
    await t.test('room admission locks capacity and moderation cannot cross room or host scope', async () => {
      const room = (await run(admin, { type: 'room.create', name: 'Platform fixture room', capacity: 2 })).id!;
      const race = await Promise.allSettled([run(alice, { type: 'room.join', id: room }), run(bob, { type: 'room.join', id: room })]);
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
      const joined = race[0].status === 'fulfilled' ? alice : bob, absent = joined === alice ? bob : alice;
      await assert.rejects(getPlatformMessages(absent, room), { status: 403 });
      await run(joined, { type: 'room.message', id: room, body: 'Een blijvend serverbericht' });
      assert.equal((await getPlatformMessages(admin, room)).messages.at(-1)?.body, 'Een blijvend serverbericht');
      await run(admin, { type: 'room.moderate', id: room, userId: joined, operation: 'mute' });
      await assert.rejects(run(joined, { type: 'room.message', id: room, body: 'Geblokkeerde tekst' }), { code: 'muted' });
      await run(admin, { type: 'room.moderate', id: room, userId: joined, operation: 'unmute' });
      await run(admin, { type: 'room.moderate', id: room, userId: joined, operation: 'role', role: 'moderator' });
      await assert.rejects(run(joined, { type: 'room.moderate', id: room, userId: admin, operation: 'ban' }), { code: 'invalid_member' });
      const messageId = (await getPlatformMessages(admin, room)).messages[0].id;
      const otherRoom = (await run(admin, { type: 'room.create', name: 'Platform fixture private', visibility: 'private' })).id!;
      await assert.rejects(run(admin, { type: 'room.moderate', id: otherRoom, operation: 'delete-message', messageId }), { code: 'not_found' });
      await run(admin, { type: 'room.moderate', id: room, userId: joined, operation: 'ban' });
      await assert.rejects(getPlatformMessages(joined, room), { code: 'room_banned' });
      await assert.rejects(run(joined, { type: 'room.join', id: room }), { status: 403 });
    });
    await t.test('club departure immediately revokes private club room access', async () => {
      const room = (await run(outsider, { type: 'room.create', name: 'Platform fixture clubroom', visibility: 'club', clubId: second })).id!;
      await run(alice, { type: 'room.join', id: room }); await run(alice, { type: 'room.message', id: room, body: 'Voor vertrek' });
      await run(alice, { type: 'club.leave', id: second });
      await assert.rejects(getPlatformMessages(alice, room), { status: 403 });
      assert.equal((await getPlatformOverview(alice)).rooms.some(r => r.id === room), false);
    });
    await t.test('training retries are exactly once, stale revisions fail and another account cannot write', async () => {
      const training = await run(alice, { type: 'training.create', mode: 'solo', startScore: 301 });
      const action = { type: 'training.score', id: training.id, score: 180, darts: 3 }, requestId = randomUUID();
      const [a, b] = await Promise.all([run(alice, action, 0, requestId), run(alice, action, 0, requestId)]);
      assert.deepEqual(a, b); assert.equal(a.entity?.state.game?.remaining[0], 121); assert.equal(a.entity?.state.game?.visits.length, 1);
      await assert.rejects(run(alice, { ...action, score: 60 }, 0, requestId), { code: 'request_reused' });
      await assert.rejects(run(alice, action, 0), { code: 'revision_conflict' });
      await assert.rejects(run(bob, action, 1), { status: 403 });
    });
    await t.test('lobby invitation, independent readiness, private signaling and core scoring share one match', async () => {
      const lobby = await run(alice, { type: 'lobby.create', opponentId: bob, setup: 'remote', startScore: 301, bestOfLegs: 1 });
      await assert.rejects(run(carol, { type: 'lobby.join', id: lobby.id, code: lobby.code }), { code: 'invite_recipient' });
      await run(bob, { type: 'lobby.join', id: lobby.id }); await run(alice, { type: 'lobby.ready', id: lobby.id });
      await assert.rejects(run(bob,{type:'lobby.starter',id:lobby.id,starterId:bob}),{status:403});
      await run(alice,{type:'lobby.starter',id:lobby.id,starterId:bob});assert.deepEqual((await getPlatformOverview(alice)).lobbies.find(l=>l.id===lobby.id)?.state.ready,{});
      await run(alice,{type:'lobby.ready',id:lobby.id});
      await assert.rejects(run(alice, { type: 'lobby.start', id: lobby.id }), { code: 'players_not_ready' });
      await run(bob, { type: 'lobby.ready', id: lobby.id });
      const started = await run(alice, { type: 'lobby.start', id: lobby.id }), matchId = started.matchId!;
      assert.ok(matchId); const core = await getMatch(alice, matchId); assert.equal(core.players.length, 2);assert.equal(core.turn,1);assert.ok((await getPlatformOverview(bob)).matches.some(m=>m.id===matchId));
      const signal = { requestId: randomUUID(), targetId: bob, type: 'offer', payload: { type: 'offer', sdp: 'fixture-sdp' } };
      const sent = await sendMatchSignal(alice, matchId, signal); assert.deepEqual(await sendMatchSignal(alice, matchId, signal), sent);
      await assert.rejects(sendMatchSignal(alice, matchId, { ...signal, payload: { sdp: 'different' } }), { code: 'request_reused' });
      assert.equal((await getMatchSignals(bob, matchId)).signals[0].actorId, alice);
      assert.equal((await getMatchSignals(alice, matchId)).signals.length, 0);
      const chat={requestId:randomUUID(),body:'Echte wedstrijdchat'};await sendMatchChat(alice,matchId,chat);await sendMatchChat(alice,matchId,chat);
      assert.equal((await getMatchChat(bob,matchId)).messages.length,1);assert.equal((await getMatchChat(alice,matchId)).messages[0].body,chat.body);
      await assert.rejects(getMatchChat(outsider,matchId),{status:403});
      await assert.rejects(getMatchSignals(outsider, matchId), { status: 403 });
      await assert.rejects(sendMatchSignal(alice, matchId, { ...signal, requestId: randomUUID(), targetId: carol }), { status: 403 });
      await assert.rejects(mediaConfiguration(outsider,matchId),{status:403});
      const previousSecret=process.env.DARTFLOW_TURN_SECRET,previousUrls=process.env.DARTFLOW_TURN_URLS;process.env.DARTFLOW_TURN_SECRET='platform-fixture-relay-only';process.env.DARTFLOW_TURN_URLS='turn:relay.example.invalid:3478?transport=udp';
      try{const media=await mediaConfiguration(alice,matchId);assert.equal(media.isInitiator,true);assert.equal(media.peerId,bob);assert.equal(media.relayConfigured,true);assert.equal(JSON.stringify(media).includes('platform-fixture-relay-only'),false);
        await run(alice,{type:'friend.block',userId:bob});await assert.rejects(mediaConfiguration(alice,matchId),{code:'blocked'});await run(alice,{type:'friend.unblock',userId:bob});await run(alice,{type:'friend.request',userId:bob});await run(bob,{type:'friend.accept',userId:alice});
        const issued=await Promise.allSettled(Array.from({length:7},()=>mediaConfiguration(bob,matchId)));assert.equal(issued.filter(r=>r.status==='fulfilled').length,6);const rejected=issued.filter(r=>r.status==='rejected');assert.equal(rejected.length,1);assert.equal(rejected[0].status==='rejected'?rejected[0].reason.code:null,'media_rate_limit');
      }finally{if(previousSecret===undefined)delete process.env.DARTFLOW_TURN_SECRET;else process.env.DARTFLOW_TURN_SECRET=previousSecret;if(previousUrls===undefined)delete process.env.DARTFLOW_TURN_URLS;else process.env.DARTFLOW_TURN_URLS=previousUrls;}

      let match = await getMatch(alice, matchId);
      const score = async (actor: string, action: MatchAction) => { match = await executeMatchCommand(actor, { requestId: randomUUID(), matchId, expectedRevision: match.revision, action }); };
      await score(alice, { type: 'accept' }); await score(bob, { type: 'accept' }); await score(alice, { type: 'start' });
      await score(bob,{type:'score',score:0});await score(alice,{type:'score',score:0});
      await score(alice,{type:'request-correction',reason:'Mijn eigen laatste testbeurt herstellen.'});const correctionId=match.correction!.id;
      await score(bob,{type:'pause'});await assert.rejects(executeMatchCommand(alice,{requestId:randomUUID(),matchId,expectedRevision:match.revision,action:{type:'score',score:60}}),{code:'match_paused'});
      const basis=match.revision;
      const race=await Promise.allSettled([executeMatchCommand(bob,{requestId:randomUUID(),matchId,expectedRevision:basis,action:{type:'approve-correction',correctionId}}),executeMatchCommand(alice,{requestId:randomUUID(),matchId,expectedRevision:basis,action:{type:'score',score:60}})]);
      assert.equal(race.filter(r=>r.status==='fulfilled').length,1);match=await getMatch(alice,matchId);assert.equal(match.correction,null);assert.equal(match.visits.length,1);assert.equal(match.paused,true);
      await score(alice,{type:'resume'});await score(bob,{type:'undo'});assert.equal(match.visits.length,0);
      await score(bob,{type:'score',score:0});await score(alice, { type: 'score', score: 180 });await score(bob, { type: 'score', score: 0 }); await score(alice, { type: 'score', score: 121, doubleConfirmed: true });
      await score(alice, { type: 'confirm' }); await score(bob, { type: 'confirm' });
      await reconcilePlatformResults(); await reconcilePlatformResults();
      await assert.rejects(mediaConfiguration(alice,matchId),{code:'media_closed'});
      assert.equal((await owner.query('select count(*)::integer as n from dartflow_private.match_results where match_id=$1', [matchId])).rows[0].n, 1);
      const mail=await owner.query("select template_id,count(*)::integer as n from dartflow_private.mail_outbox where event_id like $1 group by template_id",[`match:${matchId}:%`]);assert.equal(mail.rows.find(r=>r.template_id==='result-confirm')?.n,2);assert.equal(mail.rows.find(r=>r.template_id==='result-confirmed')?.n,2);assert.ok((await getPlatformOverview(bob)).history.some(r=>r.matchId===matchId));
    });
    await t.test('event signup serializes waitlist, promotion, actual fixtures and protected global creation', async () => {
      await assert.rejects(run(alice, { type: 'tournament.create', name: 'Forbidden global' }), { status: 403 });
      const tournament = (await run(admin, { type: 'tournament.create', name: 'Platform fixture tournament', clubId: club, capacity: 2, requireWriter: false, boards: 1, startScore:301,bestOfLegs:1 })).id!;
      await run(alice, { type: 'competition.register', id: tournament }); await run(bob, { type: 'competition.register', id: tournament }); await run(carol, { type: 'competition.register', id: tournament });
      let state = (await getPlatformOverview(admin)).tournaments.find(e => e.id === tournament)!;
      assert.equal(state.members.find(m => m.id === carol)?.status, 'waitlisted');
      await run(bob, { type: 'competition.withdraw', id: tournament });
      state = (await getPlatformOverview(admin)).tournaments.find(e => e.id === tournament)!;
      assert.equal(state.members.find(m => m.id === carol)?.status, 'active');
      await run(alice, { type: 'competition.checkin', id: tournament }); await run(carol, { type: 'competition.checkin', id: tournament });
      await run(admin, { type: 'competition.plan', id: tournament });
      const planned = await run(admin, { type: 'competition.autoplan', id: tournament });
      const assignment = (planned.assignments as { fixtureId: string; matchId: string; boardId: string }[])[0]; assert.ok(assignment.matchId);
      await assert.rejects(run(outsider, { type: 'competition.autoplan', id: tournament }), { status: 403 });
      assert.equal((await getBoardForActor(alice,assignment.boardId)).matchId,assignment.matchId);await assert.rejects(getBoardForActor(outsider,assignment.boardId),{status:403});assert.equal((await getBoardForActor(bob,assignment.boardId)).board.occupied,true);assert.equal((await getBoardForActor(bob,assignment.boardId)).matchId,undefined);await assert.rejects(getBoardForActor(alice,randomUUID()),{status:404});

      let core=await getMatch(alice,assignment.matchId);const players=core.players.map(p=>p.id);
      const playedBefore=(await getPlatformOverview(players[0])).statistics.played;
      const send=async(actor:string,action:MatchAction)=>{core=await executeMatchCommand(actor,{matchId:core.id,expectedRevision:core.revision,requestId:randomUUID(),action});};
      await send(players[0],{type:'accept'});await send(players[1],{type:'accept'});await send(players[0],{type:'start'});
      const base=core.revision,commands=[{requestId:randomUUID(),expectedRevision:base,action:{type:'score',score:180}},{requestId:randomUUID(),expectedRevision:base+1,action:{type:'score',score:0}}];
      const replay=await replayMatchCommands(core.writerId,{matchId:core.id,baseRevision:base,commands});assert.deepEqual(replay.accepted,commands.map(c=>c.requestId));
      assert.equal((await replayMatchCommands(core.writerId,{matchId:core.id,baseRevision:base,commands})).ok,true);
      const conflict=await replayMatchCommands(core.writerId,{matchId:core.id,baseRevision:base,commands:commands.map(c=>({...c,requestId:randomUUID()}))});assert.equal(conflict.ok,false);assert.deepEqual(conflict.accepted,[]);assert.equal((conflict.pending as unknown[]).length,2);
      core=await getMatch(players[0],core.id);await send(core.writerId,{type:'score',score:121,doubleConfirmed:true});await send(players[0],{type:'confirm'});await send(players[1],{type:'confirm'});
      await reconcilePlatformResults();await reconcilePlatformResults();
      const projected=(await getPlatformOverview(admin)).tournaments.find(e=>e.id===tournament)!;assert.equal(projected.state.fixtures?.find(f=>f.id===assignment.fixtureId)?.status,'confirmed');
      assert.ok(projected.state.fixtures?.find(f=>f.phase==='knockout')?.players.every(Boolean));assert.equal((await getPlatformOverview(players[0])).statistics.played,playedBefore+1);
      const csv=await exportPlatformCsv(players[0],'matches');assert.ok(csv.includes(core.id));await assert.rejects(exportPlatformCsv(outsider,'players',club),{status:403});
      const share = await run(admin, { type: 'cast.share', id: tournament });
      const projection = await getPlatformCast(String(share.token));
      assert.equal((projection.boards as { match: { id: string }|null }[])[0].match,null);assert.ok((projection.fixtures as {id:string}[]).some(f=>f.id===assignment.fixtureId));
      assert.equal(JSON.stringify(projection).includes('email'), false); assert.equal(JSON.stringify(projection).includes('invite'), false);
      await run(admin, { type: 'cast.revoke', id: tournament, grantId: share.grantId });
      await assert.rejects(getPlatformCast(String(share.token)), { status: 404 });
    });
    await t.test('registration review, report privacy, external writers and call expiry use current server state',async()=>{
      await run(alice,{type:'profile.update',name:'=Platform formula fixture'});await run(alice,{type:'registration.request'});await assert.rejects(run(bob,{type:'registration.review',userId:alice,approved:true,reason:'Forged'}),{status:403});
      await run(admin,{type:'registration.review',userId:alice,approved:true,reason:'Identiteit gecontroleerd'});assert.equal((await getPlatformOverview(alice)).registrations[0].status,'approved');
      const csv=await exportPlatformCsv(admin,'players',club);assert.ok(csv.includes("'=Platform formula fixture"));
      const report=await run(alice,{type:'report.create',userId:bob,reason:'Werkelijke testmelding'});assert.equal((await getPlatformOverview(bob)).reports.some(r=>r.id===report.id),false);assert.equal((await getPlatformOverview(admin)).reports.some(r=>r.id===report.id),true);await assert.rejects(run(bob,{type:'report.resolve',reportId:report.id,reason:'Onbevoegd'}),{status:403});await run(admin,{type:'report.resolve',reportId:report.id,reason:'Beoordeeld'});
      const event=(await run(admin,{type:'tournament.create',name:'Platform fixture writer',clubId:club,format:'knockout',capacity:3,boards:1})).id!;
      for(const user of [alice,bob,carol]){await run(user,{type:'competition.register',id:event});await run(user,{type:'competition.checkin',id:event});}
      await run(admin,{type:'competition.plan',id:event});let state=(await getPlatformOverview(admin)).tournaments.find(e=>e.id===event)!;
      const fixture=state.state.fixtures!.find(f=>f.players.every(Boolean)&&f.status==='scheduled')!,writer=[alice,bob,carol].find(p=>!fixture.players.includes(p))!;const board=(state.state.boards as {id:string}[])[0].id;
      await assert.rejects(run(admin,{type:'fixture.assign',id:event,fixtureId:fixture.id,boardId:board,writerId:outsider}),{code:'writer_unavailable'});
      await run(admin,{type:'board.reserve',id:event,boardId:board,reserved:true,reason:'Pauze'});assert.equal(((await run(admin,{type:'competition.autoplan',id:event})).assignments as unknown[]).length,0);
      await run(admin,{type:'board.reserve',id:event,boardId:board,reserved:false});
      const assigned=await run(admin,{type:'fixture.assign',id:event,fixtureId:fixture.id,boardId:board,writerId:writer});let match=await getMatch(writer,assigned.matchId!);assert.equal(match.writerId,writer);
      await owner.query("update dartflow_private.platform_entities set state=jsonb_set(state,ARRAY['calls',$2,'expiresAt'],to_jsonb(0::bigint)) where id=$1",[event,fixture.id]);
      await reconcilePlatformCalls();match=await getMatch(fixture.players[0]!,assigned.matchId!);assert.equal(match.status,'planned');assert.equal(match.boardId,null);assert.equal(match.delegatedWriterId,null);
      state=(await getPlatformOverview(admin)).tournaments.find(e=>e.id===event)!;assert.equal(state.state.fixtures?.find(f=>f.id===fixture.id)?.status,'scheduled');
      for(const player of fixture.players)await run(player!,{type:'competition.available',id:event,available:true});
      const again=await run(admin,{type:'fixture.assign',id:event,fixtureId:fixture.id,boardId:board,writerId:writer});match=await getMatch(writer,again.matchId!);
      for(const player of fixture.players)match=await executeMatchCommand(player!,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'accept'}});
      match=await executeMatchCommand(fixture.players[0]!,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'start'}});
      match=await executeMatchCommand(writer,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'score',score:60}});assert.equal(match.visits.length,1);
      await assert.rejects(executeMatchCommand(writer,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'confirm'}}),{status:403});
      match=await executeMatchCommand(fixture.players[0]!,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'take-over'}});
      await assert.rejects(executeMatchCommand(writer,{matchId:match.id,expectedRevision:match.revision,requestId:randomUUID(),action:{type:'score',score:60}}),{code:'not_writer'});
      // End this synthetic writer fixture before later subtests reuse its actors.
      // A real randomized draw can choose any pair; no subsequent test may rely
      // on the historical registration-order pairing keeping Alice free.
      await owner.query("update dartflow_private.matches set board_id=null,state=jsonb_set(jsonb_set(state,'{boardId}','null'),'{status}','\"abandoned\"') where id=$1",[match.id]);
      const walk=(await run(admin,{type:'tournament.create',name:'Platform fixture walkover',clubId:club,format:'knockout',capacity:2,boards:1})).id!;
      await run(alice,{type:'competition.register',id:walk});await run(bob,{type:'competition.register',id:walk});await run(admin,{type:'competition.plan',id:walk});const scheduled=(await getPlatformOverview(admin)).tournaments.find(e=>e.id===walk)!.state.fixtures![0];
      const decision={requestId:randomUUID(),action:{type:'fixture.walkover',id:walk,fixtureId:scheduled.id,winnerId:alice,reason:'Afwezigheid geverifieerd'}};
      const award=await executePlatformCommand(admin,decision);await executePlatformCommand(admin,decision);assert.ok(award.matchId);
      assert.equal((await owner.query('select count(*)::integer as n from dartflow_private.match_results where match_id=$1',[award.matchId])).rows[0].n,1);assert.equal((await owner.query('select count(*)::integer as n from dartflow_private.visits where match_id=$1',[award.matchId])).rows[0].n,0);
      assert.equal((await getMatch(alice,award.matchId!)).resultPublished,true);

    });
    await t.test('open and code-gated club events authorize only their entries and never create club memberships',async()=>{
      await assert.rejects(run(alice,{type:'club.settings',id:club,name:'Forbidden change'}),{status:403});await assert.rejects(run(admin,{type:'club.settings',id:club,capacity:2}),{code:'capacity_below_members'});await run(admin,{type:'club.settings',id:club,name:'Platform fixture renamed',capacity:10});
      const event=await run(admin,{type:'tournament.create',name:'Platform fixture open outside',clubId:club,eligibility:'all',format:'knockout',capacity:4,boards:1,requireWriter:false});
      await run(outsider,{type:'competition.register',id:event.id});await run(alice,{type:'competition.register',id:event.id});
      const roomId=String(event.entity!.state.roomId);assert.ok(roomId);await run(outsider,{type:'room.join',id:roomId});await run(alice,{type:'room.join',id:roomId});await run(outsider,{type:'room.message',id:roomId,body:'Gedeelde toernooikamer'});assert.equal((await getPlatformMessages(alice,roomId)).messages[0].body,'Gedeelde toernooikamer');await assert.rejects(getPlatformMessages(bob,roomId),{status:403});
      await run(outsider,{type:'competition.withdraw',id:event.id});await assert.rejects(getPlatformMessages(outsider,roomId),{status:403});assert.equal((await getPlatformOverview(outsider)).rooms.some(r=>r.id===roomId),false);await run(outsider,{type:'competition.register',id:event.id});
      await run(outsider,{type:'competition.checkin',id:event.id});await run(alice,{type:'competition.checkin',id:event.id});
      const externalBoard=((await getPlatformOverview(outsider)).tournaments.find(t=>t.id===event.id)!.state.boards as {id:string}[])[0].id;assert.equal((await getBoardForActor(outsider,externalBoard)).event.id,event.entity!.state.eventId);

      assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,outsider])).rowCount,0);
      assert.equal((await getPlatformOverview(outsider)).clubs.find(c=>c.id===club)?.members.some(m=>m.id===bob),false);
      await assert.rejects(run(outsider,{type:'competition.plan',id:event.id}),{status:403});await run(admin,{type:'competition.plan',id:event.id});
      const fixture=(await getPlatformOverview(admin)).tournaments.find(e=>e.id===event.id)!.state.fixtures![0];const started=await run(outsider,{type:'fixture.start',id:event.id,fixtureId:fixture.id});assert.ok((await getMatch(outsider,started.matchId!)).players.some(p=>p.id===outsider));assert.ok((await getPlatformOverview(outsider)).matches.some(m=>m.id===started.matchId));assert.equal((await getPlatformOverview(bob)).matches.some(m=>m.id===started.matchId),false);await getMatchSignals(outsider,started.matchId!);
      assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,outsider])).rowCount,0);
      const privateRoom=(await run(admin,{type:'room.create',name:'Platform fixture club private',visibility:'club',clubId:club})).id!;await assert.rejects(run(outsider,{type:'room.join',id:privateRoom}),{status:403});
      const gate=await run(admin,{type:'tournament.create',name:'Platform fixture code gate',clubId:club,eligibility:'code',format:'knockout',capacity:2});await assert.rejects(run(outsider,{type:'competition.register',id:gate.id}),{code:'invite_required'});await assert.rejects(run(outsider,{type:'competition.register',id:gate.id,code:event.code}),{code:'invite_required'});
      assert.equal((await run(outsider,{type:'invitation.resolve',code:gate.code})).id,gate.id);await run(outsider,{type:'competition.register',id:gate.id,code:gate.code});
      await owner.query("update dartflow_private.platform_entities set invite_expires_at=now()-interval '1 second' where id=$1",[gate.id]);await assert.rejects(run(bob,{type:'competition.register',id:gate.id,code:gate.code}),{code:'invite_required'});const rotated=await run(admin,{type:'competition.invite',id:gate.id});await run(bob,{type:'competition.register',id:gate.id,code:rotated.code});
      await run(carol,{type:'competition.register',id:gate.id,code:rotated.code});await run(admin,{type:'competition.settings',id:gate.id,capacity:3});await run(admin,{type:'competition.promote',id:gate.id,userId:carol});assert.equal((await getPlatformOverview(admin)).tournaments.find(e=>e.id===gate.id)?.members.find(m=>m.id===carol)?.status,'active');
      assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,outsider])).rowCount,0);
    });
    await t.test('blocking clears friendship and prevents fresh invitations', async () => {
      await run(alice, { type: 'friend.block', userId: bob });
      assert.equal((await getPlatformOverview(bob)).friends.some(f => f.id === alice), false);
      await assert.rejects(run(bob, { type: 'lobby.create', opponentId: alice }), { code: 'blocked' });
      const grants = await owner.query("select has_table_privilege('dartflow_app','dartflow_private.platform_receipts','UPDATE') as mutate_receipts,has_table_privilege('dartflow_app','dartflow_private.platform_audit','DELETE') as delete_audit");
      assert.equal(grants.rows[0].mutate_receipts, false); assert.equal(grants.rows[0].delete_audit, false);
    });
  } finally {
  await beginFixtureCleanup(owner,people);
    // Delete this test's UUID-owned fixtures only; never touch pre-existing development data.
    const clubs = (await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])', [people])).rows.map(r => r.club_id);
    const entities = (await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])', [people])).rows.map(r => r.id);
    const events = (await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])', [clubs])).rows.map(r => r.id);
    const matches = (await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])', [events])).rows.map(r => r.id);
    const jobs = (await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])', [people])).rows.map(r => r.id);
    await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])', [jobs]);
    await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])', [people]);
    await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])', [people.map(p => `user:${p}`)]);
    for (const table of ['platform_signals', 'platform_match_links']) await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`, [matches]);
    for (const table of ['platform_cast_grants', 'platform_messages', 'platform_reports', 'platform_audit', 'platform_members']) {
      const field = ['platform_messages', 'platform_reports'].includes(table) ? 'room_id' : 'entity_id';
      await owner.query(`delete from dartflow_private.${table} where ${field}=any($1::uuid[])`, [entities]);
    }
    await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])', [people]);
    await owner.query('delete from dartflow_private.platform_reports where reporter_id=any($1::uuid[])', [people]);
    await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])', [entities]);
    await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])', [people]);
    await owner.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])', [people]);
    for (const table of ['platform_registrations','platform_preferences', 'platform_roles', 'mail_preferences']) await owner.query(`delete from dartflow_private.${table} where user_id=any($1::uuid[])`, [people]);
    for (const table of ['action_receipts', 'match_confirmations', 'visits', 'match_results', 'match_players']) await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`, [matches]);
    for (const table of ['standings', 'audit_events', 'screen_capabilities']) await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`, [events]);
    for (const table of ['matches', 'entries', 'boards', 'event_staff']) await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`, [events]);
    await owner.query('delete from dartflow_private.events where id=any($1::uuid[])', [events]);
    await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])', [clubs]);
    await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])', [clubs]);
    await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])', [people]);
    await owner.query('commit');await owner.end(); await closeDatabase();
  }
});
