import {test}from'node:test';
import assert from'node:assert/strict';
import {randomUUID}from'node:crypto';
import pg from'pg';
import {closeDatabase,database}from'../lib/db';
import {executeOrganizerDraftCommand,getOrganizerDrafts}from'../lib/organizer-drafts';
import type{OrganizerDraftCommand}from'../lib/organizer-drafts-types';
try{process.loadEnvFile('.env.local');}catch{/* Loopback fixture only. */}
const local=(v?:string)=>{try{return !!v&&['127.0.0.1','localhost','[::1]'].includes(new URL(v).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('organizer drafts share current club scope and reconcile cross-device saves without losing another revision',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();const people=Array.from({length:5},()=>randomUUID()),[owner,manager,member,outsider,platform]=people,club=randomUUID(),suffix=randomUUID().slice(0,8);
 const send=(actor:string,action:OrganizerDraftCommand['action'],requestId:string=randomUUID())=>executeOrganizerDraftCommand(actor,{requestId,action});
 const save=(values:Partial<OrganizerDraftCommand['action']>={}):OrganizerDraftCommand['action']=>({type:'draft.save',expectedRevision:0,kind:'tournament',ownership:'personal',name:'Vrijdagavond',step:'format',values:{name:'Vrijdagavond',format:'pools-knockout',capacity:'16'},...values});
 try{
  for(const[index,id]of people.entries())await admin.query('insert into dartflow_private.profiles(id,name)values($1,$2)',[id,`draft_${suffix}_${index}`]);
  await admin.query("insert into dartflow_private.clubs(id,name)values($1,'Draft club')",[club]);for(const player of[owner,manager,member])await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,$3)',[club,player,player===member?'player':'organizer']);await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[platform]);
  const personal=await send(owner,save());const requestId=randomUUID(),action=save({ownership:'club',clubId:club,name:'Gedeeld clubconcept'});let shared=await send(owner,action,requestId);
  await t.test('only the owner sees personal values and club managers share their scoped draft',async()=>{
   assert.equal((await getOrganizerDrafts(outsider)).drafts.length,0);
   assert.equal((await getOrganizerDrafts(member)).drafts.length,0);
   assert.equal((await getOrganizerDrafts(manager)).drafts.some(row=>row.id===shared.id),true);
   assert.equal((await getOrganizerDrafts(manager)).drafts.some(row=>row.id===personal.id),false);
   await assert.rejects(send(manager,save({id:personal.id,expectedRevision:1})),{code:'forbidden'});
   await assert.rejects(send(owner,save({id:personal.id,expectedRevision:1,ownership:'club',clubId:club})),{code:'draft_scope_locked'});
   assert.deepEqual(await send(owner,action,requestId),shared);
   await assert.rejects(send(owner,{...action,name:'Anders'},requestId),{code:'request_reused'});
  });
  await t.test('concurrent devices accept one revision and return an actionable conflict for the stale save',async()=>{
   const left=save({id:shared.id,expectedRevision:shared.draft!.revision,ownership:'club',clubId:club,name:'Webaanpassing'}),right={...left,name:'Telefoonaanpassing'};
   const results=await Promise.allSettled([send(owner,left),send(manager,right)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const rejected=results.find(row=>row.status==='rejected');assert.equal(rejected?.status==='rejected'?rejected.reason.code:undefined,'revision_conflict');
   const latest=(await getOrganizerDrafts(owner)).drafts.find(row=>row.id===shared.id)!;assert.equal(latest.revision,2);shared={ok:true,id:latest.id,draft:latest};
  });
  await t.test('revoked club and platform roles cannot replay or fetch an old authorized draft',async()=>{
   const command=save({id:shared.id,expectedRevision:shared.draft!.revision,ownership:'club',clubId:club,name:'Bevoegde beheerder'}),id=randomUUID();await send(manager,command,id);
   await admin.query('delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,manager]);assert.equal((await getOrganizerDrafts(manager)).drafts.length,0);await assert.rejects(send(manager,command,id),{code:'forbidden'});
   await assert.rejects(send(owner,save({ownership:'platform'})),{code:'forbidden'});
   const national=await send(platform,save({ownership:'platform',kind:'season'}));assert.ok((await getOrganizerDrafts(platform)).drafts.some(row=>row.id===national.id));await admin.query('delete from dartflow_private.platform_roles where user_id=$1',[platform]);assert.equal((await getOrganizerDrafts(platform)).drafts.length,0);
  });
  await t.test('sensitive fields and oversized forms stay outside durable storage',async()=>{
   for(const values of[{password:'private'},{nested:{access_token:'private'}},{playerPin:'012345'}])await assert.rejects(send(owner,save({values})),{code:'private_field'});
   await assert.rejects(send(owner,save({values:{notes:'x'.repeat(33_000)}})),{code:'draft_too_large'});
   const role=(await admin.query("select has_column_privilege('dartflow_app','dartflow_private.organizer_drafts','owner_id','update')as update_owner,has_table_privilege('dartflow_app','dartflow_private.organizer_draft_receipts','delete')as delete_receipt")).rows[0];assert.deepEqual(role,{update_owner:false,delete_receipt:false});
   await assert.rejects(database().query('update dartflow_private.organizer_draft_receipts set payload_hash=$1 where actor_id=$2',['forged',owner]),{code:'42501'});
  });
  await t.test('delete has a revision and its identical retry remains idempotent',async()=>{
   const latest=(await getOrganizerDrafts(owner)).drafts.find(row=>row.id===personal.id)!,id=randomUUID(),command={type:'draft.delete' as const,id:latest.id,expectedRevision:latest.revision};const deleted=await send(owner,command,id);assert.deepEqual(await send(owner,command,id),deleted);assert.equal((await getOrganizerDrafts(owner)).drafts.some(row=>row.id===latest.id),false);
  });
 }finally{try{await admin.query('delete from dartflow_private.organizer_drafts where owner_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);}finally{await admin.end();await closeDatabase();}}
});
