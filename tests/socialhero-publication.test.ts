import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {NextRequest} from 'next/server';
import {closeDatabase} from '../lib/db';
import {authenticateBlogToken,getLiveArticle,type BlogCredential} from '../lib/blog-store';
import {storeBlogMedia} from '../lib/blog-media';
import {blogPublicationMarker} from '../lib/blog-publication-marker';
import {pairSocialHero,setSocialHeroPolicy} from '../lib/socialhero-connection';
import {handleSocialHeroApi} from '../lib/socialhero-api';
import {confirmSocialHeroPublication,processSocialHeroPublicationChecks,socialHeroPublicationPending} from '../lib/socialhero-publication';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies isolated loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
const html=(marker:string)=>new Response(`<!doctype html><html><head><meta name="dartflow:publication" content="${marker}"></head><body>Public article</body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});

test('SocialHero reports publication only after the exact live revision is publicly confirmed',{skip:!configured},async t=>{
  const envKeys=['DARTFLOW_ENV','DARTFLOW_APP_ORIGIN','DARTFLOW_SOCIALHERO_ORIGIN','DARTFLOW_SOCIALHERO_SITE_ID','DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY'] as const;
  const previous=Object.fromEntries(envKeys.map(name=>[name,process.env[name]]));
  const site=`publication-${randomUUID()}`,actor=randomUUID(),origin='https://localhost:3000',provider='https://socialhero.example.com',destination=randomUUID();
  Object.assign(process.env,{DARTFLOW_ENV:'staging',DARTFLOW_APP_ORIGIN:origin,DARTFLOW_SOCIALHERO_ORIGIN:provider,DARTFLOW_SOCIALHERO_SITE_ID:site,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
  const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
  const secret=randomBytes(32).toString('base64url'),connectionId=randomUUID(),key=()=>`publication:${randomUUID()}`;
  let credential:BlogCredential,assetId='';
  type Post={postId:string;externalId:string;slug:string;revision:number};
  const probe:typeof fetch=async()=>html('not-the-current-publication-marker');
  const api=async(path:string,{method='GET',data,requestKey,fetch=probe}:{method?:string;data?:unknown;requestKey?:string;fetch?:typeof globalThis.fetch}={})=>{
    const headers=new Headers({Authorization:`Bearer ${secret}`});
    if(data!==undefined)headers.set('Content-Type','application/json');if(requestKey)headers.set('Idempotency-Key',requestKey);
    const response=await handleSocialHeroApi(new NextRequest(`${origin}/api/socialhero/v1/${path}`,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})}),['socialhero','v1',...path.split('/')],{fetch});
    assert.ok(response);assert.match(response.headers.get('cache-control')??'',/no-store/);return response;
  };
  const article=(label:string,externalId:string,baseRevision:number|null=null)=>({baseRevision,type:'blog',locale:'nl-NL',title:`Publicatiecontrole ${label}`,slug:`publication-${externalId}`,excerpt:'Een lokaal testartikel voor publieke bereikbaarheid.',content:{format:'markdown',body:'## Publicatiecontrole\n\nDe exacte gepubliceerde revisie moet openbaar zichtbaar zijn.'},seo:{title:`Publicatiecontrole ${label}`,description:'Een herkenbare lokale test voor publicatiebevestiging.'},hero:{assetId,alt:'Een groen lokaal testbeeld.'}});
  const create=async(label:string):Promise<Post>=>{
    const externalId=randomUUID(),response=await api(`posts/${externalId}`,{method:'PUT',data:article(label,externalId),requestKey:key()});
    assert.equal(response.status,201);return {...await response.json(),externalId};
  };
  const publish=(post:Post,fetch:typeof globalThis.fetch=probe,requestKey=key())=>api(`posts/${post.externalId}/publish`,{method:'POST',data:{revision:post.revision},requestKey,fetch});
  const check=async(post:Post,revision=post.revision)=>(await owner.query('select * from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2',[post.postId,revision])).rows[0];
  const live=async(post:Post)=>(await owner.query('select live_revision,status,published_at,updated_at from dartflow_private.blog_posts where id=$1',[post.postId])).rows[0];
  const exactProbe=(post:Post,revision=post.revision):typeof fetch=>async(url,init)=>{
    assert.equal(String(url),`${origin}/blog/${post.slug}`);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(new Headers(init?.headers).has('authorization'),false);
    return html(blogPublicationMarker(origin,post.postId,revision));
  };
  try{
    await owner.query('insert into dartflow_private.profiles(id,name,display_name)values($1,$2,$2)',[actor,site]);
    await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[actor]);
    const pairingTransport:typeof fetch=async(url,init)=>{
      assert.equal(new URL(String(url)).origin,provider);
      if(String(url).endsWith('/claim'))return Response.json({connectionId,destinationId:destination,accessToken:secret,expiresAt:new Date(Date.now()+600_000).toISOString()});
      assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${secret}`);return Response.json({connectionId,status:'verified'});
    };
    await pairSocialHero(actor,'publication-fixture',{fetch:pairingTransport,draft:true,publish:true});credential=await authenticateBlogToken(secret);
    const image=await sharp({create:{width:80,height:120,channels:3,background:'#147000'}}).png().toBuffer();
    assetId=(await storeBlogMedia({credential},image,'image/png',key())).assetId;

    const first=await create('Eerste'),firstKey=key();
    await t.test('HTTP 200 with another revision marker stays publishing and GET hides the unconfirmed URL',async()=>{
      const response=await publish(first,exactProbe(first,first.revision+1),firstKey);assert.equal(response.status,202);assert.equal(response.headers.get('retry-after'),'10');
      const pending=await response.json();assert.equal(pending.state,'publishing');assert.equal(pending.publicUrl,null);assert.equal(pending.publishedRevision,first.revision);
      const stored=await check(first);assert.equal(stored.state,'pending');assert.equal(stored.attempts,1);assert.equal(stored.confirmed_at,null);assert.equal(stored.expected_marker,blogPublicationMarker(origin,first.postId,first.revision));
      assert.equal((await live(first)).live_revision,first.revision);assert.equal((await getLiveArticle(first.slug)).article?.revision,first.revision);
      const status=await api(`posts/${first.externalId}`);assert.equal(status.status,200);assert.deepEqual(await status.json(),pending);
      assert.equal(await socialHeroPublicationPending(credential,first.postId,first.revision),true);
    });
    await t.test('network failure remains durably pending and retries the same publication without duplicating it',async()=>{
      const networkFailure:typeof fetch=async()=>{throw Error('fixture-network-error-with-private-details');};
      const response=await publish(first,networkFailure,firstKey);assert.equal(response.status,202);const pending=await response.json();assert.equal(pending.state,'publishing');assert.equal(pending.publicUrl,null);assert.equal(JSON.stringify(pending).includes('private-details'),false);
      const stored=await check(first);assert.equal(stored.state,'pending');assert.equal(stored.attempts,2);assert.equal(stored.last_error_code,'PUBLICATION_NOT_VISIBLE');assert.equal(stored.confirmed_at,null);
      assert.equal((await owner.query('select count(*)::int n from dartflow_private.blog_publication_checks where post_id=$1',[first.postId])).rows[0].n,1);
      assert.equal((await owner.query("select count(*)::int n from dartflow_private.blog_audit where post_id=$1 and operation='revision.published'",[first.postId])).rows[0].n,1);
    });
    await t.test('only the exact public marker confirms publication and releases the canonical URL',async()=>{
      const response=await publish(first,exactProbe(first),firstKey);assert.equal(response.status,200);const result=await response.json();assert.equal(result.state,'published');assert.equal(result.publicUrl,`${origin}/blog/${first.slug}`);
      const stored=await check(first);assert.equal(stored.state,'confirmed');assert.equal(stored.attempts,3);assert.ok(stored.confirmed_at);assert.equal(stored.last_error_code,null);
      assert.equal(await socialHeroPublicationPending(credential,first.postId,first.revision),false);assert.deepEqual(await(await api(`posts/${first.externalId}`)).json(),result);
      let unnecessaryProbes=0;const noNetwork:typeof fetch=async()=>{unnecessaryProbes++;throw Error('a confirmed receipt must not probe again');};assert.equal((await publish(first,noNetwork,firstKey)).status,200);assert.equal(unnecessaryProbes,0);assert.equal((await check(first)).attempts,3);
    });
    await t.test('a pre-check idempotency receipt recovers its visibility check without publishing twice',async()=>{
      await owner.query('delete from dartflow_private.blog_publication_checks where post_id=$1',[first.postId]);
      const before=await live(first),waiting=await publish(first,probe,firstKey);assert.equal(waiting.status,202);assert.equal((await waiting.json()).publicUrl,null);
      assert.equal((await check(first)).state,'pending');assert.deepEqual(await live(first),before);
      const confirmed=await publish(first,exactProbe(first),firstKey);assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).state,'published');
      assert.equal((await owner.query("select count(*)::int n from dartflow_private.blog_audit where post_id=$1 and operation='revision.published'",[first.postId])).rows[0].n,1);
    });
    await t.test('the durable worker only confirms existing activation after opt-out and never publishes a denied draft',async()=>{
      const waiting=await create('Wachtrij');assert.equal((await publish(waiting)).status,202);const before=await live(waiting);
      await setSocialHeroPolicy(actor,{draft:true,publish:false});
      const draft=await create('Publicatie geweigerd');let deniedProbes=0;
      const deniedProbe:typeof fetch=async()=>{deniedProbes++;return html(blogPublicationMarker(origin,draft.postId,1));};
      const denied=await publish(draft,deniedProbe);assert.equal(denied.status,403);assert.equal((await denied.json()).code,'PERMISSION_DENIED');assert.equal(deniedProbes,0);assert.equal(await check(draft),undefined);assert.equal((await live(draft)).live_revision,null);
      await owner.query("update dartflow_private.blog_publication_checks set next_attempt_at=clock_timestamp()-interval '1 second' where post_id=$1",[waiting.postId]);
      assert.equal(await processSocialHeroPublicationChecks({fetch:exactProbe(waiting)}),1);assert.equal((await check(waiting)).state,'confirmed');assert.deepEqual(await live(waiting),before);assert.equal((await live(draft)).live_revision,null);
      const status=await(await api(`posts/${waiting.externalId}`)).json();assert.equal(status.state,'published');assert.equal(status.publicUrl,`${origin}/blog/${waiting.slug}`);
      const stillDenied=await publish(draft,deniedProbe);assert.equal(stillDenied.status,403);assert.equal(deniedProbes,0);
      await setSocialHeroPolicy(actor,{draft:true,publish:true});
    });
    await t.test('a newer revision supersedes an unconfirmed marker and cannot be confirmed by the old page',async()=>{
      const previous=await create('Oude revisie'),previousKey=key();assert.equal((await publish(previous,probe,previousKey)).status,202);
      const updated=await api(`posts/${previous.externalId}`,{method:'PUT',data:article('Nieuwe revisie',previous.externalId,1),requestKey:key()});assert.equal(updated.status,200);const next:Post={...await updated.json(),externalId:previous.externalId};assert.equal(next.revision,2);
      const result=await publish(next,exactProbe(previous));assert.equal(result.status,202);assert.equal((await result.json()).publicUrl,null);assert.equal((await check(next)).state,'pending');
      let oldProbes=0;const staleProbe:typeof fetch=async()=>{oldProbes++;return html(blogPublicationMarker(origin,previous.postId,1));};
      await assert.rejects(confirmSocialHeroPublication(credential,previous.postId,1,{fetch:staleProbe}),{code:'REVISION_CONFLICT'});assert.equal(oldProbes,0);assert.equal((await check(previous)).state,'superseded');assert.equal((await check(previous)).confirmed_at,null);
      await assert.rejects(confirmSocialHeroPublication(credential,previous.postId,1,{fetch:staleProbe}),{code:'REVISION_CONFLICT'});
      const staleReceipt=await publish(previous,staleProbe,previousKey);assert.equal(staleReceipt.status,409);assert.equal((await staleReceipt.json()).code,'REVISION_CONFLICT');assert.equal(oldProbes,0);
      await owner.query('delete from dartflow_private.blog_publication_checks where post_id=$1 and revision=1',[previous.postId]);
      const legacyStaleReceipt=await publish(previous,staleProbe,previousKey);assert.equal(legacyStaleReceipt.status,409);assert.equal((await legacyStaleReceipt.json()).code,'REVISION_CONFLICT');assert.equal((await check(previous)).state,'superseded');assert.equal(oldProbes,0);
      assert.equal(await confirmSocialHeroPublication(credential,next.postId,2,{fetch:exactProbe(next)}),true);assert.equal((await check(next)).state,'confirmed');assert.equal((await check(previous)).state,'superseded');
      const status=await(await api(`posts/${next.externalId}`)).json();assert.equal(status.state,'published');assert.equal(status.publishedRevision,2);
    });
    await t.test('a revision replaced during an in-flight public probe is never falsely confirmed',async()=>{
      const previous=await create('Gelijktijdige vervanging');let next:Post|undefined;
      const replacement:typeof fetch=async()=>{
        const updated=await api(`posts/${previous.externalId}`,{method:'PUT',data:article('Vervanging tijdens controle',previous.externalId,1),requestKey:key()});assert.equal(updated.status,200);next={...await updated.json(),externalId:previous.externalId};
        assert.equal((await publish(next!)).status,202);
        return html(blogPublicationMarker(origin,previous.postId,1));
      };
      const response=await publish(previous,replacement);assert.equal(response.status,409);assert.equal((await response.json()).code,'REVISION_CONFLICT');assert.ok(next);assert.equal((await live(previous)).live_revision,2);assert.equal((await check(previous)).state,'superseded');assert.equal((await check(previous)).confirmed_at,null);
      await owner.query("update dartflow_private.blog_publication_checks set next_attempt_at=case when revision=1 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '1 hour' end where post_id=$1",[previous.postId]);
      let staleProbes=0;const staleProbe:typeof fetch=async()=>{staleProbes++;return html(blogPublicationMarker(origin,previous.postId,1));};
      assert.equal(await processSocialHeroPublicationChecks({fetch:staleProbe}),0);assert.equal(staleProbes,0);assert.equal((await check(previous)).state,'superseded');
      assert.equal(await confirmSocialHeroPublication(credential,next.postId,2,{fetch:exactProbe(next)}),true);assert.equal((await check(next)).state,'confirmed');assert.equal((await check(previous)).confirmed_at,null);
    });
  }finally{
    for(const table of ['blog_audit','blog_posts','blog_media','blog_receipts','blog_taxonomy','socialhero_permission_events','socialhero_destination_policies','socialhero_settings','socialhero_connections','blog_tokens'])await owner.query(`delete from dartflow_private.${table} where site_id=$1 and environment='staging'`,[site]);
    await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[actor]);await owner.query('delete from dartflow_private.profiles where id=$1',[actor]);
    await owner.end();await closeDatabase();
    for(const name of envKeys){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  }
});
