import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { closeDatabase,createScreen,executeMatchCommand,getMatch,getMatchInvitation,getPublicSnapshot } from '../lib/db';
import { executePlatformCommand } from '../lib/platform';
import type { MatchAction } from '../lib/types';
import type { PlatformCommand } from '../lib/platform-types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies the loopback fixture. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('persisted remote/hybrid setup gives each account its own turn while local writers, receipts and Sprint stay consistent',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const a=randomUUID(),b=randomUUID(),people=[a,b];
 const run=(actor:string,action:PlatformCommand['action'])=>executePlatformCommand(actor,{requestId:randomUUID(),action});
 const migration=(await readFile(new URL('../supabase/migrations/20261111203744_per_player_remote_scoring.sql',import.meta.url),'utf8')).replace(/^\s*(?:begin|commit);\s*$/gmi,'');
 try{
  for(const [index,id] of people.entries())await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Per-player fixture ${index}`]);
  for(const setup of ['remote','hybrid','localone','localtwo'])await t.test(`${setup}: server-derived input, no duplicate throw and scoped migration`,async()=>{
   const ownTurns=['remote','hybrid'].includes(setup);
   const lobby=await run(a,{type:'lobby.create',opponentId:b,setup,startScore:301,bestOfLegs:1,scoringMode:ownTurns?'shared-writer':'per-player'});
   await run(b,{type:'lobby.join',id:lobby.id,code:lobby.code});
   if(setup==='hybrid')await run(a,{type:'lobby.starter',id:lobby.id,starterId:b});
   await run(a,{type:'lobby.ready',id:lobby.id});await run(b,{type:'lobby.ready',id:lobby.id});
   const started=await run(a,{type:'lobby.start',id:lobby.id});let match=await getMatch(a,started.matchId!);
   assert.equal(match.scoringMode,ownTurns?'per-player':'shared-writer');
   const board=randomUUID();await owner.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[board,match.eventId,`Per-player fixture ${setup}`]);
   const send=async(actor:string,action:MatchAction)=>match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});
   await send(a,{type:'call',boardId:board});await send(a,{type:'accept'});await send(b,{type:'accept'});await send(a,{type:'start'});
   const screen=await createScreen(a,match.eventId,board);
   assert.deepEqual(await getMatchInvitation(b,match.id),{code:lobby.code,path:`/w/${lobby.code}`});
   await assert.rejects(getMatchInvitation(randomUUID(),match.id),{status:403});
   const verifyShared=async()=>{
    const [one,two,snapshot]=await Promise.all([getMatch(a,match.id),getMatch(b,match.id),getPublicSnapshot(screen.token)]);
    assert.deepEqual(one.remaining,two.remaining);assert.equal(one.turn,two.turn);assert.equal(one.revision,two.revision);
    assert.deepEqual(snapshot.match?.remaining,one.remaining);assert.equal(snapshot.match?.turn,one.turn);assert.equal(snapshot.match?.revision,one.revision);
    assert.equal('invitation' in snapshot.match!,false);
    if(one.status==='live'){
     assert.equal(one.permissions.canWrite,ownTurns?one.players[one.turn].id===a:one.writerId===a);
     assert.equal(two.permissions.canWrite,ownTurns?two.players[two.turn].id===b:two.writerId===b);
    }
   };
   await verifyShared();
   const first=ownTurns?match.players[match.turn].id:a,second=ownTurns?people.find(id=>id!==first)!:a;
   if(ownTurns){
    assert.equal((await getMatch(first,match.id)).permissions.canWrite,true);
    assert.equal((await getMatch(second,match.id)).permissions.canTakeOver,false);
    await assert.rejects(send(second,{type:'score',score:60}),{code:'not_your_turn'});
    await assert.rejects(send(second,{type:'take-over'}),{code:'per_player_scoring'});
   }
   const command={requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action:{type:'score' as const,score:180}};
   const duplicate=await Promise.all([executeMatchCommand(first,command),executeMatchCommand(first,command)]);
   assert.deepEqual(duplicate[0],duplicate[1]);match=duplicate[0];assert.equal(match.visits.length,1);
   await assert.rejects(executeMatchCommand(first,{...command,requestId:randomUUID()}),{code:'revision_conflict'});
   await assert.rejects(executeMatchCommand(first,{...command,action:{type:'score',score:60}}),{code:'request_reused'});
   if(ownTurns){assert.equal((await getMatch(second,match.id)).permissions.canWrite,true);await assert.rejects(send(first,{type:'score',score:60}),{code:'not_your_turn'});}
   await verifyShared();

   // Run the actual data fix inside a rollback-only transaction, including a second idempotence pass.
   await owner.query('begin');
   try{
    await owner.query("update dartflow_private.matches set state=(state-'scoringMode')||jsonb_build_object('writerId',$2::text) where id=$1",[match.id,first]);
    const prior=(await owner.query('select state,revision from dartflow_private.matches where id=$1',[match.id])).rows[0];
    await owner.query(migration);
    const changed=(await owner.query('select state,revision from dartflow_private.matches where id=$1',[match.id])).rows[0];
    assert.deepEqual(changed.state.game,prior.state.game);assert.deepEqual(changed.state.previousSets,prior.state.previousSets);
    if(ownTurns){assert.equal(changed.state.scoringMode,'per-player');assert.equal(changed.state.writerId,second);assert.equal(changed.revision,prior.revision+1);assert.equal(changed.state.revision,changed.revision);}
    else assert.deepEqual(changed,prior);
    await owner.query(migration);assert.deepEqual((await owner.query('select state,revision from dartflow_private.matches where id=$1',[match.id])).rows[0],changed);
   }finally{await owner.query('rollback');}

   await send(second,{type:'score',score:0});await verifyShared();
   const replay=await executeMatchCommand(first,command);assert.equal(replay.visits.length,1);assert.equal((await getMatch(first,match.id)).visits.length,2);
   await send(first,{type:'score',score:121,doubleConfirmed:true});assert.equal(match.status,'result');await verifyShared();
   await send(a,{type:'confirm'});await send(b,{type:'confirm'});assert.equal(match.resultPublished,true);
   const published=(await owner.query('select snapshot from dartflow_private.match_results where match_id=$1',[match.id])).rows[0].snapshot;
   await owner.query('begin');
   try{
    await owner.query("update dartflow_private.matches set state=state-'scoringMode' where id=$1",[match.id]);
    const prior=(await owner.query('select state,revision from dartflow_private.matches where id=$1',[match.id])).rows[0];
    await owner.query(migration);assert.deepEqual((await owner.query('select state,revision from dartflow_private.matches where id=$1',[match.id])).rows[0],prior);
    assert.deepEqual((await owner.query('select snapshot from dartflow_private.match_results where match_id=$1',[match.id])).rows[0].snapshot,published);
   }finally{await owner.query('rollback');}
  });
 }finally{
  const clubs=(await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])',[people])).rows.map(row=>row.club_id);
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  const events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[clubs])).rows.map(row=>row.id);
  const matches=(await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);
  await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  for(const table of ['platform_signals','platform_match_links'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[entities]);
  await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);
  for(const table of ['action_receipts','match_confirmations','visits','match_results','match_players'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  for(const table of ['standings','audit_events','screen_capabilities'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  for(const table of ['matches','entries','boards','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);
  await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);
  await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);
  await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  await owner.end();await closeDatabase();
 }
});
