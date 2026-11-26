import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {closeDatabase,database} from '../lib/db';
import {authenticateBlogToken,blogHash,blogRuntime,getBlogExternalContractStatus,publishBlog,requireBlogCredential,saveBlogDraft,writeBlogDraft,type BlogCredential} from '../lib/blog-store';
import {storeBlogMedia} from '../lib/blog-media';
import type {BlogScope} from '../lib/blog-types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies its own connection. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('paired blog adapter isolates destinations and preserves durable results across relinking',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const actor=randomUUID(),prefix=`sh-adapter-${randomUUID()}`,destinations=[randomUUID(),randomUUID()],tokenIds:string[]=[],postIds:string[]=[],mediaIds:string[]=[];
 const runtime=blogRuntime(),key=()=>`${prefix}:${randomUUID()}`;
 const token=async(destinationId:string,scopes:BlogScope[]=['read','media:write','drafts:write'],state:'pending'|'active'='active')=>{
  const id=randomUUID(),secret=randomBytes(32).toString('base64url');tokenIds.push(id);
  await owner.query("insert into dartflow_private.blog_tokens(id,site_id,environment,name,token_hash,prefix,scopes,expires_at,created_by,destination_id,connection_id,credential_state,provisioning_expires_at) values($1,$2,$3,'Adapter fixture',$4,'[redacted]',$5,clock_timestamp()+interval '1 day',$6,$7,$8,$9,clock_timestamp()+interval '10 minutes')",[id,runtime.siteId,runtime.environment,blogHash(secret),JSON.stringify(scopes),actor,destinationId,randomUUID(),state]);
  return {id,secret,credential:await authenticateBlogToken(secret)};
 };
 try{
  await owner.query('insert into dartflow_private.profiles(id,name,display_name) values($1,$2,$2)',[actor,prefix]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[actor]);
  const a=await token(destinations[0]),b=await token(destinations[1]);
  const image=await sharp({create:{width:80,height:120,channels:3,background:'#146900'}}).png().toBuffer(),uploadKey=key();
  const mediaA=await storeBlogMedia({credential:a.credential},image,'image/png',uploadKey),mediaB=await storeBlogMedia({credential:b.credential},image,'image/png',uploadKey);mediaIds.push(mediaA.assetId,mediaB.assetId);
  const article=(label:string,assetId=mediaA.assetId)=>({type:'blog',locale:'nl-NL',title:label,slug:`${prefix}-${label.toLowerCase()}`,excerpt:'Een herkenbaar testconcept.',content:{format:'markdown',body:'## Testconcept\n\nEen veilig artikel.'},seo:{title:label,description:'Een herkenbare beschrijving.'},hero:{assetId,alt:'Groen testbeeld'}});
  const externalId=randomUUID(),draftKey=key(),originalData=article('Eerste');
  const first=await writeBlogDraft({credential:a.credential},{externalId,data:originalData,requestId:draftKey});postIds.push(first.id);
  await t.test('shared external IDs and idempotency keys stay within their destination',async()=>{
   assert.notEqual(mediaA.assetId,mediaB.assetId);
   const other=await writeBlogDraft({credential:b.credential},{externalId,data:article('Andere',mediaB.assetId),requestId:draftKey});postIds.push(other.id);
   assert.notEqual(first.id,other.id);
   assert.equal((await getBlogExternalContractStatus(b.credential,externalId)).postId,other.id);
   await assert.rejects(writeBlogDraft({credential:a.credential},{id:other.id,expectedRevision:1,data:originalData,requestId:key()}),{code:'POST_NOT_FOUND'});
   await assert.rejects(writeBlogDraft({credential:b.credential},{externalId:randomUUID(),data:article('Vreemd'),requestId:key()}),{code:'INVALID_MEDIA'});
   assert.equal(first.contractStatus?.draftRevision,1);
   assert.equal(first.contractStatus?.previewUrl,`${runtime.origin}/blog/beheer/voorbeeld/${first.id}?revisie=1`);
   assert.equal(first.contractStatus?.publicUrl,null);
  });
  await t.test('pending credentials authenticate only for provisioning and expire',async()=>{
   const pending=await token(destinations[0],['read','drafts:write'],'pending');
   assert.equal(pending.credential.state,'pending');
   await assert.rejects(requireBlogCredential(database(),pending.credential,'read'),{code:'PAIRING_IN_PROGRESS',status:409,retryAfter:5});
   await assert.rejects(writeBlogDraft({credential:pending.credential},{externalId:randomUUID(),data:originalData,requestId:key()}),{code:'PAIRING_IN_PROGRESS'});
   await owner.query("update dartflow_private.blog_tokens set provisioning_expires_at=clock_timestamp()-interval '1 second' where id=$1",[pending.id]);
   await assert.rejects(authenticateBlogToken(pending.secret),{code:'UNAUTHENTICATED'});
  });
  let published:Awaited<ReturnType<typeof publishBlog>>;const publishKey=key();
  await t.test('current local permission and draft right gate every paired publication',async()=>{
   await assert.rejects(publishBlog({credential:a.credential},first.id,1,publishKey),{code:'PERMISSION_DENIED'});
   await owner.query('update dartflow_private.blog_tokens set scopes=$2 where id=$1',[a.id,JSON.stringify(['read','publish'])]);
   await assert.rejects(publishBlog({credential:a.credential},first.id,1,publishKey),{code:'PERMISSION_DENIED'});
   await owner.query('update dartflow_private.blog_tokens set scopes=$2 where id=$1',[a.id,JSON.stringify(['read','media:write','drafts:write','publish'])]);
   await assert.rejects(publishBlog({credential:a.credential},postIds[1],1,key()),{code:'POST_NOT_FOUND'});
   published=await publishBlog({credential:a.credential},first.id,1,publishKey);
   assert.equal(published.contractStatus?.state,'published');
   assert.equal(published.contractStatus?.draftRevision,null);
   assert.equal(published.contractStatus?.previewUrl,null);
   assert.equal(published.contractStatus?.publicUrl,`${runtime.origin}/blog/${originalData.slug}`);
  });
  await t.test('local editor changes retain destination, conflict protection and the live canonical URL',async()=>{
   const edited=await writeBlogDraft({credential:a.credential},{externalId,expectedRevision:1,data:article('Nieuw'),requestId:key()});
   const local=await saveBlogDraft(actor,{id:first.id,expectedRevision:edited.revision,data:article('Redactie'),requestId:key()});
   assert.equal((await owner.query('select destination_id from dartflow_private.blog_posts where id=$1',[first.id])).rows[0].destination_id,destinations[0]);
   await assert.rejects(writeBlogDraft({credential:a.credential},{externalId,expectedRevision:edited.revision,data:article('Verouderd'),requestId:key()}),{code:'REVISION_CONFLICT',currentRevision:local.revision});
   const status=await getBlogExternalContractStatus(a.credential,externalId);
   assert.equal(status.slug,article('Redactie').slug);assert.equal(status.draftRevision,3);assert.equal(status.publishedRevision,1);
   assert.equal(status.publicUrl,published.contractStatus?.publicUrl);
  });
  await t.test('relinking preserves exact original upload, draft and publication receipts',async()=>{
   const next=await token(destinations[0],['publish','drafts:write','media:write','read']);
   await owner.query('update dartflow_private.blog_tokens set revoked_at=clock_timestamp() where id=$1',[a.id]);
   assert.deepEqual(await writeBlogDraft({credential:next.credential},{externalId,data:originalData,requestId:draftKey}),first);
   assert.deepEqual(await publishBlog({credential:next.credential},first.id,1,publishKey),published);
   assert.deepEqual(await storeBlogMedia({credential:next.credential},image,'image/png',uploadKey),mediaA);
   await assert.rejects(writeBlogDraft({credential:next.credential},{externalId,data:article('Andere-inhoud'),requestId:draftKey}),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(authenticateBlogToken(a.secret),{code:'UNAUTHENTICATED'});
   await assert.rejects(writeBlogDraft({credential:a.credential},{externalId,data:originalData,requestId:draftKey}),{code:'PERMISSION_DENIED'});
   const forged:BlogCredential={...next.credential,destinationId:destinations[1]};
   await assert.rejects(requireBlogCredential(database(),forged,'read'),{code:'PERMISSION_DENIED'});
  });
 }finally{
  await owner.query('delete from dartflow_private.blog_audit where actor_id=$1 or post_id=any($2::uuid[])',[actor,postIds]);
  await owner.query('delete from dartflow_private.blog_posts where id=any($1::uuid[])',[postIds]);
  await owner.query('delete from dartflow_private.blog_media where id=any($1::uuid[])',[mediaIds]);
  await owner.query('delete from dartflow_private.blog_tokens where id=any($1::uuid[])',[tokenIds]);
  await owner.query('delete from dartflow_private.blog_receipts where destination_id=any($1::text[]) or key like $2',[destinations,`${prefix}:%`]);
  await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[actor]);
  await owner.query('delete from dartflow_private.profiles where id=$1',[actor]);
  await owner.end();await closeDatabase();
 }
});
