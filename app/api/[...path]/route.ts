import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { actorId, isLocalRequest, LOCAL_USERS, loginLocal, logout, saveIntent, consumeIntent, supabaseServer } from '@/lib/auth';
import { appConfig, safeNext } from '@/lib/config';
import { releaseIdentity } from '@/lib/release';
import { checkDatabaseReady, getProfile, getOverview, getMatch, executeMatchCommand, executeEventCommand, getPublicSnapshot, createScreen, revokeScreen, consumeRateLimit } from '@/lib/db';
import { DomainError } from '@/lib/domain';
import type { EventAction, MatchAction } from '@/lib/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache'}});
const uuid=(value:unknown):value is string=>typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function csrf(request:NextRequest) {
  if (request.headers.get('origin') !== appConfig().origin) throw new DomainError('origin','Ververs de pagina en probeer opnieuw.',403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('origin','Ongeldige aanvraag.',403);
}
async function body(request:NextRequest):Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('content_type','JSON vereist.',415);
  const reader=request.body?.getReader();
  if (!reader) throw new DomainError('invalid_json','Ongeldige aanvraag.');
  const chunks:Uint8Array[]=[]; let size=0;
  while (true) {
    const {value,done}=await reader.read(); if (done) break;
    size+=value.byteLength;
    if (size>8192) { await reader.cancel(); throw new DomainError('too_large','Aanvraag te groot.',413); }
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
    return json({user,local:config.mode==='local',localUsers:config.mode==='local'?LOCAL_USERS:[]});
  }
  if (method==='POST' && path==='auth/local') {
    const data=await body(request); await loginLocal(String(data.userId),request);
    return json({ok:true,next:safeNext(data.next)});
  }
  if (method==='POST' && path==='auth/logout') { await logout(); return json({ok:true}); }
  if (method==='POST' && path==='auth/otp') {
    const data=await body(request); const email=String(data.email || '').trim().toLowerCase();
    if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('email','Vul een geldig e-mailadres in.');
    const client=await supabaseServer();
    await limit('otp:global',100,60); await limit(`otp:${digest(email)}`,1,60);
    await saveIntent(data.next);
    // Match all valid-address outcomes to avoid exposing pilot account membership.
    await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    (await cookies()).set('dartflow-otp-email',email,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});
    return json({ok:true,message:'Als dit adres is toegelaten, ontvang je een code.',retryAfter:60});
  }
  if (method==='POST' && path==='auth/verify') {
    const data=await body(request); const email=String(data.email || '').trim().toLowerCase(); const token=String(data.token || '');
    if (email !== (await cookies()).get('dartflow-otp-email')?.value || !/^\d{6,10}$/.test(token)) throw new DomainError('otp','De code is ongeldig of verlopen. Vraag een nieuwe code aan.');
    await limit('verify:global',1000,60); await limit(`verify:${digest(email)}`,8,600);
    const client=await supabaseServer(); const {data:verified,error}=await client.auth.verifyOtp({email,token,type:'email'});
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
    const client=await supabaseServer();
    const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${config.origin}/auth/callback`}});
    if (error || !data.url) return NextResponse.redirect(new URL('/inloggen?error=oauth',config.origin));
    return NextResponse.redirect(data.url,{headers:{'Cache-Control':'private, no-store'}});
  }
  if (method==='GET' && parts[0]==='screen' && parts.length===2) return json(await getPublicSnapshot(parts[1]));
  const actor=await requireActor(request);
  if (method==='GET' && path==='overview') {
    const clubId=request.nextUrl.searchParams.get('clubId') || undefined;
    if (clubId && !uuid(clubId)) throw new DomainError('club','Ongeldige club.');
    return json(await getOverview(actor.id,clubId));
  }
  if (parts[0]==='matches' && uuid(parts[1])) {
    if (method==='GET' && parts.length===2) return json(await getMatch(actor.id,parts[1]));
    if (method==='POST' && parts[2]==='actions' && parts.length===3) {
      const data=await body(request);
      if (!uuid(data.requestId) || !Number.isSafeInteger(data.expectedRevision) || Number(data.expectedRevision)<0 || !data.action || typeof data.action!=='object') throw new DomainError('command','Ongeldige wedstrijdactie.');
      if (data.matchId!==undefined && data.matchId!==parts[1]) throw new DomainError('match_changed','Deze actie hoort bij een andere partij. Open de oorspronkelijke wedstrijd.',409);
      return json(await executeMatchCommand(actor.id,{matchId:parts[1],requestId:data.requestId,expectedRevision:Number(data.expectedRevision),action:data.action as MatchAction}));
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
