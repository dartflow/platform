import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {database,closeDatabase,executeMatchCommand,getMatch} from '../lib/db';
import {newGame} from '../lib/domain';
import {executePlatformCommand,getPlatformStatistics} from '../lib/platform';
import {ensureBoardActivity,extendBoardActivity,readBoardActivity,readSourceBoardActivity,releaseBoardActivity,boardDeviceCanExtend} from '../lib/board-activity';
import {boardLease} from '../lib/platform-locks';
import type {MatchState} from '../lib/types';
try{process.loadEnvFile('.env.local');}catch{/* CI injects local URLs. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('physical inactivity transactions preserve deadlines, shared extensions and safe release',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const suffix=randomUUID().slice(0,8),manager=randomUUID(),p=randomUUID(),q=randomUUID(),outsider=randomUUID(),people=[manager,p,q,outsider],club=randomUUID(),event=randomUUID(),boardIds:string[]=[],entityIds:string[]=[],matchIds:string[]=[];
 const transaction=async<T,>(run:(client:pg.PoolClient)=>Promise<T>):Promise<T>=>{const client=await database().connect();try{await client.query('begin');const result=await run(client);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}};
 const board=async()=>{const id=randomUUID();boardIds.push(id);await admin.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[id,event,`Activity ${boardIds.length}`]);return id;};
 const age=async(id:string,elapsed:number)=>admin.query("update dartflow_private.board_activity_sessions set activity_at=date_trunc('milliseconds',clock_timestamp())-($2::text||' milliseconds')::interval,deadline_at=date_trunc('milliseconds',clock_timestamp())-($2::text||' milliseconds')::interval+interval '180 seconds' where id=$1",[id,elapsed]);
 const start=async(kind:'free'|'official'='free',boards?:string[])=>{
  const id=randomUUID(),physical=boards??[await board()],entityId=randomUUID(),settings={startScore:301 as const,bestOfLegs:1,bestOfSets:1};matchIds.push(id);entityIds.push(entityId);
  const names=await admin.query<{id:string;name:string}>('select id,name from dartflow_private.profiles where id=any($1::uuid[])',[[p,q]]);
  const state:MatchState={id,clubId:club,eventId:event,boardId:physical[0],revision:0,status:'live',players:[p,q].map(user=>names.rows.find(row=>row.id===user)!),writerId:p,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame(id,[p,q],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};
  await admin.query('insert into dartflow_private.matches(id,club_id,event_id,board_id,revision,state) values($1,$2,$3,$4,0,$5)',[id,club,event,physical[0],JSON.stringify(state)]);
  for(const [position,user]of [p,q].entries())await admin.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3)',[id,user,position]);
  await admin.query('insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state) values($1,$2,$3,$4,$5)',[entityId,kind==='free'?'lobby':'tournament',manager,'private',JSON.stringify({name:`Activity ${kind}`,eventId:event,coreClubId:club,matchId:id,boardId:physical[0],fixtures:[{id:'fixture',players:[p,q],status:'live',matchId:id,round:1,phase:'pool'}]})]);
  await admin.query('insert into dartflow_private.platform_match_links(match_id,entity_id,fixture_id) values($1,$2,$3)',[id,entityId,'fixture']);
  const activity=await transaction(client=>ensureBoardActivity(client,{sourceId:id,sourceKind:'match',boardIds:physical,eventId:event,kind,actorIds:[p,q]}));
  return {id,entityId,activity,board:physical[0]};
 };
 const score=async(id:string,value:number,requestId=randomUUID())=>{const match=await getMatch(p,id);return executeMatchCommand(p,{matchId:id,requestId,expectedRevision:match.revision,action:{type:'score',score:value}});};
 const force=async(sessionId:string)=>transaction(client=>releaseBoardActivity(client,{sessionId,reason:'forced',actorId:manager}));
 try{
  for(const [i,id]of people.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true)',[id,`Activity${i}-${suffix}`]);
  await admin.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,`Activity ${suffix}`]);
  for(const id of people)await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[club,id,id===manager?'organizer':'player']);
  await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,64)',[event,club,'Activity transactions']);
  await admin.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[event,manager]);
  for(const user of [p,q])await admin.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,'registered',true)",[randomUUID(),event,user]);
  await t.test('accepted zero and bust reset T but score replay and undo preserve T',async()=>{
   const source=await start();await age(source.activity.sessionId,130000);
   const current=await getMatch(p,source.id),command={requestId:randomUUID(),matchId:source.id,expectedRevision:current.revision,action:{type:'score' as const,score:0}};
   const zero=await executeMatchCommand(p,command),afterZero=(await readSourceBoardActivity(database(),source.id))!;assert.equal(zero.visits.at(-1)?.score,0);assert.equal(afterZero.phase,'active');assert.ok(afterZero.activityAt>source.activity.activityAt-1000);
   await age(afterZero.sessionId,80000);const beforeReplay=(await readSourceBoardActivity(database(),source.id))!;await executeMatchCommand(p,command);assert.equal((await readSourceBoardActivity(database(),source.id))!.activityAt,beforeReplay.activityAt);
   await admin.query("update dartflow_private.matches set state=jsonb_set(state,'{game,remaining,1}','40') where id=$1",[source.id]);await age(afterZero.sessionId,130000);
   const bust=await score(source.id,60);assert.equal(bust.visits.at(-1)?.bust,true);const afterBust=(await readSourceBoardActivity(database(),source.id))!;assert.equal(afterBust.phase,'active');
   await executeMatchCommand(p,{requestId:randomUUID(),matchId:source.id,expectedRevision:bust.revision,action:{type:'undo'}});assert.equal((await readSourceBoardActivity(database(),source.id))!.activityAt,afterBust.activityAt);await force(afterBust.sessionId);
  });
  await t.test('one concurrent extension per warning and at most two for both players; scores remain valid',async()=>{
   const source=await start();await age(source.activity.sessionId,130000);let warning=(await readBoardActivity(database(),source.board))!;const requests=[p,q].map(actor=>({actor,input:{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID()}}));
   const attempts=await Promise.allSettled(requests.map(({actor,input})=>extendBoardActivity(actor,input)));assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal((await readBoardActivity(database(),source.board))!.extensionsUsed,1);
   const winner=attempts.findIndex(result=>result.status==='fulfilled');await extendBoardActivity(requests[winner].actor,requests[winner].input);assert.equal((await readBoardActivity(database(),source.board))!.extensionsUsed,1);
   await age(warning.sessionId,130000);warning=(await readBoardActivity(database(),source.board))!;await extendBoardActivity(q,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID()});await age(warning.sessionId,130000);warning=(await readBoardActivity(database(),source.board))!;
   await assert.rejects(extendBoardActivity(p,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID()}),{code:'extension_limit'});await assert.rejects(extendBoardActivity(outsider,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID()}),{status:403});
   await score(source.id,0);const accepted=(await readBoardActivity(database(),source.board))!;assert.equal(accepted.phase,'active');assert.equal(accepted.extensionsUsed,2);await force(accepted.sessionId);
  });
  await t.test('a score waiting on source locks checks the post-lock deadline and commits the abandoned tombstone',async()=>{
   const source=await start(),held=await database().connect();await held.query('begin');await held.query('select id from dartflow_private.events where id=$1 for update',[event]);
   const pending=executeMatchCommand(p,{requestId:randomUUID(),matchId:source.id,expectedRevision:0,action:{type:'score',score:60}});const assertion=assert.rejects(pending,{code:'board_session_expired'});
   await age(source.activity.sessionId,180010);await held.query('commit');held.release();await assertion;
   const final=await getMatch(p,source.id);assert.equal(final.status,'abandoned');assert.equal(final.visits.length,0);assert.equal(await readBoardActivity(database(),source.board),null);assert.equal((await admin.query('select count(*)::int n from dartflow_private.visits where match_id=$1',[source.id])).rows[0].n,0);
  });
  await t.test('old warning jobs and released session IDs cannot alter a successor assignment',async()=>{
   const source=await start(),old=source.activity;await score(source.id,0);const current=(await readBoardActivity(database(),source.board))!;
   await transaction(client=>releaseBoardActivity(client,{sessionId:old.sessionId,reason:'timeout',expectedWarningEpoch:old.warningEpoch,expectedDeadlineAt:old.deadlineAt}));assert.equal((await readBoardActivity(database(),source.board))!.warningEpoch,current.warningEpoch);
   await force(old.sessionId);const successor=await start('free',[source.board]);await transaction(client=>releaseBoardActivity(client,{sessionId:old.sessionId,reason:'forced',actorId:manager}));assert.equal((await readBoardActivity(database(),source.board))!.sessionId,successor.activity.sessionId);await force(successor.activity.sessionId);
  });
  await t.test('a remote lobby binds two physical boards to one live deadline and releases both',async()=>{
   const a=await board(),b=await board(),created=await executePlatformCommand(p,{requestId:randomUUID(),action:{type:'board.start',boardId:a,mode:'remote'}});const lobby=created.id!;entityIds.push(lobby);
   await executePlatformCommand(q,{requestId:randomUUID(),action:{type:'lobby.join',id:lobby,code:created.code}});await executePlatformCommand(q,{requestId:randomUUID(),action:{type:'lobby.board.bind',id:lobby,boardId:b}});assert.equal((await boardLease(database(),b))?.id,lobby);assert.equal(await readBoardActivity(database(),a),null);
   for(const actor of [p,q])await executePlatformCommand(actor,{requestId:randomUUID(),action:{type:'lobby.ready',id:lobby}});
   const started=await executePlatformCommand(p,{requestId:randomUUID(),action:{type:'lobby.start',id:lobby}}),match=started.matchId!;matchIds.push(match);assert.equal(await readBoardActivity(database(),a),null);
   for(const actor of [p,q]){const before=await getMatch(actor,match);await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match,expectedRevision:before.revision,action:{type:'accept'}});}
   const ready=await getMatch(p,match);await executeMatchCommand(p,{requestId:randomUUID(),matchId:match,expectedRevision:ready.revision,action:{type:'start'}});
   const first=(await readBoardActivity(database(),a))!,second=(await readBoardActivity(database(),b))!;assert.deepEqual(first.boardIds.sort(),[a,b].sort());assert.equal(first.sessionId,second.sessionId);assert.equal(first.deadlineAt,second.deadlineAt);await force(first.sessionId);assert.equal(await readBoardActivity(database(),a),null);assert.equal(await readBoardActivity(database(),b),null);
  });
  await t.test('paired extension capability is board-bound, revocable and does not grant anonymous access',async()=>{
   const source=await start(),token=Buffer.alloc(32,7).toString('base64url'),device=randomUUID();
   await admin.query("insert into dartflow_private.board_screen_devices(id,board_id,event_id,created_by,name,token_hash,pairing_expires_at,paired_at,expires_at) values($1,$2,$3,$4,'Activity device',$5,now()+interval '1 hour',now(),now()+interval '1 day')",[device,source.board,event,manager,createHash('sha256').update(token).digest('hex')]);
   await age(source.activity.sessionId,130000);const warning=(await readBoardActivity(database(),source.board))!;assert.equal(await boardDeviceCanExtend(database(),source.board,token),true);
   await assert.rejects(extendBoardActivity(null,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID(),boardId:source.board}),{status:403});
   await extendBoardActivity(null,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID(),boardId:source.board,deviceToken:token});await admin.query('update dartflow_private.board_screen_devices set revoked_at=now() where id=$1',[device]);assert.equal(await boardDeviceCanExtend(database(),source.board,token),false);await force(warning.sessionId);
  });
  await t.test('official interruption preserves visits, fixtures and progress and resumes with a new lease',async()=>{
   const source=await start('official');
   for(const actor of [p,q]){await age(source.activity.sessionId,130000);const warning=(await readBoardActivity(database(),source.board))!;await extendBoardActivity(actor,{sessionId:warning.sessionId,warningEpoch:warning.warningEpoch,requestId:randomUUID()});}
   const scored=await score(source.id,60);await age(source.activity.sessionId,180010);await transaction(client=>releaseBoardActivity(client,{sessionId:source.activity.sessionId,reason:'timeout'}));
   let match=await getMatch(p,source.id);assert.equal(match.status,'interrupted');assert.equal(match.visits.length,scored.visits.length);assert.equal(match.remaining[0],241);assert.equal(match.boardId,null);
   const fixture=(await admin.query('select state from dartflow_private.platform_entities where id=$1',[source.entityId])).rows[0].state.fixtures[0];assert.equal(fixture.status,'live');assert.equal((await admin.query('select count(*)::int n from dartflow_private.match_results where match_id=$1',[source.id])).rows[0].n,0);assert.equal((await admin.query('select count(*)::int n from dartflow_private.community_messages where scope_id=$1',[source.entityId])).rows[0].n,1);
   await assert.rejects(database().query('select dartflow_private.purge_abandoned_board_payloads($1)',[source.activity.sessionId]),{code:'42501'});
   match=await executeMatchCommand(manager,{requestId:randomUUID(),matchId:source.id,expectedRevision:match.revision,action:{type:'call',boardId:source.board}});
   for(const actor of [p,q])match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:source.id,expectedRevision:match.revision,action:{type:'accept'}});
   match=await executeMatchCommand(p,{requestId:randomUUID(),matchId:source.id,expectedRevision:match.revision,action:{type:'start'}});assert.equal(match.status,'live');assert.equal(match.visits.length,1);assert.notEqual(match.boardActivity!.sessionId,source.activity.sessionId);assert.equal(match.boardActivity!.extensionsUsed,2);await force(match.boardActivity!.sessionId);
  });
  await t.test('normally completed free results and immutable score receipts survive forced physical release',async()=>{
   const source=await start();await score(source.id,180);await score(source.id,0);let match=await getMatch(p,source.id);
   match=await executeMatchCommand(p,{requestId:randomUUID(),matchId:source.id,expectedRevision:match.revision,action:{type:'score',score:121,darts:3,doubleConfirmed:true}});assert.equal(match.status,'result');
   for(const actor of [p,q])match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:source.id,expectedRevision:match.revision,action:{type:'confirm'}});
   assert.equal(match.resultPublished,true);const revision=match.revision;await force(source.activity.sessionId);
   const retained=await getMatch(p,source.id);assert.equal(retained.status,'confirmed');assert.equal(retained.visits.length,3);assert.equal(retained.revision,revision+1);assert.equal((await admin.query('select count(*)::int n from dartflow_private.match_results where match_id=$1',[source.id])).rows[0].n,1);
   assert.equal((await admin.query("select count(*)::int n from dartflow_private.action_receipts where match_id=$1 and jsonb_array_length(response->'visits')>0",[source.id])).rows[0].n>0,true);await assert.rejects(database().query('select dartflow_private.purge_abandoned_board_payloads($1)',[source.activity.sessionId]),{code:'42501'});
  });
  await t.test('abandoned training erases provisional game and receipt payloads and does not count as training history',async()=>{
   const id=await board(),created=await executePlatformCommand(p,{requestId:randomUUID(),action:{type:'board.start',boardId:id,mode:'solo'}}),training=created.id!;entityIds.push(training);const revision=created.entity!.revision;
   await executePlatformCommand(p,{requestId:randomUUID(),expectedRevision:revision,action:{type:'training.score',id:training,score:60}});const activity=(await readSourceBoardActivity(database(),training))!;await force(activity.sessionId);
   const state=(await admin.query('select state from dartflow_private.platform_entities where id=$1',[training])).rows[0].state;assert.equal(state.discarded,true);assert.equal(state.game,undefined);assert.equal(state.undo,undefined);assert.equal((await admin.query("select count(*)::int n from dartflow_private.platform_receipts where response->'entity'->>'id'=$1 and response->'entity'->'state' ? 'game'",[training])).rows[0].n,0);
   await assert.rejects(executePlatformCommand(p,{requestId:randomUUID(),expectedRevision:revision+1,action:{type:'training.score',id:training,score:60}}),{code:'board_session_expired'});assert.equal((await getPlatformStatistics(p)).trainingSessions,0);
  });
 }finally{
  await admin.query('rollback');
  await admin.query('delete from dartflow_private.community_messages where author_id=any($1::uuid[])',[people]);
  for(const table of ['mail_outbox','mail_events'])await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[people.map(id=>`user:${id}`)]);
  await admin.query('delete from dartflow_private.board_activity_sessions where event_id=$1',[event]);
  await admin.query('delete from dartflow_private.board_score_events where board_id=any($1::uuid[])',[boardIds]);
  await admin.query('delete from dartflow_private.board_screen_devices where board_id=any($1::uuid[])',[boardIds]);
  for(const table of ['visits','match_confirmations','match_results','action_receipts','match_players','platform_match_links'])await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matchIds]);
  await admin.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[]) or event_id=$2',[people,event]);
  await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matchIds]);
  await admin.query('delete from dartflow_private.invitation_codes where entity_id=any($1::uuid[])',[entityIds]);await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entityIds]);
  await admin.query('delete from dartflow_private.screen_capabilities where event_id=$1',[event]);await admin.query('delete from dartflow_private.entries where event_id=$1',[event]);await admin.query('delete from dartflow_private.event_staff where event_id=$1',[event]);await admin.query('delete from dartflow_private.boards where event_id=$1',[event]);await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  await admin.end();await closeDatabase();
 }
});
