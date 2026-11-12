import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database,executeMatchCommand,getMatch} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
import {readBoardActivity,releaseBoardActivity} from '../lib/board-activity';
try{process.loadEnvFile('.env.local');}catch{/* CI injects a loopback database. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);

test('remote match start rechecks a secondary board reservation that becomes active after binding',{skip:!configured},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const suffix=randomUUID().slice(0,8),p=randomUUID(),q=randomUUID(),people=[p,q],club=randomUUID(),event=randomUUID(),secondaryEvent=randomUUID(),a=randomUUID(),b=randomUUID(),location=randomUUID(),reservation=randomUUID();
 let lobby='',matchId='';
 try{
  for(const[index,id]of people.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true)',[id,`Start${index}-${suffix}`]);
  await admin.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,`Remote start ${suffix}`]);
  for(const id of people)await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player')",[club,id]);
  for(const id of [event,secondaryEvent])await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,8)',[id,club,`Start ${id}`]);
  for(const[id,eventId]of [[a,event],[b,secondaryEvent]])await admin.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[id,eventId,`Start ${id}`]);
  await admin.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'venue',$3)",[location,q,`Secondary venue ${suffix}`]);
  await admin.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,reservation_enabled) values($1,$2,$3,true)',[b,location,secondaryEvent]);
  // An already approved future reservation does not prevent the initial remote binding.
  await admin.query("insert into dartflow_private.board_reservations(id,location_id,requester_id,club_id,event_id,starts_at,ends_at,board_count,max_matches,status) values($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',1,1,'accepted')",[reservation,location,p,club,event]);
  await admin.query('insert into dartflow_private.reservation_boards(reservation_id,board_id) values($1,$2)',[reservation,b]);
  const created=await executePlatformCommand(p,{requestId:randomUUID(),action:{type:'board.start',boardId:a,mode:'remote'}});lobby=created.id!;
  await executePlatformCommand(q,{requestId:randomUUID(),action:{type:'lobby.join',id:lobby,code:created.code}});
  await executePlatformCommand(q,{requestId:randomUUID(),action:{type:'lobby.board.bind',id:lobby,boardId:b}});
  for(const actor of people)await executePlatformCommand(actor,{requestId:randomUUID(),action:{type:'lobby.ready',id:lobby}});
  const called=await executePlatformCommand(p,{requestId:randomUUID(),action:{type:'lobby.start',id:lobby}});matchId=called.matchId!;
  for(const actor of people){const current=await getMatch(actor,matchId);await executeMatchCommand(actor,{requestId:randomUUID(),matchId,expectedRevision:current.revision,action:{type:'accept'}});}
  const ready=await getMatch(p,matchId);assert.equal(ready.status,'ready');
  // Advance only this fixture's reservation window, never the server/activity clock.
  await admin.query("update dartflow_private.board_reservations set starts_at=clock_timestamp()-interval '1 second' where id=$1",[reservation]);
  await assert.rejects(executeMatchCommand(p,{requestId:randomUUID(),matchId,expectedRevision:ready.revision,action:{type:'start'}}),{code:'board_reserved'});
  const unchanged=await getMatch(p,matchId);assert.equal(unchanged.status,'ready');assert.equal(unchanged.revision,ready.revision);
  for(const id of [a,b])assert.equal(await readBoardActivity(database(),id),null);
  // Releasing that reservation makes the same ready match start normally on both boards.
  await admin.query("update dartflow_private.board_reservations set status='cancelled' where id=$1",[reservation]);
  const live=await executeMatchCommand(p,{requestId:randomUUID(),matchId,expectedRevision:ready.revision,action:{type:'start'}});
  assert.equal(live.status,'live');assert.deepEqual(live.boardActivity!.boardIds,[a,b].sort());
  const client=await database().connect();try{await client.query('begin');await releaseBoardActivity(client,{sessionId:live.boardActivity!.sessionId,reason:'forced',actorId:q});await client.query('commit');}catch(error){await client.query('rollback');throw error;}finally{client.release();}
 }finally{
  await admin.query('begin');
  try{
   await admin.query('delete from dartflow_private.board_activity_sessions where event_id=$1',[event]);
   await admin.query('delete from dartflow_private.reservation_matches where reservation_id=$1',[reservation]);await admin.query('delete from dartflow_private.reservation_boards where reservation_id=$1',[reservation]);await admin.query('delete from dartflow_private.board_reservations where id=$1',[reservation]);
   for(const table of ['mail_outbox','mail_events'])await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[people.map(id=>`user:${id}`)]);
   for(const table of ['visits','match_confirmations','match_results','action_receipts','match_players','platform_match_links'])await admin.query(`delete from dartflow_private.${table} where match_id=$1`,[matchId||null]);
   await admin.query('delete from dartflow_private.audit_events where event_id=any($1::uuid[])',[[event,secondaryEvent]]);
   await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.matches where id=$1',[matchId||null]);await admin.query('delete from dartflow_private.invitation_codes where entity_id=$1',[lobby||null]);await admin.query('delete from dartflow_private.platform_entities where id=$1',[lobby||null]);
   await admin.query('delete from dartflow_private.screen_capabilities where event_id=$1',[event]);await admin.query('delete from dartflow_private.entries where event_id=$1',[event]);
   await admin.query('delete from dartflow_private.location_boards where location_id=$1',[location]);await admin.query('delete from dartflow_private.locations where id=$1',[location]);
   await admin.query('delete from dartflow_private.boards where id=any($1::uuid[])',[[a,b]]);await admin.query('delete from dartflow_private.events where id=any($1::uuid[])',[[event,secondaryEvent]]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}finally{await admin.end();await closeDatabase();}
 }
});
