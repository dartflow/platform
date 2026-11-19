import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {NextRequest,NextResponse} from 'next/server';
import {ensureAuthProfile} from './accounts';
import {isLocalRequest,LOCAL_USERS} from './auth';
import {appConfig} from './config';
import {consumeRateLimit} from './db';
import {DomainError} from './domain';
import {withNativePlayerPrincipal} from './native-player-context';
import {assertAccountActive} from './account-removal';
import {signInPlayReviewer} from './play-review';

const id='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const reads=[/^play\/(?:mine|policy|advice|sources|statistics|boards|challenges(?:\/[a-f0-9-]{36})?|boards\/[a-f0-9-]{36}|sessions\/[a-f0-9-]{36})$/i,/^(?:session|profile|profile\/username-availability|players|overview|platform|player-statistics|player-experience|organizer-planning|organizer-guest-claims|push|locations|feed|seasons|organizer-drafts|faq|manual|faq\/admin|rankings|safety|account\/deletion)$/,
 new RegExp(`^organizer-participants/${id}$`,'i'),
 new RegExp(`^matches/${id}(?:/invitation|/corrections)?$`,'i'),new RegExp(`^trainings/${id}$`,'i'),new RegExp(`^boards/${id}(?:/competition)?$`,'i'),new RegExp(`^media/${id}$`,'i'),
 new RegExp(`^platform/matches/${id}/(?:chat|signals)$`,'i'),new RegExp(`^platform/rooms/${id}/messages$`,'i'),
 new RegExp(`^rankings/events/${id}$`,'i'),new RegExp(`^events/${id}/boards$`,'i'),new RegExp(`^seasons/${id}$`,'i'),new RegExp(`^feed/(?:result|replies)/${id}$`,'i'),/^community\/feed$/,
 new RegExp(`^community/chat/(?:club|league|tournament|match)/${id}$`,'i'),/^oche\/v1\/(?:context|devices)$/];
const writes=[/^play\/(?:actions|advice|legacy-actions|challenges\/actions)$/,/^(?:competition-lobbies\/(?:actions|player-pin)|profile\/(?:complete|player-pin)|player-pin\/lobby-add|player-experience|organizer-participants|push\/actions|platform\/actions|organizer-drafts\/actions|faq\/admin\/actions|rankings\/actions|board-activity\/continue|feed\/actions|seasons|seasons\/actions|seasons\/player-pin|account\/deletion|safety\/(?:consent|report|block))$/,
 new RegExp(`^matches/${id}/(?:actions|corrections/actions)$`,'i'),new RegExp(`^events/${id}/actions$`,'i'),new RegExp(`^boards/${id}/screen-preferences$`,'i'),new RegExp(`^platform/matches/${id}/(?:chat|signals|replay)$`,'i'), /^oche\/v1\/(?:claim|home-session)$/,new RegExp(`^oche/v1/devices/${id}$`,'i')];
export function nativePlayerRouteAllowed(path:string,method:string):boolean{
 if(!path||path.length>200||path.includes('%')||path.includes('\\')||path.includes('..'))return false;
 return (method==='GET'?reads:method==='POST'?writes:[]).some(pattern=>pattern.test(path));
}
export function nativePlayerEnvironment(){const config=appConfig();return config.mode==='local'?'development':config.origin==='https://staging.dartflow.nl'?'staging':'production';}
export function nativePlayerClientId(){const environment=nativePlayerEnvironment();return environment==='production'?'nl.dartflow.app':environment==='staging'?'nl.dartflow.app.staging':'nl.dartflow.app.dev';}
function localNativeRequest(request:NextRequest){return isLocalRequest(request)&&(request.headers.get('x-forwarded-for')??'').split(',').map(value=>value.trim()).filter(Boolean).every(value=>['localhost','127.0.0.1','::1','::ffff:127.0.0.1'].includes(value));}
function json(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});}
function publicAuth(){
 if(appConfig().mode==='local')return {url:null,publishableKey:null};
 const rawUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??'',key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??'';
 let url:URL;try{url=new URL(rawUrl);}catch{throw new DomainError('auth_configuration','Inloggen is tijdelijk niet beschikbaar.',503);}
 let publishable=/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key);
 if(!publishable){try{const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());publishable=key.split('.').length===3&&claims.role==='anon';}catch{/* Only public keys are ever exposed. */}}
 if(!publishable||url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new DomainError('auth_configuration','Inloggen is tijdelijk niet beschikbaar.',503);
 return {url:url.origin,publishableKey:key};
}
export function nativePlayerCapabilities(){const config=appConfig(),client=nativePlayerClientId();return {apiVersion:1,origin:config.origin,environment:nativePlayerEnvironment(),local:config.mode==='local',localUsers:config.mode==='local'?LOCAL_USERS:[],auth:{...publicAuth(),callbackUrl:`${config.origin}/auth/callback?native_client=${client}`,redirectScheme:client,otpLengthMin:6,otpLengthMax:10},pollAfterMs:2000,authentication:'Bearer',permissions:'existing-player-domain-rights',features:['resumable-guest-play','versioned-play-modes','private-guest-results','manual','profile','immutable-username','competition-board-lobbies','player-pin','matches','scoring','boards','friends','clubs','tournaments','seasons','statistics','practice','feed','chat','organize','organizer-drafts','rankings','ranking-event-declarations','ranking-management','faq','faq-administration','physical-locations','reservations','cricket','team-scoring','circuit-finals','integrity-dossiers','fixture-precalls','season-vacancies','media-readiness','organizer-participant-import','event-guests','guest-history-claims','hybrid-fixtures','two-clear-cap','tournament-planning','tournament-draw-controls','tournament-phase-rules','tournament-consolation','ranking-publication-pause','offline-score-conflicts','bull-start','notification-inbox','push-registration']};}

function localKey(){const dir=join(process.cwd(),'.local');mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,'native-player-session.key');try{writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}return readFileSync(path);}
const localSignature=(value:string)=>createHmac('sha256',localKey()).update('dartflow-native-player:').update(value).digest('base64url');
export function localNativePlayerSession(userId:unknown,request:NextRequest){
 if(appConfig().mode!=='local'||!localNativeRequest(request))throw new DomainError('local_only','Lokale login is alleen op loopback beschikbaar.',403);
 if(!LOCAL_USERS.some(user=>user.id===userId))throw new DomainError('local_user','Onbekend lokaal testaccount.');
 const expiresAt=new Date(Date.now()+8*3600_000).toISOString(),value=Buffer.from(JSON.stringify({id:userId,exp:Date.parse(expiresAt),nonce:randomBytes(16).toString('base64url')})).toString('base64url');
 return {accessToken:`local-player.${value}.${localSignature(value)}`,expiresAt};
}
export function verifyLocalNativePlayerSession(token:string,request:NextRequest):string|null{
 if(appConfig().mode!=='local'||!localNativeRequest(request))return null;
 const [prefix,value,signature,extra]=token.split('.');if(prefix!=='local-player'||!value||!signature||extra)return null;
 const expected=Buffer.from(localSignature(value)),actual=Buffer.from(signature);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
 try{const data=JSON.parse(Buffer.from(value,'base64url').toString());return Number.isSafeInteger(data.exp)&&data.exp>Date.now()&&LOCAL_USERS.some(user=>user.id===data.id)?data.id:null;}catch{return null;}
}
export function nativePlayerBearer(request:NextRequest):string{
 // Native APIs never authenticate a browser cookie or a client-supplied account ID.
 if(request.headers.has('origin')||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('origin','Gebruik de DartFlow-app voor deze aanvraag.',403);
 const raw=request.headers.get('authorization')??'';if(raw.length>8192||!/^Bearer [A-Za-z0-9._~-]+$/.test(raw))throw new DomainError('unauthorized','Log in om verder te gaan.',401);
 return raw.slice(7);
}
async function authenticatedPlayer(request:NextRequest){
 const token=nativePlayerBearer(request);
 if(appConfig().mode==='local'){const actor=verifyLocalNativePlayerSession(token,request);if(!actor)throw new DomainError('unauthorized','Log opnieuw in om verder te gaan.',401);await assertAccountActive(actor);return {request,id:actor,claims:null};}
 const auth=publicAuth();const client=createClient(auth.url!,auth.publishableKey!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)})}});
 // Auth checks the current account, and getClaims verifies signature/expiry. Neither trusts user_metadata for rights.
 const {data,error}=await client.auth.getUser(token);if(error||!data.user||data.user.is_anonymous)throw new DomainError('unauthorized','Log opnieuw in om verder te gaan.',401);
 const {data:verified,error:claimError}=await client.auth.getClaims(token);if(claimError||verified?.claims.sub!==data.user.id)throw new DomainError('unauthorized','Log opnieuw in om verder te gaan.',401);
 await assertAccountActive(data.user.id);
 await ensureAuthProfile(data.user);
 return {request,id:data.user.id,claims:verified.claims as unknown as Record<string,unknown>};
}
async function readLocalBody(request:NextRequest){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('content_type','JSON vereist.',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('invalid_json','Ongeldige aanvraag.');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>4096){await reader.cancel();throw new DomainError('too_large','Aanvraag te groot.',413);}chunks.push(item.value);}}finally{reader.releaseLock();}
 try{const data=JSON.parse(Buffer.concat(chunks).toString());if(data&&typeof data==='object'&&!Array.isArray(data))return data as Record<string,unknown>;}catch{/* Stable error, no input logged. */}throw new DomainError('invalid_json','Ongeldige aanvraag.');
}
async function limit(key:string,max:number){const result=await consumeRateLimit(`native-player:${key}`,max,60);if(!result.allowed)throw Object.assign(new DomainError('rate_limited','Tijdelijk te veel aanvragen. Probeer straks opnieuw.',429),{retryAfter:result.retryAfter});}

/** Narrow in-process adapter: the existing handler still parses commands and authorizes every domain operation. */
export async function handleNativePlayerApi(request:NextRequest,parts:string[],delegate:(request:NextRequest,parts:string[],method:string)=>Promise<Response>):Promise<Response|null>{
 if(parts[0]!=='player'||parts[1]!=='v1')return null;
 try{
  const config=appConfig(),method=request.method,path=parts.slice(2).join('/');
  if(config.mode==='local'&&!localNativeRequest(request))throw new DomainError('local_only','Lokale gegevens zijn alleen op loopback beschikbaar.',403);
  if(config.secure&&new URL(request.url).protocol!=='https:'&&request.headers.get('x-forwarded-proto')!=='https')throw new DomainError('https_required','Gebruik HTTPS.',400);
  if(path==='capabilities'&&method==='GET')return json(nativePlayerCapabilities());
  if((path==='faq'||path==='manual')&&method==='GET')return delegate(request,[path],method);
  if(path==='auth/review'&&method==='POST'){
   if(request.headers.has('origin')||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('origin','Open de beoordelaarstoegang vanuit de DartFlow-app.',403);
   return json(await signInPlayReviewer(request,await readLocalBody(request)));
  }
  if(path==='auth/local'&&method==='POST'){
   if(request.headers.has('origin')||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('origin','Gebruik de lokale app voor deze aanvraag.',403);
   if(config.mode!=='local')throw new DomainError('not_found','Niet gevonden.',404);
   await limit('local-login',30);return json(localNativePlayerSession((await readLocalBody(request)).userId,request));
  }
  if(!nativePlayerRouteAllowed(path,method))throw new DomainError('not_found','Niet gevonden.',404);
  nativePlayerBearer(request);
  const address=(request.headers.get('x-forwarded-for')??'direct').split(',').at(-1)!.trim();
  await limit(`ip:${createHash('sha256').update(address).digest('hex')}`,1200);
  const principal=await authenticatedPlayer(request);await limit(`actor:${principal.id}:${method==='GET'?'read':'write'}`,method==='GET'?360:120);
  const response=await withNativePlayerPrincipal(principal,()=>delegate(request,parts.slice(2),method));
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Authorization');response.headers.delete('Set-Cookie');return response;
 }catch(error){
  if(error instanceof DomainError){const retryAfter='retryAfter' in error?Number(error.retryAfter):undefined;const response=json({code:error.code,error:error.message,...(retryAfter?{retryAfter}:{})},error.status);if(error.status===401)response.headers.set('WWW-Authenticate','Bearer');if(error.status===429)response.headers.set('Retry-After',String(retryAfter||60));return response;}
  return json({code:'unavailable',error:'De server is tijdelijk niet beschikbaar. Probeer opnieuw.'},503);
 }
}

/** Fixed-target PKCE relay. The application owns state/verifier and exchanges the one-use code itself. */
export function nativePlayerCallback(request:NextRequest):Response|null{
 const requested=request.nextUrl.searchParams.get('native_client');if(requested===null)return null;
 const client=nativePlayerClientId(),state=request.nextUrl.searchParams.get('state')??'',code=request.nextUrl.searchParams.get('code');
 if(requested!==client||!/^[A-Za-z0-9_-]{32,128}$/.test(state))return json({code:'native_callback',error:'Open Google-login opnieuw vanuit de DartFlow-app.'},400);
 const target=new URL(`${client}://auth/callback`);target.searchParams.set('state',state);
 if(code&&/^[A-Za-z0-9_-]{16,256}$/.test(code))target.searchParams.set('code',code);else target.searchParams.set('error','oauth');
 const response=NextResponse.redirect(target,302);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
