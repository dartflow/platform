import { NextRequest, NextResponse } from 'next/server';
import { createGoogleAttempt, GOOGLE_ATTEMPT_COOKIE } from '@/lib/google-proof';
import { googleSignInOptions,hasRecentVerifiedAuthentication } from '@/lib/reauth';
import { googleConfigurationRevision } from '@/lib/integrations';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { actorId, isLocalRequest, LOCAL_USERS, loginLocal, logout, saveIntent, consumeIntent, supabaseServer } from '@/lib/auth';
import { appConfig, safeNext } from '@/lib/config';
import { releaseIdentity } from '@/lib/release';
import { database, checkDatabaseReady, getProfile, getOverview, getMatch, getMatchInvitation, getBoardForActor, executeMatchCommand, executeEventCommand, getPublicSnapshot, createScreen, revokeScreen, consumeRateLimit } from '@/lib/db';
import { DomainError } from '@/lib/domain';
import type { EventAction, MatchAction } from '@/lib/types';
import { ensureAuthProfile } from '@/lib/accounts';
import { handleIntegrationPublic, handleIntegrations, workerTokenMatches } from '@/lib/integrations';
import { getPlatformOverview, executePlatformCommand, getPlatformMessages, getMatchSignals, sendMatchSignal, reconcilePlatformResults, reconcilePlatformCalls, getPlatformCast, getPlatformStatistics, exportPlatformCsv, replayMatchCommands, getMatchChat, sendMatchChat } from '@/lib/platform';
import { mediaConfiguration } from '@/lib/media';
import { getClubBoardScreen } from '@/lib/club-boards';
import {getCommunityFeed,getCommunityChat} from '@/lib/community';
import {getLocationOverview} from '@/lib/locations';
import {requiresDisplayName} from '@/lib/display-name';
import {invitationAttemptRequired} from '@/lib/invitations';
import {BOARD_SCREEN_COOKIE,boardScreenCookiePath,getBoardScreen,listBoardScreenDevices,createBoardScreenDevice,revokeBoardScreenDevice,pairBoardScreenDevice,heartbeatBoardScreen,setBoardScreenPreferences} from '@/lib/board-screens';
import {extendBoardActivity,processBoardActivityBatch,publicBoardActivity} from '@/lib/board-activity';
import {completePlayerProfile} from '@/lib/profile-setup';
import {updatePlayerPin} from '@/lib/player-pin';
import {addLocalLobbyPlayer} from '@/lib/player-pin-lobby';
import {getPlayerStatistics} from '@/lib/player-statistics-db';
import {getPlayerExperience,updatePlayerExperience} from '@/lib/player-experience';
import {getSeasons,getSeason,executeSeasonCommand,exportSeason} from '@/lib/seasons';
import type {SeasonCommand} from '@/lib/seasons-types';
import {acceptSeasonPlayerPin} from '@/lib/season-pin';
import {seasonCalendar} from '@/lib/season-calendar';
import {getFeedState,getFeedResult,executeFeedAction,getFeedReplies} from '@/lib/feed';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache'}});
const uuid=(value:unknown):value is string=>typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function csrf(request:NextRequest) {
  if (request.headers.get('origin') !== appConfig().origin) throw new DomainError('origin','Ververs de pagina en probeer opnieuw.',403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('origin','Ongeldige aanvraag.',403);
}
async function body(request:NextRequest,maxBytes=8192):Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('content_type','JSON vereist.',415);
  const reader=request.body?.getReader();
  if (!reader) throw new DomainError('invalid_json','Ongeldige aanvraag.');
  const chunks:Uint8Array[]=[]; let size=0;
  while (true) {
    const {value,done}=await reader.read(); if (done) break;
    size+=value.byteLength;
    if (size>maxBytes) { await reader.cancel(); throw new DomainError('too_large','Aanvraag te groot.',413); }
    chunks.push(value);
  }
  const text=Buffer.concat(chunks).toString('utf8');
  try { const data=JSON.parse(text); if (data && typeof data==='object' && !Array.isArray(data)) return data; } catch { /* invalid JSON */ }
  throw new DomainError('invalid_json','Ongeldige aanvraag.');
}
async function requireActor(request:NextRequest) {
  const id=await actorId(request);
  if (!id) throw new DomainError('unauthorized','Log in om verder te gaan.',401);
  const profile=await getProfile(id);
  if (!profile) throw new DomainError('not_enrolled','Dit account is niet toegelaten tot de pilot.',403);
  return {id,profile};
}
async function limit(key:string,max:number,seconds:number) {
  const result=await consumeRateLimit(key,max,seconds);
  if (!result.allowed) throw Object.assign(new DomainError('rate_limited',`Wacht ${result.retryAfter} seconden en probeer opnieuw.`,429),{retryAfter:result.retryAfter});
}

async function handle(request:NextRequest,parts:string[],method:string) {
  const path=parts.join('/');
  if(appConfig().mode==='local' && !isLocalRequest(request)) throw new DomainError('local_only','Deze testomgeving is alleen lokaal bereikbaar.',403);
  if (path==='mail/process') {
    const host=request.headers.get('host') || '';
    const forwarded=(request.headers.get('x-forwarded-for') || '').split(',').map(value=>value.trim()).filter(Boolean);
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || forwarded.some(value=>!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value))) throw new DomainError('forbidden','Geen toegang.',403);
    if(method==='POST' && workerTokenMatches(request)) {
      await processBoardActivityBatch();
      await reconcilePlatformResults();
      await reconcilePlatformCalls();
    }
  }
  const integrationPublic=await handleIntegrationPublic(request,parts);
  if(integrationPublic)return integrationPublic;
  if (method!=='GET') csrf(request);
  if (method==='GET' && path==='health') {
    const config=appConfig();
    return json({status:'ok',mode:config.mode,...releaseIdentity()});
  }
  if (method==='GET' && path==='ready') {
    // A real query verifies runtime connectivity. Auth readiness is separately measured.
    const readiness=await checkDatabaseReady();
    if (!readiness.ready) return json({status:'unavailable',database:'schema_mismatch'},503);
    const config=appConfig();
    let auth='local-only';
    if (config.mode==='supabase') {
      const target=new URL('/auth/v1/health',process.env.NEXT_PUBLIC_SUPABASE_URL!);
      const response=await fetch(target,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},signal:AbortSignal.timeout(5000),cache:'no-store'});
      if (!response.ok) return json({status:'unavailable',database:'ok',auth:'unavailable'},503);
      auth='reachable';
    }
    return json({status:'ready',database:'ok',schemaVersion:readiness.schemaVersion,auth,...releaseIdentity()});
  }
  if (method==='GET' && path==='session') {
    const config=appConfig(); const id=await actorId(request); const user=id ? await getProfile(id) : null;
    const canManagePlatform=id?Boolean((await database().query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[id])).rowCount):false;
    return json({user,requiresDisplayName:user?requiresDisplayName(user):false,requiresProfileCompletion:user?user.onboardingComplete===false:false,canManagePlatform,local:config.mode==='local',environment:config.mode==='local'?'development':config.origin==='https://staging.dartflow.nl'?'staging':'production',localUsers:config.mode==='local'?LOCAL_USERS:[]});
  }
  if (method==='POST' && path==='auth/local') {
    const data=await body(request); await loginLocal(String(data.userId),request);
    return json({ok:true,next:safeNext(data.next)});
  }
  if (method==='POST' && path==='auth/logout') { await logout(); return json({ok:true}); }
  if (method==='POST' && path==='auth/otp') {
    const jar=await cookies();jar.delete(GOOGLE_ATTEMPT_COOKIE);jar.delete('dartflow-oauth-provider');
    const data=await body(request); const email=String(data.email || '').trim().toLowerCase();
    if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('email','Vul een geldig e-mailadres in.');
    const client=await supabaseServer();
    await limit('otp:global',100,60); await limit(`otp:${digest(email)}`,1,60);
    await saveIntent(data.next);
    // Match all valid-address outcomes to avoid exposing pilot account membership.
    await client.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
    (await cookies()).set('dartflow-otp-email',email,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});
    return json({ok:true,message:'Als dit adres is toegelaten, ontvang je een code.',retryAfter:60});
  }
  if (method==='POST' && path==='auth/verify') {
    const data=await body(request); const email=String(data.email || '').trim().toLowerCase(); const token=String(data.token || '');
    if (email !== (await cookies()).get('dartflow-otp-email')?.value || !/^\d{6,10}$/.test(token)) throw new DomainError('otp','De code is ongeldig of verlopen. Vraag een nieuwe code aan.');
    await limit('verify:global',1000,60); await limit(`verify:${digest(email)}`,8,600);
    const client=await supabaseServer(); const {data:verified,error}=await client.auth.verifyOtp({email,token,type:'email'});
    if (!error && verified.user) await ensureAuthProfile(verified.user);
    const enrolled=verified.user ? await getProfile(verified.user.id).catch(()=>null) : null;
    if (error || !verified.user || !enrolled) {
      if (verified.user) await client.auth.signOut();
      throw new DomainError('otp','De code is ongeldig of verlopen. Vraag een nieuwe code aan.');
    }
    (await cookies()).delete('dartflow-otp-email');
    return json({ok:true,next:await consumeIntent()});
  }
  if (method==='GET' && path==='auth/google') {
    const config=appConfig();
    await limit('oauth:global',100,60);
    await saveIntent(request.nextUrl.searchParams.get('next'));
    const jar=await cookies();jar.delete(GOOGLE_ATTEMPT_COOKIE);jar.delete('dartflow-oauth-provider');
    let proofAttempt:string|null=null;
    try{proofAttempt=createGoogleAttempt(await googleConfigurationRevision());}catch{/* Optional proof setup never disables a working provider login. */}
    const client=await supabaseServer();
    const {data,error}=await client.auth.signInWithOAuth(googleSignInOptions(config.origin,request.nextUrl.searchParams.get('reauth')));
    if (error || !data.url) return NextResponse.redirect(new URL('/inloggen?error=oauth',config.origin),{headers:{'Cache-Control':'private, no-store'}});
    if(proofAttempt)jar.set(GOOGLE_ATTEMPT_COOKIE,proofAttempt,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});
    return NextResponse.redirect(data.url,{headers:{'Cache-Control':'private, no-store'}});
  }
  if (method==='GET' && parts[0]==='screen' && parts.length===2) return json(await getPublicSnapshot(parts[1]));
  if(parts[0]==='board-screens' && uuid(parts[1])){
    if(parts[1]!==parts[1].toLowerCase()){
      const canonical=new URL(request.url);canonical.pathname=canonical.pathname.replace(parts[1],parts[1].toLowerCase());
      return NextResponse.redirect(canonical,308);
    }
    // A fixed display always uses its independent device credential, never a player session.
    if(method==='GET' && parts.length===2)return json(await getBoardScreen(parts[1],request.cookies.get(BOARD_SCREEN_COOKIE)?.value));
    if(method==='POST'&&parts.length===3&&parts[2]==='heartbeat')return json(await heartbeatBoardScreen(parts[1],request.cookies.get(BOARD_SCREEN_COOKIE)?.value));
    if(method==='POST'&&parts.length===3&&parts[2]==='continue'){
      const data=await body(request);
      if(!uuid(data.sessionId)||!uuid(data.warningEpoch)||!uuid(data.requestId))throw new DomainError('invalid_command','Ververs de baanstatus en probeer opnieuw.');
      const activity=await extendBoardActivity(null,{sessionId:data.sessionId,warningEpoch:data.warningEpoch,requestId:data.requestId,boardId:parts[1],deviceToken:request.cookies.get(BOARD_SCREEN_COOKIE)?.value});
      return json({activity:publicBoardActivity(activity,activity.canExtend)});
    }
    if(method==='POST' && parts.length===3 && parts[2]==='pair'){
      const address=(request.headers.get('x-forwarded-for')||'loopback').split(',').at(-1)!.trim();
      await limit(`board-screen-pair:ip:${digest(address)}`,40,60);
      const data=await body(request);const paired=await pairBoardScreenDevice(parts[1],data.code);
      const response=json({ok:true});
      response.cookies.set(BOARD_SCREEN_COOKIE,paired.token,{httpOnly:true,secure:appConfig().secure,sameSite:'strict',path:boardScreenCookiePath(parts[1]),maxAge:paired.maxAge});
      return response;
    }
  }
  if (method==='GET' && parts[0]==='club-boards' && uuid(parts[1]) && parts[2]==='screen' && parts.length===3) return json(await getClubBoardScreen(parts[1]));
  if (method==='GET' && parts[0]==='platform' && parts[1]==='cast' && parts.length===3) return json(await getPlatformCast(parts[2]));
  if(method==='GET'&&parts[0]==='feed'&&parts[1]==='result'&&parts.length===3)return json(await getFeedResult(await actorId(request),parts[2]));
  const actor=await requireActor(request);
  if(method==='GET'&&path==='feed'){const q=request.nextUrl.searchParams;return json(await getFeedState(actor.id,{mode:q.get('mode')==='discover'?'discover':'mine',filter:q.get('filter')??'all',channel:q.get('channel')??undefined,cursor:q.get('cursor')??undefined}));}
  if(method==='POST'&&path==='feed/actions')return json(await executeFeedAction(actor.id,await body(request,16384)));
  if(method==='GET'&&parts[0]==='feed'&&parts[1]==='replies'&&parts.length===3)return json(await getFeedReplies(actor.id,parts[2],request.nextUrl.searchParams.get('cursor')??undefined));
  if(method==='GET'&&path==='player-experience')return json(await getPlayerExperience(actor.id));
  if(method==='POST'&&path==='player-experience')return json(await updatePlayerExperience(actor.id,await body(request)));
  if(method==='GET'&&path==='seasons')return json(await getSeasons(actor.id));
  if(method==='POST'&&['seasons','seasons/actions'].includes(path))return json(await executeSeasonCommand(actor.id,await body(request,196608) as SeasonCommand));
  if(method==='POST'&&path==='seasons/player-pin'){const input=await body(request);const address=(request.headers.get('x-forwarded-for')||'loopback').split(',').at(-1)!.trim();return json(await acceptSeasonPlayerPin(actor.id,input,digest(address)));}
  if(method==='GET'&&parts[0]==='seasons'&&uuid(parts[1])&&parts.length===2)return json(await getSeason(actor.id,parts[1]));
  if(method==='GET'&&parts[0]==='seasons'&&uuid(parts[1])&&parts[2]==='calendar.ics'&&parts.length===3){const {season}=await getSeason(actor.id,parts[1]);return new NextResponse(seasonCalendar(season,appConfig().origin),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="dartflow-programma.ics"','Cache-Control':'private, no-store'}});}
  if(method==='GET'&&parts[0]==='seasons'&&uuid(parts[1])&&parts[2]==='export'&&parts.length===3){const result=await exportSeason(actor.id,parts[1]);return new NextResponse(result.csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="dartflow-seizoen.csv"','Cache-Control':'private, no-store'}});}
  if(method==='GET'&&path==='profile')return json({user:actor.profile});
  if(method==='POST'&&path==='profile/complete')return json(await completePlayerProfile(actor.id,await body(request)));
  if(method==='POST'&&path==='profile/player-pin'){
    const data=await body(request);
    let recentAuth=appConfig().mode==='local'&&isLocalRequest(request);
    if(!recentAuth){const {data:verified,error}=await (await supabaseServer()).auth.getClaims();recentAuth=!error&&hasRecentVerifiedAuthentication(actor.id,verified?.claims);}
    return json(await updatePlayerPin(actor.id,{requestId:data.requestId,pin:data.pin,pinConfirmation:data.pinConfirmation,currentPin:data.currentPin,mode:data.mode},{recentAuth}));
  }
  if(method==='POST'&&path==='player-pin/lobby-add'){
    const data=await body(request);
    const address=(request.headers.get('x-forwarded-for')||'loopback').split(',').at(-1)!.trim();
    return json(await addLocalLobbyPlayer(actor.id,{requestId:data.requestId,lobbyId:data.lobbyId,expectedRevision:data.expectedRevision,username:data.username,pin:data.pin},digest(address)));
  }
  if(method==='GET'&&path==='player-statistics'){
    const q=request.nextUrl.searchParams;
    return json(await getPlayerStatistics(actor.id,{limit:25,startScore:q.has('startScore')?Number(q.get('startScore')) as 301|501|701:undefined,offset:Number(q.get('offset')||0),opponent:q.get('opponent')||undefined,search:q.get('search')||undefined,opponentOffset:Number(q.get('opponentOffset')||0),practiceOffset:Number(q.get('practiceOffset')||0)}));
  }
  if(method==='POST'&&path==='board-activity/continue'){
    const data=await body(request);
    if(!uuid(data.sessionId)||!uuid(data.warningEpoch)||!uuid(data.requestId))throw new DomainError('invalid_command','Ververs de baanstatus en probeer opnieuw.');
    return json({activity:await extendBoardActivity(actor.id,{sessionId:data.sessionId,warningEpoch:data.warningEpoch,requestId:data.requestId})});
  }
  const integration=await handleIntegrations(request,actor.id,parts);
  if(integration)return integration;
  if(method==='GET' && parts[0]==='media' && uuid(parts[1]) && parts.length===2) return json(await mediaConfiguration(actor.id,parts[1]));
  if(method==='GET' && parts[0]==='boards' && uuid(parts[1]) && parts.length===2)return json(await getBoardForActor(actor.id,parts[1]));
  if(method==='POST'&&parts[0]==='boards'&&uuid(parts[1])&&parts[2]==='screen-preferences'&&parts.length===3)return json(await setBoardScreenPreferences(actor.id,parts[1],await body(request)));
  if(parts[0]==='boards' && uuid(parts[1]) && parts[2]==='screen-devices'){
    if(method==='GET'&&parts.length===3)return json(await listBoardScreenDevices(actor.id,parts[1]));
    if(method==='POST'&&parts.length===3)return json(await createBoardScreenDevice(actor.id,parts[1],(await body(request)).name));
    if(method==='DELETE'&&parts.length===4&&uuid(parts[3])){await revokeBoardScreenDevice(actor.id,parts[1],parts[3]);return json({ok:true});}
  }
  if(method==='GET' && path==='platform')return json(await getPlatformOverview(actor.id));
  if(method==='GET' && path==='locations')return json(await getLocationOverview(actor.id));
  if(method==='GET' && path==='community/feed')return json(await getCommunityFeed(actor.id,{kind:request.nextUrl.searchParams.get('kind')||'my',id:request.nextUrl.searchParams.get('id'),cursor:request.nextUrl.searchParams.get('cursor'),parentId:request.nextUrl.searchParams.get('parentId')}));
  if(method==='GET' && parts[0]==='community'&&parts[1]==='chat'&&parts.length===4)return json(await getCommunityChat(actor.id,parts[2],parts[3],Number(request.nextUrl.searchParams.get('after')||'0')));
  if(method==='POST' && path==='platform/actions'){
    const input=await body(request,196608);
    if(input.action&&typeof input.action==='object'&&!Array.isArray(input.action)&&invitationAttemptRequired(input.action as Record<string,unknown>)){
      // Caddy overwrites the forwarding header on the loopback-only app listener.
      const address=(request.headers.get('x-forwarded-for')||'loopback').split(',').at(-1)!.trim();
      await limit(`invite:ip:${digest(address)}`,20,60);
    }
    return json(await executePlatformCommand(actor.id,input));
  }
  if(method==='GET' && path==='platform/statistics')return json(await getPlatformStatistics(actor.id));
  if(method==='GET' && parts[0]==='platform' && parts[1]==='export' && parts.length===3){
    const csv=await exportPlatformCsv(actor.id,parts[2],request.nextUrl.searchParams.get('clubId') || undefined);
    return new NextResponse(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="dartflow-export.csv"','Cache-Control':'private, no-store'}});
  }
  if(parts[0]==='platform' && parts[1]==='matches' && uuid(parts[2]) && parts.length===4){
    if(parts[3]==='replay' && method==='POST'){
      const input=await body(request,65536);
      if(input.matchId!==undefined && input.matchId!==parts[2])throw new DomainError('match_changed','Deze wachtrij hoort bij een andere partij.',409);
      return json(await replayMatchCommands(actor.id,{...input,matchId:parts[2]}));
    }
    if(parts[3]==='chat' && method==='GET')return json(await getMatchChat(actor.id,parts[2]));
    if(parts[3]==='chat' && method==='POST')return json(await sendMatchChat(actor.id,parts[2],await body(request)));
  }
  if(parts[0]==='platform' && parts[1]==='rooms' && uuid(parts[2]) && parts[3]==='messages' && parts.length===4 && method==='GET')return json(await getPlatformMessages(actor.id,parts[2]));
  if(parts[0]==='platform' && parts[1]==='matches' && uuid(parts[2]) && parts[3]==='signals' && parts.length===4){
    if(method==='GET')return json(await getMatchSignals(actor.id,parts[2],Number(request.nextUrl.searchParams.get('after') || '0')));
    if(method==='POST')return json(await sendMatchSignal(actor.id,parts[2],await body(request,65536)));
  }
  if (method==='GET' && path==='overview') {
    const clubId=request.nextUrl.searchParams.get('clubId') || undefined;
    if (clubId && !uuid(clubId)) throw new DomainError('club','Ongeldige club.');
    return json(await getOverview(actor.id,clubId));
  }
  if (parts[0]==='matches' && uuid(parts[1])) {
    if (method==='GET' && parts.length===2) return json(await getMatch(actor.id,parts[1]));
    if (method==='GET' && parts.length===3 && parts[2]==='invitation')return json({invitation:await getMatchInvitation(actor.id,parts[1])});
    if (method==='POST' && parts[2]==='actions' && parts.length===3) {
      const data=await body(request);
      if (!uuid(data.requestId) || !Number.isSafeInteger(data.expectedRevision) || Number(data.expectedRevision)<0 || !data.action || typeof data.action!=='object') throw new DomainError('command','Ongeldige wedstrijdactie.');
      if (data.matchId!==undefined && data.matchId!==parts[1]) throw new DomainError('match_changed','Deze actie hoort bij een andere partij. Open de oorspronkelijke wedstrijd.',409);
      const result=await executeMatchCommand(actor.id,{matchId:parts[1],requestId:data.requestId,expectedRevision:Number(data.expectedRevision),action:data.action as MatchAction});
      await reconcilePlatformResults();
      return json(result);
    }
  }
  if (method==='POST' && parts[0]==='events' && uuid(parts[1]) && parts[2]==='actions' && parts.length===3) return json(await executeEventCommand(actor.id,parts[1],await body(request) as EventAction));
  if (method==='POST' && path==='screens') {
    const data=await body(request);
    if (!uuid(data.eventId) || !uuid(data.boardId)) throw new DomainError('screen','Ongeldige schermkoppeling.');
    return json(await createScreen(actor.id,data.eventId,data.boardId));
  }
  if (method==='DELETE' && parts[0]==='screens' && uuid(parts[1]) && parts.length===2) { await revokeScreen(actor.id,parts[1]); return json({ok:true}); }
  return json({error:'Niet gevonden.',code:'not_found'},404);
}
type Context={params:Promise<{path:string[]}>};
async function route(request:NextRequest,context:Context) {
  try { return await handle(request,(await context.params).path,request.method); }
  catch (error) {
    if (error instanceof DomainError) {
      const retryAfter='retryAfter' in error ? Number(error.retryAfter) : undefined;
      const response=json({error:error.message,code:error.code,...(retryAfter?{retryAfter}:{})},error.status);
      if (error.status===429) response.headers.set('Retry-After',String(retryAfter || 60));
      return response;
    }
    // Database URLs, SQL details, tokens and provider errors never leave this boundary.
    return json({error:'De server is tijdelijk niet beschikbaar. Probeer opnieuw.',code:'unavailable'},503);
  }
}
export const GET=route;
export const POST=route;
export const DELETE=route;
export const PATCH=route;
