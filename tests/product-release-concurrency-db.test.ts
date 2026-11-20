import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase} from '../lib/db';
import {executeProductReleaseCommand,getProductRelease} from '../lib/product-releases';
import type {ProductReleaseCommand} from '../lib/product-release-types';
try{process.loadEnvFile('.env.local');}catch{/* Only isolated loopback fixtures. */}
const loopback=(value?:string)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const enabled=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('release resource locks protect concurrent first-save and publication from stale draft overwrites',{skip:!enabled},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const actors=[randomUUID(),randomUUID()],id=randomUUID(),suffix=id.replaceAll('-','').slice(0,10);
 const save=(title:string):ProductReleaseCommand=>({requestId:randomUUID(),action:{type:'release.save',id,expectedRevision:0,product:'dartflow',channel:'web',version:`0.6.0-race.${suffix}`,title,body:`Frozen ${title}`}});
 const active=new Set<Promise<unknown>>();
 const track=<T,>(promise:Promise<T>)=>{active.add(promise);void promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;};
 const waitForLocks=async(count:number)=>{for(let i=0;i<200;i++){
  await admin.query('select pg_stat_clear_snapshot()');
  const waiting=(await admin.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and (query like 'insert into dartflow_private.product_releases%' or query like 'select * from dartflow_private.product_releases%' or query like 'select pg_advisory_xact_lock%')`)).rows[0].n;
  if(waiting>=count)return;await new Promise(resolve=>setTimeout(resolve,10));
 }assert.fail(`Expected ${count} real release commands to wait on database locks.`);};
 try{
  for(const[i,actor]of actors.entries()){await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,true)',[actor,`releaserace${suffix}${i}`,`Release reviewer ${i}`]);await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[actor]);}
  let winner=0;
  await t.test('two distinct first saves of one missing UUID accept one revision and preserve the winner text',async()=>{
   await admin.query('begin');await admin.query('lock table dartflow_private.product_releases in share mode');
   const commands=[save('First editor'),save('Second editor')];
   const pending=commands.map((command,i)=>track(executeProductReleaseCommand(actors[i],command)));
   try{await waitForLocks(2);}finally{await admin.query('commit');}
   const results=await Promise.allSettled(pending);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   winner=results.findIndex(r=>r.status==='fulfilled');const rejected=results.find(r=>r.status==='rejected')as PromiseRejectedResult;assert.equal(rejected.reason.code,'revision_conflict');
   const current=(await admin.query('select * from dartflow_private.product_releases where id=$1',[id])).rows[0];
   const accepted=commands[winner].action;assert.equal(accepted.type,'release.save');assert.ok('title'in accepted);
   assert.equal(current.revision,1);assert.equal(current.status,'draft');assert.equal(current.title,accepted.title);assert.equal(current.body,`Frozen ${current.title}`);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.notification_commands where actor_id=any($1::uuid[])',[actors])).rows[0].n,1);
   await assert.rejects(getProductRelease(actors[0],id),{status:404});
  });
  await t.test('publication wins its row lock and a concurrent stale save cannot change published content',async()=>{
   const original=(await admin.query('select title,body from dartflow_private.product_releases where id=$1',[id])).rows[0];
   await admin.query('begin');await admin.query('select id from dartflow_private.product_releases where id=$1 for update',[id]);
   const publish:ProductReleaseCommand={requestId:randomUUID(),action:{type:'release.publish',id,expectedRevision:1}};
   const pendingPublish=track(executeProductReleaseCommand(actors[winner],publish));
   let pendingOverwrite:Promise<unknown>|undefined;
   try{
    await waitForLocks(1);const stale=save('Forbidden overwrite');stale.action.expectedRevision=1;
    pendingOverwrite=track(executeProductReleaseCommand(actors[1-winner],stale));await waitForLocks(2);
   }finally{await admin.query('commit');}
   const result=await pendingPublish;assert.equal(result.release.status,'published');assert.equal(result.release.revision,2);
   await assert.rejects(pendingOverwrite!,{code:'revision_conflict'});
   const current=await getProductRelease(actors[0],id);assert.equal(current.title,original.title);assert.equal(current.body,original.body);assert.equal(current.revision,2);
   assert.deepEqual(await executeProductReleaseCommand(actors[winner],publish),result);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.mail_events where actor_id=any($1::uuid[])',[actors])).rows[0].n,0,'Editorial publication sends no notification.');
  });
 }finally{
  await admin.query('rollback');await Promise.allSettled([...active]);
  try{await admin.query('delete from dartflow_private.notification_commands where actor_id=any($1::uuid[])',[actors]);await admin.query('delete from dartflow_private.product_releases where id=$1',[id]);await admin.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[actors]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[actors]);}finally{await admin.end();await closeDatabase();}
 }
});
