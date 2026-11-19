import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {NextRequest} from 'next/server';
import {POST} from '../app/api/[...path]/route';
import {closeDatabase} from '../lib/db';
import {handlePlayReviewManagement,reviewPasswordMatches,signInPlayReviewer} from '../lib/play-review';
import {encryptCredential} from '../lib/integrations-core';
import {localNativePlayerSession} from '../lib/native-player';
import {assertAccountActive} from '../lib/account-removal';

try{process.loadEnvFile('.env.local');}catch{}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('review password matching safely handles unequal lengths and arbitrary Unicode',()=>{
 assert.ok(reviewPasswordMatches('synthetic review value','synthetic review value'));
 assert.ok(!reviewPasswordMatches('synthetic review value','different'));
 assert.ok(!reviewPasswordMatches('a','a'.repeat(400)));
 assert.ok(!reviewPasswordMatches('é','e'));
});

test('review login is a scoped real password grant with private credentials, generic errors and fail-closed routing',{skip:!configured},async t=>{
 const db=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await db.connect();
 const savedEnv=new Map(Object.entries({DARTFLOW_DATA_MODE:process.env.DARTFLOW_DATA_MODE,DARTFLOW_APP_ORIGIN:process.env.DARTFLOW_APP_ORIGIN,DARTFLOW_ENV:process.env.DARTFLOW_ENV,NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY}));
 const originalFetch=globalThis.fetch,actor=randomUUID(),companion=randomUUID(),owner=randomUUID(),stranger=randomUUID(),people=[actor,companion,owner,stranger],email=`review-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url'),companionEmail=`companion-${randomUUID()}@example.invalid`,companionPassword=randomBytes(32).toString('base64url'),key=randomBytes(32).toString('base64'),ip=`fixture-${randomUUID()}`;
 const counterKeys=new Set<string>(['play-review:global']),beforeGlobal=(await db.query("select * from dartflow_private.auth_limits where key='play-review:global'")).rows[0];
 let inserted=false,authCalls=0,responseActor:string|null=null,responseAnonymous=false,providerFailure=false;
 const request=(headers:Record<string,string>={})=>{const address=headers['x-forwarded-for']??`${ip}-${randomUUID()}`;counterKeys.add(`play-review:ip:${createHash('sha256').update(address).digest('hex')}`);return new NextRequest('https://staging.dartflow.nl/api/player/v1/auth/review',{method:'POST',headers:{host:'staging.dartflow.nl','x-forwarded-for':address,...headers}});};
 const setHosted=()=>Object.assign(process.env,{DARTFLOW_DATA_MODE:'supabase',DARTFLOW_APP_ORIGIN:'https://staging.dartflow.nl',DARTFLOW_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://dsnqnvbckkqpzadblshu.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_fixture_not_a_credential',DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:key});
 const status=(error:unknown,code:string,http:number)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===code&&'status'in error&&error.status===http);
 const expectInvalid=(promise:Promise<unknown>)=>assert.rejects(promise,error=>status(error,'review_login',401));
 globalThis.fetch=async(target,init)=>{
  // Never allow this suite to perform a real provider request.
  const url=new URL(String(target));assert.equal(url.origin,'https://dsnqnvbckkqpzadblshu.supabase.co');assert.equal(url.pathname,'/auth/v1/token');assert.equal(url.searchParams.get('grant_type'),'password');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  const body=JSON.parse(String(init?.body));assert.ok(body.email===email&&body.password===password||body.email===companionEmail&&body.password===companionPassword,'Only the two synthetic configured identities may reach the Auth adapter.');authCalls++;
  if(providerFailure)return Response.json({error:'synthetic failure',error_description:'synthetic internal details'},{status:400});
  const now=Math.floor(Date.now()/1000);
  return Response.json({access_token:'synthetic.access.token',refresh_token:'synthetic-refresh-not-a-credential',expires_in:3600,expires_at:now+3600,token_type:'bearer',user:{id:responseActor??(body.email===companionEmail?companion:actor),aud:'authenticated',role:'authenticated',email:body.email,email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{name:'Synthetic reviewer'},identities:[],is_anonymous:responseAnonymous}});
 };
 try{
  // The production-shaped mode changes only routing/config. Both database URLs
  // remain the previously verified isolated loopback URLs throughout the suite.
  assert.equal((await db.query("select count(*)::int n from dartflow_private.play_review_accounts where environment='staging'")).rows[0].n,0,'The isolated staging fixture slot must be unused.');
  for(const[id,name]of [[actor,'Synthetic reviewer'],[companion,'Synthetic companion'],[owner,'Synthetic owner'],[stranger,'Synthetic unrelated player']])await db.query('insert into dartflow_private.profiles(id,name,display_name,email,email_verified) values($1,$2,$3,$4,true)',[id,`review${id.slice(0,8)}`,`${name} ${id.slice(0,8)}`,id===actor?email:id===companion?companionEmail:null]);
  await db.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'owner')",[owner]);
  setHosted();const envelope=encryptCredential(password,'play-review-password');
  assert.ok(!JSON.stringify(envelope).includes(password),'Encrypted storage must not contain the plaintext synthetic password.');
  const details=encryptCredential(JSON.stringify({companionEmail,companionPassword}),'play-review-password');
  await db.query("insert into dartflow_private.play_review_accounts(environment,user_id,email,password_envelope,companion_user_id,review_details) values('staging',$1,$2,$3,$4,$5)",[actor,email,envelope,companion,details]);inserted=true;
  counterKeys.add(`play-review:ip:${createHash('sha256').update(ip).digest('hex')}`);
  await t.test('only the configured identity can obtain a session, through the ordinary provider password grant',async()=>{
   const before=authCalls,result=await signInPlayReviewer(request(),{email:`  ${email.toUpperCase()}  `,password});
   assert.equal(authCalls,before+1);assert.ok(result.accessToken==='synthetic.access.token');assert.ok(result.refreshToken==='synthetic-refresh-not-a-credential');assert.ok(Date.parse(result.expiresAt)>Date.now());
   assert.equal((await db.query('select email from dartflow_private.profiles where id=$1',[actor])).rows[0].email,email);
   assert.equal((await db.query('select count(*)::int n from dartflow_private.platform_roles where user_id=$1',[actor])).rows[0].n,0,'Review sign-in must not grant administrator rights.');
  });
  await t.test('the configured companion uses its own password and is bound to its own Auth account ID',async()=>{
   const before=authCalls;await signInPlayReviewer(request(),{email:companionEmail,password:companionPassword});assert.equal(authCalls,before+1);
   assert.equal((await db.query('select email from dartflow_private.profiles where id=$1',[companion])).rows[0].email,companionEmail);
   const after=authCalls;await expectInvalid(signInPlayReviewer(request(),{email,password:companionPassword}));await expectInvalid(signInPlayReviewer(request(),{email:companionEmail,password}));assert.equal(authCalls,after);
   responseActor=actor;await expectInvalid(signInPlayReviewer(request(),{email:companionEmail,password:companionPassword}));responseActor=null;
   assert.equal((await db.query('select count(*)::int n from dartflow_private.platform_roles where user_id=$1',[companion])).rows[0].n,0);
  });
  await t.test('unknown users, incorrect passwords, extra authority fields and disabled configuration fail before Auth',async()=>{
   const before=authCalls;
   for(const input of [{email:'unknown@example.invalid',password},{email,password:password+'wrong'},{email,password,userId:owner},{email,password,role:'owner'},{email,password:'short'}])await expectInvalid(signInPlayReviewer(request(),input));
   await db.query("update dartflow_private.play_review_accounts set enabled=false where environment='staging'");await expectInvalid(signInPlayReviewer(request(),{email,password}));await db.query("update dartflow_private.play_review_accounts set enabled=true where environment='staging'");
   assert.equal(authCalls,before,'Rejected accounts must never invoke the provider.');
  });
  await t.test('credential corruption, wrong environment and missing encryption key cannot create a login',async()=>{
   const before=authCalls;
   await db.query("update dartflow_private.play_review_accounts set password_envelope=jsonb_set(password_envelope,'{ciphertext}','\"tampered\"') where environment='staging'");await expectInvalid(signInPlayReviewer(request(),{email,password}));
   await db.query("update dartflow_private.play_review_accounts set password_envelope=$1 where environment='staging'",[envelope]);
   process.env.NEXT_PUBLIC_SUPABASE_URL='https://wlrnowuownakqqgjxnbb.supabase.co';await expectInvalid(signInPlayReviewer(request(),{email,password}));setHosted();
   delete process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY;await expectInvalid(signInPlayReviewer(request(),{email,password}));setHosted();
   assert.equal(authCalls,before);
  });
  await t.test('a provider response cannot substitute another account or an anonymous principal',async()=>{
   responseActor=owner;await expectInvalid(signInPlayReviewer(request(),{email,password}));responseActor=null;
   responseAnonymous=true;await expectInvalid(signInPlayReviewer(request(),{email,password}));responseAnonymous=false;
   providerFailure=true;await expectInvalid(signInPlayReviewer(request(),{email,password}));providerFailure=false;
  });
  await t.test('owner status is sanitized and secret retrieval rejects unrelated users and unsupported methods',async()=>{
   const response=await handlePlayReviewManagement(new NextRequest('https://staging.dartflow.nl/api/admin/play-review',{method:'GET'}),owner,'admin/play-review');assert.ok(response);assert.equal(response.status,200);
   assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   const view=await response.json();assert.equal(view.configured,true);assert.equal(view.enabled,true);assert.equal(view.email,email);assert.ok(!('password'in view));assert.ok(!('password_envelope'in view));assert.ok(!('companionPassword'in view));assert.ok(!('review_details'in view));
   const before=authCalls;await assert.rejects(handlePlayReviewManagement(request(),stranger,'admin/play-review'),error=>status(error,'owner_required',403));assert.equal(authCalls,before);
   const unsupported=new NextRequest('https://staging.dartflow.nl/api/admin/play-review',{method:'DELETE'});assert.equal((await handlePlayReviewManagement(unsupported,owner,'admin/play-review'))?.status,405);
   assert.equal(await handlePlayReviewManagement(request(),stranger,'unrelated/path'),null);
  });
  await t.test('credential table is private and the runtime cannot overwrite identity or ciphertext',async()=>{
   assert.equal((await db.query("select relrowsecurity from pg_class where oid='dartflow_private.play_review_accounts'::regclass")).rows[0].relrowsecurity,true);
   assert.equal((await db.query("select count(*)::int n from information_schema.role_table_grants where table_schema='dartflow_private' and table_name='play_review_accounts' and grantee in('PUBLIC','anon','authenticated')")).rows[0].n,0);
   const rights=(await db.query("select has_column_privilege('dartflow_app','dartflow_private.play_review_accounts','password_envelope','UPDATE') ciphertext,has_column_privilege('dartflow_app','dartflow_private.play_review_accounts','user_id','UPDATE') identity,has_column_privilege('dartflow_app','dartflow_private.play_review_accounts','enabled','UPDATE') disable")).rows[0];assert.equal(rights.ciphertext,false);assert.equal(rights.identity,false);assert.equal(rights.disable,true);
  });
  await t.test('persistent IP cooldown blocks login before Auth and permits recovery after expiry',async()=>{
   const limitedIp=`fixture-limit-${randomUUID()}`,counter=`play-review:ip:${createHash('sha256').update(limitedIp).digest('hex')}`;counterKeys.add(counter);
   await db.query("insert into dartflow_private.auth_limits(key,count,reset_at) values($1,20,now()+interval '15 minutes')",[counter]);
   const before=authCalls;await assert.rejects(signInPlayReviewer(request({'x-forwarded-for':limitedIp}),{email,password}),error=>status(error,'rate_limited',429));assert.equal(authCalls,before);
   await db.query("update dartflow_private.auth_limits set reset_at=now()-interval '1 second' where key=$1",[counter]);await signInPlayReviewer(request({'x-forwarded-for':limitedIp}),{email,password});assert.equal(authCalls,before+1);
  });
  await t.test('disabling review access also rejects both already-issued account principals',async()=>{
   await db.query("update dartflow_private.play_review_accounts set enabled=false where environment='staging'");
   try{
    await assert.rejects(assertAccountActive(actor),error=>status(error,'unauthorized',401));
    await assert.rejects(assertAccountActive(companion),error=>status(error,'unauthorized',401));
    await assertAccountActive(stranger);
   }finally{await db.query("update dartflow_private.play_review_accounts set enabled=true where environment='staging'");}
  });
  await t.test('native safety endpoints reject malformed block intent, browser origin and administrative forwarding',async()=>{
   process.env.DARTFLOW_DATA_MODE='local';process.env.DARTFLOW_APP_ORIGIN=savedEnv.get('DARTFLOW_APP_ORIGIN')||'http://localhost:3000';
   const origin=process.env.DARTFLOW_APP_ORIGIN,fixtureActor='00000000-0000-4000-8000-000000000002',fixtureOther='00000000-0000-4000-8000-000000000003';
   const initial=new NextRequest(`${origin}/api/player/v1/session`,{headers:{host:new URL(origin).host}}),token=localNativePlayerSession(fixtureActor,initial).accessToken;
   const call=async(path:string,input:unknown,headers:Record<string,string>={})=>POST(new NextRequest(`${origin}/api/player/v1/${path}`,{method:'POST',headers:{host:new URL(origin).host,authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}),{params:Promise.resolve({path:['player','v1',...path.split('/')]})});
   const before=(await db.query('select source_id,target_id,kind from dartflow_private.platform_relationships where source_id=$1 or target_id=$1 order by source_id,target_id,kind',[fixtureActor])).rows;
   for(const blocked of [undefined,null,'false',0,1,{},[]]){const response=await call('safety/block',{requestId:randomUUID(),userId:fixtureOther,...(blocked===undefined?{}:{blocked})});assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid_command');}
   for(const userId of ['',null,'not-a-uuid'])assert.equal((await call('safety/block',{requestId:randomUUID(),userId,blocked:true})).status,400);
   assert.equal((await call('safety/block',{requestId:randomUUID(),userId:fixtureOther,blocked:true},{origin:'https://unrelated.invalid'})).status,403);
   assert.equal((await call('admin/play-review',{})).status,404);
   assert.equal((await call('auth/review',{email,password},{origin:'https://unrelated.invalid'})).status,403);
   const after=(await db.query('select source_id,target_id,kind from dartflow_private.platform_relationships where source_id=$1 or target_id=$1 order by source_id,target_id,kind',[fixtureActor])).rows;assert.deepEqual(after,before);
   for(const suffix of ['read','write'])counterKeys.add(`native-player:actor:${fixtureActor}:${suffix}`);
   counterKeys.add(`native-player:ip:${createHash('sha256').update('direct').digest('hex')}`);
   setHosted();
  });
 }finally{
  globalThis.fetch=originalFetch;
  try{
   await db.query('begin');
   if(inserted)await db.query("delete from dartflow_private.play_review_accounts where environment='staging' and user_id=$1",[actor]);
   await db.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]))',[people]);
   await db.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);
   await db.query('delete from dartflow_private.mail_events where actor_id=any($1::uuid[]) or recipient_key=any($2::text[])',[people,people.map(id=>`user:${id}`)]);
   await db.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[])',[people]);
   await db.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);
   await db.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
   // Only fixture-specific counters are removed; preserve a pre-existing global budget.
   counterKeys.delete('play-review:global');counterKeys.delete('native-player:actor:00000000-0000-4000-8000-000000000002:read');counterKeys.delete('native-player:actor:00000000-0000-4000-8000-000000000002:write');counterKeys.delete(`native-player:ip:${createHash('sha256').update('direct').digest('hex')}`);
   await db.query('delete from dartflow_private.auth_limits where key=any($1::text[])',[[...counterKeys]]);
   if(beforeGlobal)await db.query("update dartflow_private.auth_limits set count=$1,reset_at=$2 where key='play-review:global'",[beforeGlobal.count,beforeGlobal.reset_at]);else await db.query("delete from dartflow_private.auth_limits where key='play-review:global'");
   await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  finally{
   for(const[name,value]of savedEnv){if(value===undefined)delete process.env[name];else process.env[name]=value;}
   await Promise.allSettled([db.end(),closeDatabase()]);
  }
 }
});
