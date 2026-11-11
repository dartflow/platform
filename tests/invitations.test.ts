import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { allocateInvitationCode, generateInvitationCode, invitationAttemptRequired, invitationPath, normalizeInvitationCode, resolveInvitation, rotateEntityInvitation } from '../lib/invitations';
import { acceptsCode, createEntity, entity, transaction } from '../lib/platform-store';
import { closeDatabase } from '../lib/db';
import { executePlatformCommand, getPlatformOverview } from '../lib/platform';
import type { PlatformCommand } from '../lib/platform-types';
try { process.loadEnvFile('.env.local'); } catch { /* CI supplies explicit loopback fixture URLs. */ }
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

test('short invitation input normalizes four characters and preserves case-sensitive historical codes',()=>{
 for(let i=0;i<128;i++)assert.match(generateInvitationCode(),/^[A-Z0-9]{4}$/);
 assert.equal(normalizeInvitationCode(' k7m2 '),'K7M2');assert.equal(invitationPath('k7m2'),'/w/K7M2');
 const legacy='AbCdEfGhIjKlMnOpQrStUvWx';assert.equal(legacy.length,24);assert.equal(normalizeInvitationCode(legacy),legacy);assert.equal(invitationPath(legacy),null);
 for(const invalid of [undefined,null,3,{},'','K7M','K7M22','K7-M','K 72','Ｋ7M2','/w/K7M2','https://elsewhere.test/w/K7M2'])assert.equal(normalizeInvitationCode(invalid),null);
 assert.equal(invitationAttemptRequired({type:'invitation.resolve'}),true);assert.equal(invitationAttemptRequired({type:'lobby.join',code:'k7m2'}),true);assert.equal(invitationAttemptRequired({type:'competition.register',inviteCode:'K7M2'}),true);
 assert.equal(invitationAttemptRequired({type:'lobby.join',code:''}),false);assert.equal(invitationAttemptRequired({type:'score',score:60}),false);
});

test('short invitations persist unique live codes, retain historical links and enforce current ACLs',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const host=randomUUID(),guest=randomUUID(),other=randomUUID(),guesser=randomUUID(),people=[host,guest,other,guesser];
 const run=(actor:string,action:PlatformCommand['action'],requestId=randomUUID())=>executePlatformCommand(actor,{requestId,action});
 const unavailable=async(action:()=>Promise<unknown>)=>assert.rejects(action,{code:'invalid_invitation',status:404,message:'Deze uitnodiging is ongeldig of niet beschikbaar.'});
 try{
  for(const [i,id]of people.entries())await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Invitation fixture ${i}`]);
  const club=(await run(host,{type:'club.create',name:'Short invitation fixture club'})).id!;
  const lobby=await run(host,{type:'lobby.create',name:'Short invitation fixture lobby',setup:'localtwo'});
  assert.match(lobby.code!,/^[A-Z0-9]{4}$/);
  await t.test('new codes reopen for their owner but never leak through the public directory',async()=>{
   assert.equal(lobby.entity?.inviteCode,lobby.code);
   assert.equal((await getPlatformOverview(host)).lobbies.find(e=>e.id===lobby.id)?.inviteCode,lobby.code);
   const clubCode=(await getPlatformOverview(host)).clubs.find(e=>e.id===club)?.inviteCode;assert.match(clubCode!,/^[A-Z0-9]{4}$/);
   assert.equal((await getPlatformOverview(guest)).clubs.find(e=>e.id===club)?.inviteCode,undefined);
   const row=await entity(owner,lobby.id);assert.equal(acceptsCode(row,lobby.code!.toLowerCase()),true);
   const resolved=await resolveInvitation(owner,guest,lobby.code!.toLowerCase());assert.equal(resolved.id,lobby.id);
   await run(guest,{type:'lobby.join',id:lobby.id,code:lobby.code!.toLowerCase()});
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,guest])).rowCount,0);
  });
  await t.test('historical 24-character links remain valid with their exact original case and expiry',async()=>{
   const legacy='AbCdEfGhIjKlMnOpQrStUvWx';
   const {row}=await transaction(client=>createEntity(client,host,'room',{name:'Historical invitation fixture room',capacity:8},'private'));
   await owner.query('delete from dartflow_private.invitation_codes where entity_id=$1',[row.id]);
   await owner.query("update dartflow_private.platform_entities set invite_hash=$2,invite_expires_at=now()+interval '1 day' where id=$1",[row.id,digest(legacy)]);
   const current=await entity(owner,row.id);assert.equal(acceptsCode(current,legacy),true);assert.equal(acceptsCode(current,legacy.toLowerCase()),false);
   assert.equal((await resolveInvitation(owner,guest,legacy)).id,row.id);await unavailable(()=>resolveInvitation(owner,guest,legacy.toLowerCase()));
   await owner.query("update dartflow_private.platform_entities set invite_expires_at=now()-interval '1 second' where id=$1",[row.id]);
   await unavailable(()=>resolveInvitation(owner,guest,legacy));assert.equal(acceptsCode(await entity(owner,row.id),legacy),false);
  });
  await t.test('collisions safely retry within one usable transaction and active codes never move to another entity',async()=>{
   const {row:a}=await transaction(client=>createEntity(client,host,'room',{name:'Collision fixture A'},'private'));
   const {row:b}=await transaction(client=>createEntity(client,host,'room',{name:'Collision fixture B'},'private'));
   await owner.query('begin');
   const first=await allocateInvitationCode(owner,a.id,new Date(Date.now()+60_000),()=> 'TST1');assert.equal(first,'TST1');
   const sequence=['TST1','TST2'];const second=await allocateInvitationCode(owner,b.id,new Date(Date.now()+60_000),()=>sequence.shift()!);assert.equal(second,'TST2');
   assert.equal((await owner.query('select 1 as usable')).rows[0].usable,1);await owner.query('commit');
   assert.equal((await owner.query("select entity_id from dartflow_private.invitation_codes where code='TST1'")).rows[0].entity_id,a.id);
   await owner.query("update dartflow_private.invitation_codes set expires_at=now()-interval '1 second' where code='TST1'");
   assert.equal(await allocateInvitationCode(owner,b.id,new Date(Date.now()+60_000),()=> 'TST1'),'TST1');
   await assert.rejects(allocateInvitationCode(owner,a.id,new Date(Date.now()+60_000),()=> 'TST1'),{code:'invitation_busy',status:503});
   assert.equal((await owner.query('select 1 as usable')).rows[0].usable,1);
  });
  await t.test('concurrent transactions cannot reserve the same active code for different invitations',async()=>{
   const {row:a}=await transaction(client=>createEntity(client,host,'room',{name:'Race invitation fixture A'},'private'));
   const {row:b}=await transaction(client=>createEntity(client,host,'room',{name:'Race invitation fixture B'},'private'));
   const contender=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await contender.connect();
   try{
    await owner.query('begin');await contender.query('begin');assert.equal(await allocateInvitationCode(owner,a.id,new Date(Date.now()+60_000),()=> 'RAC1'),'RAC1');
    const sequence=['RAC1','RAC2'];const pending=allocateInvitationCode(contender,b.id,new Date(Date.now()+60_000),()=>sequence.shift()!);
    await new Promise(resolve=>setTimeout(resolve,30));await owner.query('commit');assert.equal(await pending,'RAC2');await contender.query('commit');
    const mapping=await owner.query("select code,entity_id from dartflow_private.invitation_codes where code in ('RAC1','RAC2') order by code");assert.deepEqual(mapping.rows,[{code:'RAC1',entity_id:a.id},{code:'RAC2',entity_id:b.id}]);
   }finally{await owner.query('rollback');await contender.query('rollback');await contender.end();}
  });
  await t.test('unknown, expired, blocked, banned and unintended-recipient lookups share one failure response',async()=>{
   await unavailable(()=>resolveInvitation(owner,guest,'bad-length'));
   const directed=await run(host,{type:'lobby.create',name:'Directed short invitation fixture',opponentId:guest});
   assert.equal((await resolveInvitation(owner,guest,directed.code)).id,directed.id);await unavailable(()=>resolveInvitation(owner,other,directed.code));
   await owner.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status,attributes) values($1,$2,'member','banned','{}')",[directed.id,other]);
   await unavailable(()=>resolveInvitation(owner,other,directed.code));
   await owner.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind) values($1,$2,'block')",[host,guest]);
   await unavailable(()=>resolveInvitation(owner,guest,directed.code));await owner.query('delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2',[host,guest]);
   await owner.query("update dartflow_private.platform_entities set invite_expires_at=now()-interval '1 second' where id=$1",[directed.id]);await unavailable(()=>resolveInvitation(owner,guest,directed.code));
   await unavailable(()=>resolveInvitation(owner,randomUUID(),lobby.code));
   const privateRoom=await run(host,{type:'room.create',name:'Private club invitation fixture room',clubId:club,visibility:'club'});await unavailable(()=>resolveInvitation(owner,guest,privateRoom.code));
  });
  await t.test('rotation revokes its previous code, creates a new four-character code, and receipt replay rechecks validity',async()=>{
   const candidate=await run(host,{type:'lobby.create',name:'Rotating invitation fixture'}),requestId=randomUUID();
   assert.equal((await run(other,{type:'invitation.resolve',code:candidate.code},requestId)).id,candidate.id);
   const fresh=await transaction(async client=>rotateEntityInvitation(client,await entity(client,candidate.id,true)));assert.match(fresh,/^[A-Z0-9]{4}$/);assert.notEqual(fresh,candidate.code);
   await unavailable(()=>resolveInvitation(owner,other,candidate.code));assert.equal((await resolveInvitation(owner,other,fresh)).id,candidate.id);
   await unavailable(()=>run(other,{type:'invitation.resolve',code:candidate.code},requestId));
  });
  await t.test('failed guesses commit their rate counters even when every lookup command rolls back',async()=>{
   for(let i=0;i<10;i++)await unavailable(()=>run(guesser,{type:'invitation.resolve',code:'invalid-code'}));
   await assert.rejects(run(guesser,{type:'invitation.resolve',code:lobby.code}),{code:'rate_limited',status:429});
   const counter=await owner.query('select count from dartflow_private.auth_limits where key=$1',[`invite:actor:${guesser}`]);assert.equal(counter.rows[0].count,11);
   assert.equal((await owner.query('select 1 from dartflow_private.platform_receipts where actor_id=$1',[guesser])).rowCount,0);
  });
  await t.test('lookup storage stays in the private schema with RLS and no public API grants',async()=>{
   const table=await owner.query("select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dartflow_private' and c.relname='invitation_codes'");assert.equal(table.rows[0].relrowsecurity,true);
   const roles=await owner.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");for(const row of roles.rows)assert.equal((await owner.query("select has_table_privilege($1,'dartflow_private.invitation_codes','select') as granted",[row.rolname])).rows[0].granted,false);
  });
 }finally{
  await owner.query('rollback');
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  const clubs=(await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])',[people])).rows.map(r=>r.club_id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(p=>`user:${p}`)]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[entities]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.auth_limits where key=any($1::text[])',[people.map(p=>`invite:actor:${p}`)]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.end();await closeDatabase();
 }
});
