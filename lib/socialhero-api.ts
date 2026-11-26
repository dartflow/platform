import {randomUUID} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {actorId} from './auth';
import {appConfig} from './config';
import {consumeRateLimit,database} from './db';
import {BlogError} from './blog-types';
import {authenticateBlogToken,blogRuntime,getBlogExternalContractStatus,publishBlog,requireBlogAdmin,requireBlogCredential,resolveBlogExternalPostId,writeBlogDraft,type BlogCredential} from './blog-store';
import {BLOG_MEDIA_LIMITS} from './blog-media';
import {readBlogRequest,uploadBlogMedia} from './blog-api';
import {checkSocialHero,disconnectSocialHero,pairSocialHero,revokeSocialHeroCredential,setSocialHeroPolicy,socialHeroStatus} from './socialhero-connection';
import {SocialHeroError,validateSocialHeroPost,type SocialHeroTransport} from './socialhero-core';
import {confirmSocialHeroPublication,socialHeroPublicationPending} from './socialhero-publication';
import {listBlogTaxonomy} from './blog-taxonomy';

const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow',...headers}});
async function input(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new SocialHeroError('VALIDATION_ERROR','Gebruik JSON voor deze aanvraag.',415);
 try{const value:unknown=JSON.parse((await readBlogRequest(request)).toString('utf8'));if(value&&typeof value==='object'&&!Array.isArray(value))return value as Record<string,unknown>;}catch(error){if(error instanceof BlogError)throw error;}
 throw new SocialHeroError('VALIDATION_ERROR','De aanvraag bevat geen geldig JSON-object.');
}
function key(request:Request){const value=request.headers.get('idempotency-key')||'';if(!/^[A-Za-z0-9_:/.-]{1,240}$/.test(value))throw new SocialHeroError('VALIDATION_ERROR','Een geldige Idempotency-Key is verplicht.');return value;}
async function limited(identity:string,max:number,seconds=60){const rate=await consumeRateLimit(`socialhero:${identity}`,max,seconds);if(!rate.allowed)throw new SocialHeroError('RATE_LIMITED','Er zijn te veel verzoeken. Probeer later opnieuw.',429,rate.retryAfter);}
export async function socialHeroCapabilities(credential:BlogCredential){
 const taxonomy=await listBlogTaxonomy();
 const r=blogRuntime(),scopes=['read',...(credential.scopes.includes('drafts:write')?['draft']:[]),...(credential.scopes.includes('drafts:write')&&credential.scopes.includes('publish')?['publish']:[])];
 return {contractVersion:1,connectionId:credential.connectionId,destinationId:credential.destinationId,credentialState:credential.state??'active',siteId:r.siteId,siteName:'DartFlow',origin:r.origin,environment:r.environment,blogPath:'/blog',contentTypes:['blog','article'],locales:['nl-NL','en-GB','en-US'],scopes,authors:taxonomy.authors.map(({id,name})=>({id,name})),categories:taxonomy.categories.map(({id,name})=>({id,name})),media:{mimeTypes:BLOG_MEDIA_LIMITS.formats,maxBytes:BLOG_MEDIA_LIMITS.maxBytes,maxPixels:BLOG_MEDIA_LIMITS.maxPixels,maxDimension:BLOG_MEDIA_LIMITS.maxDimension},optionalFields:['slug','excerpt','authorId','categoryId','tags','seo','hero','ogImageAssetId'],publicationRequirements:['title','excerpt','content','seo.title','seo.description','hero.assetId','hero.alt']};
}
/** Contract v1 wraps the editorial service. Manually issued tokens fall through
 * to their existing compatibility API until explicitly revoked. */
export async function handleSocialHeroApi(request:NextRequest,segments:string[],options:SocialHeroTransport={}):Promise<Response|null>{
 const machine=segments[0]==='socialhero'&&segments[1]==='v1',admin=segments.length===2&&segments[0]==='blog'&&segments[1]==='socialhero';
 if(!machine&&!admin)return null;
 const requestId=randomUUID();
 const respond=(value:unknown,status=200,headers:Record<string,string>={})=>{
  console.info(JSON.stringify({event:'socialhero.request',requestId,method:request.method,status}));
  return json(value,status,{'X-Request-ID':requestId,...headers});
 };
 try{
  if(admin){
   const actor=await actorId(request);if(!actor)throw new SocialHeroError('UNAUTHENTICATED','Log in om SocialHero te beheren.',401);
   await requireBlogAdmin(actor);
   if(request.method==='GET'){await limited(`admin:${actor}:read`,120);return respond({connection:await socialHeroStatus(actor)});}
   if(request.method!=='POST')throw new SocialHeroError('METHOD_NOT_ALLOWED','Deze methode is niet beschikbaar.',405);
   if(request.headers.get('origin')!==appConfig().origin||request.headers.get('sec-fetch-site')==='cross-site')throw new SocialHeroError('PERMISSION_DENIED','Ververs de pagina en probeer opnieuw.',403);
   const data=await input(request);
   if(data.action==='pair'){
    if(Object.keys(data).some(k=>!['action','code','draft','publish'].includes(k)))throw new SocialHeroError('VALIDATION_ERROR','De aanvraag bevat onbekende velden.');
    if(typeof data.draft!=='boolean'||typeof data.publish!=='boolean')throw new SocialHeroError('VALIDATION_ERROR','Bevestig de zichtbare concept- en publicatietoestemming.');
    await limited(`admin:${actor}:pair`,5,600);
    return respond({connection:await pairSocialHero(actor,data.code,{...options,draft:data.draft,publish:data.publish})});
   }
   await limited(`admin:${actor}:write`,40);
   if(data.action==='policy'&&Object.keys(data).every(k=>['action','draft','publish'].includes(k)))return respond({connection:await setSocialHeroPolicy(actor,{draft:data.draft,publish:data.publish})});
   if(Object.keys(data).length!==1)throw new SocialHeroError('VALIDATION_ERROR','De aanvraag bevat onbekende velden.');
   if(data.action==='check')return respond({connection:await checkSocialHero(actor,options)});
   if(data.action==='disconnect')return respond({connection:await disconnectSocialHero(actor)});
   throw new SocialHeroError('VALIDATION_ERROR','Onbekende verbindingsactie.');
  }
  const bearer=request.headers.get('authorization')||'';
  if(!/^Bearer [^\s]+$/.test(bearer))throw new SocialHeroError('INVALID_CREDENTIAL','Een geldige verbindingscredential is vereist.',401);
  const credential=await authenticateBlogToken(bearer.slice(7));
  if(!credential.connectionId)return null;
  await limited(`credential:${credential.id}:${request.method==='GET'?'read':'write'}`,request.method==='GET'?240:40);
  const path=segments.slice(2),method=request.method;
  if(method==='GET'&&path.length===1&&path[0]==='capabilities'){
   if(!credential.scopes.includes('read'))throw new SocialHeroError('PERMISSION_DENIED','Deze verbinding mist leesrechten.',403);
   return respond(await socialHeroCapabilities(credential));
  }
  if(credential.state==='pending')throw new SocialHeroError('PAIRING_IN_PROGRESS','De verificatie is nog niet afgerond.',409,3);
  if(method==='DELETE'&&path.length===1&&path[0]==='connection'){
   await requireBlogCredential(database(),credential,'read');await revokeSocialHeroCredential(credential);
   console.info(JSON.stringify({event:'socialhero.request',requestId,method:request.method,status:204}));
   return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store','X-Request-ID':requestId}});
  }
  if(method==='POST'&&path.length===1&&path[0]==='media'){
   await requireBlogCredential(database(),credential,'media:write');
   const asset=await uploadBlogMedia(request,{credential},key(request));
   return respond({assetId:asset.assetId,mimeType:asset.type,width:asset.width,height:asset.height},201);
  }
  if(path[0]==='posts'&&path[1]&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(path[1])){
   const externalId=path[1];
   if(method==='GET'&&path.length===2){await requireBlogCredential(database(),credential,'read');const result=await getBlogExternalContractStatus(credential,externalId);const pending=await socialHeroPublicationPending(credential,result.postId,result.publishedRevision);return respond(pending?{...result,state:'publishing',publicUrl:null}:result);}
   if(method==='PUT'&&path.length===2){
    await requireBlogCredential(database(),credential,'drafts:write');const requestKey=key(request),body=validateSocialHeroPost(await input(request));
    const result=await writeBlogDraft({credential},{externalId,expectedRevision:body.baseRevision??undefined,data:body.data,requestId:requestKey});
    const pending=result.contractStatus?await socialHeroPublicationPending(credential,result.id,result.contractStatus.publishedRevision):false;
    return respond(pending?{...result.contractStatus,state:'publishing',publicUrl:null}:result.contractStatus,result.created?201:200,{'ETag':`"${result.revision}"`});
   }
   if(method==='POST'&&path.length===3&&path[2]==='publish'){
    await requireBlogCredential(database(),credential,'publish');const requestKey=key(request),data=await input(request);
    if(Object.keys(data).length!==1||!Number.isSafeInteger(data.revision)||Number(data.revision)<1)throw new SocialHeroError('VALIDATION_ERROR','Geef uitsluitend de expliciete numerieke revisie op.');
    const id=await resolveBlogExternalPostId(credential,externalId,'publish'),result=await publishBlog({credential},id,Number(data.revision),requestKey);
    const confirmed=await confirmSocialHeroPublication(credential,id,Number(data.revision),options);
    return respond(confirmed?result.contractStatus:{...result.contractStatus,state:'publishing',publicUrl:null},confirmed?200:202,confirmed?{}:{'Retry-After':'10'});
   }
  }
  throw new SocialHeroError('POST_NOT_FOUND','Deze connectorroute bestaat niet.',404);
 }catch(error){
  if(error instanceof SocialHeroError||error instanceof BlogError){
   const code=machine&&error.code==='UNAUTHENTICATED'?'INVALID_CREDENTIAL':error.code,status=machine&&error.code==='REVISION_CONFLICT'?409:error.status;
   const retry='retryAfter'in error&&typeof error.retryAfter==='number'?error.retryAfter:code==='PAIRING_IN_PROGRESS'?3:undefined;
   return respond({code,message:error.message,requestId},status,retry?{'Retry-After':String(retry)}:{});
  }
  console.error(JSON.stringify({event:'socialhero.request_failed',requestId}));
  return respond({code:'TEMPORARILY_UNAVAILABLE',message:'De koppeling is tijdelijk niet beschikbaar. Probeer opnieuw.',requestId},503,{'Retry-After':'10'});
 }
}
