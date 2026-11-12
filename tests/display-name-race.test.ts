import {beginFixtureCleanup} from './helpers/cleanup-v17';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeDatabase, getMatch, getProfile } from '../lib/db';
import { executePlatformCommand } from '../lib/platform';
import { createCoreMatch, entity, save } from '../lib/platform-store';
import { saveScoreboardName } from '../lib/profile-name';
import type { PlatformCommand } from '../lib/platform-types';
import type { MatchState } from '../lib/types';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies explicit loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);

test('profile confirmation and concurrent match creation keep one current scoreboard name',{skip:!configured},async t=>{
 const adminPool=new pg.Pool({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL,max:3}),owner=await adminPool.connect(),holder=await adminPool.connect();
 const host=randomUUID(),legacy=randomUUID(),renamer=randomUUID(),secondHost=randomUUID(),people=[host,legacy,renamer,secondHost];
 const run=(actor:string,action:PlatformCommand['action'])=>executePlatformCommand(actor,{requestId:randomUUID(),action});
 const settings={startScore:501 as const,bestOfLegs:3,bestOfSets:1};
 async function waitForLock(pattern:string){
  for(let attempt=0;attempt<100;attempt++){
   await owner.query('select pg_stat_clear_snapshot()');
   const {rows}=await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1) as waiting",[pattern]);
   if(rows[0].waiting)return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('The concurrent command did not reach its expected real PostgreSQL lock.');
 }
 try{
  await owner.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true),($3,$4,false),($5,$6,true),($7,$8,true)',[host,'Name race host',legacy,'Nieuwe speler',renamer,'Original board name',secondHost,'Second name race host']);
  await t.test('a starting lobby waits for profile confirmation and snapshots the confirmed chosen name',async()=>{
   const lobby=await run(host,{type:'lobby.create',name:'Profile confirmation race fixture',setup:'remote'});
   // A pre-existing lobby may contain a legacy placeholder account at migration time.
   await owner.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status,attributes) values($1,$2,'member','active','{}')",[lobby.id,legacy]);
   await owner.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{ready}',$2::jsonb) where id=$1",[lobby.id,JSON.stringify({[host]:true,[legacy]:true})]);
   let queued:Promise<PromiseSettledResult<Awaited<ReturnType<typeof run>>>[]>|undefined;
   try{
    await holder.query('begin');await saveScoreboardName(holder,legacy,'Confirmed chosen name');
    queued=Promise.allSettled([run(host,{type:'lobby.start',id:lobby.id})]);
    await waitForLock('select id,name from dartflow_private.profiles where id=any%for share');
    await holder.query('commit');
    const [result]=await queued;assert.equal(result.status,'fulfilled');
    const match=await getMatch(legacy,result.value.matchId!);assert.deepEqual(match.players.map(p=>p.name),['Name race host','Confirmed chosen name']);
    assert.equal((await getProfile(legacy)).name,'Confirmed chosen name');assert.equal(match.scoringMode,'per-player');
   }finally{await holder.query('rollback');if(queued)await queued;}
  });
  await t.test('a rename waiting for a new match rescans that newly committed match and preserves every score',async()=>{
   const lobby=await run(secondHost,{type:'lobby.create',name:'Profile rename race fixture',setup:'hybrid'});
   let queued:Promise<PromiseSettledResult<Awaited<ReturnType<typeof run>>>[]>|undefined;
   try{
    await holder.query('begin');
    const row=await entity(holder,lobby.id,true);
    const matchId=await createCoreMatch(holder,row,[secondHost,renamer],settings,'name-race');
    row.state.matchId=matchId;await save(holder,row);
    const original=(await holder.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[matchId])).rows[0].state;
    queued=Promise.allSettled([run(renamer,{type:'profile.update',name:'Concurrent chosen name'})]);
    await waitForLock('update dartflow_private.profiles set name=$2,display_name_confirmed=true where id=$1');
    await holder.query('commit');
    const [result]=await queued;assert.equal(result.status,'fulfilled');
    const match=await getMatch(renamer,matchId),state=(await owner.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[matchId])).rows[0].state;
    assert.equal(match.players[1].name,'Concurrent chosen name');assert.equal((await getProfile(renamer)).name,'Concurrent chosen name');
    assert.deepEqual(state.game,original.game);assert.deepEqual(state.accepted,original.accepted);assert.deepEqual(state.confirmations,original.confirmations);assert.equal(state.revision,original.revision+1);
   }finally{await holder.query('rollback');if(queued)await queued;}
  });
 }finally{
  await holder.query('rollback');
  await beginFixtureCleanup(owner,people);
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  const clubs=(await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])',[people])).rows.map(r=>r.club_id);
  const events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[clubs])).rows.map(r=>r.id);
  const matches=(await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(r=>r.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(p=>`user:${p}`)]);
  for(const table of ['platform_signals','platform_match_links','action_receipts','match_confirmations','visits','match_results','match_players'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  await owner.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[entities]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  await owner.query('delete from dartflow_private.entries where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.event_staff where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);
  await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);owner.release();holder.release();await adminPool.end();await closeDatabase();
 }
});
