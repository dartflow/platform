import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {ensureAuthProfile} from '../lib/accounts';
import {closeDatabase,getProfile} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
try{process.loadEnvFile('.env.local');}catch{/* The fixture must be explicitly local. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('global username claims are atomic across clubs and Google proposals cannot steal a confirmed name',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const first=randomUUID(),second=randomUUID(),third=randomUUID(),google=randomUUID(),people=[first,second,third,google],clubs=[randomUUID(),randomUUID()],suffix=randomUUID().slice(0,10),name=`Zoë Speler ${suffix}`;
 const choose=(actor:string,value:unknown)=>executePlatformCommand(actor,{requestId:randomUUID(),action:{type:'profile.update',name:value}});
 try{
  for(const id of [first,second,third])await owner.query("insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,'Nieuwe speler',false)",[id]);
  for(const [index,id] of clubs.entries())await owner.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[id,`Username fixture ${suffix} ${index}`]);
  await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player'),($3,$4,'player')",[clubs[0],first,clubs[1],second]);
  let winner=first,loser=second;
  await t.test('two different clubs racing the same normalized name produce one claim and one explicit 409',async()=>{
   const results=await Promise.allSettled([choose(first,`  ${name.replace(' ','\u00A0  ')}  `),choose(second,name.toUpperCase())]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'username_taken');assert.equal(rejected.reason.status,409);
   winner=results[0].status==='fulfilled'?first:second;loser=winner===first?second:first;
   assert.equal((await getProfile(winner)).displayNameConfirmed,true);assert.equal((await getProfile(loser)).displayNameConfirmed,false);
   assert.equal((await owner.query('select count(*)::int as n from dartflow_private.club_memberships where user_id=any($1::uuid[])',[[first,second]])).rows[0].n,2);
  });
  await t.test('case and canonically equivalent Unicode do not bypass uniqueness while the owner may change capitalization',async()=>{
   await choose(winner,name);await choose(winner,name.toUpperCase());
   await assert.rejects(choose(loser,name.replace('ë','e\u0308')),{code:'username_taken',status:409});
   await assert.rejects(owner.query('update dartflow_private.profiles set name=$2,display_name_confirmed=true where id=$1',[third,`  ${name}  `]),{code:'23505',constraint:'profiles_unique_confirmed_username'});
   assert.equal((await getProfile(winner)).name,name.toUpperCase());assert.equal((await getProfile(third)).name,'Nieuwe speler');
  });
  await t.test('Google metadata is an unconfirmed suggestion and repeat login keeps the explicitly chosen username',async()=>{
   const identity={id:google,user_metadata:{full_name:name,display_name_confirmed:true}};await ensureAuthProfile(identity);
   assert.equal((await getProfile(google)).name,name);assert.equal((await getProfile(google)).displayNameConfirmed,false);
   await assert.rejects(choose(google,name),{code:'username_taken',status:409});
   const selected=`Mijn eigen naam ${suffix}`;await choose(google,selected);await ensureAuthProfile(identity);assert.equal((await getProfile(google)).name,selected);assert.equal((await getProfile(google)).displayNameConfirmed,true);
   for(const value of ['', '\t\u00A0 ', 'Nieuwe speler'])await assert.rejects(choose(loser,value),{code:'display_name'});
   await choose(loser,`李明 ${suffix}`);assert.equal((await getProfile(loser)).displayNameConfirmed,true);
  });
  await t.test('trusted direct inserts use the same whitespace normalization and cannot create a second confirmed claim',async()=>{
   const direct=`Direct Label ${suffix}`;await owner.query('update dartflow_private.profiles set name=$2,display_name_confirmed=true where id=$1',[third,`\t Direct\u00A0\u2007Label ${suffix}\u3000`]);assert.equal((await getProfile(third)).name,direct);
   await assert.rejects(choose(loser,direct.toLowerCase()),{code:'username_taken'});assert.equal((await getProfile(loser)).name,`李明 ${suffix}`);
   for(const value of ['¼','²','Ⅷ']){await choose(loser,value);assert.equal((await getProfile(loser)).displayNameConfirmed,true);}
  });
  await t.test('newer Unicode letters keep their validity and case-insensitive claim on older PostgreSQL ICU tables',async()=>{
   // Node 24.18 / Unicode 17 adds these case pairs beyond the local PostgreSQL ICU 72 tables.
   for(const [upper,lower] of [['\u1C89','\u1C8A'],['\u{10D50}','\u{10D70}'],['\u{16EA0}','\u{16EBB}']]){
    await choose(loser,upper);assert.equal((await getProfile(loser)).displayNameConfirmed,true);
    await assert.rejects(choose(third,lower),{code:'username_taken',status:409});
    await choose(loser,lower);assert.equal((await getProfile(loser)).displayNameConfirmed,true);
    const row=(await owner.query('select dartflow_private.username_key($1)=dartflow_private.username_key($2) same_key,dartflow_private.valid_username($1) valid_upper,dartflow_private.valid_username($2) valid_lower',[upper,lower])).rows[0];
    assert.deepEqual(row,{same_key:true,valid_upper:true,valid_lower:true});
   }
  });
 }finally{
  await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.end();await closeDatabase();
 }
});

test('username migration preserves duplicate and placeholder records, history and rights while requesting a new unique confirmation',{skip:!configured},async()=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();const schema=`username_fixture_${randomUUID().replaceAll('-','')}`;
 const names=['  Zelfde\u00A0naam  ','ZELFDE NAAM','Nieuwe speler','Unique owner','UNIQUE OWNER','李明','¼','²','Ⅷ','\u1C89','\u1C8A','\u{10D50}','\u{16EA0}'],ids=names.map(()=>randomUUID());
 const confirmed=[false,false,false,true,false,true,true,true,true,false,false,true,true];
 try{
  await owner.query('begin');await owner.query(`create schema ${schema}`);await owner.query(`create table ${schema}.profiles(id uuid primary key,name text not null,display_name_confirmed boolean not null default true);create table ${schema}.feature_versions(name text primary key,version integer not null);create table ${schema}.history(profile_id uuid references ${schema}.profiles,snapshot text);create table ${schema}.memberships(profile_id uuid references ${schema}.profiles,role text)`);
  for(const [index,id] of ids.entries()){await owner.query(`insert into ${schema}.profiles(id,name,display_name_confirmed) values($1,$2,$3)`,[id,names[index],index!==4]);await owner.query(`insert into ${schema}.history values($1,$2)`,[id,`Saved original name: ${names[index]}`]);await owner.query(`insert into ${schema}.memberships values($1,'organizer')`,[id]);}
  const file=await readFile(new URL('../supabase/migrations/20261112184741_globally_unique_usernames.sql',import.meta.url),'utf8'),sql=file.replaceAll('dartflow_private',schema).replace(/^begin;\s*/m,'').replace(/\ncommit;\s*$/,'');await owner.query(sql);
  const after=(await owner.query(`select id,name,display_name_confirmed from ${schema}.profiles`)).rows;
  for(const [index,id] of ids.entries()){const row=after.find(r=>r.id===id)!;assert.equal(row.name,names[index]);assert.equal(row.display_name_confirmed,confirmed[index]);}
  assert.equal((await owner.query(`select count(*)::int n from ${schema}.history h join ${schema}.memberships m on m.profile_id=h.profile_id where m.role='organizer'`)).rows[0].n,ids.length);
  for(const [index,id] of ids.entries())assert.equal((await owner.query(`select snapshot from ${schema}.history where profile_id=$1`,[id])).rows[0].snapshot,`Saved original name: ${names[index]}`);
  await owner.query(`update ${schema}.profiles set name='Zelfde naam',display_name_confirmed=true where id=$1`,[ids[0]]);
  await owner.query('savepoint duplicate_claim');await assert.rejects(owner.query(`update ${schema}.profiles set name='ZELFDE NAAM',display_name_confirmed=true where id=$1`,[ids[1]]),{code:'23505'});await owner.query('rollback to savepoint duplicate_claim');
  await owner.query(sql);assert.equal((await owner.query(`select display_name_confirmed from ${schema}.profiles where id=$1`,[ids[0]])).rows[0].display_name_confirmed,true);
 }finally{await owner.query('rollback');await owner.end();}
});
