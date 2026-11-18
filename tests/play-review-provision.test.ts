import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {credentialEnvelope,newPlannedPlayer,parseEnvironment,provisionPrivateReviewBoard,validateProvisionEnvironment} from '../ops/provision-play-review.mjs';
import {closeDatabase,database,getBoardForActor} from '../lib/db';
import {getPlatformOverview} from '../lib/platform';
import {beginFixtureCleanup} from './helpers/cleanup-v17';
try{process.loadEnvFile('.env.local');}catch{}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
const ref='dsnqnvbckkqpzadblshu',key=randomBytes(32),base={DARTFLOW_DATA_MODE:'supabase',DARTFLOW_ENV:'staging',DARTFLOW_APP_ORIGIN:'https://staging.dartflow.nl',NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_fixture_only',DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:key.toString('base64'),DARTFLOW_DATABASE_URL:`postgresql://dartflow_app.${ref}:synthetic@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=verify-full`},admin={auth:'synthetic-admin-fixture-value-not-a-credential',database:`postgresql://postgres.${ref}:synthetic@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=verify-full`};
test('provisioning binds runtime, Auth project, database destination, pooler role and TLS to one environment',()=>{
 assert.equal(validateProvisionEnvironment('staging',base,admin).ref,ref);
 for(const runtime of [{...base,DARTFLOW_ENV:'production'},{...base,DARTFLOW_APP_ORIGIN:'https://dartflow.nl'},{...base,NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},{...base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'},{...base,DARTFLOW_DATABASE_URL:base.DARTFLOW_DATABASE_URL.replace('verify-full','disable')},{...base,DARTFLOW_DATABASE_URL:base.DARTFLOW_DATABASE_URL.replace('5432','6543')}])assert.throws(()=>validateProvisionEnvironment('staging',runtime,admin));
 for(const value of [admin.database.replace(ref,'other'),admin.database.replace('/postgres?','/another?'),admin.database.replace('pooler.supabase.com','untrusted.invalid'),admin.database+'&host=127.0.0.1'])assert.throws(()=>validateProvisionEnvironment('staging',base,{...admin,database:value}));
 assert.throws(()=>validateProvisionEnvironment('production',base,admin));
});
test('planned synthetic identity and envelope preserve a leading-zero PIN and bind credentials to their environment',()=>{
 const planned=newPlannedPlayer('staging','Synthetic reviewer');assert.match(planned.pin,/^[0-9]{6}$/);assert.match(planned.email,/^play-review-staging-[a-f0-9]+@dartflow\.nl$/);
 const value=JSON.stringify({...planned,pin:'012345'}),sealed=credentialEnvelope(value,'staging',key);if(typeof sealed==='string')throw Error('Expected encrypted envelope.');assert.ok(!JSON.stringify(sealed).includes(planned.password));const restored=credentialEnvelope(sealed,'staging',key,true);if(typeof restored!=='string')throw Error('Expected decrypted fixture text.');assert.equal(JSON.parse(restored).pin,'012345');
 assert.throws(()=>credentialEnvelope(sealed,'production',key,true));assert.throws(()=>credentialEnvelope({...sealed,tag:randomBytes(16).toString('base64')},'staging',key,true));
 assert.deepEqual(parseEnvironment('# Comment\nA=one\nB="two"\nC=\'three\'\n'),{A:'one',B:'two',C:'three'});assert.throws(()=>parseEnvironment('BROKEN'));assert.throws(()=>parseEnvironment('A="not closed'));
});
test('private review setup is atomic and repeatable, grants only its own club rights and creates no match or mail',{skip:!configured},async()=>{
 const db=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await db.connect();
 const player={id:randomUUID()},companion={id:randomUUID()},outsider=randomUUID(),people=[player.id,companion.id,outsider];let details:{clubId:string;eventId:string;locationId:string;boardId:string;boardUrl:string}|undefined;
 try{
  for(const[index,id]of people.entries())await db.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed,onboarding_complete) values($1,$2,$3,true,true)',[id,`review-setup-${index}-${id.slice(0,8)}`,`Synthetic ${index}`]);
  await db.query('begin');details=await provisionPrivateReviewBoard(db,'staging',player,companion,{});
  assert.equal((await database().query('select count(*)::int n from dartflow_private.platform_entities where id=$1',[details.clubId])).rows[0].n,0,'Uncommitted setup must not expose even a temporary public club.');
  await db.query('commit');
  const club=(await db.query('select visibility,state from dartflow_private.platform_entities where id=$1',[details.clubId])).rows[0];assert.equal(club.visibility,'private');assert.equal(club.state.joinPolicy,'closed');
  const member=(await db.query('select user_id,role,status from dartflow_private.platform_members where entity_id=$1 order by user_id',[details.clubId])).rows;assert.equal(member.length,2);assert.ok(member.every(row=>row.status==='active'));assert.equal(member.find(row=>row.user_id===player.id).role,'owner');assert.equal(member.find(row=>row.user_id===companion.id).role,'member');
  assert.equal((await db.query('select count(*)::int n from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people])).rows[0].n,0,'No platform owner/admin role is granted.');
  assert.equal((await getBoardForActor(player.id,details.boardId)).board.id,details.boardId);assert.equal((await getBoardForActor(companion.id,details.boardId)).board.id,details.boardId);await assert.rejects(getBoardForActor(outsider,details.boardId),{status:403});
  assert.equal((await getPlatformOverview(outsider)).clubs.some(row=>row.id===details!.clubId),false);
  const board=(await db.query('select cb.access,lb.public_screen,lb.reservation_enabled from dartflow_private.club_boards cb join dartflow_private.location_boards lb on lb.board_id=cb.board_id where cb.board_id=$1',[details.boardId])).rows[0];assert.equal(board.access,'club');assert.equal(board.public_screen,false);assert.equal(board.reservation_enabled,false);
  await db.query('begin');const retry=await provisionPrivateReviewBoard(db,'staging',player,companion,details);await db.query('commit');assert.equal(retry.boardId,details.boardId);assert.equal(retry.boardUrl,details.boardUrl);
  assert.equal((await db.query('select count(*)::int n from dartflow_private.boards where event_id=$1',[details.eventId])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from dartflow_private.matches where event_id=$1',[details.eventId])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows[0].n,0);
  await db.query('begin');await assert.rejects(provisionPrivateReviewBoard(db,'staging',companion,player,details));await db.query('rollback');
 }finally{
  try{
   await beginFixtureCleanup(db,people);
   if(details){await db.query('delete from dartflow_private.club_boards where board_id=$1',[details.boardId]);await db.query('delete from dartflow_private.boards where id=$1',[details.boardId]);await db.query('delete from dartflow_private.events where id=$1',[details.eventId]);}
   await db.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[people]);
   await db.query('delete from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people]);
   if(details){await db.query('delete from dartflow_private.club_memberships where club_id=$1',[details.clubId]);await db.query('delete from dartflow_private.clubs where id=$1',[details.clubId]);}
   await db.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}finally{await Promise.allSettled([db.end(),closeDatabase()]);}
 }
});
