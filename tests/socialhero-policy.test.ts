import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {authenticateBlogToken,requireBlogCredential} from '../lib/blog-store';
import {checkSocialHero,disconnectSocialHero,pairSocialHero,setSocialHeroPolicy,setSocialHeroPublish,socialHeroStatus} from '../lib/socialhero-connection';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('destination permission choices survive retries, relinking and disconnect',{skip:!configured},async t=>{
 const envKeys=['DARTFLOW_ENV','DARTFLOW_APP_ORIGIN','DARTFLOW_SOCIALHERO_ORIGIN','DARTFLOW_SOCIALHERO_SITE_ID','DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY'] as const;
 const previous=Object.fromEntries(envKeys.map(name=>[name,process.env[name]]));
 const site=`policy-${randomUUID()}`,legacySite=`legacy-${randomUUID()}`,actor=randomUUID();
 Object.assign(process.env,{DARTFLOW_ENV:'staging',DARTFLOW_APP_ORIGIN:'https://localhost:3000',DARTFLOW_SOCIALHERO_ORIGIN:'https://socialhero.example.com',DARTFLOW_SOCIALHERO_SITE_ID:site,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 let destination='destination-a',latestToken='',lostClaim=false,failedVerify=false;
 const sessions=new Map<string,{connectionId:string;destinationId:string;accessToken:string;expiresAt:string}>();
 const pendingScopes:string[][]=[];
 const transport:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/claim')){
   const body=JSON.parse(String(init?.body));let session=sessions.get(body.attemptId);
   if(!session){session={connectionId:randomUUID(),destinationId:destination,accessToken:randomBytes(32).toString('base64url'),expiresAt:new Date(Date.now()+600_000).toISOString()};sessions.set(body.attemptId,session);}
   latestToken=session.accessToken;
   if(lostClaim){lostClaim=false;throw new Error('lost claim response');}
   return Response.json(session);
  }
  const secret=new Headers(init?.headers).get('authorization')!.slice(7),session=[...sessions.values()].find(value=>value.accessToken===secret)!;
  const credential=await authenticateBlogToken(secret);assert.equal(credential.state,'pending');pendingScopes.push(credential.scopes);
  await assert.rejects(requireBlogCredential(database(),credential,'publish'),{code:'PAIRING_IN_PROGRESS'});
  if(failedVerify){failedVerify=false;throw new Error('interrupted verify');}
  return Response.json({connectionId:session.connectionId,status:'verified'});
 };
 const pair=(code:string,choice?:{draft:boolean;publish:boolean})=>pairSocialHero(actor,code,{fetch:transport,...choice});
 const policy=async(id:string,environment='staging')=>(await owner.query('select * from dartflow_private.socialhero_destination_policies where site_id=$1 and environment=$2 and destination_id=$3',[site,environment,id])).rows[0];
 try{
  await owner.query('insert into dartflow_private.profiles(id,name,display_name) values($1,$2,$2)',[actor,site]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[actor]);
  await t.test('first pairing defaults both rights on and records the explicit chooser',async()=>{
   const empty=await socialHeroStatus(actor);assert.equal(empty.draft,true);assert.equal(empty.publish,true);assert.equal(empty.hasSavedPolicy,false);
   await assert.rejects(pair('inconsistent',{draft:false,publish:true}),{code:'VALIDATION_ERROR'});
   const result=await pair('first');assert.equal(result.draft,true);assert.equal(result.publish,true);assert.equal(result.hasSavedPolicy,true);assert.ok(result.lastCheckedAt);
   assert.deepEqual(pendingScopes.at(-1),['read','media:write','drafts:write','publish']);
   const saved=await policy(destination);assert.equal(saved.decided_by,actor);assert.equal(saved.decision_source,'pairing');assert.ok(saved.decided_at);
   assert.equal((await owner.query('select count(*)::int n from dartflow_private.socialhero_permission_events where site_id=$1',[site])).rows[0].n,1);
  });
  await t.test('turning either right off updates the current token before returning',async()=>{
   const authenticated=await authenticateBlogToken(latestToken);
   await setSocialHeroPolicy(actor,{draft:true,publish:false});
   await assert.rejects(requireBlogCredential(database(),authenticated,'publish'),{code:'PERMISSION_DENIED'});
   await requireBlogCredential(database(),authenticated,'drafts:write');
   const result=await setSocialHeroPolicy(actor,{draft:false,publish:false});assert.equal(result.draft,false);assert.equal(result.publish,false);
   assert.deepEqual((await authenticateBlogToken(latestToken)).scopes,['read']);
   await assert.rejects(requireBlogCredential(database(),authenticated,'drafts:write'),{code:'PERMISSION_DENIED'});
   await assert.rejects(setSocialHeroPublish(actor,true),{code:'VALIDATION_ERROR'});
  });
  await t.test('disconnect and prechecked relinking never reenable a saved opt-out',async()=>{
   await disconnectSocialHero(actor);let result=await socialHeroStatus(actor);assert.equal(result.draft,false);assert.equal(result.publish,false);assert.equal(result.hasSavedPolicy,true);
   const count=(await owner.query('select count(*)::int n from dartflow_private.socialhero_permission_events where site_id=$1',[site])).rows[0].n;
   result=await pair('relinked',{draft:true,publish:true});assert.equal(result.draft,false);assert.equal(result.publish,false);assert.deepEqual(pendingScopes.at(-1),['read']);
   assert.equal((await owner.query('select count(*)::int n from dartflow_private.socialhero_permission_events where site_id=$1',[site])).rows[0].n,count);
   await disconnectSocialHero(actor);
   result=await setSocialHeroPolicy(actor,{draft:true,publish:false});assert.equal(result.status,'disconnected');assert.equal(result.draft,true);assert.equal(result.publish,false);
   result=await pair('relinked-again',{draft:true,publish:true});assert.equal(result.draft,true);assert.equal(result.publish,false);
  });
  await t.test('a lost claim response retains its first consent and another destination has its own choice',async()=>{
   destination='destination-b';lostClaim=true;
   await assert.rejects(pair('lost',{draft:true,publish:false}),{code:'PROVIDER_UNAVAILABLE'});
   let result=await socialHeroStatus(actor);assert.equal(result.previousConnectionActive,true);assert.equal(result.draft,true);assert.equal(result.publish,false);
   const attempts=sessions.size;result=await pair('lost',{draft:true,publish:true});assert.equal(sessions.size,attempts);assert.equal(result.publish,false);
   assert.equal((await policy('destination-a')).publish_enabled,false);
   destination='destination-c';result=await pair('third');assert.equal(result.publish,true);assert.equal(result.draft,true);
   result=await pair('third-reduced',{draft:true,publish:false});assert.equal(result.publish,false);assert.equal(result.draft,true);
   assert.deepEqual((await authenticateBlogToken(latestToken)).scopes,['read','media:write','drafts:write']);
   result=await pair('third-defaults',{draft:true,publish:true});assert.equal(result.publish,false);
   const decision=(await owner.query("select source,actor_id,publish_enabled from dartflow_private.socialhero_permission_events where site_id=$1 and destination_id='destination-c' order by id desc limit 1",[site])).rows[0];
   assert.equal(decision.source,'pairing');assert.equal(decision.actor_id,actor);assert.equal(decision.publish_enabled,false);
   await owner.query("insert into dartflow_private.socialhero_destination_policies(site_id,environment,destination_id,draft_enabled,publish_enabled,decided_by,decision_source)values($1,'production','destination-c',false,false,$2,'admin')",[site,actor]);
   await setSocialHeroPolicy(actor,{draft:true,publish:false});assert.equal((await policy('destination-c','production')).draft_enabled,false);
  });
  await t.test('policy changes during interrupted provisioning control activation',async()=>{
   destination='destination-d';failedVerify=true;
   await assert.rejects(pair('pending'),{code:'PROVIDER_UNAVAILABLE'});
   const pending=await setSocialHeroPolicy(actor,{draft:false,publish:false});assert.equal(pending.status,'pending');assert.deepEqual((await authenticateBlogToken(latestToken)).scopes,['read']);
   const result=await checkSocialHero(actor,{fetch:transport});assert.equal(result.status,'active');assert.equal(result.draft,false);assert.equal(result.publish,false);assert.deepEqual((await authenticateBlogToken(latestToken)).scopes,['read']);
  });
  await t.test('same-code claim retries persist consent reductions and never restore a grant by default',async()=>{
   destination='same-attempt-claim';lostClaim=true;
   await assert.rejects(pair('same-claim',{draft:true,publish:true}),{code:'PROVIDER_UNAVAILABLE'});
   const attempts=sessions.size;
   let result=await pair('same-claim',{draft:true,publish:false});assert.equal(sessions.size,attempts);assert.equal(result.draft,true);assert.equal(result.publish,false);assert.deepEqual(pendingScopes.at(-1),['read','media:write','drafts:write']);
   assert.equal((await policy(destination)).publish_enabled,false);
   result=await pair('same-claim',{draft:true,publish:true});assert.equal(result.publish,false);assert.equal(sessions.size,attempts);
   result=await pair('same-claim',{draft:false,publish:false});assert.equal(result.draft,false);assert.equal(result.publish,false);assert.deepEqual((await authenticateBlogToken(latestToken)).scopes,['read']);
   await setSocialHeroPolicy(actor,{draft:true,publish:true});
   result=await pair('same-claim',{draft:true,publish:true});assert.equal(result.draft,true);assert.equal(result.publish,true);assert.equal(sessions.size,attempts);
  });
  await t.test('same-code pending retries reduce the stored policy and token before another verification attempt',async()=>{
   destination='same-attempt-pending';failedVerify=true;
   await assert.rejects(pair('same-pending',{draft:true,publish:true}),{code:'PROVIDER_UNAVAILABLE'});
   const token=latestToken,attempts=sessions.size;failedVerify=true;
   await assert.rejects(pair('same-pending',{draft:false,publish:false}),{code:'PROVIDER_UNAVAILABLE'});
   assert.equal(latestToken,token);assert.equal(sessions.size,attempts);assert.deepEqual((await authenticateBlogToken(token)).scopes,['read']);assert.equal((await policy(destination)).draft_enabled,false);assert.equal((await policy(destination)).publish_enabled,false);
   const result=await pair('same-pending',{draft:true,publish:true});assert.equal(result.status,'active');assert.equal(result.draft,false);assert.equal(result.publish,false);assert.deepEqual((await authenticateBlogToken(token)).scopes,['read']);
   const decision=(await owner.query('select source,actor_id,draft_enabled,publish_enabled from dartflow_private.socialhero_permission_events where site_id=$1 and destination_id=$2 order by id desc limit 1',[site,destination])).rows[0];assert.equal(decision.source,'pairing');assert.equal(decision.actor_id,actor);assert.equal(decision.draft_enabled,false);assert.equal(decision.publish_enabled,false);
  });
  await t.test('legacy false is imported once and permission history is append-only for runtime',async()=>{
   await owner.query("insert into dartflow_private.socialhero_settings(site_id,environment,publish_enabled)values($1,'staging',false)",[legacySite]);
   await owner.query("insert into dartflow_private.socialhero_connections(id,site_id,environment,origin,provider_origin,code_hash,destination_id,status,created_by)values($1,$2,'staging','https://staging.dartflow.nl','https://socialhero.example.com','legacy-code-hash','legacy-destination','disconnected',$3)",[randomUUID(),legacySite,actor]);
   const migration=await readFile(new URL('../supabase/migrations/20261126010000_socialhero_permissions.sql',import.meta.url),'utf8');
   await owner.query(migration);await owner.query(migration);
   const imported=(await owner.query('select * from dartflow_private.socialhero_destination_policies where site_id=$1',[legacySite])).rows[0];assert.equal(imported.publish_enabled,false);assert.equal(imported.decision_source,'legacy');assert.equal(imported.decided_by,null);
   assert.equal((await owner.query('select count(*)::int n from dartflow_private.socialhero_permission_events where site_id=$1',[legacySite])).rows[0].n,1);
   await assert.rejects(database().query('update dartflow_private.socialhero_permission_events set publish_enabled=false where site_id=$1',[site]),{code:'42501'});
   await assert.rejects(database().query('delete from dartflow_private.socialhero_permission_events where site_id=$1',[site]),{code:'42501'});
  });
 }finally{
  for(const table of ['socialhero_permission_events','socialhero_destination_policies','socialhero_settings','socialhero_connections','blog_audit','blog_tokens'])await owner.query(`delete from dartflow_private.${table} where site_id=any($1::text[])`,[[site,legacySite]]);
  await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[actor]);await owner.query('delete from dartflow_private.profiles where id=$1',[actor]);
  await owner.end();await closeDatabase();
  for(const name of envKeys){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
 }
});
