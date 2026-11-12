import {test} from 'node:test';
import {beginFixtureCleanup} from './helpers/cleanup-v17';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
import {communityAction,getCommunityFeed,getCommunityChat,PLATFORM_FEED_ID,decodeFeedCursor} from '../lib/community';
import type {PlatformCommand} from '../lib/platform-types';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback configuration. */}
const loopback=(value:string|undefined)=>{try{return value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('community cursor rejects malformed or ambiguous continuations',()=>{
 assert.equal(decodeFeedCursor(''),null);
 for(const cursor of ['not-json','x'.repeat(241),Buffer.from(JSON.stringify({at:'yesterday',id:randomUUID()})).toString('base64url')])assert.throws(()=>decodeFeedCursor(cursor),{code:'invalid_cursor'});
});
test('v17 feed and chat enforce fresh scope rights, stable pagination, moderation and idempotency',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const admin=randomUUID(),alice=randomUUID(),bob=randomUUID(),outsider=randomUUID(),people=[admin,alice,bob,outsider],entities:string[]=[];
 const run=(actor:string,action:PlatformCommand['action'],requestId=randomUUID())=>executePlatformCommand(actor,{requestId,action});
 try{
  for(const [index,id]of people.entries())await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Community ${index}`]);
  const club=(await run(admin,{type:'club.create',name:'Community A'})).id!,other=(await run(outsider,{type:'club.create',name:'Community B'})).id!;entities.push(club,other);
  for(const user of [alice,bob]){await run(user,{type:'club.request',id:club});await run(admin,{type:'club.approve',id:club,userId:user});}
  const league=(await run(admin,{type:'league.create',name:'Community league',clubId:club,boards:1})).id!,tournament=(await run(admin,{type:'tournament.create',name:'Community cup',clubId:club,boards:1})).id!;entities.push(league,tournament);
  await run(alice,{type:'competition.register',id:league});await run(bob,{type:'competition.register',id:tournament});
  const post=async(actor:string,kind:string,id:string,body:string)=>run(actor,{type:'community.post',scopeKind:kind,scopeId:id,body});
  const publicPost=(await post(alice,'platform',PLATFORM_FEED_ID,'Platform fixture')).id!,clubPost=(await post(alice,'club',club,'Club fixture')).id!;
  await post(alice,'league',league,'League fixture');await post(bob,'tournament',tournament,'Tournament fixture');await post(outsider,'club',other,'Other club fixture');
  await t.test('My Feed includes participation and keeps independent club and event sources private',async()=>{
   const feed=await getCommunityFeed(alice),body=feed.posts.map(p=>p.body);
   assert.ok(body.includes('Platform fixture'));assert.ok(body.includes('Club fixture'));assert.ok(body.includes('League fixture'));assert.ok(!body.includes('Tournament fixture'));assert.ok(!body.includes('Other club fixture'));
   await assert.rejects(getCommunityFeed(outsider,{kind:'club',id:club}),{status:403});await assert.rejects(getCommunityFeed(alice,{kind:'tournament',id:tournament}),{status:403});
   await assert.rejects(post(outsider,'club',club,'Unauthorized'),{status:403});await assert.rejects(run(outsider,{type:'community.like',postId:clubPost,liked:true}),{status:403});
  });
  await t.test('likes are account-unique and repeated reply requests make one correct thread reply',async()=>{
   await Promise.all([run(bob,{type:'community.like',postId:clubPost,liked:true}),run(bob,{type:'community.like',postId:clubPost,liked:true})]);
   const current=(await getCommunityFeed(bob,{kind:'club',id:club})).posts.find(p=>p.id===clubPost)!;assert.equal(current.likes,1);assert.equal(current.liked,true);
   const request=randomUUID(),action={type:'community.reply',postId:clubPost,body:'One reply'};await run(bob,action,request);await run(bob,action,request);
   await assert.rejects(run(bob,{...action,body:'Changed'},request),{code:'request_reused'});
   const replies=await getCommunityFeed(alice,{kind:'club',id:club,parentId:clubPost});assert.equal(replies.posts.length,1);assert.equal(replies.posts[0].body,'One reply');assert.equal(replies.posts[0].parentId,clubPost);
   await assert.rejects(getCommunityFeed(outsider,{parentId:clubPost}),{status:404});
  });
  await t.test('equal timestamp pagination has no skipped or duplicated rows',async()=>{
   for(let i=0;i<35;i++)await owner.query("insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,body,created_at) values($1,'platform',$2,$3,$4,'2030-01-01T12:34:56.123456Z')",[randomUUID(),PLATFORM_FEED_ID,alice,`Page ${i}`]);
   const first=await getCommunityFeed(alice,{kind:'platform'});assert.equal(first.posts.length,30);assert.ok(first.nextCursor);
   const next=await getCommunityFeed(alice,{kind:'platform',cursor:first.nextCursor});assert.equal(next.posts.length,6);assert.equal(new Set([...first.posts,...next.posts].map(p=>p.id)).size,36);assert.ok(next.posts.some(p=>p.id===publicPost));
  });
  await t.test('chat cursors cannot skip a delayed commit and receive later deletion tombstones',async()=>{
   const client=await database().connect();await client.query('begin');let second:Promise<unknown>|undefined;
   try{
    const cursor=(await getCommunityChat(alice,'club',club)).cursor;
    const first=await communityAction(client,bob,{requestId:randomUUID(),action:{type:'community.message',scopeKind:'club',scopeId:club,body:'Delayed first transaction'}});
    let settled=false;second=run(admin,{type:'community.message',scopeKind:'club',scopeId:club,body:'Second transaction'}).then(value=>{settled=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,35));assert.equal(settled,false,'The second writer must wait until the earlier scoped transaction commits.');
    assert.deepEqual((await getCommunityChat(alice,'club',club,cursor)).messages,[]);
    await client.query('commit');await second;
    const committed=await getCommunityChat(alice,'club',club,cursor);assert.deepEqual(committed.messages.map(m=>m.body),['Delayed first transaction','Second transaction']);
    await run(bob,{type:'community.message.delete',scopeKind:'club',scopeId:club,messageId:first!.id});
    const changed=await getCommunityChat(alice,'club',club,committed.cursor);assert.equal(changed.messages.length,1);assert.equal(changed.messages[0].id,first!.id);assert.equal(changed.messages[0].deleted,true);assert.equal(changed.messages[0].body,'');
    await owner.query('delete from dartflow_private.community_messages where scope_kind=\'club\' and scope_id=$1',[club]);
   }finally{await client.query('rollback');client.release();if(second)await Promise.allSettled([second]);}
  });
  await t.test('chat is ordered, retry safe, scoped, mutable only by its current moderator and respects mute/block',async()=>{
   const role=(await run(admin,{type:'club.role.save',id:club,name:'Chat reviewer',permissions:['chat.moderate']})).entity!;
   const roleId=(role as unknown as {clubDetails:{roles:{id:string;name:string}[]}}).clubDetails.roles.find(r=>r.name==='Chat reviewer')!.id;
   await run(admin,{type:'club.member.roles',id:club,userId:alice,role:'member',roleIds:[roleId]});
   const request=randomUUID(),message={type:'community.message',scopeKind:'club',scopeId:club,body:'Chat fixture'};await run(bob,message,request);await run(bob,message,request);
   let chat=await getCommunityChat(alice,'club',club);assert.equal(chat.messages.length,1);assert.equal(chat.messages[0].body,'Chat fixture');assert.ok(chat.scope.canModerate);
   await assert.rejects(getCommunityChat(outsider,'club',club),{status:403});await assert.rejects(getCommunityChat(alice,'tournament',tournament),{status:403});
   await assert.rejects(run(bob,{type:'community.message.delete',scopeKind:'club',scopeId:club,messageId:randomUUID()}),{status:404});
   await run(alice,{type:'community.moderate',scopeKind:'club',scopeId:club,userId:bob,minutes:10,banned:false});assert.equal((await getCommunityChat(bob,'club',club)).scope.canWrite,false);
   await assert.rejects(run(bob,{...message,body:'Muted write'}),{code:'chat_muted'});
   await run(alice,{type:'community.moderate',scopeKind:'club',scopeId:club,userId:bob,minutes:0,banned:false});
   await run(admin,{type:'club.member.roles',id:club,userId:alice,role:'member',roleIds:[]});await assert.rejects(run(alice,{type:'community.moderate',scopeKind:'club',scopeId:club,userId:bob,minutes:10,banned:false}),{status:403});
   await run(admin,{type:'community.message.delete',scopeKind:'club',scopeId:club,messageId:chat.messages[0].id});chat=await getCommunityChat(bob,'club',club);assert.equal(chat.messages[0].body,'');assert.equal(chat.messages[0].deleted,true);
   await run(bob,{...message,body:'Hidden by block'});await run(alice,{type:'friend.block',userId:bob});assert.equal((await getCommunityChat(alice,'club',club)).messages.length,0);
  });
  await t.test('revoked club membership stops reads, writes and receipt replay immediately',async()=>{
   const request=randomUUID(),action={type:'community.post',scopeKind:'club',scopeId:club,body:'Before leaving'};await run(bob,action,request);await run(bob,{type:'club.leave',id:club});
   await assert.rejects(getCommunityFeed(bob,{kind:'club',id:club}),{status:403});await assert.rejects(getCommunityChat(bob,'club',club),{status:403});await assert.rejects(run(bob,action,request),{status:403});assert.ok(!(await getCommunityFeed(bob)).posts.some(p=>p.scopeId===club));
  });
 }finally{
  // Only this suite's isolated fixtures are removed; seeded and hosted records are untouched.
  await owner.query('delete from dartflow_private.community_likes where user_id=any($1::uuid[]) or post_id in(select id from dartflow_private.community_posts where author_id=any($1::uuid[]))',[people]);
  await owner.query('delete from dartflow_private.community_posts where parent_id is not null and author_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.community_posts where author_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.community_messages where author_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.community_moderation where user_id=any($1::uuid[]) or updated_by=any($1::uuid[])',[people]);
  await beginFixtureCleanup(owner,people);
  const ownedEntities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  const ownedClubs=(await owner.query('select id from dartflow_private.clubs where id in(select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[]))',[people])).rows.map(row=>row.id);
  const events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[ownedClubs])).rows.map(row=>row.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[ownedEntities]);
  await owner.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);
  for(const table of ['boards','entries','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[ownedClubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[ownedClubs]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.query('commit');
  await owner.end();await closeDatabase();
 }
});
