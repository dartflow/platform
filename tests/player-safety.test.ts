import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase} from '../lib/db';
import {executePlatformCommand,getPlatformMessages} from '../lib/platform';
import {getCommunityFeed,PLATFORM_FEED_ID} from '../lib/community';
import {executeFeedAction,getFeedState} from '../lib/feed';
import {acceptPlayerSafety,COMMUNITY_RULES_VERSION,getPlayerSafety,REPORT_CATEGORIES} from '../lib/player-safety';
import {beginFixtureCleanup} from './helpers/cleanup-v17';
import type {PlatformCommand} from '../lib/platform-types';
try{process.loadEnvFile('.env.local');}catch{}
const local=(v:string|undefined)=>{try{return Boolean(v&&['127.0.0.1','localhost','[::1]'].includes(new URL(v).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('community safety requires current explicit acceptance, validates report references and enforces blocks',{skip:!configured},async t=>{
 const db=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await db.connect();
 const owner=randomUUID(),alice=randomUUID(),bob=randomUUID(),outsider=randomUUID(),people=[owner,alice,bob,outsider];
 const run=(actor:string,action:PlatformCommand['action'],requestId=randomUUID())=>executePlatformCommand(actor,{requestId,action});
 let post='',room='',message='',report='';
 try{
  for(const[i,id]of people.entries())await db.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`safety-${i}-${id.slice(0,8)}`]);
  await db.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[owner]);
  await t.test('age and rules cannot be silently accepted; stale versions fail and retry preserves timestamp',async()=>{
   assert.equal((await getPlayerSafety(alice)).requiresAcceptance,true);
   await assert.rejects(run(alice,{type:'community.post',scopeKind:'platform',scopeId:PLATFORM_FEED_ID,body:'Before consent'}),{code:'community_rules_required'});
   await assert.rejects(acceptPlayerSafety(alice,{version:COMMUNITY_RULES_VERSION,accepted:true,ageConfirmed:false}),{code:'rules_confirmation_required'});
   await assert.rejects(acceptPlayerSafety(alice,{version:'old',accepted:true,ageConfirmed:true}),{code:'rules_changed'});
   const first=await acceptPlayerSafety(alice,{version:COMMUNITY_RULES_VERSION,accepted:true,ageConfirmed:true});
   const retry=await acceptPlayerSafety(alice,{version:COMMUNITY_RULES_VERSION,accepted:true,ageConfirmed:true});
   assert.equal(first.acceptedAt,retry.acceptedAt);assert.equal(retry.requiresAcceptance,false);
   for(const actor of [owner,bob,outsider])await run(actor,{type:'safety.accept',version:COMMUNITY_RULES_VERSION,accepted:true,ageConfirmed:true});
   assert.equal(REPORT_CATEGORIES.length,8);
  });
  await t.test('report targets resolve real content author and scope, reject spoofed references and stay idempotent',async()=>{
   post=(await run(bob,{type:'community.post',scopeKind:'platform',scopeId:PLATFORM_FEED_ID,body:'Synthetic reportable message'})).id!;
   const request=randomUUID(),action={type:'report.create',targetType:'post',targetId:post,category:'harassment',reason:'Synthetic regression report'};
   const first=await run(alice,action,request);report=first.id!;assert.deepEqual(await run(alice,action,request),first);
   const row=(await db.query('select target_id,content_id,scope_id,category from dartflow_private.platform_reports where id=$1',[report])).rows[0];
   assert.equal(row.target_id,bob);assert.equal(row.content_id,post);assert.equal(row.scope_id,PLATFORM_FEED_ID);assert.equal(row.category,'harassment');
   assert.equal((await db.query('select count(*)::int n from dartflow_private.platform_reports where reporter_id=$1',[alice])).rows[0].n,1);
   await assert.rejects(run(alice,{...action,scopeId:randomUUID()}),{code:'report_target_unavailable'});
   await assert.rejects(run(alice,{...action,userId:owner}),{code:'report_target_unavailable'});
   await assert.rejects(run(alice,{...action,category:'invented'}),{code:'invalid_report_category'});
   await assert.rejects(run(alice,{...action,targetId:randomUUID()}),{status:404});
   await assert.rejects(run(bob,action),{code:'invalid_target'});
  });
  await t.test('private room content cannot be reported through a supplied arbitrary user/room ID',async()=>{
   room=(await run(bob,{type:'room.create',name:'Safety private room',visibility:'private'})).id!;
   await run(bob,{type:'room.invite',id:room,userId:alice});await run(alice,{type:'room.join',id:room});
   await run(bob,{type:'room.message',id:room,body:'Private synthetic message'});message=(await getPlatformMessages(alice,room)).messages[0].id;
   await assert.rejects(run(outsider,{type:'report.create',targetType:'room-message',targetId:message,category:'privacy',reason:'Not in room'}),{status:403});
   await assert.rejects(run(alice,{type:'report.create',targetType:'room-message',targetId:message,scopeKind:'room',scopeId:randomUUID(),category:'privacy',reason:'Wrong scope'}),{code:'report_target_unavailable'});
   await run(alice,{type:'report.create',targetType:'room-message',targetId:message,scopeKind:'room',scopeId:room,category:'privacy',reason:'Valid room report'});
   await db.query('insert into dartflow_private.platform_preferences(user_id,discoverable) values($1,false)',[outsider]);
   await assert.rejects(run(alice,{type:'report.create',targetType:'user',targetId:outsider,category:'other',reason:'No known contact'}),{status:404});
  });
  await t.test('blocking removes content and friend requests and prevents replies without altering records',async()=>{
   await run(alice,{type:'friend.request',userId:bob});await run(bob,{type:'friend.accept',userId:alice});
   await run(alice,{type:'friend.block',userId:bob});
   assert.equal((await getCommunityFeed(alice)).posts.some(p=>p.id===post),false);
   assert.equal((await getFeedState(alice)).posts.some(p=>p.id===post),false);
   await assert.rejects(run(bob,{type:'friend.request',userId:alice}),{code:'blocked'});
   await assert.rejects(run(alice,{type:'community.reply',postId:post,body:'Blocked response'}),{code:'blocked'});
   await assert.rejects(getPlatformMessages(alice,room),{code:'blocked'});
   assert.equal((await db.query('select count(*)::int n from dartflow_private.community_posts where id=$1',[post])).rows[0].n,1);
   await run(alice,{type:'friend.unblock',userId:bob});
   assert.equal((await getCommunityFeed(alice)).posts.some(p=>p.id===post),true);
  });
  await t.test('moderation removal requires current reviewer rights and removes projections together',async()=>{
   await getFeedState(alice);
   await assert.rejects(run(outsider,{type:'report.resolve',reportId:report,operation:'remove-content',reason:'Unauthorized'}),{status:403});
   await run(owner,{type:'report.resolve',reportId:report,operation:'remove-content',reason:'Removed synthetic inappropriate content'});
   assert.equal((await getCommunityFeed(alice)).posts.some(p=>p.id===post),false);
   assert.equal((await getFeedState(alice)).posts.some(p=>p.id===post),false);
   assert.equal((await db.query('select status from dartflow_private.platform_reports where id=$1',[report])).rows[0].status,'resolved');
  });
  await t.test('report rate limit is persistent and failed submissions never become reports',async()=>{
   for(let i=0;i<9;i++)await run(outsider,{type:'report.create',targetType:'user',targetId:bob,category:'other',reason:'Synthetic cooldown report'});
   await run(outsider,{type:'report.create',targetType:'user',targetId:bob,category:'other',reason:'Tenth report'});
   await assert.rejects(run(outsider,{type:'report.create',targetType:'user',targetId:bob,category:'other',reason:'Over limit'}),{code:'rate_limited'});
   await db.query("update dartflow_private.platform_reports set created_at=now()-interval '2 hours' where reporter_id=$1",[outsider]);
   await run(outsider,{type:'report.create',targetType:'user',targetId:bob,category:'other',reason:'Cooldown recovered'});
  });
  await t.test('rules evidence stays in private RLS storage with only the server runtime role authorized',async()=>{
   const row=(await db.query("select relrowsecurity from pg_class where oid='dartflow_private.player_safety_acceptances'::regclass")).rows[0];assert.equal(row.relrowsecurity,true);
   assert.equal((await db.query("select count(*)::int n from information_schema.role_table_grants where table_schema='dartflow_private' and table_name='player_safety_acceptances' and grantee in('PUBLIC','anon','authenticated')")).rows[0].n,0);
   assert.equal((await db.query("select has_table_privilege('dartflow_app','dartflow_private.player_safety_acceptances','SELECT,INSERT') allowed")).rows[0].allowed,true);
  });
  await t.test('all feed publication entry points reject unaccepted profiles while ordinary score flows are unaffected',async()=>{
   await db.query('delete from dartflow_private.player_safety_acceptances where user_id=$1',[alice]);
   await assert.rejects(executeFeedAction(alice,{requestId:randomUUID(),action:{type:'compose',channel:'friends',body:'No consent'}}),{code:'community_rules_required'});
   await assert.rejects(run(alice,{type:'room.message',id:room,body:'No consent'}),{code:'community_rules_required'});
   const training=await run(alice,{type:'training.create',mode:'solo',startScore:501});assert.ok(training.id);
   const scored=await executePlatformCommand(alice,{requestId:randomUUID(),expectedRevision:training.entity!.revision,action:{type:'training.score',id:training.id,score:60}});assert.equal(scored.entity?.state.game?.remaining[0],441);
  });
 }finally{
  await beginFixtureCleanup(db,people);
  await db.query('delete from dartflow_private.platform_reports where reporter_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);
  for(const table of ['platform_messages','platform_receipts','platform_audit'])await db.query(`delete from dartflow_private.${table} where ${table==='platform_messages'?'author_id':'actor_id'}=any($1::uuid[])`,[people]);
  await db.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.platform_preferences where user_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]))',[people]);
  await db.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  await db.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await db.query('commit');await db.end();await closeDatabase();
 }
});
