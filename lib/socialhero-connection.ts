import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {appConfig} from './config';
import {blogHash,blogRuntime,blogTransaction,requireBlogAdmin,type BlogCredential} from './blog-store';
import {decryptSocialHeroSecret,encryptSocialHeroSecret,socialHeroOrigin,socialHeroRequest,SocialHeroError,validatePairingClaim,type SocialHeroTransport} from './socialhero-core';

type Connection={id:string;site_id:string;environment:string;origin:string;provider_origin:string;code_hash:string;connection_id:string|null;destination_id:string|null;token_id:string|null;status:'claiming'|'pending'|'active'|'expired'|'rejected'|'disconnected';expires_at:Date|null;temporary_secret:Parameters<typeof decryptSocialHeroSecret>[0]|null};
type Client=Pick<PoolClient,'query'>;
const binding=(row:Connection)=>`${row.site_id}:${row.environment}:${row.id}`;
function configuration(options:SocialHeroTransport={}){
 const r=blogRuntime(),provider=socialHeroOrigin(process.env.DARTFLOW_SOCIALHERO_ORIGIN||'');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.siteId)||!['staging','production'].includes(r.environment)||(!r.origin.startsWith('https://')&&!(appConfig().mode==='local'&&options.fetch)))throw new SocialHeroError('CONFIGURATION_REQUIRED','Richt een stabiele site-ID, HTTPS-origin en staging- of productieomgeving in.',503);
 return {...r,provider};
}
async function settings(client:Client){const r=blogRuntime();await client.query('insert into dartflow_private.socialhero_settings(site_id,environment) values($1,$2) on conflict do nothing',[r.siteId,r.environment]);return (await client.query('select * from dartflow_private.socialhero_settings where site_id=$1 and environment=$2 for update',[r.siteId,r.environment])).rows[0] as {publish_enabled:boolean;current_attempt:string|null};}
async function expire(client:Client){
 await settings(client);
 const r=blogRuntime();
 const expired=(await client.query("update dartflow_private.socialhero_connections set status='expired',temporary_secret=null,updated_at=clock_timestamp() where site_id=$1 and environment=$2 and ((status='pending' and expires_at<=clock_timestamp())or(status='claiming' and created_at<clock_timestamp()-interval '10 minutes')) returning token_id",[r.siteId,r.environment])).rows;
 for(const row of expired)if(row.token_id)await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1',[row.token_id]);
}
/** Invoked by the existing authenticated maintenance worker, even without a visit. */
export async function expireSocialHeroProvisioning(){await blogTransaction(expire);}
async function selected(client:Client):Promise<Connection|null>{const r=blogRuntime();return (await client.query(`select c.* from dartflow_private.socialhero_connections c left join dartflow_private.socialhero_settings s on s.site_id=c.site_id and s.environment=c.environment where c.site_id=$1 and c.environment=$2 order by (c.id=s.current_attempt) desc nulls last,c.created_at desc,c.id limit 1`,[r.siteId,r.environment])).rows[0]??null;}
async function status(client:Client){
 const r=blogRuntime(),row=await selected(client),policy=(await client.query('select publish_enabled from dartflow_private.socialhero_settings where site_id=$1 and environment=$2',[r.siteId,r.environment])).rows[0];
 let configured=false;try{configuration();encryptSocialHeroSecret('',`${r.siteId}:${r.environment}:configuration`);configured=true;}catch{/* Settings remain inspectable before provisioning. */}
 let state:Exclude<Connection['status'],'claiming'>=row?.status==='claiming'?'pending':row?.status??'disconnected';
 if(row?.status==='active'){
  const current=(await client.query("select 1 from dartflow_private.blog_tokens where id=$1 and revoked_at is null and credential_state='active' and expires_at>clock_timestamp()",[row.token_id])).rowCount;
  if(!current)state='disconnected';
 }
 return {status:state,environment:r.environment,siteId:r.siteId,origin:r.origin,connectionId:row?.connection_id??null,destinationId:row?.destination_id??null,publish:policy?.publish_enabled===true,scopes:state==='active'?['read','draft',...(policy?.publish_enabled?['publish']:[])]:[],configured};
}
export async function socialHeroStatus(actor:string){return blogTransaction(async client=>{await requireBlogAdmin(actor,client);await expire(client);return status(client);});}

async function reject(row:Connection,state:'rejected'|'expired'){
 await blogTransaction(async client=>{
  await settings(client);
  await client.query("update dartflow_private.socialhero_connections set status=$2,temporary_secret=null,updated_at=clock_timestamp() where id=$1 and status in('claiming','pending')",[row.id,state]);
  if(row.token_id)await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1 and credential_state=\'pending\'',[row.token_id]);
 });
}
async function verify(row:Connection,options:SocialHeroTransport){
 if(!row.expires_at||row.expires_at.getTime()<=Date.now()){await reject(row,'expired');throw new SocialHeroError('PAIRING_EXPIRED','De installatie is verlopen. Maak een nieuwe koppelcode in SocialHero.',410);}
 if(!row.temporary_secret||!row.connection_id)throw new SocialHeroError('PAIRING_IN_PROGRESS','Plak dezelfde code opnieuw om de onderbroken installatie te hervatten.',409,3);
 const r=configuration(options);
 if(row.provider_origin!==r.provider||row.origin!==r.origin)throw new SocialHeroError('DESTINATION_MISMATCH','De serverconfiguratie is gewijzigd. Koppel opnieuw voor deze omgeving.',409);
 const token=decryptSocialHeroSecret(row.temporary_secret,binding(row));
 try{
  const value=await socialHeroRequest(row.provider_origin,`/api/integrations/blog/v1/pairings/${row.connection_id}/verify`,{},token,options);
  if(!value||typeof value!=='object'||!('connectionId'in value)||value.connectionId!==row.connection_id||!('status'in value)||value.status!=='verified')throw new SocialHeroError('PROVIDER_UNAVAILABLE','De verificatie is niet bevestigd. Controleer de verbinding opnieuw.',503,5);
 }catch(error){
  if(error instanceof SocialHeroError&&['INVALID_CREDENTIAL','PERMISSION_DENIED','DESTINATION_MISMATCH','PAIRING_EXPIRED','INVALID_PAIRING_CODE'].includes(error.code))await reject(row,error.code==='PAIRING_EXPIRED'?'expired':'rejected');
  throw error;
 }
 await blogTransaction(async client=>{
  const policy=await settings(client),current=(await client.query('select * from dartflow_private.socialhero_connections where id=$1 for update',[row.id])).rows[0] as Connection;
  if(policy.current_attempt!==row.id||!['pending','active'].includes(current.status))throw new SocialHeroError('INVALID_CREDENTIAL','Deze installatie is vervangen of ontkoppeld. Koppel opnieuw.',401);
  if(current.status==='active')return;
  if(!current.expires_at||current.expires_at.getTime()<=Date.now())throw new SocialHeroError('PAIRING_EXPIRED','De installatie is verlopen. Koppel opnieuw.',410);
  // Revoke previous credentials individually, after the replacement was verified.
  const previous=(await client.query("select token_id,id from dartflow_private.socialhero_connections where site_id=$1 and environment=$2 and status='active' and id<>$3 for update",[r.siteId,r.environment,row.id])).rows;
  for(const old of previous){await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1',[old.token_id]);await client.query("update dartflow_private.socialhero_connections set status='disconnected',temporary_secret=null where id=$1",[old.id]);}
  const activated=await client.query("update dartflow_private.blog_tokens set credential_state='active',expires_at='9999-12-31T23:59:59Z',scopes=$2 where id=$1 and revoked_at is null returning id",[row.token_id,JSON.stringify(['read','media:write','drafts:write',...(policy.publish_enabled?['publish']:[])])]);
  if(!activated.rowCount)throw new SocialHeroError('INVALID_CREDENTIAL','Deze verbinding is ingetrokken. Koppel opnieuw.',401);
  await client.query("update dartflow_private.socialhero_connections set status='active',temporary_secret=null,updated_at=clock_timestamp() where id=$1",[row.id]);
 });
}

export async function pairSocialHero(actor:string,code:unknown,options:SocialHeroTransport={}){
 await requireBlogAdmin(actor);
 if(typeof code!=='string'||!code.trim()||code.length>2048||/[\s\u0000-\u001f]/.test(code.trim()))throw new SocialHeroError('INVALID_PAIRING_CODE','Plak de volledige koppelcode uit SocialHero.',400);
 const r=configuration(options),normalized=code.trim(),hash=blogHash(normalized);
 // Fail before claiming a one-time code if encrypted recovery storage is unavailable.
 encryptSocialHeroSecret('',`${r.siteId}:${r.environment}:configuration`);
 let row=await blogTransaction(async client=>{
  await requireBlogAdmin(actor,client);await expire(client);const policy=await settings(client),old=policy.current_attempt?(await client.query('select * from dartflow_private.socialhero_connections where id=$1',[policy.current_attempt])).rows[0] as Connection|undefined:undefined;
  if(old&&['claiming','pending','active'].includes(old.status)&&old.code_hash===hash&&old.origin===r.origin&&old.provider_origin===r.provider)return old;
  if(old&&['claiming','pending'].includes(old.status)){
   if(old.token_id)await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1',[old.token_id]);
   await client.query("update dartflow_private.socialhero_connections set status='disconnected',temporary_secret=null where id=$1",[old.id]);
  }
  const id=randomUUID();
  const inserted=(await client.query("insert into dartflow_private.socialhero_connections(id,site_id,environment,origin,provider_origin,code_hash,status,created_by) values($1,$2,$3,$4,$5,$6,'claiming',$7) returning *",[id,r.siteId,r.environment,r.origin,r.provider,hash,actor])).rows[0] as Connection;
  await client.query('update dartflow_private.socialhero_settings set current_attempt=$3 where site_id=$1 and environment=$2',[r.siteId,r.environment,id]);return inserted;
 });
 if(row.status==='active')return socialHeroStatus(actor);
 if(row.status==='claiming'){
  try{
   const claim=validatePairingClaim(await socialHeroRequest(r.provider,'/api/integrations/blog/v1/pairings/claim',{code:normalized,attemptId:row.id,siteId:r.siteId,origin:r.origin,environment:r.environment,contractVersion:1},undefined,options));
   const secret=encryptSocialHeroSecret(claim.accessToken,binding(row));
   row=await blogTransaction(async client=>{
    const policy=await settings(client),current=(await client.query('select * from dartflow_private.socialhero_connections where id=$1 for update',[row.id])).rows[0] as Connection;
    if(policy.current_attempt!==row.id||!['claiming','pending'].includes(current.status))throw new SocialHeroError('INVALID_CREDENTIAL','Deze installatie is vervangen. Koppel opnieuw.',401);
    if(current.status==='pending')return current;
    const tokenId=randomUUID();
    await client.query("insert into dartflow_private.blog_tokens(id,site_id,environment,name,token_hash,prefix,scopes,expires_at,created_by,connection_id,destination_id,credential_state,provisioning_expires_at) values($1,$2,$3,'SocialHero koppelcode',$4,'paired',$5,$6,$7,$8,$9,'pending',$6)",[tokenId,r.siteId,r.environment,blogHash(claim.accessToken),JSON.stringify(['read','media:write','drafts:write']),claim.expiresAt,actor,claim.connectionId,claim.destinationId]);
    return (await client.query("update dartflow_private.socialhero_connections set connection_id=$2,destination_id=$3,token_id=$4,status='pending',expires_at=$5,temporary_secret=$6,updated_at=clock_timestamp() where id=$1 returning *",[row.id,claim.connectionId,claim.destinationId,tokenId,claim.expiresAt,JSON.stringify(secret)])).rows[0] as Connection;
   });
  }catch(error){if(error instanceof SocialHeroError&&['INVALID_PAIRING_CODE','PAIRING_EXPIRED','DESTINATION_MISMATCH','INVALID_CREDENTIAL','PERMISSION_DENIED'].includes(error.code))await reject(row,error.code==='PAIRING_EXPIRED'?'expired':'rejected');throw error;}
 }
 await verify(row,options);
 return socialHeroStatus(actor);
}
export async function checkSocialHero(actor:string,options:SocialHeroTransport={}){
 await requireBlogAdmin(actor);await blogTransaction(expire);
 const row=await selected(database());
 if(row?.status==='pending')await verify(row,options);
 else if(row?.status==='claiming')throw new SocialHeroError('PAIRING_IN_PROGRESS','Plak dezelfde koppelcode opnieuw om de installatie te hervatten.',409,3);
 return socialHeroStatus(actor);
}
export async function disconnectSocialHero(actor:string){return blogTransaction(async client=>{
 await requireBlogAdmin(actor,client);await settings(client);const r=blogRuntime();
 const rows=(await client.query("select id,token_id from dartflow_private.socialhero_connections where site_id=$1 and environment=$2 and status in('claiming','pending','active') for update",[r.siteId,r.environment])).rows;
 for(const row of rows){if(row.token_id)await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1',[row.token_id]);await client.query("update dartflow_private.socialhero_connections set status='disconnected',temporary_secret=null,updated_at=clock_timestamp() where id=$1",[row.id]);}
 await client.query('update dartflow_private.socialhero_settings set publish_enabled=false where site_id=$1 and environment=$2',[r.siteId,r.environment]);
 return status(client);
});}
export async function setSocialHeroPublish(actor:string,publish:unknown){
 if(typeof publish!=='boolean')throw new SocialHeroError('VALIDATION_ERROR','Kies of SocialHero mag publiceren.');
 return blogTransaction(async client=>{
  await requireBlogAdmin(actor,client);await settings(client);const r=blogRuntime();
  if(publish&&!(await client.query("select 1 from dartflow_private.socialhero_connections c join dartflow_private.blog_tokens t on t.id=c.token_id where c.site_id=$1 and c.environment=$2 and c.status='active' and t.credential_state='active' and t.revoked_at is null and t.expires_at>clock_timestamp()",[r.siteId,r.environment])).rowCount)throw new SocialHeroError('PERMISSION_DENIED','Koppel SocialHero voordat je publicatierechten geeft.',403);
  await client.query('update dartflow_private.socialhero_settings set publish_enabled=$3 where site_id=$1 and environment=$2',[r.siteId,r.environment,publish]);
  await client.query("update dartflow_private.blog_tokens set scopes=$3 where site_id=$1 and environment=$2 and connection_id is not null and revoked_at is null and credential_state='active'",[r.siteId,r.environment,JSON.stringify(['read','media:write','drafts:write',...(publish?['publish']:[])])]);
  return status(client);
 });
}
/** Machine disconnect only revokes the exact bearer that authenticated this request. */
export async function revokeSocialHeroCredential(credential:BlogCredential){await blogTransaction(async client=>{
 await settings(client);
 const r=blogRuntime();
 await client.query('update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1 and site_id=$2 and environment=$3',[credential.id,r.siteId,r.environment]);
 await client.query("update dartflow_private.socialhero_connections set status='disconnected',temporary_secret=null,updated_at=clock_timestamp() where token_id=$1 and site_id=$2 and environment=$3",[credential.id,r.siteId,r.environment]);
});}
