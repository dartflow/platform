import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
try{process.loadEnvFile('.env.local');}catch{/* The fixture must be explicitly local. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

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
