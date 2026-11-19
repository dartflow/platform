import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{readFile}from'node:fs/promises';
import pg from'pg';
try{process.loadEnvFile('.env.local');}catch{/* Explicit local transaction only. */}
const loopback=(url:string|undefined)=>{try{return Boolean(url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('identity migration preserves fixed IDs and relations, quarantines only invalid/colliding legacy claims, and is replay-safe',{skip:!configured},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();const schema=`identity_fixture_${randomUUID().replaceAll('-','')}`,ids=Array.from({length:6},()=>randomUUID());
 const migration=async(path:string)=>(await readFile(new URL(`../supabase/migrations/${path}`,import.meta.url),'utf8')).replaceAll('dartflow_private',schema).replace(/^begin;\s*/m,'').replace(/\ncommit;\s*$/,'');
 try{await admin.query('begin');await admin.query(`create schema ${schema}`);await admin.query(`create table ${schema}.profiles(id uuid primary key,name text not null,display_name text,email text,email_verified boolean default false,display_name_confirmed boolean not null default true,show_public_statistics boolean default false,onboarding_complete boolean default true,deletion_requested_at timestamptz,deleted_at timestamptz);create table ${schema}.feature_versions(name text primary key,version integer not null);create table ${schema}.relations(player_id uuid primary key references ${schema}.profiles(id),history jsonb not null)`);
  await admin.query(await migration('20261112184741_globally_unique_usernames.sql'));
  const names=['ValidHandle','Personal Legacy Name','Ｆｏｏ','foo','Google Private Name','Zoe\u0308'],displays=['De Pijl','Personal Legacy Name','Publiek Een','Publiek Twee',null,'Public Zoë'];
  for(const[index,id]of ids.entries()){await admin.query(`insert into ${schema}.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,$4)`,[id,names[index],displays[index],index!==4]);await admin.query(`insert into ${schema}.relations(player_id,history)values($1,$2)`,[id,JSON.stringify({fixedMatchId:'unchanged',points:index+10})]);}
  const sql=await migration('20261119192646_immutable_private_player_identity.sql');await admin.query(sql);
  const after=(await admin.query(`select id,name,display_name,full_name,display_name_confirmed,username_locked_at,identity_needs_review from ${schema}.profiles order by id`)).rows;
  const profile=(index:number)=>after.find(p=>p.id===ids[index])!;
  for(const index of [0,5]){assert.equal(profile(index).display_name_confirmed,true);assert.ok(profile(index).username_locked_at);assert.equal(profile(index).identity_needs_review,false);assert.equal(profile(index).display_name,displays[index]);}
  assert.equal(profile(0).name,'validhandle');assert.equal(profile(5).name,'zoë');
  for(const index of [1,2,3,4]){assert.equal(profile(index).display_name_confirmed,false);assert.equal(profile(index).username_locked_at,null);assert.equal(profile(index).identity_needs_review,true);assert.equal(profile(index).name,'Nieuwe speler');}
  assert.equal(profile(1).full_name,'Personal Legacy Name');assert.equal(profile(1).display_name,null);assert.equal(profile(4).full_name,'Google Private Name');
  assert.equal(profile(2).display_name,'Publiek Een');assert.equal(profile(3).display_name,'Publiek Twee');
  const publicRows=(await admin.query(`select * from ${schema}.profile_labels order by id`)).rows;assert.equal(publicRows.find(p=>p.id===ids[1]).name,'Speler');assert.equal(publicRows.find(p=>p.id===ids[1]).username,null);assert.ok(!JSON.stringify(publicRows).includes('Personal Legacy Name'));assert.ok(!JSON.stringify(publicRows).includes('Google Private Name'));assert.ok(!Object.hasOwn(publicRows[0],'full_name'));
  for(const[index,id]of ids.entries())assert.deepEqual((await admin.query(`select history from ${schema}.relations where player_id=$1`,[id])).rows[0].history,{fixedMatchId:'unchanged',points:index+10});
  assert.equal((await admin.query(`select count(*)::int n from ${schema}.profile_identity_migration_audit`)).rows[0].n,6);
  await admin.query(`update ${schema}.profiles set name='repairedowner',display_name_confirmed=true where id=$1`,[ids[1]]);
  await admin.query(sql);assert.equal((await admin.query(`select name,display_name_confirmed from ${schema}.profiles where id=$1`,[ids[1]])).rows[0].name,'repairedowner');assert.equal((await admin.query(`select count(*)::int n from ${schema}.relations`)).rows[0].n,6);
  await admin.query('savepoint locked');await assert.rejects(admin.query(`update ${schema}.profiles set name='changed'where id=$1`,[ids[0]]),{code:'23514',constraint:'profiles_username_immutable'});await admin.query('rollback to savepoint locked');
  await admin.query(`create table ${schema}.mail_outbox(id uuid primary key,environment text,scope_key text,event_id text,template_id text,recipient_key text,snapshot jsonb);create table ${schema}.mail_events(environment text,scope_key text,event_id text,template_id text,recipient_key text,actor_id uuid);create table ${schema}.mail_provider_events(job_id uuid);create table ${schema}.platform_audit(actor_id uuid,action text,detail jsonb)`);
  const mails=Array.from({length:4},()=>randomUUID()),requestId=randomUUID();
  for(const[index,id]of mails.entries()){await admin.query(`insert into ${schema}.mail_outbox values($1,'staging','platform',$2,'friend-accepted','user:recipient',$3)`,[id,index===2?`platform:${requestId}:friend-accepted:recipient`:`mail:${index}`,JSON.stringify({text:'Same public label',...(index===1?{renderContext:{actorId:ids[0]}}:{})})]);await admin.query(`insert into ${schema}.mail_provider_events values($1)`,[id]);}
  await admin.query(`insert into ${schema}.mail_events values('staging','platform','mail:0','friend-accepted','user:recipient',$1)`,[ids[0]]);
  await admin.query(`insert into ${schema}.platform_audit values($1,'friend.accept',$2)`,[ids[0],JSON.stringify({requestId})]);
  // Historical invitations use two different exact event-ID formats. Actor
  // recovery follows the authorized request/action, never a copied name.
  for(const[template,action]of [['room-invite','room.invite'],['challenge-invite','board.start'],['challenge-invite','lobby.create'],['challenge-accepted','lobby.join'],['challenge-accepted','board.join'],['challenge-cancelled','lobby.cancel']]){
   const request=randomUUID(),id=randomUUID(),eventId=`${template==='room-invite'?'platform:':''}${request}:${template}:recipient`;
   await admin.query(`insert into ${schema}.mail_outbox values($1,'staging','platform',$2,$3,'user:recipient',$4)`,[id,eventId,template,JSON.stringify({text:'Same public label'})]);await admin.query(`insert into ${schema}.mail_provider_events values($1)`,[id]);await admin.query(`insert into ${schema}.platform_audit values($1,$2,$3)`,[ids[0],action,JSON.stringify({requestId:request})]);
  }
  assert.equal((await admin.query("select has_function_privilege('dartflow_app',$1,'EXECUTE')allowed",[`${schema}.scrub_social_identity_mail(uuid)`])).rows[0].allowed,false);
  await admin.query(`select ${schema}.scrub_social_identity_mail($1)`,[ids[0]]);
  assert.deepEqual((await admin.query(`select id from ${schema}.mail_outbox`)).rows.map(row=>row.id),[mails[3]]);assert.deepEqual((await admin.query(`select job_id from ${schema}.mail_provider_events`)).rows.map(row=>row.job_id),[mails[3]]);assert.equal((await admin.query(`select count(*)::int n from ${schema}.mail_events`)).rows[0].n,1);
  await admin.query(`update ${schema}.profiles set full_name='Erase Private Name'where id=$1`,[ids[0]]);
  await admin.query(`update ${schema}.profiles set name='Verwijderde speler',display_name_confirmed=false,deleted_at=clock_timestamp()where id=$1`,[ids[0]]);assert.equal((await admin.query(`select full_name from ${schema}.profiles where id=$1`,[ids[0]])).rows[0].full_name,null);assert.equal((await admin.query(`select old_username from ${schema}.profile_identity_migration_audit where profile_id=$1`,[ids[0]])).rows[0].old_username,null);
 }finally{await admin.query('rollback');await admin.end();}
});
