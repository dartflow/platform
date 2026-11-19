import {createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {actorId} from './auth';
import {appConfig} from './config';
import {consumeRateLimit} from './db';
import {DomainError} from './domain';
import {nativePlayerPrincipal} from './native-player-context';
import {executePlayCommand,executeLegacyPlayCommand,getMyPlaySessions,getPlayBoard,getPlaySession,getPlayRetentionPolicy} from './play-sessions';
import {executeChallengeCommand,getPlayChallenge,getPlayChallenges} from './play-challenges';
import {getPlayAdvice,savePlayAdvice} from './play-advice';
import {getPlayBoards} from './play-board-list';
import {getPlaySources} from './play-sources';
import {getPlayStatistics,type PlayStatisticsFilters} from './play-statistics';
import {PlayRuleError} from './play-rules';
import type {PlayPrincipal} from './play-session-types';

const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function playJson(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Authorization, X-DartFlow-Play-Capability'}});}
export async function readPlayBody(request:NextRequest):Promise<Record<string,unknown>>{
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('content_type','JSON vereist.',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('invalid_json','Vul de actie opnieuw in.');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768){await reader.cancel();throw new DomainError('too_large','De actie is te groot.',413);}chunks.push(part.value);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{/* Report a useful validation error without logging the private payload. */}
 throw new DomainError('invalid_json','De actie kon niet worden gelezen. Probeer opnieuw.');
}
export function protectPlayMutation(request:NextRequest):void{
 if(nativePlayerPrincipal(request))return;
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==appConfig().origin)throw new DomainError('origin','Open deze actie vanuit DartFlow.',403);
 // Public native guest clients have no browser cookies or account authority.
 // Account-bearing native requests must pass the existing authenticated v1 boundary.
 if(!origin&&(request.headers.has('cookie')||request.headers.has('authorization')))throw new DomainError('origin','Open deze actie opnieuw vanuit de app of browser.',403);
}
export async function playPrincipal(request:NextRequest):Promise<PlayPrincipal>{
 const token=request.headers.get('x-dartflow-play-capability');
 if(token!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i.test(token))throw new DomainError('invalid_access','Deze privétoegang is niet geldig.',403);
 const address=(request.headers.get('x-forwarded-for')??'direct').split(',').at(-1)!.trim();
 return {accountId:await actorId(request),token,ipKey:createHash('sha256').update(address).digest('hex')};
}
export async function playLimit(principal:PlayPrincipal,scope:string,max:number){
 const result=await consumeRateLimit(`play:${scope}:${principal.accountId??principal.ipKey??'direct'}`,max,60);
 if(!result.allowed)throw Object.assign(new DomainError('rate_limited',`Wacht ${result.retryAfter} seconden en probeer opnieuw.`,429),{retryAfter:result.retryAfter});
}
export async function handlePlayApi(request:NextRequest,parts:string[]):Promise<Response|null>{
 if(parts[0]!=='play')return null;
 const principal=await playPrincipal(request),method=request.method;
 if(method==='GET'){
  await playLimit(principal,'read',360);
  if(parts.length===2&&parts[1]==='boards')return playJson(await getPlayBoards(principal));
  if(parts.length===3&&parts[1]==='boards'&&id.test(parts[2]))return playJson(await getPlayBoard(parts[2],principal));
  if(parts.length===3&&parts[1]==='sessions'&&id.test(parts[2]))return playJson(await getPlaySession(principal,parts[2]));
  if(parts.length===3&&parts[1]==='challenges'&&id.test(parts[2]))return playJson(await getPlayChallenge(principal,parts[2],request.headers.get('x-dartflow-challenge-link')));
  if(parts.length===2&&parts[1]==='challenges')return playJson(await getPlayChallenges(principal));
  if(parts.length===2&&parts[1]==='policy')return playJson(await getPlayRetentionPolicy(principal));
  if(parts.length===2&&parts[1]==='advice'){if(!principal.accountId)throw new DomainError('unauthorized','Meld je aan voor persoonlijk advies.',401);return playJson(await getPlayAdvice(principal.accountId));}
  if(parts.length===2&&parts[1]==='sources'){if(!principal.accountId)throw new DomainError('unauthorized','Meld je aan om een eigen leg te kiezen.',401);return playJson(await getPlaySources(principal.accountId,request.nextUrl.searchParams.get('shared')??undefined));}
  if(parts.length===2&&parts[1]==='statistics'){
   if(!principal.accountId)throw new DomainError('unauthorized','Meld je aan om je spelstatistieken te bekijken.',401);
   const q=request.nextUrl.searchParams,filters:PlayStatisticsFilters={};
   for(const key of ['mode','source','inRule','outRule']as const)if(q.has(key))Object.assign(filters,{[key]:q.get(key)});
   if(q.has('startScore'))filters.startScore=Number(q.get('startScore'))as 301|501|701;
   return playJson(await getPlayStatistics(principal.accountId,filters));
  }
  if(parts.length===2&&parts[1]==='mine'){
   if(!principal.accountId)throw new DomainError('unauthorized','Meld je aan om je eigen partijen te bekijken.',401);
   return playJson(await getMyPlaySessions(principal.accountId));
  }
 }
 if(method==='POST'&&((parts.length===3&&parts[1]==='challenges'&&parts[2]==='actions')||(parts.length===2&&['advice','legacy-actions'].includes(parts[1])))){
  protectPlayMutation(request);const raw=await readPlayBody(request);await playLimit(principal,'challenge',30);
  if(parts[1]==='challenges')return playJson(await executeChallengeCommand(principal,raw));
  if(!principal.accountId)throw new DomainError('unauthorized','Meld je aan voor deze actie.',401);
  if(parts[1]==='advice')return playJson(await savePlayAdvice(principal.accountId,raw.action));
  return playJson(await executeLegacyPlayCommand(principal.accountId,raw as Parameters<typeof executeLegacyPlayCommand>[1]));
 }
 if(method==='POST'&&parts.length===2&&parts[1]==='actions'){
  protectPlayMutation(request);const raw=await readPlayBody(request);
  const type=(raw.action as {type?:unknown}|undefined)?.type;
  await playLimit(principal,type==='session.create'?'create':type==='session.pin'?'pin':type==='session.claim'?'claim':'write',type==='session.create'?30:type==='session.pin'?20:type==='session.claim'?20:240);
  try{return playJson(await executePlayCommand(principal,raw));}catch(error){if(error instanceof PlayRuleError)throw new DomainError(error.code,error.message,error.status);throw error;}
 }
 return null;
}
