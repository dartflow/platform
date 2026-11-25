import {NextRequest,NextResponse} from 'next/server';
import {actorId,isLocalRequest} from './auth';
import {nativePlayerPrincipal} from './native-player-context';
import {appConfig} from './config';
import {consumeRateLimit} from './db';
import {DomainError} from './domain';
import {secretHash} from './oche-device-crypto';
import {claimOcheInstallation,proposeOcheLayout,getOcheLayoutProposal,getOcheInstallationStatus,getOcheManagement,logoutOcheDevice,manageOcheDevice,redeemOcheInstallation,refreshOcheSession,selectOcheHomeSession,setOcheLimit,startOcheInstallation} from './oche-device-store';
import {getOcheDeviceSnapshot,pollOcheDeviceEvents} from './oche-device-projection';
import type {OcheClaim,OchePlatform,OcheSession} from './oche-device-types';

const pendingCookie='dartflow-oche-installation',accessCookie='dartflow-oche-access',refreshCookie='dartflow-oche-refresh';
const cookiePath='/api/oche/v1';
function json(value:unknown,status=200,headers:Record<string,string>={}){return NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff',...headers}});}
function csrf(request:NextRequest){if(nativePlayerPrincipal(request))return;if(request.headers.get('origin')!==appConfig().origin||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('origin','Ververs de pagina en probeer opnieuw.',403);}
async function body(request:NextRequest):Promise<Record<string,unknown>>{
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('content_type','Gebruik JSON voor deze aanvraag.',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('invalid_json','Invoer ontbreekt.');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>8192){await reader.cancel();throw new DomainError('too_large','De aanvraag is te groot.',413);}chunks.push(item.value);}}finally{reader.releaseLock();}
 try{const input=JSON.parse(Buffer.concat(chunks).toString());if(input&&typeof input==='object'&&!Array.isArray(input))return input;}catch{/* stable validation below */}
 throw new DomainError('invalid_json','Gebruik een geldig JSON-object.');
}
async function limit(key:string,max:number,seconds=60){const result=await consumeRateLimit(`oche:${key}`,max,seconds);if(!result.allowed)throw Object.assign(new DomainError('rate_limited',`Wacht ${result.retryAfter} seconden en probeer opnieuw.`,429),{retryAfter:result.retryAfter});}
function installAuth(request:NextRequest):{id:string;secret:string;browser:boolean}{
 const raw=request.cookies.get(pendingCookie)?.value;if(raw){const [id,secret,extra]=raw.split('.');if(extra||!id||!secret)throw new DomainError('device_unauthorized','Open de schermkoppeling opnieuw.',401);return{id,secret,browser:true};}
 const header=request.headers.get('authorization')??'';
 const match=/^OcheInstall ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(header);
 return {id:match?.[1]??'',secret:match?.[2]??'',browser:false};
}
function accessAuth(request:NextRequest):{token:string;browser:boolean}{const value=request.headers.get('authorization');if(value?.startsWith('Bearer '))return{token:value.slice(7),browser:false};return{token:request.cookies.get(accessCookie)?.value??'',browser:true};}
function browserSession(response:NextResponse,session:OcheSession){const common={httpOnly:true,secure:appConfig().secure,sameSite:'strict' as const,path:cookiePath};response.cookies.set(accessCookie,session.accessToken!,{...common,maxAge:120});response.cookies.set(refreshCookie,session.refreshToken!,{...common,maxAge:365*86400});}
function sessionResponse(session:OcheSession,browser:boolean){const response=json(browser?{deviceId:session.deviceId,accessExpiresAt:session.accessExpiresAt,refreshExpiresAt:session.refreshExpiresAt}:session);if(browser)browserSession(response,session);return response;}
function clearCookies(response:NextResponse){for(const name of[pendingCookie,accessCookie,refreshCookie])response.cookies.set(name,'',{httpOnly:true,secure:appConfig().secure,sameSite:'strict',path:cookiePath,maxAge:0});}
async function actor(request:NextRequest):Promise<string>{const id=await actorId(request);if(!id)throw new DomainError('unauthorized','Log in om schermen te beheren.',401);return id;}

/** Server-only API. Native bearer credentials never create a DartFlow user session. */
export async function handleOcheDeviceApi(request:NextRequest,segments:string[]):Promise<Response|null>{
 if(segments[0]!=='oche'||segments[1]!=='v1')return null;
 const path=segments.slice(2),method=request.method;
 try{
  const config=appConfig();if(config.mode==='local'&&!isLocalRequest(request))throw new DomainError('local_only','Lokale gegevens zijn alleen op loopback beschikbaar.',403);
  if(config.secure&&(new URL(request.url).protocol!=='https:'&&request.headers.get('x-forwarded-proto')!=='https'))throw new DomainError('https_required','Gebruik de beveiligde HTTPS-schermlink.',400);
  const ip=secretHash((request.headers.get('x-forwarded-for')??'direct').split(',')[0].trim());
  await limit(`ip:${ip}`,1200);
  if(path.length===1&&path[0]==='capabilities'&&method==='GET')return json({apiVersion:1,origin:config.origin,pairing:{alphabet:'CrockfordBase32',length:8,lifetimeSeconds:600},permissions:{read:true,score:false,extend:false},pollAfterMs:2000,revocationBoundMs:5000,layouts:{version:1,dualLocation:true}});
  if(path.length===1&&path[0]==='start'&&method==='POST'){
   const input=await body(request),platform=input.platform as OchePlatform,existing=installAuth(request),browser=platform==='browser';if(browser)csrf(request);
   await limit(`start:${ip}`,20,600);
   const result=await startOcheInstallation({platform,...(input.layoutProposal!==undefined?{layoutProposal:input.layoutProposal}:{}),requestId:String(input.requestId??''),...(browser&&existing.id?{installationId:existing.id,installationSecret:existing.secret}:!browser&&input.installationId?{installationId:String(input.installationId),installationSecret:String(input.installationSecret??'')}: {})});
   const response=json(browser?{installationId:result.installationId,code:result.code,expiresAt:result.expiresAt,serverNow:result.serverNow,verificationUrl:result.verificationUrl,pollAfterMs:result.pollAfterMs,layoutProposal:result.layoutProposal}:result,201);
   if(browser){
    clearCookies(response);
    response.cookies.set(pendingCookie,`${result.installationId}.${result.installationSecret}`,{httpOnly:true,secure:config.secure,sameSite:'strict',path:cookiePath,maxAge:600});
   }return response;
  }
  if(path.length===1&&path[0]==='status'&&method==='GET'){const auth=installAuth(request);await limit(`installation:${secretHash(auth.id)}`,120);return json(await getOcheInstallationStatus(auth.id,auth.secret));}
  if(path.length===1&&path[0]==='redeem'&&method==='POST'){
   const auth=installAuth(request);if(auth.browser)csrf(request);await limit(`redeem:${ip}`,60);const input=await body(request);return sessionResponse(await redeemOcheInstallation(auth.id,auth.secret,String(input.nonce??'')),auth.browser);
  }
  if(path.length===1&&path[0]==='refresh'&&method==='POST'){
   const input=await body(request),cookie=request.cookies.get(refreshCookie)?.value,browser=Boolean(cookie);if(browser)csrf(request);await limit(`refresh:${ip}`,120);return sessionResponse(await refreshOcheSession(cookie??String(input.refreshToken??''),String(input.nonce??'')),browser);
  }
  if(path.length===1&&['snapshot','events'].includes(path[0])&&method==='GET'){
   const auth=accessAuth(request);await limit(`access:${secretHash(auth.token)}`,120);const query=new URL(request.url).searchParams,panels=query.get('panels')==='1';return json(path[0]==='snapshot'?await getOcheDeviceSnapshot(auth.token,panels):await pollOcheDeviceEvents(auth.token,query.get('after')??undefined,panels));
  }
  if(path.length===1&&path[0]==='layout-proposal'&&method==='POST'){const auth=accessAuth(request);if(auth.browser)csrf(request);await limit(`proposal:${secretHash(auth.token)}`,20,600);return json(await proposeOcheLayout(auth.token,await body(request) as Parameters<typeof proposeOcheLayout>[1]),201);}
  if(path.length===1&&path[0]==='logout'&&method==='POST'){
   const auth=accessAuth(request);if(auth.browser)csrf(request);await logoutOcheDevice(auth.token);const response=json({ok:true});clearCookies(response);return response;
  }
  const id=await actor(request);await limit(`account:${id}`,method==='GET'?120:30);if(method!=='GET')csrf(request);
  if(path.length===1&&path[0]==='proposal'&&method==='GET')return json(await getOcheLayoutProposal(id,new URL(request.url).searchParams.get('code')??''));
  if(path.length===1&&path[0]==='context'&&method==='GET')return json(await getOcheManagement(id));
  if(path.length===1&&path[0]==='devices'&&method==='GET')return json({devices:(await getOcheManagement(id)).devices});
  if(path.length===1&&path[0]==='claim'&&method==='POST'){await limit(`claim:${id}`,20,600);return json(await claimOcheInstallation(id,await body(request) as OcheClaim));}
  if(path.length===2&&path[0]==='devices'&&method==='POST')return json(await manageOcheDevice(id,path[1],await body(request) as Parameters<typeof manageOcheDevice>[2]));
  if(path.length===1&&path[0]==='limits'&&method==='POST')return json(await setOcheLimit(id,await body(request) as Parameters<typeof setOcheLimit>[1]));
  if(path.length===1&&path[0]==='home-session'&&method==='POST')return json(await selectOcheHomeSession(id,await body(request) as Parameters<typeof selectOcheHomeSession>[1]));
  throw new DomainError('not_found','Deze scherm-API-route bestaat niet.',404);
 }catch(error){
  if(error instanceof DomainError){const retryAfter='retryAfter'in error?String(error.retryAfter):'5';return json({code:error.code,message:error.message,...('capacity'in error?{capacity:error.capacity}:{})},error.status,error.status===429?{'Retry-After':retryAfter}:{});}
  return json({code:'screen_unavailable',message:'Schermkoppeling is tijdelijk niet bereikbaar. Probeer opnieuw.'},503,{'Retry-After':'10'});
 }
}
