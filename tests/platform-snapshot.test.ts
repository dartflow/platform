import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeDatabase, database } from '../lib/db';
import { executePlatformCommand, getPlatformOverview } from '../lib/platform';
import type { PlatformCommand } from '../lib/platform-types';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies the explicit local fixture. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);

test('an overview never combines an old tournament revision with a newly approved member',{skip:!configured},async()=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const host=randomUUID(),applicant=randomUUID(),people=[host,applicant],pool=database(),originalQuery=pool.query;
 const run=(actor:string,action:PlatformCommand['action'],expectedRevision?:number)=>executePlatformCommand(actor,{requestId:randomUUID(),action,...(expectedRevision===undefined?{}:{expectedRevision})});
 let resumeRead=()=>{};
 let pendingOverview:ReturnType<typeof getPlatformOverview>|undefined;
 try{
  await owner.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true),($3,$4,true)',[host,'Snapshot organizer fixture',applicant,'Snapshot applicant fixture']);
  const club=(await run(host,{type:'club.create',name:'Snapshot coherence fixture club'})).id!;
  const tournament=await run(host,{type:'tournament.create',clubId:club,name:'Snapshot approval fixture',eligibility:'all',approvalRequired:true,boards:1});
  await run(applicant,{type:'competition.register',id:tournament.id});
  const initial=(await getPlatformOverview(applicant)).tournaments.find(e=>e.id===tournament.id)!;
  assert.equal(initial.members.find(m=>m.id===applicant)?.status,'pending');
  let readReached=()=>{};
  const reached=new Promise<void>(resolve=>{readReached=resolve;}),release=new Promise<void>(resolve=>{resumeRead=resolve;});
  let intercepted=false;
  // Delegate every query to real Postgres. The barrier changes timing, never SQL or results.
  pool.query=new Proxy(originalQuery,{apply(target,thisArg,args){
   const response=Reflect.apply(target,thisArg,args) as unknown;
   if(!(response instanceof Promise))return response;
   return (response as Promise<pg.QueryResult<Record<string,unknown>>>).then(async result=>{
    if(!intercepted&&result.rows.some(row=>row.id===tournament.id&&row.kind==='tournament')){
     intercepted=true;readReached();await release;
    }
    return result;
   });
  }});
  pendingOverview=getPlatformOverview(applicant);
  let barrierTimeout:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([reached,new Promise<never>((_,reject)=>{barrierTimeout=setTimeout(()=>reject(new Error('The real overview query never reached the synchronization barrier.')),5000);})]);
   await run(host,{type:'competition.approve',id:tournament.id,userId:applicant},initial.revision);
  }finally{if(barrierTimeout)clearTimeout(barrierTimeout);resumeRead();}
  const snapshot=(await pendingOverview).tournaments.find(e=>e.id===tournament.id)!;
  assert.equal(intercepted,true);
  assert.equal(snapshot.revision,initial.revision);
  assert.equal(snapshot.members.find(m=>m.id===applicant)?.status,'pending','A pre-approval entity revision must carry its pre-approval member state.');
  pool.query=originalQuery;
  const approved=(await getPlatformOverview(applicant)).tournaments.find(e=>e.id===tournament.id)!;
  assert.equal(approved.revision,initial.revision+1);assert.equal(approved.members.find(m=>m.id===applicant)?.status,'active');
  // Genuine stale writes still fail; a coherent approved view can check in immediately.
  await assert.rejects(run(applicant,{type:'competition.checkin',id:tournament.id},initial.revision),{code:'revision_conflict',status:409});
  await run(applicant,{type:'competition.checkin',id:tournament.id},approved.revision);
  const checked=(await getPlatformOverview(host)).tournaments.find(e=>e.id===tournament.id)!;
  assert.equal(checked.members.find(m=>m.id===applicant)?.attributes.checkedIn,true);
 }finally{
  resumeRead();if(pendingOverview)await Promise.allSettled([pendingOverview]);pool.query=originalQuery;
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  const clubs=(await owner.query('select club_id from dartflow_private.club_memberships where user_id=any($1::uuid[])',[people])).rows.map(r=>r.club_id);
  const events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[clubs])).rows.map(r=>r.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(r=>r.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(p=>`user:${p}`)]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[entities]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  for(const table of ['boards','entries','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[clubs]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.end();await closeDatabase();
 }
});
