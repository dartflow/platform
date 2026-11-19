import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import pg from 'pg';
import {NextRequest} from 'next/server';
import {nativePlayerBearer,nativePlayerCallback,nativePlayerCapabilities,nativePlayerRouteAllowed,localNativePlayerSession,verifyLocalNativePlayerSession,handleNativePlayerApi} from '../lib/native-player';
import {nativePlayerPrincipal,withNativePlayerPrincipal} from '../lib/native-player-context';
import {actorId} from '../lib/auth';
import {closeDatabase,database} from '../lib/db';
import {GET,POST} from '../app/api/[...path]/route';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies the loopback fixture. */}
const origin='http://localhost:3000';
const request=(path='session',method='GET',headers:Record<string,string>={},input?:unknown)=>new NextRequest(`${origin}/api/player/v1/${path}`,{method,headers:{host:'localhost:3000',...headers,...(input!==undefined?{'Content-Type':'application/json'}:{})},...(input!==undefined?{body:JSON.stringify(input)}:{})});
const localEnvironment=()=>{process.env.DARTFLOW_DATA_MODE='local';process.env.DARTFLOW_APP_ORIGIN=origin;};
const actor='00000000-0000-4000-8000-000000000002';
test('native route allowlist includes player functions and excludes worker, cookie auth and arbitrary forwarding',()=>{
 const training=randomUUID();assert.equal(nativePlayerRouteAllowed(`trainings/${training}`,'GET'),true);
 for(const [path,method]of [[`trainings/${training}`,'POST'],[`trainings/${training}/actions`,'POST'],[`trainings/${training}/extra`,'GET'],['trainings/not-an-id','GET']])assert.equal(nativePlayerRouteAllowed(path,method),false,path);
 for(const [path,method]of [[`rankings/events/${randomUUID()}`,'GET'],['rankings/actions','POST'],['organizer-drafts','GET'],['organizer-drafts/actions','POST'],['faq','GET'],['faq/admin','GET'],['faq/admin/actions','POST'],[`matches/${randomUUID()}/corrections`,'GET'],[`matches/${randomUUID()}/corrections/actions`,'POST'],['rankings','GET'],[`events/${randomUUID()}/boards`,'GET'],['session','GET'],['profile','GET'],['profile/complete','POST'],['profile/player-pin','POST'],['platform/actions','POST'],[`matches/${randomUUID()}/actions`,'POST'],[`events/${randomUUID()}/actions`,'POST'],[`platform/matches/${randomUUID()}/signals`,'POST'],['player-statistics','GET'],['oche/v1/context','GET'],['oche/v1/devices','GET'],['oche/v1/claim','POST'],['oche/v1/home-session','POST'],[`oche/v1/devices/${randomUUID()}`,'POST']])assert.equal(nativePlayerRouteAllowed(path,method),true,path);
 for(const [path,method]of [[`rankings/events/${randomUUID()}`,'POST'],['rankings/actions','GET'],['organizer-drafts','POST'],['organizer-drafts/actions','GET'],['faq','POST'],['faq/admin','POST'],['faq/admin/actions','GET'],[`matches/${randomUUID()}/corrections`,'POST'],[`matches/${randomUUID()}/corrections/actions`,'GET'],['rankings','POST'],[`events/${randomUUID()}/boards`,'POST'],['auth/google','GET'],['auth/otp','POST'],['auth/local','POST'],['mail/process','POST'],['integrations','GET'],['blog/admin','POST'],['health','GET'],['platform/export/players','GET'],['oche/v1/devices','POST'],['oche/v1/start','POST'],['oche/v1/redeem','POST'],['oche/v1/snapshot','GET'],['oche/v1/limits','POST'],['session','DELETE'],['../platform','GET'],['platform%2factions','POST'],['platform/actions/extra','POST']])assert.equal(nativePlayerRouteAllowed(path,method),false,path);
});
test('published native FAQ is available before login while ranking and director reads still require bearer',async()=>{
 localEnvironment();
 const faq=await GET(request('faq?id=start-zonderclub'),{params:Promise.resolve({path:['player','v1','faq']})});
 assert.equal(faq.status,200);const data=await faq.json();assert.equal(data.version,'2026.11.19');assert.equal(data.items.length,1);assert.equal(data.items[0].id,'start-zonderclub');
 for(const path of ['rankings',`events/${randomUUID()}/boards`]){const result=await GET(request(path),{params:Promise.resolve({path:['player','v1',...path.split('/')]})});assert.equal(result.status,401,path);}
});
test('native authentication never falls back to cookies, actor headers, browser Origin, malformed or oversized bearer',()=>{
 localEnvironment();
 const invalidHeaders:Record<string,string>[]=[{},{cookie:'dartflow-local=anything','x-actor-id':actor},{authorization:'Basic secret'},{authorization:'Bearer a b'},{authorization:`Bearer ${'x'.repeat(8200)}`},{authorization:'Bearer a',origin},{authorization:'Bearer a','sec-fetch-site':'cross-site'}];
 for(const headers of invalidHeaders)assert.throws(()=>nativePlayerBearer(request('profile','GET',headers)));
 assert.equal(nativePlayerBearer(request('profile','GET',{authorization:'Bearer abc.def-ghi_123'})),'abc.def-ghi_123');
});
test('local native bearer is signed, expiring, fixture-bound and never accepted outside local loopback',()=>{
 localEnvironment();const req=request(),session=localNativePlayerSession(actor,req);assert.equal(verifyLocalNativePlayerSession(session.accessToken,req),actor);assert.ok(Date.parse(session.expiresAt)>Date.now());
 for(const token of [session.accessToken+'x',session.accessToken.replace('local-player','other'),session.accessToken+'.extra','local-player.not-json.signature'])assert.equal(verifyLocalNativePlayerSession(token,req),null);
 const clock=Date.now;try{Date.now=()=>Date.parse(session.expiresAt);assert.equal(verifyLocalNativePlayerSession(session.accessToken,req),null);}finally{Date.now=clock;}
 const external=new NextRequest('https://dartflow.nl/api/player/v1/session',{headers:{host:'dartflow.nl'}});assert.throws(()=>localNativePlayerSession(actor,external));assert.equal(verifyLocalNativePlayerSession(session.accessToken,external),null);
 assert.throws(()=>localNativePlayerSession(actor,request('session','GET',{'x-forwarded-for':'203.0.113.1'})));
 assert.throws(()=>localNativePlayerSession(randomUUID(),req));
 process.env.DARTFLOW_DATA_MODE='supabase';process.env.DARTFLOW_APP_ORIGIN='https://dartflow.nl';assert.equal(verifyLocalNativePlayerSession(session.accessToken,req),null);assert.throws(()=>localNativePlayerSession(actor,req));localEnvironment();
});
test('bearer principal is isolated across requests, asynchronous work and parallel users',async()=>{
 const one=request(),two=request();const first={request:one,id:actor,claims:null},second={request:two,id:'00000000-0000-4000-8000-000000000003',claims:null};
 assert.equal(nativePlayerPrincipal(one),null);
 await Promise.all([withNativePlayerPrincipal(first,async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(await actorId(one),actor);assert.equal(nativePlayerPrincipal(two),null);}),withNativePlayerPrincipal(second,async()=>{assert.equal(await actorId(two),second.id);assert.equal(nativePlayerPrincipal(one),null);})]);
 assert.equal(nativePlayerPrincipal(one),null);assert.equal(nativePlayerPrincipal(two),null);
});
test('capabilities expose only public auth and use independent fixed production/staging identities',()=>{
 const saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
 try{
  localEnvironment();assert.equal(nativePlayerCapabilities().local,true);assert.equal(nativePlayerCapabilities().auth.url,null);assert.equal(nativePlayerCapabilities().localUsers.length,4);assert.equal(nativePlayerCapabilities().auth.redirectScheme,'nl.dartflow.app.dev');
  process.env.DARTFLOW_DATA_MODE='supabase';process.env.DARTFLOW_APP_ORIGIN='https://dartflow.nl';process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_public-test-key';
  const prod=nativePlayerCapabilities();assert.equal(prod.auth.redirectScheme,'nl.dartflow.app');assert.equal(prod.auth.callbackUrl,'https://dartflow.nl/auth/callback?native_client=nl.dartflow.app');assert.equal(prod.localUsers.length,0);assert.equal(prod.auth.publishableKey,'sb_publishable_public-test-key');
  process.env.DARTFLOW_APP_ORIGIN='https://staging.dartflow.nl';assert.equal(nativePlayerCapabilities().auth.redirectScheme,'nl.dartflow.app.staging');
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_secret_do-not-expose';assert.throws(nativePlayerCapabilities);
  const token=(role:string)=>`e30.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=token('service_role');assert.throws(nativePlayerCapabilities);
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=token('anon');assert.equal(nativePlayerCapabilities().auth.publishableKey,token('anon'));
 }finally{if(saved.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;if(saved.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=saved.key;localEnvironment();}
});
test('Google callback relays only one-use code and state to the fixed environment app and leaves ordinary callback untouched',()=>{
 process.env.DARTFLOW_DATA_MODE='supabase';process.env.DARTFLOW_APP_ORIGIN='https://dartflow.nl';const state='s'.repeat(43),code=randomUUID();
 try{
  const call=(query:string)=>nativePlayerCallback(new NextRequest(`https://dartflow.nl/auth/callback?${query}`));
  assert.equal(call(`code=${code}`),null);
  const response=call(`native_client=nl.dartflow.app&state=${state}&code=${code}&next=https://evil.example&access_token=secret`);assert.ok(response);assert.equal(response.status,302);
  const target=new URL(response.headers.get('location')!);assert.equal(target.protocol,'nl.dartflow.app:');assert.equal(target.hostname,'auth');assert.equal(target.pathname,'/callback');assert.equal(target.searchParams.get('state'),state);assert.equal(target.searchParams.get('code'),code);assert.equal(target.searchParams.size,2);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.has('set-cookie'),false);
  for(const query of [`native_client=https://evil.example&state=${state}&code=${code}`,`native_client=nl.dartflow.app.staging&state=${state}&code=${code}`,`native_client=nl.dartflow.app&state=short&code=${code}`])assert.equal(call(query)?.status,400);
  const failed=call(`native_client=nl.dartflow.app&state=${state}&error=provider_secret`);assert.ok(failed);assert.equal(new URL(failed.headers.get('location')!).searchParams.get('error'),'oauth');assert.equal(failed.headers.get('location')!.includes('provider_secret'),false);
  process.env.DARTFLOW_APP_ORIGIN='https://staging.dartflow.nl';assert.equal(call(`native_client=nl.dartflow.app&state=${state}&code=${code}`)?.status,400);
 }finally{localEnvironment();}
});

const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('native real API uses verified bearer actor and existing authorization while ordinary web POST retains CSRF',{skip:!configured},async()=>{
 localEnvironment();const session=localNativePlayerSession(actor,request());const authorization=`Bearer ${session.accessToken}`;
 const call=async(path:string,method='GET',input?:unknown,headers:Record<string,string>={})=>{
  const req=request(path,method,headers,input),handler=method==='GET'?GET:POST;
  return handler(req,{params:Promise.resolve({path:['player','v1',...path.split('/')]})});
 };
 try{
  const cap=await call('capabilities');assert.equal(cap.status,200);assert.equal(cap.headers.get('cache-control'),'private, no-store');
  assert.equal((await call('session')).status,401);assert.equal((await call('profile','GET',undefined,{cookie:'dartflow-local=pretend'})).status,401);
  const profile=await call('profile','GET',undefined,{authorization,'x-actor-id':'00000000-0000-4000-8000-000000000001'});assert.equal(profile.status,200);assert.equal((await profile.json()).user.id,actor);assert.equal(profile.headers.has('set-cookie'),false);
  assert.equal((await call('profile','GET',undefined,{authorization,origin:'https://evil.example'})).status,403);
  assert.equal((await call('mail/process','POST',{}, {authorization})).status,404);
  const forbidden=await call(`matches/30000000-0000-4000-8000-000000000001/actions`,'POST',{requestId:randomUUID(),expectedRevision:0,action:{type:'call',boardId:'20000000-0000-4000-8000-000000000001'}},{authorization});assert.ok([403,404,409].includes(forbidden.status),await forbidden.text());
  const web=new NextRequest(`${origin}/api/platform/actions`,{method:'POST',headers:{host:'localhost:3000','Content-Type':'application/json',authorization},body:'{}'});const webResult=await POST(web,{params:Promise.resolve({path:['platform','actions']})});assert.equal(webResult.status,403);assert.equal((await webResult.json()).code,'origin');
  const local=await call('auth/local','POST',{userId:actor});assert.equal(local.status,200);assert.equal(verifyLocalNativePlayerSession((await local.json()).accessToken,request()),actor);
  const unknown=await call('profile','GET',undefined,{authorization:'Bearer invalid'});assert.equal(unknown.status,401);assert.equal(unknown.headers.get('www-authenticate'),'Bearer');
  const delegate=async(req:NextRequest,parts:string[],method:string)=>{assert.equal(await actorId(req),actor);assert.equal(method,'POST');assert.deepEqual(parts,['profile','complete']);return new Response('{}',{headers:{'Set-Cookie':'should-not-escape=1'}});};
  const adapted=await handleNativePlayerApi(request('profile/complete','POST',{authorization},{}),['player','v1','profile','complete'],delegate);assert.equal(adapted?.status,200);assert.equal(adapted?.headers.has('set-cookie'),false);
 }finally{
  await database().query("delete from dartflow_private.auth_limits where key like 'native-player:%'");await closeDatabase();
 }
});

test('Supabase native bearer checks current Auth user, cryptographic claims, identity match and anonymous status using a local auth adapter',{skip:!configured},async()=>{
 const priorFetch=globalThis.fetch,saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const userId=randomUUID(),otherId=randomUUID(),{publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),kid=randomUUID(),jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
 let authUser=userId,denied=false,anonymous=false,authCalls=0,jwksCalls=0;
 const jwt=(sub:string,expired=false,tampered=false)=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({sub,iss:'https://native-player-auth-test.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+(expired?-60:3600),amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)}],user_metadata:{role:'owner'}})).toString('base64url'),signature=sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url');return `${header}.${payload}.${tampered?signature.slice(0,-5)+'aaaaa':signature}`;};
 globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url==='https://native-player-auth-test.supabase.co/auth/v1/user'){authCalls++;assert.match(new Headers(init?.headers).get('authorization')??'',/^Bearer /);return denied?Response.json({message:'Invalid JWT',code:'bad_jwt'},{status:401}):Response.json({id:authUser,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),is_anonymous:anonymous,user_metadata:{name:'Native testspeler',role:'owner'}});}
  if(url==='https://native-player-auth-test.supabase.co/auth/v1/.well-known/jwks.json'){jwksCalls++;return Response.json({keys:[jwk]});}
  throw new Error('Native auth test forbids external network requests.');
 };
 process.env.DARTFLOW_DATA_MODE='supabase';process.env.DARTFLOW_APP_ORIGIN='https://dartflow.nl';process.env.NEXT_PUBLIC_SUPABASE_URL='https://native-player-auth-test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_native-local-test';
 const call=async(token:string)=>{
  const req=new NextRequest('https://dartflow.nl/api/player/v1/profile',{headers:{host:'dartflow.nl',authorization:`Bearer ${token}`}});
  const response=await handleNativePlayerApi(req,['player','v1','profile'],async()=>{const principal=nativePlayerPrincipal(req);assert.ok(principal);assert.equal(principal.id,userId);assert.equal(principal.claims?.sub,userId);return Response.json({id:await actorId(req)});});assert.ok(response);return response;
 };
 try{
  assert.equal((await call(jwt(userId))).status,200);assert.equal(authCalls,1);assert.equal(jwksCalls,1);
  const profile=await database().query('select id,name,display_name_confirmed,onboarding_complete from dartflow_private.profiles where id=$1',[userId]);assert.equal(profile.rows[0].name,'Native testspeler');assert.equal(profile.rows[0].display_name_confirmed,false);assert.equal(profile.rows[0].onboarding_complete,false);
  assert.equal((await database().query('select 1 from dartflow_private.platform_roles where user_id=$1',[userId])).rowCount,0);
  denied=true;assert.equal((await call(jwt(userId))).status,401);denied=false;
  anonymous=true;assert.equal((await call(jwt(userId))).status,401);anonymous=false;
  authUser=otherId;assert.equal((await call(jwt(userId))).status,401);authUser=userId;
  assert.equal((await call(jwt(userId,true))).status,401);assert.equal((await call(jwt(userId,false,true))).status,401);
 }finally{
  globalThis.fetch=priorFetch;if(saved.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;if(saved.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=saved.key;localEnvironment();
  await admin.query('delete from dartflow_private.profiles where id=$1',[userId]);await admin.query("delete from dartflow_private.auth_limits where key like 'native-player:%'");await admin.end();await closeDatabase();
 }
});
