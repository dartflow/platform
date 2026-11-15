import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/[...path]/route';
import {closeDatabase} from '../lib/db';
import type {MatchAction,MatchView,Profile} from '../lib/types';
import type {PlatformEntity,PlatformResponse} from '../lib/platform-types';
import type {PlayerStatisticsResponse} from '../lib/player-statistics-types';
import {invitationAttemptRequired} from '../lib/invitations';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback development credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_APP_ORIGIN);
const first='00000000-0000-4000-8000-000000000002',second='00000000-0000-4000-8000-000000000003';

/** No API, database, score engine, clock, command or statistics adapters are stubbed.
 * The loopback fixture bearer replaces only the external Google/OTP login roundtrip. */
test('native player real API flows keep lobby, flattened score DTO, authoritative turns, retries and finished statistics consistent',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const origin=process.env.DARTFLOW_APP_ORIGIN!,prefix=`Native player flow ${randomUUID()}`;
 const tokens=new Map<string,string>(),entities:string[]=[],commandIds:string[]=[],limits=new Map<string,{key:string;resetAt:string;consumed:number}>();
 const beforeProfiles=(await admin.query('select * from dartflow_private.profiles where id=any($1::uuid[]) order by id',[[first,second]])).rows;
 assert.equal(beforeProfiles.length,2,'The standard local development accounts must exist.');
 const call=async<T>(actor:string|null,path:string,method='GET',input?:unknown,status=200):Promise<T>=>{
  const url=new URL(`/api/player/v1/${path}`,origin),parts=url.pathname.slice('/api/'.length).split('/');
  const req=new NextRequest(url,{method,headers:{host:url.host,...(actor?{authorization:`Bearer ${tokens.get(actor)??''}`} :{}),...(input!==undefined?{'Content-Type':'application/json'}:{})},...(input!==undefined?{body:JSON.stringify(input)}:{})});
  const response=await(method==='GET'?GET:POST)(req,{params:Promise.resolve({path:parts})});
  // Count only this fixture's real requests, preserving other clients' requests
  // on these shared test-account counters. Window IDs make cleanup safe at reset.
  const keys=actor?[`native-player:ip:${createHash('sha256').update('direct').digest('hex')}`,`native-player:actor:${actor}:${method==='GET'?'read':'write'}`]:['native-player:local-login'];
  const action=(input as {action?:Record<string,unknown>}|undefined)?.action;
  if(actor&&path==='platform/actions'&&action&&invitationAttemptRequired(action))keys.push(`invite:ip:${createHash('sha256').update('loopback').digest('hex')}`,`invite:actor:${actor}`,'invite:global');
  if(response.status!==429)for(const row of(await admin.query<{key:string;reset_at:string}>('select key,reset_at::text from dartflow_private.auth_limits where key=any($1::text[])',[keys])).rows){const identity=`${row.key}:${row.reset_at}`,prior=limits.get(identity);limits.set(identity,{key:row.key,resetAt:row.reset_at,consumed:(prior?.consumed??0)+1});}
  const data=await response.json();assert.equal(response.status,status,`${method} ${url.pathname}: ${JSON.stringify(data)}`);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.has('set-cookie'),false);return data as T;
 };
 const platform=async(actor:string,action:Record<string,unknown>,expectedRevision?:number,requestId=randomUUID(),status=200)=>{
  commandIds.push(requestId);const result=await call<PlatformResponse&{code?:string}>(actor,'platform/actions','POST',{requestId,action,...(expectedRevision===undefined?{}:{expectedRevision})},status);
  if(status===200&&['lobby.create','training.create'].includes(String(action.type))&&result.id)entities.push(result.id);
  return result;
 };
 const match=async(actor:string,id:string)=>call<MatchView>(actor,`matches/${id}`);
 const matchAction=async(actor:string,view:MatchView,action:MatchAction,requestId=randomUUID(),status=200)=>{
  commandIds.push(requestId);return call<MatchView&{code?:string}>(actor,`matches/${view.id}/actions`,'POST',{requestId,matchId:view.id,expectedRevision:view.revision,action},status);
 };
 const stats=(actor:string)=>call<PlayerStatisticsResponse>(actor,'player-statistics?startScore=301');
 try{
  for(const id of [first,second]){
   const login=await call<{accessToken:string;expiresAt:string}>(null,'auth/local','POST',{userId:id});assert.ok(Date.parse(login.expiresAt)>Date.now());tokens.set(id,login.accessToken);
   const session=await call<{user:Profile;local:boolean;requiresProfileCompletion:boolean}>(id,'session');assert.equal(session.user.id,id);assert.equal(session.local,true);assert.equal(session.user.onboardingComplete,true);
  }
  const baselineFirst=await stats(first),baselineSecond=await stats(second);
  let completed=0;
  for(const setup of ['localone','remote','hybrid'])await t.test(`${setup}: two fixture accounts complete a real native lobby and one shared match`,async()=>{
   const created=await platform(first,{type:'lobby.create',name:`${prefix} ${setup}`,setup,startScore:301,bestOfLegs:1});
   assert.ok(created.id);assert.match(created.code??'',/^[A-Z0-9]{4}$/);assert.equal(created.entity?.kind,'lobby');assert.equal(created.entity?.state.setup,setup);assert.equal(created.entity?.state.settings?.startScore,301);assert.equal(created.entity?.state.ready?.[first],undefined);
   const resolved=await platform(second,{type:'invitation.resolve',code:created.code!.toLowerCase()});assert.equal(resolved.id,created.id);assert.equal(resolved.kind,'lobby');
   await platform(second,{type:'lobby.join',id:created.id,code:created.code});
   let lobby=await call<{lobbies:PlatformEntity[]}>(first,'platform');let current=lobby.lobbies.find(row=>row.id===created.id)!;
   assert.deepEqual(current.members.filter(member=>member.status==='active').map(member=>member.id),[first,second]);
   // These wrappers exactly match entityCommand() and NativePlayerCommand in the Compose app.
   await platform(first,{type:'lobby.ready',id:created.id},current.revision);
   lobby=await call(first,'platform');current=lobby.lobbies.find(row=>row.id===created.id)!;
   await platform(second,{type:'lobby.ready',id:created.id},current.revision);
   lobby=await call(first,'platform');current=lobby.lobbies.find(row=>row.id===created.id)!;
   assert.equal(current.state.ready?.[first],true);assert.equal(current.state.ready?.[second],true);
   const started=await platform(first,{type:'lobby.start',id:created.id},current.revision);assert.ok(started.matchId);
   let view=await match(first,started.matchId!);assert.equal(view.status,'called');assert.equal(view.settings.startScore,301);assert.equal(view.permissions.canAccept,true);assert.equal('game'in view,false);assert.equal('previousSets'in view,false);
   assert.deepEqual(view.players.map(player=>player.id),[first,second]);assert.ok(view.players.every(player=>player.name.length>0));assert.deepEqual(view.remaining,[301,301]);assert.deepEqual(view.currentLegVisits,[]);assert.equal(view.currentLegStartScore,301);
   view=await matchAction(first,view,{type:'accept'});assert.equal(view.accepted[0],true);
   view=await matchAction(second,await match(second,view.id),{type:'accept'});assert.equal(view.status,'ready');assert.equal(view.permissions.canWrite,false,'canWrite is a live-turn permission; the UI must not use it to hide Start in ready state.');
   view=await matchAction(first,await match(first,view.id),{type:'start'});assert.equal(view.status,'live');assert.equal(view.turn,0);assert.equal(view.writerId,first);assert.equal(view.permissions.canScore,true);
   const perPlayer=setup!=='localone';assert.equal(view.scoringMode,perPlayer?'per-player':'shared-writer');
   const other=await match(second,view.id);assert.equal(other.permissions.canScore,false);assert.equal(other.permissions.canTakeOver,!perPlayer);
   await matchAction(second,other,{type:'score',score:60},randomUUID(),403);
   const scoreRequest=randomUUID(),basis=view;
   const [accepted,retry]=await Promise.all([matchAction(first,basis,{type:'score',score:180,darts:3},scoreRequest),matchAction(first,basis,{type:'score',score:180,darts:3},scoreRequest)]);
   assert.deepEqual(accepted,retry);view=accepted;assert.equal(view.revision,basis.revision+1);assert.deepEqual(view.remaining,[121,301]);assert.equal(view.visits.length,1);assert.equal(view.currentLegVisits?.length,1);assert.equal(view.currentLegVisits?.[0].score,180);assert.equal(view.currentLegVisits?.[0].remainingAfter,121);assert.equal(view.stats[0].oneEighties,1);assert.equal(view.stats[0].total,180);assert.equal(view.stats[0].darts,3);
   assert.equal((await matchAction(first,basis,{type:'score',score:140,darts:3},scoreRequest,409)).code,'request_reused');
   assert.equal((await matchAction(first,basis,{type:'score',score:60},randomUUID(),409)).code,'revision_conflict');
   const firstTurn=await match(first,view.id),secondTurn=await match(second,view.id);assert.equal(firstTurn.permissions.canScore,!perPlayer);assert.equal(secondTurn.permissions.canScore,perPlayer);assert.deepEqual(firstTurn.remaining,secondTurn.remaining);assert.equal(firstTurn.turn,secondTurn.turn);
   if(perPlayer)await matchAction(first,firstTurn,{type:'score',score:60},randomUUID(),403);
   view=await matchAction(perPlayer?second:first,perPlayer?secondTurn:firstTurn,{type:'score',score:60,darts:3});assert.deepEqual(view.remaining,[121,241]);assert.equal(view.visits.length,2);assert.equal(view.visits[1].player,second);assert.equal(view.permissions.canScore,!perPlayer);
   view=await matchAction(first,await match(first,view.id),{type:'score',score:121,darts:3,doubleConfirmed:true,doubleAttempts:1});assert.equal(view.status,'result');assert.deepEqual(view.remaining,[0,241]);assert.deepEqual(view.legs,[1,0]);assert.equal(view.stats[0].highestFinish,121);assert.equal(view.stats[0].average,150.5);assert.equal(view.permissions.canConfirm,true);
   view=await matchAction(first,view,{type:'confirm'});view=await matchAction(second,await match(second,view.id),{type:'confirm'});assert.equal(view.status,'confirmed');assert.equal(view.resultPublished,true);completed++;
   const afterFirst=await stats(first),afterSecond=await stats(second);assert.equal(afterFirst.summary.played,baselineFirst.summary.played+completed);assert.equal(afterSecond.summary.played,baselineSecond.summary.played+completed);
   assert.equal(afterFirst.matches.filter(row=>row.id===view.id).length,1);assert.equal(afterSecond.matches.filter(row=>row.id===view.id).length,1);
   assert.equal(afterFirst.matches.find(row=>row.id===view.id)?.result,'W');assert.equal(afterSecond.matches.find(row=>row.id===view.id)?.result,'V');
   assert.ok(afterFirst.opponents.find(row=>row.opponent.id===second)?.recent.some(row=>row.id===view.id));assert.ok(afterSecond.opponents.find(row=>row.opponent.id===first)?.recent.some(row=>row.id===view.id));
   assert.equal((await admin.query('select 1 from dartflow_private.match_results where match_id=$1',[view.id])).rowCount,1);assert.equal((await admin.query('select 1 from dartflow_private.visits where match_id=$1',[view.id])).rowCount,3);
   assert.equal((await call<{user:Profile}>(first,'session')).user.id,first);assert.equal((await call<{user:Profile}>(second,'session')).user.id,second);
  });
  await t.test('solo practice uses real exact-retry, finish and practice statistics without changing played match totals',async()=>{
   const before=await stats(first),created=await platform(first,{type:'training.create',mode:'solo',startScore:501});assert.ok(created.id);assert.equal(created.entity?.state.game?.remaining[0],501);assert.equal(created.entity?.state.mode,'solo');
   const command={type:'training.score',id:created.id,score:180,darts:3},requestId=randomUUID();
   const [accepted,retry]=await Promise.all([platform(first,command,created.entity!.revision,requestId),platform(first,command,created.entity!.revision,requestId)]);assert.deepEqual(accepted,retry);assert.equal(accepted.entity?.state.game?.remaining[0],321);assert.equal(accepted.entity?.state.game?.visits.length,1);
   assert.equal((await platform(first,{...command,score:60},created.entity!.revision,requestId,409)).code,'request_reused');assert.equal((await platform(first,command,created.entity!.revision,randomUUID(),409)).code,'revision_conflict');
   await platform(second,command,accepted.entity!.revision,randomUUID(),403);
   let progress=accepted;for(const score of [100,100,81])progress=await platform(first,{type:'training.score',id:created.id,score,darts:3},progress.entity!.revision);
   const finished=await platform(first,{type:'training.score',id:created.id,score:40,darts:3,doubleConfirmed:true,doubleAttempts:1},progress.entity!.revision);assert.equal(finished.entity?.state.completed,true);assert.equal(finished.entity?.state.game?.status,'finished');assert.equal(finished.entity?.state.game?.remaining[0],0);
   const saved=await platform(first,{type:'training.finish',id:created.id},finished.entity!.revision);assert.equal(saved.entity?.state.completed,true);
   const state=await call<{trainings:PlatformEntity[]}>(first,'platform');assert.equal(state.trainings.find(row=>row.id===created.id)?.state.game?.visits.length,5);
   const after=await stats(first);assert.equal(after.summary.played,before.summary.played);assert.equal(after.practice.pagination.total,before.practice.pagination.total+1);const session=after.practice.sessions.find(row=>row.id===created.id);assert.ok(session);assert.equal(session.average,100.2);assert.equal(session.darts,15);assert.equal(session.highestFinish,40);assert.equal(after.matches.some(row=>row.id===created.id),false);
  });
 }finally{
  // Fixed local accounts are never deleted or broadly cleaned. Every deletion is
  // restricted to the UUIDs/receipts produced by this test, in one cleanup transaction.
  try{
   await admin.query('begin');
   const recovered=(await admin.query<{id:string}>('select distinct response->>\'id\' id from dartflow_private.platform_receipts where actor_id=any($1::uuid[]) and request_id=any($2::uuid[]) and response->>\'id\' is not null',[[first,second],commandIds])).rows.map(row=>row.id);
   const ownEntities=[...new Set([...entities,...recovered])];
   const events=(await admin.query<{id:string}>('select distinct state->>\'eventId\' id from dartflow_private.platform_entities where id=any($1::uuid[]) and state->>\'eventId\' is not null',[ownEntities])).rows.map(row=>row.id);
   const clubs=(await admin.query<{club_id:string}>('select distinct club_id from dartflow_private.events where id=any($1::uuid[])',[events])).rows.map(row=>row.club_id);
   const matches=(await admin.query<{id:string}>('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id);
   const patterns=[...commandIds,...matches].map(id=>`%${id}%`),jobs=(await admin.query<{id:string}>('select id from dartflow_private.mail_outbox where entity_id=any($1::uuid[]) or event_id like any($2::text[])',[[...ownEntities,...matches],patterns])).rows.map(row=>row.id);
   await admin.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await admin.query('delete from dartflow_private.mail_outbox where id=any($1::uuid[])',[jobs]);await admin.query('delete from dartflow_private.mail_events where event_id like any($1::text[])',[patterns]);
   await admin.query('delete from dartflow_private.feed_items where source_kind=\'match\' and source_id=any($1::uuid[])',[matches]);
   for(const table of ['platform_signals','platform_match_links','action_receipts','match_confirmations','visits','match_results','match_players'])await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
   await admin.query('delete from dartflow_private.community_messages where scope_kind=\'match\' and scope_id=any($1::uuid[])',[matches]);
   await admin.query('delete from dartflow_private.audit_events where event_id=any($1::uuid[])',[events]);await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);
   await admin.query('delete from dartflow_private.platform_audit where entity_id=any($1::uuid[]) or detail->>\'requestId\'=any($2::text[])',[ownEntities,commandIds]);await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[]) and request_id=any($2::uuid[])',[[first,second],commandIds]);
   await admin.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[ownEntities]);await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[ownEntities]);
   for(const table of ['standings','entries','boards','event_staff'])await admin.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);await admin.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await admin.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);await admin.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);
   for(const limit of limits.values()){await admin.query('update dartflow_private.auth_limits set count=greatest(0,count-$2) where key=$1 and reset_at=$3',[limit.key,limit.consumed,limit.resetAt]);await admin.query('delete from dartflow_private.auth_limits where key=$1 and reset_at=$2 and count=0',[limit.key,limit.resetAt]);}
   assert.deepEqual((await admin.query('select * from dartflow_private.profiles where id=any($1::uuid[]) order by id',[[first,second]])).rows,beforeProfiles,'Existing fixture profiles and account identities remain unchanged.');
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}finally{await admin.end();await closeDatabase();}
 }
});
