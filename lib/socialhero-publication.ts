import {database} from './db';
import {blogRuntime,type BlogCredential} from './blog-store';
import {SocialHeroError,type SocialHeroTransport} from './socialhero-core';

type Check={post_id:string;revision:number;site_id:string;environment:string;destination_id:string;origin:string;slug:string;expected_marker:string;state:'pending'|'confirmed'|'superseded'};
function hasMarker(html:string,marker:string){
 return [...html.matchAll(/<meta\s+[^>]*>/gi)].some(([tag])=>/\bname=["']dartflow:publication["']/i.test(tag)&&new RegExp(`\\bcontent=["']${marker}["']`,'i').test(tag));
}
async function inspect(check:Check,options:SocialHeroTransport){
 const r=blogRuntime();
 if(check.origin!==r.origin||check.site_id!==r.siteId||check.environment!==r.environment)throw new SocialHeroError('DESTINATION_MISMATCH','Deze publicatie hoort bij een andere website of omgeving.',409);
 const current=(await database().query('select live_revision,status from dartflow_private.blog_posts where id=$1 and site_id=$2 and environment=$3 and destination_id=$4',[check.post_id,r.siteId,r.environment,check.destination_id])).rows[0];
 if(!current||current.status==='archived'||current.live_revision!==check.revision){
  await database().query("update dartflow_private.blog_publication_checks set state='superseded',last_error_code='REVISION_CONFLICT',checked_at=clock_timestamp() where post_id=$1 and revision=$2 and state='pending'",[check.post_id,check.revision]);
  return false;
 }
 let confirmed=false;
 try{
  const response=await(options.fetch??fetch)(`${r.origin}/blog/${encodeURIComponent(check.slug)}`,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{Accept:'text/html'}});
  if(response.ok&&response.headers.get('content-type')?.toLowerCase().includes('text/html')){
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
   if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();break;}chunks.push(value);}}finally{reader.releaseLock();}
   if(size<=1_500_000)confirmed=hasMarker(Buffer.concat(chunks).toString('utf8'),check.expected_marker);
  }else await response.body?.cancel();
 }catch{/* Keep the durable check pending, without raw network/provider errors. */}
 const result=await database().query(`update dartflow_private.blog_publication_checks c set attempts=attempts+1,checked_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '10 seconds',state=case when $3 then 'confirmed' else 'pending' end,confirmed_at=case when $3 then clock_timestamp() else null end,last_error_code=case when $3 then null else 'PUBLICATION_NOT_VISIBLE' end where c.post_id=$1 and c.revision=$2 and c.state='pending' and exists(select 1 from dartflow_private.blog_posts p where p.id=c.post_id and p.live_revision=c.revision and p.status<>'archived') returning state`,[check.post_id,check.revision,confirmed]);
 if(!result.rowCount)await database().query("update dartflow_private.blog_publication_checks c set state='superseded',last_error_code='REVISION_CONFLICT',checked_at=clock_timestamp() where c.post_id=$1 and c.revision=$2 and c.state='pending' and not exists(select 1 from dartflow_private.blog_posts p where p.id=c.post_id and p.live_revision=c.revision and p.status<>'archived')",[check.post_id,check.revision]);
 return result.rows[0]?.state==='confirmed'||(await database().query("select 1 from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2 and state='confirmed'",[check.post_id,check.revision])).rowCount===1;
}
export async function confirmSocialHeroPublication(credential:BlogCredential,postId:string,revision:number,options:SocialHeroTransport={}){
 const r=blogRuntime(),check=(await database().query('select * from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2 and site_id=$3 and environment=$4 and destination_id=$5',[postId,revision,r.siteId,r.environment,credential.destinationId])).rows[0] as Check|undefined;
 if(!check)throw new SocialHeroError('POST_NOT_FOUND','Deze publicatiecontrole bestaat niet.',404);
 if(check.state==='confirmed')return true;
 if(check.state==='superseded')throw new SocialHeroError('REVISION_CONFLICT','Deze publicatie is inmiddels vervangen door een andere revisie.',409);
 const confirmed=await inspect(check,options);
 if(!confirmed&&(await database().query("select 1 from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2 and state='superseded'",[check.post_id,check.revision])).rowCount)throw new SocialHeroError('REVISION_CONFLICT','Deze publicatie is inmiddels vervangen door een andere revisie.',409);
 return confirmed;
}
export async function socialHeroPublicationPending(credential:BlogCredential,postId:string,revision:number|null){
 if(revision===null)return false;
 const r=blogRuntime();return(await database().query("select 1 from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2 and site_id=$3 and environment=$4 and destination_id=$5 and state='pending'",[postId,revision,r.siteId,r.environment,credential.destinationId])).rowCount===1;
}
/** Only retries the read-only visibility check. Live activation already ran in
 * the blog transaction with current credential and destination rights. */
export async function processSocialHeroPublicationChecks(options:SocialHeroTransport={},limit=10){
 const r=blogRuntime(),checks=(await database().query("select * from dartflow_private.blog_publication_checks where site_id=$1 and environment=$2 and state='pending' and next_attempt_at<=clock_timestamp() order by next_attempt_at,post_id limit $3",[r.siteId,r.environment,Math.min(20,Math.max(1,limit))])).rows as Check[];
 for(const check of checks)await inspect(check,options);
 return checks.length;
}
