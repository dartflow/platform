import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {NextRequest} from 'next/server';
import {database,closeDatabase} from '../lib/db';
import {blogRuntime,normalizeBlogSlug,validateBlogData,saveBlogDraft,getBlogDraft,getLiveArticle,listLiveArticles,publishBlogRevision,scheduleBlogRevision,processScheduledBlogPublications,processBlogInvalidations,archiveBlogArticle,createBlogToken,authenticateBlogToken,revokeBlogToken,writeBlogDraft,publishBlog,getBlogExternalStatus,listBlogTokens,restoreBlogRevision} from '../lib/blog-store';
import {storeBlogMedia,readBlogMedia,validateBlogImage} from '../lib/blog-media';
import {handleBlogApi} from '../lib/blog-api';

try{process.loadEnvFile('.env.local');}catch{/* CI provides loopback credentials. */}
const local=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('blog validation normalizes slugs and rejects unsafe content and unrecognized fields',()=>{
 assert.equal(normalizeBlogSlug('  DártFlow: Zo speel je! '),'dartflow-zo-speel-je');
 assert.throws(()=>normalizeBlogSlug('///'),{code:'VALIDATION_ERROR'});
 assert.throws(()=>normalizeBlogSlug('a'.repeat(101)),{code:'VALIDATION_ERROR'});
 assert.throws(()=>validateBlogData({title:'Test',content:{type:'doc',content:[{type:'script'}]}}),{code:'VALIDATION_ERROR'});
 assert.throws(()=>validateBlogData({title:'Test',rawHtml:'<script>alert(1)</script>'}),{code:'VALIDATION_ERROR'});
 assert.throws(()=>validateBlogData({title:'Test',hero:{focalPoint:{x:-1,y:.5}}}),{field:'hero.focalPoint'});
});
test('blog revisions, routes, scheduler, private media and SocialHero credentials are transactional',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const actor=randomUUID(),outsider=randomUUID(),prefix=`blog-${randomUUID()}`,postIds:string[]=[],tokenIds:string[]=[];let mediaId='';
 const key=()=>`${prefix}:${randomUUID()}`;
 try{
  await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2),($3,$4)',[actor,'Blog fixture beheer',outsider,'Blog fixture speler']);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[actor]);
  const png=await sharp({create:{width:1200,height:1800,channels:3,background:'#76a800'}}).png().toBuffer();
  const uploadKey=key(),asset=await storeBlogMedia({actor},png,'image/png',uploadKey);mediaId=asset.assetId;
  const article=(title:string,slug=`${prefix}-${title.toLowerCase().replace(/\W+/g,'-')}`)=>({type:'blog',title,slug,locale:'nl-NL',excerpt:'Praktische aanwijzingen voor een clubtoernooi.',content:{format:'markdown',body:'## Een veilige wedstrijd\n\nEen **duidelijke** uitleg met [DartFlow](https://dartflow.nl).\n\n| Speler | Punten |\n|---|---|\n| Danny | 180 |'},seo:{title,description:'Lees de praktische aanwijzingen voor een geslaagd clubtoernooi.'},authorId:'redactie',categoryId:'toernooien',tags:['darts'],hero:{assetId:asset.assetId,alt:'Een groen testbeeld.',focalPoint:{x:.7,y:.3},ratio:'2:3'}});
  await t.test('real raster decoding, exact retries and protected unpublished media',async()=>{
   assert.deepEqual(await storeBlogMedia({actor},png,'image/png',uploadKey),asset);
   await assert.rejects(storeBlogMedia({actor},png,'image/jpeg',uploadKey),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(validateBlogImage(Buffer.from('<svg onload="alert(1)"></svg>'),'image/png'),{code:'INVALID_MEDIA'});
   await assert.rejects(validateBlogImage(png,'image/jpeg'),{code:'INVALID_MEDIA'});
   await assert.rejects(storeBlogMedia({actor:outsider},png,'image/png',key()),{code:'PERMISSION_DENIED'});
   await assert.rejects(readBlogMedia(mediaId),{status:404});
   await assert.rejects(readBlogMedia(mediaId,{actor:outsider}),{status:403});
   const privateMedia=await readBlogMedia(mediaId,{actor});assert.equal(privateMedia.public,false);assert.equal((await sharp(privateMedia.bytes).metadata()).width,1200);
  });
  const initialKey=key(),initial=await saveBlogDraft(actor,{data:article('Eerste'),requestId:initialKey});postIds.push(initial.id);
  await t.test('draft saves are durable and live revisions stay independent',async()=>{
   const retry=await saveBlogDraft(actor,{data:article('Eerste'),requestId:initialKey});assert.equal(retry.revision,1);assert.equal(retry.id,initial.id);
   await assert.rejects(saveBlogDraft(actor,{data:article('Anders'),requestId:initialKey}),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(getBlogDraft(outsider,initial.id),{code:'PERMISSION_DENIED'});
   assert.equal((await getLiveArticle(initial.article.slug)).article,null);
   const published=await publishBlogRevision(actor,initial.id,1,key());assert.equal(published.publishedRevision,1);
   const publishedModified=(await getLiveArticle(initial.article.slug)).article!.updatedAt;
   const draft=await saveBlogDraft(actor,{id:initial.id,expectedRevision:1,data:article('Gewijzigde titel',initial.article.slug),requestId:key()});assert.equal(draft.revision,2);
   assert.equal((await getLiveArticle(initial.article.slug)).article?.title,'Eerste');assert.equal((await getBlogDraft(actor,initial.id)).title,'Gewijzigde titel');
   assert.equal((await getLiveArticle(initial.article.slug)).article!.updatedAt,publishedModified);
   assert.ok((await listLiveArticles({search:'Eerste',category:'toernooien'})).some(p=>p.id===initial.id));
   assert.equal((await listLiveArticles({search:'Eerste',category:'training'})).some(p=>p.id===initial.id),false);
   await assert.rejects(saveBlogDraft(actor,{id:initial.id,expectedRevision:1,data:article('Verouderd'),requestId:key()}),{code:'REVISION_CONFLICT',currentRevision:2});
   await assert.rejects(publishBlogRevision(actor,initial.id,1,key()),{code:'REVISION_CONFLICT'});
   await publishBlogRevision(actor,initial.id,2,key());assert.equal((await getLiveArticle(initial.article.slug)).article?.slug,initial.article.slug);
   const titleOnly=article('Alleen een nieuwe titel');Reflect.deleteProperty(titleOnly,'slug');
   const unchangedRoute=await saveBlogDraft(actor,{id:initial.id,expectedRevision:2,data:titleOnly,requestId:key()});assert.equal(unchangedRoute.article.slug,initial.article.slug);
   await publishBlogRevision(actor,initial.id,unchangedRoute.revision,key());assert.equal((await getLiveArticle(initial.article.slug)).article?.title,'Alleen een nieuwe titel');
  });
  await t.test('slug aliases stay reserved and redirects go directly to the current live URL',async()=>{
   let current=await getBlogDraft(actor,initial.id);const secondSlug=`${prefix}-tweede-url`,thirdSlug=`${prefix}-derde-url`;
   const second=await saveBlogDraft(actor,{id:initial.id,expectedRevision:current.revision,data:article('Tweede',secondSlug),requestId:key()});await publishBlogRevision(actor,initial.id,second.revision,key());
   const third=await saveBlogDraft(actor,{id:initial.id,expectedRevision:second.revision,data:article('Derde',thirdSlug),requestId:key()});await publishBlogRevision(actor,initial.id,third.revision,key());
   assert.equal((await getLiveArticle(initial.article.slug)).redirect,`/blog/${thirdSlug}`);assert.equal((await getLiveArticle(secondSlug)).redirect,`/blog/${thirdSlug}`);
   await assert.rejects(saveBlogDraft(actor,{data:article('Slug stelen',initial.article.slug),requestId:key()}),{code:'SLUG_CONFLICT'});
   current=await getBlogDraft(actor,initial.id);assert.equal(current.hero.width,1200);assert.equal(current.ogImage.width,1200);
   const publicMedia=await readBlogMedia(mediaId);assert.equal(publicMedia.public,true);const og=await readBlogMedia(mediaId,{og:true,x:.7,y:.3});const m=await sharp(og.bytes).metadata();assert.equal(m.width,1200);assert.equal(m.height,630);
   await assert.rejects(database().query('update dartflow_private.blog_revisions set data=data where post_id=$1',[initial.id]),{code:'42501'});
  });
  await t.test('concurrent editors produce exactly one new revision, and restore appends a revision',async()=>{
   const current=await getBlogDraft(actor,initial.id),attempts=await Promise.allSettled(['Links','Rechts'].map(title=>saveBlogDraft(actor,{id:initial.id,expectedRevision:current.revision,data:article(title,current.slug),requestId:key()})));
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal((attempts.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'REVISION_CONFLICT');
   const latest=await getBlogDraft(actor,initial.id),restored=await restoreBlogRevision(actor,initial.id,1,latest.revision,key());assert.equal(restored.article.title,'Eerste');assert.equal(restored.revision,latest.revision+1);
  });
  await t.test('cache invalidation retries after failure and covers home, archive, sitemap and old aliases',async()=>{
   await assert.rejects(processBlogInvalidations(()=>{throw new Error('temporary cache failure');}),/temporary cache failure/);
   const pending=(await owner.query('select count(*)::int as n from dartflow_private.blog_invalidation where post_id=$1 and processed_at is null',[initial.id])).rows[0].n;assert.ok(pending>0);
   const paths:string[]=[];await processBlogInvalidations(path=>{paths.push(path);});
   for(const path of ['/','/blog','/sitemap.xml',`/blog/${initial.article.slug}`,`/blog/${prefix}-tweede-url`])assert.ok(paths.includes(path),path);
   assert.equal((await owner.query('select count(*)::int as n from dartflow_private.blog_invalidation where post_id=$1 and processed_at is null',[initial.id])).rows[0].n,0);
  });
  await t.test('inline image references become public, while a UUID mentioned in prose stays private',async()=>{
   const inline=await storeBlogMedia({actor},png,'image/png',key()),privateAsset=await storeBlogMedia({actor},png,'image/png',key());
   const saved=await saveBlogDraft(actor,{data:{...article('Inline'),content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:`Een uitleg met de referentie ${privateAsset.assetId}.`}]},{type:'image',attrs:{src:`/api/blog/media/${inline.assetId}`,alt:'Het testbeeld',width:inline.width,height:inline.height}}]}},requestId:key()});postIds.push(saved.id);
   await publishBlogRevision(actor,saved.id,saved.revision,key());assert.equal((await readBlogMedia(inline.assetId)).public,true);await assert.rejects(readBlogMedia(privateAsset.assetId),{status:404});
  });
  await t.test('a durable server scheduler publishes without a visitor, then archive removes live data',async()=>{
   const scheduled=await saveBlogDraft(actor,{data:article('Gepland'),requestId:key()});postIds.push(scheduled.id);
   await scheduleBlogRevision(actor,scheduled.id,scheduled.revision,new Date(Date.now()+60000).toISOString(),key());
   assert.equal((await getLiveArticle(scheduled.article.slug)).article,null);await owner.query("update dartflow_private.blog_posts set scheduled_at=clock_timestamp()-interval '1 second' where id=$1",[scheduled.id]);
   const results=await Promise.all([processScheduledBlogPublications(),processScheduledBlogPublications()]);assert.equal(results.flat().filter(r=>r.id===scheduled.id).length,1);assert.equal((await getLiveArticle(scheduled.article.slug)).article?.title,'Gepland');
   await archiveBlogArticle(actor,scheduled.id,key());assert.equal((await getLiveArticle(scheduled.article.slug)).article,null);
   assert.equal((await listLiveArticles()).some(p=>p.id===scheduled.id),false);
  });
  await t.test('site-scoped credentials, explicit revision publish and durable API operation replay',async()=>{
   const token=await createBlogToken(actor,{name:'Blog fixture'});tokenIds.push(token.id);const credential=await authenticateBlogToken(token.token);
   assert.equal((await listBlogTokens(actor)).some(row=>'token'in row||'token_hash'in row),false);
   const externalId=`sh_${randomUUID()}`,draftKey=key(),data=article('SocialHero');
   const first=await writeBlogDraft({credential},{externalId,data,requestId:draftKey});postIds.push(first.id);
   const publishKey=key(),published=await publishBlog({credential},first.id,first.revision,publishKey);assert.equal(published.status,'published');
   await writeBlogDraft({credential},{externalId,expectedRevision:first.revision,data:{...data,title:'Nieuwe SocialHero titel'},requestId:key()});
   assert.deepEqual(await writeBlogDraft({credential},{externalId,data,requestId:draftKey}),first);assert.deepEqual(await publishBlog({credential},first.id,first.revision,publishKey),published);
   const status=await getBlogExternalStatus(credential,externalId);assert.equal(status.revision,2);assert.equal(status.publishedRevision,1);assert.equal(status.publicUrl,published.publicUrl);
   const rotate=await createBlogToken(actor,{rotateId:token.id});tokenIds.push(rotate.id);await assert.rejects(authenticateBlogToken(token.token),{code:'UNAUTHENTICATED'});await assert.rejects(writeBlogDraft({credential},{externalId,data,requestId:draftKey}),{code:'PERMISSION_DENIED'});
   const next=await authenticateBlogToken(rotate.token);assert.deepEqual(await writeBlogDraft({credential:next},{externalId,data,requestId:draftKey}),first);
   const restricted=await createBlogToken(actor,{scopes:['read']});tokenIds.push(restricted.id);const readOnly=await authenticateBlogToken(restricted.token);await assert.rejects(writeBlogDraft({credential:readOnly},{externalId:`sh_${randomUUID()}`,data,requestId:key()}),{code:'PERMISSION_DENIED'});
   await revokeBlogToken(actor,rotate.id);await assert.rejects(authenticateBlogToken(rotate.token),{code:'UNAUTHENTICATED'});
  });
  await t.test('actual v1 HTTP handler validates auth, payload, If-Match and idempotency',async()=>{
   const token=await createBlogToken(actor,{});tokenIds.push(token.id);const r=blogRuntime(),base=`${r.origin}/api/socialhero/v1`;
   const call=async(path:string,method='GET',input?:unknown,keyValue?:string,revision?:number,credential=token.token)=>{const headers:Record<string,string>={'Authorization':`Bearer ${credential}`};if(input!==undefined)headers['Content-Type']='application/json';if(keyValue)headers['Idempotency-Key']=keyValue;if(revision)headers['If-Match']=`"${revision}"`;return handleBlogApi(new NextRequest(`${base}/${path}`,{method,headers,...(input===undefined?{}:{body:JSON.stringify(input)})}),['socialhero','v1',...path.split('/')]);};
   assert.equal((await call('capabilities','GET',undefined,undefined,undefined,'wrong'))?.status,401);
   const caps=await call('capabilities');assert.equal(caps?.status,200);assert.equal((await caps!.json()).environment,'development');
   const externalId=`sh_${randomUUID()}`,data=article('API'),writeKey=key(),first=await call(`posts/${externalId}`,'PUT',data,writeKey);assert.equal(first?.status,201);const result=await first!.json();postIds.push(result.id);
   assert.equal((await call(`posts/${externalId}`,'PUT',data,key()))?.status,412);
   assert.equal((await call(`posts/${externalId}/publish`,'POST',{revision:99},key()))?.status,412);
   assert.equal((await call(`posts/${externalId}/publish`,'POST',{revision:1},key()))?.status,200);
   assert.equal((await call(`posts/${externalId}`,'PUT',{...data,title:'Changed'},writeKey))?.status,409);
   const other=await call(`posts/${externalId}`,'PUT',{...data,title:'Changed'},key(),1);assert.equal(other?.status,200);
   const invalid=await call(`posts/sh_${randomUUID()}`,'PUT',{...data,content:{type:'doc',content:[{type:'script'}]}},key());assert.equal(invalid?.status,422);
   assert.equal((await call(`posts/${externalId}/publish`,'POST',{revision:2,extra:'discarded'},key()))?.status,422);
   const mediaForm=new FormData();mediaForm.set('file',new File([new Uint8Array(png)],'fixture.png',{type:'image/png'}));
   const upload=await handleBlogApi(new NextRequest(`${base}/media`,{method:'POST',headers:{Authorization:`Bearer ${token.token}`,'Idempotency-Key':key()},body:mediaForm}),['socialhero','v1','media']);assert.equal(upload?.status,201);assert.equal((await upload!.json()).type,'image/png');
  });
  await t.test('concurrent operation claims replay one result and rate limiting persists across requests',async()=>{
   const token=await createBlogToken(actor,{});tokenIds.push(token.id);const credential=await authenticateBlogToken(token.token),requestId=key(),externalId=`sh_${randomUUID()}`;
   const [left,right]=await Promise.all([writeBlogDraft({credential},{externalId,data:article('Gelijktijdig'),requestId}),writeBlogDraft({credential},{externalId,data:article('Gelijktijdig'),requestId})]);assert.deepEqual(left,right);postIds.push(left.id);
   const url=`${blogRuntime().origin}/api/socialhero/v1/posts/sh_missing`,response=async()=>handleBlogApi(new NextRequest(url,{method:'PUT',headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json','Idempotency-Key':key()},body:JSON.stringify({invalid:true})}),['socialhero','v1','posts','sh_missing']);
   for(let n=0;n<40;n++)assert.equal((await response())?.status,422);
   const blocked=await response();assert.equal(blocked?.status,429);assert.ok(Number(blocked?.headers.get('retry-after'))>0);assert.equal((await response())?.status,429);
  });
  await t.test('all blog persistence is private with RLS and no anonymous grants',async()=>{
   const rows=(await owner.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dartflow_private' and c.relname like 'blog_%' and c.relkind='r'")).rows;assert.ok(rows.length>=8);assert.equal(rows.every(r=>r.relrowsecurity),true);
   const grants=(await owner.query("select grantee from information_schema.role_table_grants where table_schema='dartflow_private' and table_name like 'blog_%' and grantee in ('PUBLIC','anon','authenticated','service_role')")).rows;assert.equal(grants.length,0);
  });
 }finally{
  await owner.query('delete from dartflow_private.blog_audit where actor_id=any($1::uuid[]) or post_id=any($2::uuid[])',[[actor,outsider],postIds]);
  await owner.query('delete from dartflow_private.blog_posts where id=any($1::uuid[])',[postIds]);
  await owner.query('delete from dartflow_private.blog_media where created_by=$1',[actor]);
  await owner.query('delete from dartflow_private.blog_tokens where id=any($1::uuid[])',[tokenIds]);
  await owner.query('delete from dartflow_private.blog_receipts where key like $1',[`${prefix}:%`]);
  await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[actor]);
  await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[[actor,outsider]]);
  await owner.end();await closeDatabase();
 }
});
