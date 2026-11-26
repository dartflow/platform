import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {NextRequest} from 'next/server';
import {closeDatabase} from '../lib/db';
import {getBlogDraft,getLiveArticle,saveBlogDraft} from '../lib/blog-store';
import {checkSocialHero,disconnectSocialHero,expireSocialHeroProvisioning,pairSocialHero,setSocialHeroPublish,socialHeroStatus} from '../lib/socialhero-connection';
import {handleSocialHeroApi} from '../lib/socialhero-api';
import {decryptSocialHeroSecret,encryptSocialHeroSecret,socialHeroOrigin,socialHeroRequest,validatePairingClaim,validateSocialHeroPost} from '../lib/socialhero-core';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
const post=(title='Connector fixture')=>({baseRevision:null as number|null,type:'blog',locale:'nl-NL',title,excerpt:'Een lokaal herkenbaar connectorconcept.',seo:{title,description:'Lokaal testartikel voor de SocialHero-koppeling.'},content:{format:'markdown',body:'## Een lokaal testconcept\n\nVeilige **Markdown** met [DartFlow](https://dartflow.nl).'}});

test('connector validates the shared contract and never forwards provider secrets in errors',async()=>{
 assert.equal(socialHeroOrigin('https://socialhero.example.com'),'https://socialhero.example.com');
 for(const origin of ['http://socialhero.example.com','https://socialhero.example.com/claim','https://user:secret@socialhero.example.com','https://127.0.0.1','https://socialhero.local'])assert.throws(()=>socialHeroOrigin(origin),{code:'CONFIGURATION_REQUIRED'});
 assert.equal(validateSocialHeroPost(post()).baseRevision,null);
 for(const invalid of [{...post(),baseRevision:undefined},{...post(),baseRevision:0},{...post(),content:{format:'html',body:'<script>x</script>'}},{...post(),hero:{assetId:randomUUID(),alt:''}},{...post(),hero:{assetId:randomUUID(),alt:'Test',focalPoint:{x:2,y:.5}}}])assert.throws(()=>validateSocialHeroPost(invalid));
 assert.throws(()=>validatePairingClaim({connectionId:'one',destinationId:'destination',accessToken:randomBytes(32).toString('base64url'),expiresAt:new Date(Date.now()-1000).toISOString()}),{code:'PAIRING_EXPIRED'});
 const rawSecret='provider-secret-must-stay-server-side';
 const mockFetch:typeof fetch=async()=>Response.json({code:'INVALID_PAIRING_CODE',message:rawSecret},{status:400});
 await assert.rejects(socialHeroRequest('https://socialhero.example.com','/api/integrations/blog/v1/pairings/claim',{code:rawSecret},undefined,{fetch:mockFetch}),error=>{assert.equal((error as {code:string}).code,'INVALID_PAIRING_CODE');assert.equal(String(error).includes(rawSecret),false);return true;});
});

test('temporary credentials are authenticated encryption bound to the provisioning attempt',()=>{
 const original=process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY;
 process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 try{
  const secret=randomBytes(32).toString('base64url'),binding=randomUUID(),envelope=encryptSocialHeroSecret(secret,binding);
  assert.equal(JSON.stringify(envelope).includes(secret),false);
  assert.equal(decryptSocialHeroSecret(envelope,binding),secret);
  assert.throws(()=>decryptSocialHeroSecret(envelope,randomUUID()),{code:'CONFIGURATION_REQUIRED'});
  assert.throws(()=>decryptSocialHeroSecret({...envelope,tag:randomBytes(16).toString('base64')},binding),{code:'CONFIGURATION_REQUIRED'});
 }finally{if(original===undefined)delete process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY;else process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY=original;}
});

test('SocialHero pairing, recovery, scoped content and local publication policy use the real database',{skip:!configured},async t=>{
 const keys=['DARTFLOW_ENV','DARTFLOW_APP_ORIGIN','DARTFLOW_SOCIALHERO_ORIGIN','DARTFLOW_SOCIALHERO_SITE_ID','DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY'] as const;
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const siteId=`connector-${randomUUID()}`,actor=randomUUID(),outsider=randomUUID(),origin='https://localhost:3000',provider='https://socialhero.example.com';
 Object.assign(process.env,{DARTFLOW_ENV:'staging',DARTFLOW_APP_ORIGIN:origin,DARTFLOW_SOCIALHERO_ORIGIN:provider,DARTFLOW_SOCIALHERO_SITE_ID:siteId,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 let destinationId='project-destination-a',latestToken='',verifyFailures=0,claimFailures=0,pendingVerified=0,expiredClaim=false;
 const sessions=new Map<string,{token:string;connectionId:string;destinationId:string;expiresAt:string}>();
 const api=async(path:string,{method='GET',data,key,token=latestToken,body}:{method?:string;data?:unknown;key?:string;token?:string;body?:BodyInit}={})=>{
  const headers=new Headers({Authorization:`Bearer ${token}`});if(data!==undefined)headers.set('Content-Type','application/json');if(key)headers.set('Idempotency-Key',key);
  const response=await handleSocialHeroApi(new NextRequest(origin+`/api/socialhero/v1/${path}`,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:body?{body}:{})}),['socialhero','v1',...path.split('/')]);
  assert.ok(response);return response;
 };
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,provider);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  const data=JSON.parse(String(init?.body));
  if(url.pathname.endsWith('/claim')){
   assert.equal(data.siteId,siteId);assert.equal(data.environment,'staging');assert.equal(data.origin,origin);assert.equal(data.contractVersion,1);assert.match(data.attemptId,/^[0-9a-f-]{36}$/);
   if(['invalid','expired','mismatch'].includes(data.code))return Response.json({code:{invalid:'INVALID_PAIRING_CODE',expired:'PAIRING_EXPIRED',mismatch:'DESTINATION_MISMATCH'}[data.code as 'invalid'],message:'sensitive upstream detail'},{status:{invalid:400,expired:410,mismatch:409}[data.code as 'invalid']});
   let session=sessions.get(data.attemptId);
   if(!session){session={token:`sh_fixture_${randomBytes(32).toString('base64url')}`,connectionId:`connection-${randomUUID()}`,destinationId,expiresAt:new Date(Date.now()+(expiredClaim?-1000:600000)).toISOString()};sessions.set(data.attemptId,session);}
   latestToken=session.token;if(claimFailures-->0)throw Error('interrupted claim after provider reserved code');
   return Response.json({...session,accessToken:session.token,token:undefined});
  }
  assert.match(url.pathname,/^\/api\/integrations\/blog\/v1\/pairings\/[A-Za-z0-9_.:-]+\/verify$/);
  const bearer=new Headers(init?.headers).get('authorization')?.slice(7),session=[...sessions.values()].find(value=>value.token===bearer);assert.ok(session);
  const saved=(await owner.query('select c.status,c.temporary_secret,t.token_hash,t.credential_state from dartflow_private.socialhero_connections c join dartflow_private.blog_tokens t on t.id=c.token_id where c.connection_id=$1',[session.connectionId])).rows[0];
  assert.equal(saved.status,'pending');assert.equal(saved.credential_state,'pending');assert.equal(saved.token_hash,createHash('sha256').update(session.token).digest('hex'));assert.equal(JSON.stringify(saved).includes(session.token),false);
  const capabilities=await api('capabilities',{token:session.token});assert.equal(capabilities.status,200);assert.equal(capabilities.headers.get('cache-control')?.includes('no-store'),true);
  const payload=await capabilities.json();assert.equal(payload.credentialState,'pending');assert.equal(payload.connectionId,session.connectionId);assert.equal(payload.destinationId,session.destinationId);assert.equal(payload.environment,'staging');
  const blocked=await api('posts/provisioning-check',{token:session.token});assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'PAIRING_IN_PROGRESS');assert.ok(blocked.headers.get('retry-after'));pendingVerified++;
  if(verifyFailures-->0)throw Error('interrupted verification with sensitive bearer');
  return Response.json({connectionId:session.connectionId,status:'verified'});
 };
 const pair=(code:string)=>pairSocialHero(actor,code,{fetch:transport});
 const key=()=>`connector:${randomUUID()}`;
 try{
  for(const [id,name] of [[actor,'Connector admin'],[outsider,'Connector outsider']])await owner.query('insert into dartflow_private.profiles(id,name,display_name) values($1,$2,$2)',[id,name.replaceAll(' ','')]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[actor]);
  await t.test('admin authority and controlled claim errors',async()=>{
   await assert.rejects(socialHeroStatus(outsider),{code:'PERMISSION_DENIED'});
   await assert.rejects(setSocialHeroPublish(actor,true),{code:'PERMISSION_DENIED'});
   for(const [code,error] of [['invalid','INVALID_PAIRING_CODE'],['expired','PAIRING_EXPIRED'],['mismatch','DESTINATION_MISMATCH']])await assert.rejects(pair(code),{code:error});
   assert.equal((await socialHeroStatus(actor)).status,'rejected');
  });
  await t.test('claim commits a restricted provisional credential before verify and activates only afterward',async()=>{
   const result=await pair('success-code');assert.equal(result.status,'active');assert.equal(result.publish,false);assert.deepEqual(result.scopes,['read','draft']);assert.ok(pendingVerified>0);
   assert.equal(JSON.stringify(result).includes(latestToken),false);
   const stored=(await owner.query('select temporary_secret from dartflow_private.socialhero_connections where connection_id=$1',[result.connectionId])).rows[0];assert.equal(stored.temporary_secret,null);
   const response=await api('capabilities'),capabilities=await response.json();assert.equal(capabilities.credentialState,'active');assert.deepEqual(capabilities.scopes,['read','draft']);assert.ok(capabilities.authors.length);assert.ok(capabilities.categories.length);
  });
  await t.test('a lost claim response reuses the same attempt ID and one-time reservation',async()=>{
   claimFailures=1;await assert.rejects(pair('claim-retry-code'),{code:'PROVIDER_UNAVAILABLE'});
   const reserved=sessions.size,token=latestToken;const result=await pair('claim-retry-code');assert.equal(result.status,'active');assert.equal(sessions.size,reserved);assert.equal(latestToken,token);
  });
  const externalId=`article-${randomUUID()}`,initialKey=key(),initialData=post(),png=await sharp({create:{width:1200,height:1800,channels:3,background:'#76a800'}}).png().toBuffer();
  let first:{postId:string;revision:number;slug:string},assetId='';
  await t.test('contract writes use the editor, exact retries, revision conflicts and draft privacy',async()=>{
   const form=new FormData();form.set('file',new File([png],'fixture.png',{type:'image/png'}));
   const uploaded=await api('media',{method:'POST',key:key(),body:form});assert.equal(uploaded.status,201);const asset=await uploaded.json();assetId=asset.assetId;assert.equal(asset.width,1200);assert.equal(asset.height,1800);
   const create=await api(`posts/${externalId}`,{method:'PUT',data:initialData,key:initialKey});assert.equal(create.status,201);first=await create.json();assert.equal(first.revision,1);assert.equal(first.postId,(await getBlogDraft(actor,first.postId)).id);assert.equal((await getLiveArticle(first.slug)).article,null);
   const replay=await api(`posts/${externalId}`,{method:'PUT',data:initialData,key:initialKey});assert.deepEqual(await replay.json(),first);
   const changed=await api(`posts/${externalId}`,{method:'PUT',data:post('Different'),key:initialKey});assert.equal(changed.status,409);assert.equal((await changed.json()).code,'IDEMPOTENCY_CONFLICT');
   const updated=await api(`posts/${externalId}`,{method:'PUT',data:{...post('Updated'),baseRevision:1},key:key()});assert.equal(updated.status,200);assert.equal((await updated.json()).revision,2);
   const stale=await api(`posts/${externalId}`,{method:'PUT',data:{...post('Stale'),baseRevision:1},key:key()});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'REVISION_CONFLICT');
   const draft=await getBlogDraft(actor,first.postId);await saveBlogDraft(actor,{id:first.postId,expectedRevision:draft.revision,data:{type:'blog',locale:'nl-NL',title:'Local editor',content:{format:'markdown',body:'Een wijziging van de lokale redacteur.'},hero:{assetId,alt:'Een groen testbeeld.'}},requestId:key()});
   const localConflict=await api(`posts/${externalId}`,{method:'PUT',data:{...post('Stale after local edit'),baseRevision:2},key:key()});assert.equal(localConflict.status,409);assert.equal((await localConflict.json()).code,'REVISION_CONFLICT');
   const denied=await api(`posts/${externalId}/publish`,{method:'POST',data:{revision:2},key:key()});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'PERMISSION_DENIED');
  });
  await t.test('interrupted verify resumes, revokes the prior credential and preserves destination receipts',async()=>{
   const previousToken=latestToken;verifyFailures=1;
   await assert.rejects(pair('recovery-code'),{code:'PROVIDER_UNAVAILABLE'});assert.equal((await socialHeroStatus(actor)).status,'pending');
   const recovered=await checkSocialHero(actor,{fetch:transport});assert.equal(recovered.status,'active');assert.equal(recovered.destinationId,destinationId);
   const rejected=await api('capabilities',{token:previousToken});assert.equal(rejected.status,401);assert.equal((await rejected.json()).code,'INVALID_CREDENTIAL');
   assert.equal((await api('connection',{method:'DELETE',token:previousToken})).status,401);assert.equal((await socialHeroStatus(actor)).status,'active');
   const replay=await api(`posts/${externalId}`,{method:'PUT',data:initialData,key:initialKey});assert.deepEqual(await replay.json(),first);
  });
  await t.test('another destination cannot read or overwrite the original article or use its media',async()=>{
   destinationId='project-destination-b';await pair('another-destination');
   const missing=await api(`posts/${externalId}`);assert.equal(missing.status,404);assert.equal((await missing.json()).code,'POST_NOT_FOUND');
   const overwrite=await api(`posts/${externalId}`,{method:'PUT',data:{...post('Stolen'),baseRevision:2},key:key()});assert.equal(overwrite.status,409);
   const stealMedia=await api('posts/other-asset',{method:'PUT',data:{...post('Stolen image'),hero:{assetId,alt:'Test'}},key:key()});assert.equal(stealMedia.status,422);assert.equal((await stealMedia.json()).code,'INVALID_MEDIA');
   assert.equal((await getBlogDraft(actor,first.postId)).title,'Local editor');
  });
  await t.test('publication requires local consent and an exact revision; a later draft preserves live content',async()=>{
   destinationId='project-destination-a';await pair('restore-destination');await setSocialHeroPublish(actor,true);
   const current=await api(`posts/${externalId}`),status=await current.json();
   const updated=await api(`posts/${externalId}`,{method:'PUT',key:key(),data:{...post('Ready for local publication'),baseRevision:status.revision,hero:{assetId,alt:'Een groen testbeeld.'}}});const ready=await updated.json();assert.equal(updated.status,200);
   const stale=await api(`posts/${externalId}/publish`,{method:'POST',key:key(),data:{revision:ready.revision-1}});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'REVISION_CONFLICT');
   const publishKey=key(),published=await api(`posts/${externalId}/publish`,{method:'POST',key:publishKey,data:{revision:ready.revision}});assert.equal(published.status,200);const live=await published.json();assert.equal(live.state,'published');assert.equal(live.publicUrl,`${origin}/blog/${live.slug}`);assert.equal((await getLiveArticle(live.slug)).article?.title,'Ready for local publication');
   const retry=await api(`posts/${externalId}/publish`,{method:'POST',key:publishKey,data:{revision:ready.revision}});assert.deepEqual(await retry.json(),live);
   const newer=await api(`posts/${externalId}`,{method:'PUT',key:key(),data:{...post('Unpublished new wording'),baseRevision:ready.revision,hero:{assetId,alt:'Een groen testbeeld.'}}});assert.equal(newer.status,200);assert.equal((await getLiveArticle(live.slug)).article?.title,'Ready for local publication');
   await setSocialHeroPublish(actor,false);const blocked=await api(`posts/${externalId}/publish`,{method:'POST',key:key(),data:{revision:ready.revision+1}});assert.equal(blocked.status,403);
  });
  await t.test('manual disconnect is immediate and idempotent; expired provisioning cannot recover',async()=>{
   assert.equal((await api('connection',{method:'DELETE'})).status,204);assert.equal((await api('connection',{method:'DELETE'})).status,401);await pair('after-machine-disconnect');
   const token=latestToken;await disconnectSocialHero(actor);await disconnectSocialHero(actor);assert.equal((await socialHeroStatus(actor)).status,'disconnected');assert.equal((await api('capabilities',{token})).status,401);
   verifyFailures=1;await assert.rejects(pair('expires-after-interruption'),{code:'PROVIDER_UNAVAILABLE'});
   await owner.query("update dartflow_private.socialhero_connections set expires_at=clock_timestamp()-interval '1 second' where site_id=$1 and status='pending'",[siteId]);
   await expireSocialHeroProvisioning();
   const expired=(await owner.query("select c.status,c.temporary_secret,t.revoked_at from dartflow_private.socialhero_connections c join dartflow_private.blog_tokens t on t.id=c.token_id where c.site_id=$1 and c.connection_id=$2",[siteId,[...sessions.values()].find(value=>value.token===latestToken)!.connectionId])).rows[0];
   assert.equal(expired.status,'expired');assert.equal(expired.temporary_secret,null);assert.ok(expired.revoked_at);
   assert.equal((await checkSocialHero(actor,{fetch:transport})).status,'expired');assert.equal((await socialHeroStatus(actor)).status,'expired');
   assert.equal((await owner.query('select count(*)::int n from dartflow_private.socialhero_connections where site_id=$1 and temporary_secret is not null',[siteId])).rows[0].n,0);
   expiredClaim=true;await assert.rejects(pair('expired-response'),{code:'PAIRING_EXPIRED'});
  });
 }finally{
  for(const table of ['socialhero_settings','socialhero_connections','blog_audit','blog_posts','blog_media','blog_tokens','blog_receipts'])await owner.query(`delete from dartflow_private.${table} where site_id=$1 and environment='staging'`,[siteId]);
  await owner.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[[actor,outsider]]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[[actor,outsider]]);
  await owner.end();await closeDatabase();for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
 }
});
