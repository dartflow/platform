import {createClient} from '@supabase/supabase-js';
import {createHash,timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {setTimeout as delay} from 'node:timers/promises';
import {appConfig} from './config';
import {database,consumeRateLimit} from './db';
import {DomainError} from './domain';
import {decryptCredential,integrationRuntime,ownerAccess,type Envelope} from './integrations-core';
import {hasRecentVerifiedAuthentication} from './reauth';
import {ensureAuthProfile} from './accounts';

type ReviewAccount={user_id:string;email:string;password_envelope:Envelope;review_details:Envelope|null;companion_user_id:string|null;enabled:boolean};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export function reviewPasswordMatches(supplied:string,expected:string){
 return timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(expected).digest());
}
async function account():Promise<ReviewAccount|null>{
 if(appConfig().mode!=='supabase')return null;
 const {rows}=await database().query<ReviewAccount>('select user_id,email,password_envelope,review_details,companion_user_id,enabled from dartflow_private.play_review_accounts where environment=$1',[integrationRuntime().environment]);
 return rows[0]??null;
}
async function rate(key:string,max:number,seconds:number){const result=await consumeRateLimit(`play-review:${key}`,max,seconds);if(!result.allowed)throw new DomainError('rate_limited','Wacht even voordat je opnieuw probeert.',429);}
/** A regular Supabase password sign-in, limited to the explicitly provisioned review identity. */
export async function signInPlayReviewer(request:NextRequest,input:Record<string,unknown>){
 const started=Date.now();
 const ip=(request.headers.get('x-forwarded-for')??'direct').split(',').at(-1)!.trim();
 await rate(`ip:${createHash('sha256').update(ip).digest('hex')}`,20,900);
 await rate('global',300,900);
 const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
 const password=typeof input.password==='string'?input.password:'';
 const invalid=()=>new DomainError('review_login','Deze beoordelaargegevens kloppen niet of zijn niet beschikbaar.',401);
 try{
  if(email.length>254||password.length<12||password.length>256||Object.keys(input).some(key=>!['email','password'].includes(key)))throw invalid();
  const row=await account();
  if(!row?.enabled)throw invalid();
  const details=row.review_details?JSON.parse(decryptCredential(row.review_details,'play-review-password')):{};
  const companion=row.companion_user_id&&typeof details.companionEmail==='string'&&details.companionEmail===email;
  const expectedId=companion?row.companion_user_id:row.user_id;
  const expectedPassword=companion?details.companionPassword:row.email===email?decryptCredential(row.password_envelope,'play-review-password'):null;
  if(typeof expectedPassword!=='string'||!reviewPasswordMatches(password,expectedPassword))throw invalid();
  const runtime=integrationRuntime(),url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  if(url!==`https://${runtime.projectRef}.supabase.co`)throw invalid();
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(target,init)=>fetch(target,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)})}});
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error||!data.session||data.user?.id!==expectedId||data.user.is_anonymous)throw invalid();
  await ensureAuthProfile(data.user);
  return {accessToken:data.session.access_token,refreshToken:data.session.refresh_token,expiresAt:new Date(data.session.expires_at!*1000).toISOString()};
 }catch(error){
  await delay(Math.max(0,450-(Date.now()-started)));
  if(error instanceof DomainError&&error.code==='rate_limited')throw error;
  throw invalid();
 }
}
export async function handlePlayReviewManagement(request:NextRequest,actor:string,path:string):Promise<Response|null>{
 if(path!=='admin/play-review')return null;
 await ownerAccess(actor);
 if(request.method==='GET'){
  const row=await account();return json({configured:Boolean(row),enabled:row?.enabled??false,email:row?.email??null,instructionsUrl:'/communityregels',supportEmail:'info@dartflow.nl'});
 }
 if(request.method!=='POST')return json({error:'Methode niet toegestaan.'},405);
 if(appConfig().mode!=='supabase')throw new DomainError('review_unavailable','Beoordelaarstoegang is alleen in de eigen hosted omgeving beschikbaar.',503);
 const {supabaseServer}=await import('./auth');
 const {data,error}=await (await supabaseServer()).auth.getClaims();
 if(error||!hasRecentVerifiedAuthentication(actor,data?.claims,{requireMfa:process.env.DARTFLOW_ADMIN_REQUIRE_MFA==='true'}))throw new DomainError('reauth_required','Meld je opnieuw aan voordat je beoordelaargegevens bekijkt.',403);
 await rate(`owner:${actor}`,10,900);
 const row=await account();if(!row?.enabled)throw new DomainError('review_unavailable','De beoordelaarstoegang is niet ingericht of is uitgeschakeld.',409);
 // Never persist a plaintext credential or log request/response bodies.
 await database().query("insert into dartflow_private.audit_events(actor_id,action,detail) values($1,'play-review.credentials-viewed','{}')",[actor]);
 const details=row.review_details?JSON.parse(decryptCredential(row.review_details,'play-review-password')):{};
 return json({email:row.email,password:decryptCredential(row.password_envelope,'play-review-password'),...details,supportEmail:'info@dartflow.nl'});
}
