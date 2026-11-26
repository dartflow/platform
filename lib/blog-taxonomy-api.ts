import type {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {actorId} from './auth';
import {appConfig} from './config';
import {consumeRateLimit} from './db';
import {BlogError} from './blog-types';
import {requireBlogAdmin} from './blog-store';
import {archiveBlogTaxonomy,listBlogTaxonomy,restoreBlogTaxonomy,saveBlogTaxonomy} from './blog-taxonomy';

const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow',...headers}});
async function input(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new BlogError('VALIDATION_ERROR','Gebruik JSON voor deze aanvraag.',415);
 const reader=request.body?.getReader();if(!reader)throw new BlogError('VALIDATION_ERROR','De aanvraag bevat geen gegevens.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10_000){await reader.cancel();throw new BlogError('PAYLOAD_TOO_LARGE','De aanvraag is te groot.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 try{const data:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data&&typeof data==='object'&&!Array.isArray(data))return data as Record<string,unknown>;}catch{/* Use the same controlled validation error for malformed input. */}
 throw new BlogError('VALIDATION_ERROR','Gebruik een geldig JSON-object.');
}
export async function handleBlogTaxonomyApi(request:NextRequest,parts:string[]):Promise<Response|null>{
 if(parts.length!==2||parts[0]!=='blog'||parts[1]!=='taxonomy')return null;
 const requestId=randomUUID();
 try{
  const actor=await actorId(request);if(!actor)throw new BlogError('UNAUTHENTICATED','Log in om auteurs en categorieën te beheren.',401);
  await requireBlogAdmin(actor);
  const rate=await consumeRateLimit(`blog:taxonomy:${actor}:${request.method}`,request.method==='GET'?120:40,60);
  if(!rate.allowed)return json({code:'RATE_LIMITED',message:'Er zijn te veel wijzigingen. Probeer later opnieuw.',requestId},429,{'Retry-After':String(rate.retryAfter)});
  if(request.method==='GET')return json(await listBlogTaxonomy(undefined,true));
  if(request.method!=='POST')throw new BlogError('METHOD_NOT_ALLOWED','Deze methode is niet beschikbaar.',405);
  if(request.headers.get('origin')!==appConfig().origin||request.headers.get('sec-fetch-site')==='cross-site')throw new BlogError('PERMISSION_DENIED','Ververs de pagina en probeer opnieuw.',403);
  const data=await input(request),allowed=['action','kind','id','name','expectedRevision','requestId'];
  if(Object.keys(data).some(key=>!allowed.includes(key))||typeof data.requestId!=='string')throw new BlogError('VALIDATION_ERROR','Controleer de gegevens van deze vermelding.');
  const values={kind:data.kind,id:data.id,name:data.name,expectedRevision:data.expectedRevision,requestId:data.requestId};
  const entry=data.action==='save'?await saveBlogTaxonomy(actor,values):data.action==='archive'?await archiveBlogTaxonomy(actor,values):data.action==='restore'?await restoreBlogTaxonomy(actor,values):null;
  if(!entry)throw new BlogError('VALIDATION_ERROR','Onbekende beheeractie.');
  return json({entry,...await listBlogTaxonomy(undefined,true)});
 }catch(error){
  if(error instanceof BlogError)return json({code:error.code,message:error.message,field:error.field,currentRevision:error.currentRevision,requestId},error.status);
  console.error(JSON.stringify({event:'blog.taxonomy_failed',requestId}));
  return json({code:'TEMPORARILY_UNAVAILABLE',message:'Auteurs en categorieën konden niet worden bijgewerkt. Je invoer blijft bewaard.',requestId},503);
 }
}
