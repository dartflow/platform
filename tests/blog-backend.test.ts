import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {NextRequest} from 'next/server';
import {database,closeDatabase} from '../lib/db';
import {blogRuntime,normalizeBlogSlug,validateBlogData,saveBlogDraft,getBlogDraft,getLiveArticle,listLiveArticles,publishBlogRevision,scheduleBlogRevision,unscheduleBlogRevision,processScheduledBlogPublications,processBlogInvalidations,archiveBlogArticle,createBlogToken,authenticateBlogToken,revokeBlogToken,writeBlogDraft,publishBlog,getBlogExternalStatus,listBlogTokens,restoreBlogRevision} from '../lib/blog-store';
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
  await t.test('an editor waiting on another committed revision receives a conflict instead of a missing article',async()=>{
   const current=await getBlogDraft(actor,initial.id),requestId=key();
   const blockerPid=Number((await owner.query('select pg_backend_pid() as pid')).rows[0].pid);
   let pending:Promise<{error?:unknown}>|undefined;
   await owner.query('begin');
   try{
    await owner.query('select id from dartflow_private.blog_posts where id=$1 for update',[initial.id]);
    pending=saveBlogDraft(actor,{id:initial.id,expectedRevision:current.revision,data:article('Wachtende editor',current.slug),requestId}).then(()=>({}),error=>({error}));
    let waiting=false;
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
     // pg_locks is live; pg_stat_activity can retain its first snapshot for this transaction.
     waiting=(await owner.query('select exists(select 1 from pg_locks where not granted and $1::int=any(pg_blocking_pids(pid))) as waiting',[blockerPid])).rows[0].waiting;
     if(waiting)break;
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'the second editor reached the locked article before the first editor commits');
    await owner.query('insert into dartflow_private.blog_revisions(post_id,revision,data,created_by) select post_id,$2,data,$3 from dartflow_private.blog_revisions where post_id=$1 and revision=$4',[initial.id,current.revision+1,actor,current.revision]);
    await owner.query('update dartflow_private.blog_posts set draft_revision=$2 where id=$1',[initial.id,current.revision+1]);
    await owner.query('commit');
    const outcome=await pending;
    assert.equal((outcome.error as {code?:string}|undefined)?.code,'REVISION_CONFLICT');
    assert.equal((outcome.error as {currentRevision?:number}).currentRevision,current.revision+1);
    assert.equal((await getBlogDraft(actor,initial.id)).revision,current.revision+1);
    assert.equal(Number((await owner.query('select count(*) from dartflow_private.blog_revisions where post_id=$1 and revision>$2',[initial.id,current.revision])).rows[0].count),1);
    assert.equal((await owner.query('select 1 from dartflow_private.blog_receipts where key=$1',[requestId])).rowCount,0);
   }finally{
    await owner.query('rollback');
    await pending;
   }
  });
  await t.test('a replayed save returns the acted immutable revision instead of an unseen latest draft',async()=>{
   const latest=await getBlogDraft(actor,initial.id);assert.ok(latest.revision>1);
   const replay=await saveBlogDraft(actor,{data:article('Eerste'),requestId:initialKey});assert.equal(replay.revision,1);assert.equal(replay.article.revision,1);assert.equal(replay.article.title,'Eerste');assert.equal(replay.article.draftRevision,latest.revision);
   await assert.rejects(publishBlogRevision(actor,initial.id,replay.article.revision,key()),{code:'REVISION_CONFLICT'});
   assert.equal((await getBlogDraft(actor,initial.id)).revision,latest.revision);
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
  await t.test('unchanged live revisions cannot be scheduled and legacy due entries cannot starve the worker',async()=>{
   const live=await saveBlogDraft(actor,{data:article('Oude planning'),requestId:key()});postIds.push(live.id);const published=await publishBlogRevision(actor,live.id,live.revision,key());
   await assert.rejects(scheduleBlogRevision(actor,live.id,live.revision,new Date(Date.now()+60000).toISOString(),key()),{code:'VALIDATION_ERROR',status:422});
   await owner.query("update dartflow_private.blog_posts set scheduled_at=clock_timestamp()-interval '1 day',scheduled_revision=live_revision where id=$1",[live.id]);
   const ready=await saveBlogDraft(actor,{data:article('Volgende planning'),requestId:key()});postIds.push(ready.id);await scheduleBlogRevision(actor,ready.id,ready.revision,new Date(Date.now()+60000).toISOString(),key());await owner.query("update dartflow_private.blog_posts set scheduled_at=clock_timestamp()-interval '1 second' where id=$1",[ready.id]);
   assert.deepEqual(await processScheduledBlogPublications(1),[]);assert.equal((await getBlogDraft(actor,live.id)).scheduledAt,null);
   assert.equal((await getBlogDraft(actor,live.id)).publishedAt,published.publishedAt);
   assert.equal((await processScheduledBlogPublications(1))[0]?.id,ready.id);assert.equal((await getLiveArticle(ready.article.slug)).article?.title,'Volgende planning');
   await owner.query("update dartflow_private.blog_posts set scheduled_at=clock_timestamp()+interval '1 day',scheduled_revision=live_revision where id=$1",[live.id]);const again=await publishBlogRevision(actor,live.id,live.revision,key());assert.equal(again.scheduledAt,null);assert.equal(again.publishedAt,published.publishedAt);
  });
  await t.test('a late cancellation preserves archived state and cannot restore a public article',async()=>{
   const archived=await saveBlogDraft(actor,{data:article('Gearchiveerde planning'),requestId:key()});postIds.push(archived.id);await publishBlogRevision(actor,archived.id,archived.revision,key());
   const changed=await saveBlogDraft(actor,{id:archived.id,expectedRevision:archived.revision,data:article('Gewijzigde planning',archived.article.slug),requestId:key()});await scheduleBlogRevision(actor,archived.id,changed.revision,new Date(Date.now()+60000).toISOString(),key());
   await archiveBlogArticle(actor,archived.id,key());const cancelled=await unscheduleBlogRevision(actor,archived.id,key());assert.equal(cancelled.status,'archived');assert.equal((await getBlogDraft(actor,archived.id)).status,'archived');assert.equal((await getLiveArticle(archived.article.slug)).article,null);
   await owner.query("update dartflow_private.blog_posts set scheduled_at=clock_timestamp()-interval '1 day',scheduled_revision=draft_revision where id=$1",[archived.id]);await processScheduledBlogPublications();assert.equal((await getBlogDraft(actor,archived.id)).status,'archived');assert.equal((await getBlogDraft(actor,archived.id)).scheduledAt,null);assert.equal((await getLiveArticle(archived.article.slug)).article,null);
  });
  await t.test('a scheduling retry after its due time returns the original receipt',async()=>{
   const pending=await saveBlogDraft(actor,{data:article('Planningherhaling'),requestId:key()});postIds.push(pending.id);const at=new Date(Date.now()+1800).toISOString(),requestId=key(),result=await scheduleBlogRevision(actor,pending.id,pending.revision,at,requestId);
   await new Promise(done=>setTimeout(done,Math.max(0,Date.parse(at)-Date.now()+30)));
   assert.deepEqual(await scheduleBlogRevision(actor,pending.id,pending.revision,at,requestId),result);
   await assert.rejects(scheduleBlogRevision(actor,pending.id,pending.revision,at,key()),{code:'VALIDATION_ERROR',field:'scheduledAt'});
   assert.equal((await processScheduledBlogPublications()).filter(post=>post.id===pending.id).length,1);assert.equal((await getLiveArticle(pending.article.slug)).article?.title,'Planningherhaling');
   assert.deepEqual(await scheduleBlogRevision(actor,pending.id,pending.revision,at,requestId),result);
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
  await t.test('a publish-only credential publishes its explicitly selected site revision without read scope',async()=>{
   const writer=await createBlogToken(actor,{}),publisher=await createBlogToken(actor,{scopes:['publish']});tokenIds.push(writer.id,publisher.id);const writerCredential=await authenticateBlogToken(writer.token),externalId=`sh_${randomUUID()}`;
   const post=await writeBlogDraft({credential:writerCredential},{externalId,data:article('Publicatierecht'),requestId:key()});postIds.push(post.id);
   const base=`${blogRuntime().origin}/api/socialhero/v1/posts/${externalId}`,headers={Authorization:`Bearer ${publisher.token}`,'Content-Type':'application/json','Idempotency-Key':key()};
   const denied=await handleBlogApi(new NextRequest(base,{headers:{Authorization:`Bearer ${publisher.token}`}}),['socialhero','v1','posts',externalId]);assert.equal(denied?.status,403);
   const publish=()=>handleBlogApi(new NextRequest(base+'/publish',{method:'POST',headers,body:JSON.stringify({revision:post.revision})}),['socialhero','v1','posts',externalId,'publish']);
   const response=await publish();assert.equal(response?.status,200);const result=await response!.json();assert.equal(result.publishedRevision,post.revision);assert.equal(result.status,'published');assert.deepEqual(await(await publish())!.json(),result);
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
