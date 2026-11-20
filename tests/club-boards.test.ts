import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getClubBoardScreen } from '../lib/club-boards';
import { checkDatabaseReady, closeDatabase, eventAccess, executeEventCommand, executeMatchCommand, getBoardForActor, getMatch, getOverview } from '../lib/db';
import { executePlatformCommand, getMatchSignals, getPlatformOverview, reconcilePlatformResults } from '../lib/platform';
import type { ClubBoardView, PlatformCommand } from '../lib/platform-types';
import type { MatchAction } from '../lib/types';
try { process.loadEnvFile('.env.local'); } catch { /* CI supplies the explicit loopback fixture. */ }
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);

test('standalone club boards persist without competitions and isolate open play from club privileges',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const admin=randomUUID(),member=randomUUID(),guest=randomUUID(),secondGuest=randomUUID(),otherOwner=randomUUID(),people=[admin,member,guest,secondGuest,otherOwner];
 const clubs:string[]=[];
 const run=(actor:string,action:PlatformCommand['action'],requestId=randomUUID(),expectedRevision?:number)=>executePlatformCommand(actor,{requestId,action,...(expectedRevision===undefined?{}:{expectedRevision})});
 const create=async(clubId:string,name:string,access:'all'|'club'='all')=>(await run(admin,{type:'club-board.create',clubId,name,access})).board as ClubBoardView;
 try{
  for(const [i,id] of people.entries())await owner.query("insert into dartflow_private.profiles(id,name,display_name,email) values($1,replace($2,' ',''),$2,$3)",[id,`Club board fixture ${i}`,`board-fixture-${i}@example.test`]);
  const club=(await run(admin,{type:'club.create',name:'Standalone board fixture club'})).id!;clubs.push(club);
  const otherClub=(await run(otherOwner,{type:'club.create',name:'Standalone board unrelated club'})).id!;clubs.push(otherClub);
  await run(admin,{type:'location.enable-venue'});
  await run(member,{type:'club.request',id:club});await run(admin,{type:'club.approve',id:club,userId:member});
  const publicBoard=await create(club,'Open verenigingsbaan');
  const clubBoard=await create(club,'Ledenbaan','club');
  const eventId=String((await owner.query('select event_id from dartflow_private.club_boards where board_id=$1',[publicBoard.id])).rows[0].event_id);
  await t.test('migration is private, grants only runtime DML, and readiness requires its feature marker',async()=>{
   assert.equal((await checkDatabaseReady()).ready,true);
   const {rows}=await owner.query(`select c.relrowsecurity,has_table_privilege('dartflow_app','dartflow_private.club_boards','select') as runtime_select,
    has_column_privilege('dartflow_app','dartflow_private.club_boards','access','update') as runtime_update,
    has_table_privilege('dartflow_app','dartflow_private.club_boards','delete') as runtime_delete
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dartflow_private' and c.relname='club_boards'`);
   assert.deepEqual(rows[0],{relrowsecurity:true,runtime_select:true,runtime_update:true,runtime_delete:false});
   const roles=await owner.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");
   for(const role of roles.rows)assert.equal((await owner.query("select has_table_privilege($1,'dartflow_private.club_boards','select') as allowed",[role.rolname])).rows[0].allowed,false);
  });
  await t.test('only current club management creates boards, independent of any league or tournament',async()=>{
   assert.equal(publicBoard.canManage,true);assert.equal(publicBoard.access,'all');assert.equal(publicBoard.playUrl,`/baan/${publicBoard.id}`);assert.equal(publicBoard.screenUrl,`/baanscherm/${publicBoard.id}`);
   await assert.rejects(run(member,{type:'club-board.create',clubId:club,name:'Forbidden member board'}),{status:403});
   await assert.rejects(run(otherOwner,{type:'club-board.create',clubId:club,name:'Forbidden other club'}),{status:403});
   const overview=await getOverview(admin,club);assert.equal(overview.events.length,0);assert.equal(overview.boards.length,2);
   const platform=await getPlatformOverview(admin);assert.equal(platform.leagues.filter(e=>e.clubId===club).length,0);assert.equal(platform.tournaments.filter(e=>e.clubId===club).length,0);
   assert.equal(platform.clubBoards.filter(b=>b.clubId===club).length,2);
   await assert.rejects(executeEventCommand(admin,eventId,{type:'plan',playerIds:[guest,secondGuest]}),{code:'invalid_action'});
   await assert.rejects(executeEventCommand(guest,eventId,{type:'register'}),{code:'invalid_action'});
  });
  await t.test('open play admits outsiders only to its own board and never grants membership, room or other event access',async()=>{
   assert.equal((await getBoardForActor(guest,publicBoard.id)).canStart,true);
   await assert.rejects(getBoardForActor(guest,clubBoard.id),{status:403});assert.equal((await getBoardForActor(member,clubBoard.id)).canStart,true);
   const foreignEvent=(await run(admin,{type:'tournament.create',clubId:club,name:'Independent private fixture',boards:1})).entity!;
   const privateRoom=(await run(admin,{type:'room.create',clubId:club,visibility:'club',name:'Independent private room'})).id!;
   await assert.rejects(eventAccess(owner,guest,String(foreignEvent.state.eventId)),{status:403});
   await assert.rejects(run(guest,{type:'room.join',id:privateRoom}),{status:403});
   await assert.rejects(getOverview(guest,club),{status:403});
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,guest])).rowCount,0);
   const open=await getPlatformOverview(guest);assert.equal(open.clubBoards.some(b=>b.id===publicBoard.id),true);assert.equal(open.clubBoards.some(b=>b.id===clubBoard.id),false);
   assert.equal(open.clubs.find(c=>c.id===club)?.members.some(m=>m.id===member),false);
  });
  await t.test('board directories inherit authorized club visibility while a known open QR stays playable',async()=>{
   const hidden=(await run(admin,{type:'club.create',name:'Hidden physical board fixture club'})).id!;clubs.push(hidden);
   await owner.query("update dartflow_private.platform_entities set visibility='private' where id=$1",[hidden]);
   const board=await create(hidden,'Hidden physical board fixture name');
   const guestPlatform=await getPlatformOverview(guest),serialized=JSON.stringify(guestPlatform);
   assert.equal(guestPlatform.clubs.some(c=>c.id===hidden),false);assert.equal(guestPlatform.clubBoards.some(b=>b.id===board.id),false);
   assert.equal(serialized.includes(hidden),false);assert.equal(serialized.includes(board.id),false);assert.equal(serialized.includes(board.name),false);
   assert.equal((await getPlatformOverview(admin)).clubBoards.some(b=>b.id===board.id),true);
   assert.equal((await getBoardForActor(guest,board.id)).canStart,true);assert.equal((await getClubBoardScreen(board.id)).board.id,board.id);
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[hidden,guest])).rowCount,0);
  });
  await t.test('concurrent same-name creation is serialized and rolls back its extra container',async()=>{
   const before=Number((await owner.query('select count(*) as n from dartflow_private.events where club_id=$1',[club])).rows[0].n);
   const results=await Promise.allSettled([create(club,'Zelfde baan'),create(club,'zelfde BAAN')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(Number((await owner.query('select count(*) as n from dartflow_private.events where club_id=$1',[club])).rows[0].n),before+1);
  });
  await t.test('a single physical board serializes claims and publishes only safe live solo scores',async()=>{
   const race=await Promise.allSettled([run(guest,{type:'board.start',boardId:publicBoard.id,mode:'solo'}),run(secondGuest,{type:'board.start',boardId:publicBoard.id,mode:'solo'})]);
   assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
   const first=race[0].status==='fulfilled'?race[0].value:(race[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value,actor=race[0].status==='fulfilled'?guest:secondGuest;
   assert.equal((await getClubBoardScreen(publicBoard.id)).status,'playing');
   await assert.rejects(run(admin,{type:'club-board.update',boardId:publicBoard.id,access:'club'}),{code:'board_occupied'});
   await assert.rejects(run(admin,{type:'club-board.update',boardId:publicBoard.id,blocked:true}),{code:'board_occupied'});
   const scored=await run(actor,{type:'training.score',id:first.id,score:180},randomUUID(),first.entity!.revision);
   const screen=await getClubBoardScreen(publicBoard.id);assert.equal(screen.snapshot.match?.remaining[0],321);assert.equal(screen.snapshot.match?.writerId,'');
   assert.deepEqual(screen.snapshot.match?.players.map(p=>p.id),['player-1']);assert.equal(screen.board.playUrl,publicBoard.playUrl);
   const serialized=JSON.stringify(screen);for(const id of [...people,first.id,eventId,club])assert.equal(serialized.includes(id!),false);assert.equal(serialized.includes('@example.test'),false);assert.equal(serialized.includes(String(first.screenUrl)),false);
   await run(actor,{type:'training.finish',id:first.id},randomUUID(),scored.entity!.revision);
   assert.equal((await getClubBoardScreen(publicBoard.id)).status,'available');assert.equal((await getClubBoardScreen(publicBoard.id)).snapshot.match,null);
  });
  await t.test('two outside accounts join the fixed QR, play one authoritative match, and release the same display',async()=>{
   const local=await run(guest,{type:'board.start',boardId:publicBoard.id,mode:'local',startScore:301,bestOfLegs:1});
   assert.equal((await getClubBoardScreen(publicBoard.id)).status,'waiting');
   assert.equal((await getBoardForActor(secondGuest,publicBoard.id)).pendingLobbyId,local.id);
   await run(secondGuest,{type:'lobby.join',id:local.id,boardId:publicBoard.id});await run(guest,{type:'lobby.ready',id:local.id});await run(secondGuest,{type:'lobby.ready',id:local.id});
   const started=await run(guest,{type:'lobby.start',id:local.id});let match=await getMatch(guest,started.matchId!);
   assert.equal(match.boardId,publicBoard.id);assert.equal((await getPlatformOverview(guest)).matches.some(m=>m.id===match.id),true);
   assert.deepEqual((await getMatchSignals(guest,match.id)).signals,[]);await assert.rejects(getMatch(otherOwner,match.id),{status:403});
   const send=async(actor:string,action:MatchAction)=>{match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});};
   await send(guest,{type:'accept'});await send(secondGuest,{type:'accept'});await send(secondGuest,{type:'start'});await send(guest,{type:'score',score:180});
   await owner.query("update dartflow_private.matches set state=jsonb_set(jsonb_set(jsonb_set(state,'{privateOperatorNote}','\"private-board-fixture-secret\"'),'{settings,privateKey}','\"private-board-fixture-secret\"'),'{players,0,email}','\"private@example.test\"') where id=$1",[match.id]);
   const screen=await getClubBoardScreen(publicBoard.id);assert.equal(JSON.stringify(screen).includes('private-board-fixture-secret'),false);assert.equal(JSON.stringify(screen).includes('private@example.test'),false);assert.equal(screen.snapshot.match?.remaining[0],121);assert.equal(screen.snapshot.match?.id,`board-${publicBoard.id}`);assert.equal(JSON.stringify(screen).includes(match.id),false);
   await send(guest,{type:'score',score:0});await send(guest,{type:'score',score:121,doubleConfirmed:true});await send(guest,{type:'confirm'});await send(secondGuest,{type:'confirm'});await reconcilePlatformResults();
   assert.equal((await getClubBoardScreen(publicBoard.id)).status,'available');assert.equal((await getClubBoardScreen(publicBoard.id)).board.playUrl,publicBoard.playUrl);
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=any($2::uuid[])',[club,[guest,secondGuest]])).rowCount,0);
  });
  await t.test('current bans and blocks defeat lookup, starts, and receipt replay without changing public screen access',async()=>{
   const board=await create(club,'Moderatiebaan');const requestId=randomUUID();const training=await run(guest,{type:'board.start',boardId:board.id,mode:'solo'},requestId);
   await owner.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status,attributes) values($1,$2,'member','banned','{}')",[club,guest]);
   await assert.rejects(getBoardForActor(guest,board.id),{status:403});await assert.rejects(run(guest,{type:'board.start',boardId:board.id,mode:'solo'},requestId),{status:403});
   await assert.rejects(run(guest,{type:'training.score',id:training.id,score:60},randomUUID(),training.entity!.revision),{status:403});
   assert.equal((await getPlatformOverview(guest)).clubBoards.some(b=>b.id===board.id),false);
   assert.equal((await getClubBoardScreen(board.id)).board.id,board.id);
   await run(guest,{type:'training.finish',id:training.id},randomUUID(),training.entity!.revision);
   await owner.query('delete from dartflow_private.platform_members where entity_id=$1 and user_id=$2',[club,guest]);
   await owner.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'block')",[admin,guest]);
   await assert.rejects(getBoardForActor(guest,board.id),{status:403});await assert.rejects(run(guest,{type:'board.start',boardId:board.id,mode:'solo'}),{status:403});
   await owner.query('delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2',[admin,guest]);
  });
  await t.test('independent location grants survive club demotion and are checked again on receipt replay',async()=>{
   await run(admin,{type:'club.role',id:club,userId:member,role:'admin'});
   await run(member,{type:'location.enable-venue'});
   const req=randomUUID(),action={type:'club-board.update',boardId:publicBoard.id,name:'Hernoemde verenigingsbaan'};
   await assert.rejects(run(member,action,req),{status:403});
   const locationId=(await owner.query('select location_id from dartflow_private.location_boards where board_id=$1',[publicBoard.id])).rows[0].location_id;
   await run(admin,{type:'location.manager.add',locationId,userId:member});
   const createReq=randomUUID(),createAction={type:'club-board.create',clubId:club,name:'Gedelegeerde beheerdersbaan'};await run(member,createAction,createReq);
   await run(member,action,req);assert.equal((await getClubBoardScreen(publicBoard.id)).board.name,action.name);
   await run(admin,{type:'club.role',id:club,userId:member,role:'member'});
   await run(member,createAction,createReq);await run(member,action,req);
   await assert.rejects(run(member,{...createAction,name:'Missing current club setup right'}),{status:403});
   await run(admin,{type:'location.manager.remove',locationId,userId:member});
   await assert.rejects(run(member,action,req),{status:403});await assert.rejects(run(member,{type:'club-board.update',boardId:publicBoard.id,blocked:true}),{status:403});
   await assert.rejects(run(otherOwner,{type:'club-board.update',boardId:publicBoard.id,name:'Cross-club change'}),{status:403});
  });
  await t.test('a queued creation rechecks the current manager role after waiting for a concurrent demotion',async()=>{
   await run(admin,{type:'club.role',id:club,userId:member,role:'admin'});
   const countBefore=Number((await owner.query('select count(*) as n from dartflow_private.club_boards where club_id=$1',[club])).rows[0].n);
   await owner.query('begin');await owner.query('select id from dartflow_private.platform_entities where id=$1 for update',[club]);
   const queued=Promise.allSettled([run(member,{type:'club-board.create',clubId:club,name:'Queued demoted-admin board'})]);
   try{
   let blocked=false;
   for(let attempt=0;attempt<50&&!blocked;attempt++){
    await owner.query('select pg_stat_clear_snapshot()');
    blocked=Boolean((await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select id from dartflow_private.platform_entities where id=$1 and kind=%') as blocked")).rows[0].blocked);
    if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(blocked,true,'The queued creation must be waiting for the actual club lock.');
   await owner.query("update dartflow_private.platform_members set role='member' where entity_id=$1 and user_id=$2",[club,member]);
   await owner.query("update dartflow_private.club_memberships set role='player' where club_id=$1 and user_id=$2",[club,member]);
   await owner.query('update dartflow_private.platform_entities set revision=revision+1,updated_at=now() where id=$1',[club]);await owner.query('commit');
   }finally{await owner.query('rollback');}
   const result=(await queued)[0];assert.equal(result.status,'rejected');assert.equal(result.status==='rejected'?result.reason.status:null,403);
   assert.equal(Number((await owner.query('select count(*) as n from dartflow_private.club_boards where club_id=$1',[club])).rows[0].n),countBefore);
  });
  await t.test('inactive clubs stop member-only play while physical ownership and public screen links stay independent',async()=>{
   await run(admin,{type:'club.deactivate',id:club});
   await assert.rejects(getBoardForActor(member,clubBoard.id),{status:403});await assert.rejects(run(member,{type:'board.start',boardId:clubBoard.id,mode:'solo'}),{status:403});
   assert.equal((await getPlatformOverview(member)).clubBoards.some(b=>b.id===clubBoard.id),false);
   await run(admin,{type:'club-board.update',boardId:clubBoard.id,name:'Fysiek beheer blijft onafhankelijk'});
   assert.equal((await getClubBoardScreen(clubBoard.id)).board.name,'Fysiek beheer blijft onafhankelijk');
   assert.equal((await getBoardForActor(guest,publicBoard.id)).canStart,true);
   const practice=await run(guest,{type:'board.start',boardId:publicBoard.id,mode:'solo'});await run(guest,{type:'training.finish',id:practice.id},randomUUID(),practice.entity!.revision);
   await run(admin,{type:'club.restore',id:club});assert.equal((await getBoardForActor(member,clubBoard.id)).canStart,true);
  });
  await t.test('a queued open claim rechecks access after a completed restriction and stable QR survives rename and unblock',async()=>{
   const board=await create(club,'Toegangscontrolebaan');
   await owner.query('begin');const row=await owner.query('select event_id from dartflow_private.club_boards where board_id=$1',[board.id]);await owner.query('select id from dartflow_private.events where id=$1 for update',[row.rows[0].event_id]);
   const queued=Promise.allSettled([run(guest,{type:'board.start',boardId:board.id,mode:'solo'})]);await new Promise(resolve=>setTimeout(resolve,30));
   await owner.query("update dartflow_private.club_boards set access='club' where board_id=$1",[board.id]);await owner.query('commit');
   const result=(await queued)[0];assert.equal(result.status,'rejected');assert.equal(result.status==='rejected'?result.reason.status:null,403);
   await run(admin,{type:'club-board.update',boardId:board.id,name:'Gerenoveerde baan',blocked:true});assert.equal((await getBoardForActor(member,board.id)).canStart,false);assert.equal((await getClubBoardScreen(board.id)).status,'blocked');
   await run(admin,{type:'club-board.update',boardId:board.id,access:'all',blocked:false});const updated=await getClubBoardScreen(board.id);assert.equal(updated.board.playUrl,board.playUrl);assert.equal(updated.board.screenUrl,board.screenUrl);assert.equal((await getBoardForActor(guest,board.id)).canStart,true);
   await assert.rejects(getClubBoardScreen(randomUUID()),{status:404});
  });
 }finally{
  try{
  await owner.query('rollback');
  await owner.query('begin');
  const cleanupClubs=[...new Set([...clubs,...(await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])',[people])).rows.map(row=>row.club_id)])];
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  const events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[cleanupClubs])).rows.map(r=>r.id);
  const matches=(await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(r=>r.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(p=>`user:${p}`)]);
  for(const table of ['platform_signals','platform_match_links','action_receipts','match_confirmations','visits','match_results','match_players'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  for(const table of ['platform_cast_grants','platform_messages','platform_reports','platform_audit','platform_members'])await owner.query(`delete from dartflow_private.${table} where ${['platform_messages','platform_reports'].includes(table)?'room_id':'entity_id'}=any($1::uuid[])`,[entities]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  await owner.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[]) or event_id=any($2::uuid[])',[people,events]);await owner.query('delete from dartflow_private.screen_capabilities where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);await owner.query('delete from dartflow_private.standings where event_id=any($1::uuid[])',[events]);
  await owner.query('delete from dartflow_private.club_boards where club_id=any($1::uuid[])',[cleanupClubs]);
  const locationIds=(await owner.query('select distinct location_id from dartflow_private.location_boards where home_event_id=any($1::uuid[])',[events])).rows.map(row=>row.location_id);
  await owner.query('delete from dartflow_private.location_boards where home_event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.location_members where location_id=any($1::uuid[])',[locationIds]);await owner.query('delete from dartflow_private.locations where id=any($1::uuid[])',[locationIds]);await owner.query('delete from dartflow_private.location_accounts where user_id=any($1::uuid[])',[people]);
  for(const table of ['boards','entries','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[cleanupClubs]);await owner.query('delete from dartflow_private.club_join_requests where club_id=any($1::uuid[])',[cleanupClubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[cleanupClubs]);
  await owner.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.query('commit');
  }finally{await owner.query('rollback').catch(()=>undefined);await owner.end();await closeDatabase();}
 }
});
