import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { appConfig, safeNext } from './config';

export const LOCAL_USERS = [
  {id:'00000000-0000-4000-8000-000000000001',name:'Danny Goldenbelt',role:'organizer'},
  {id:'00000000-0000-4000-8000-000000000002',name:'Michael de Groot',role:'player'},
  {id:'00000000-0000-4000-8000-000000000003',name:'Raymond van Dijk',role:'player'},
  {id:'00000000-0000-4000-8000-000000000004',name:'Speler andere club',role:'player'},
];

function localKey() {
  const dir = join(process.cwd(),'.local');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const path = join(dir,'local-session.key');
  try { writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600}); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return readFileSync(path);
}
function sign(value:string) { return createHmac('sha256',localKey()).update(value).digest('base64url'); }
export function isLocalRequest(request:NextRequest) {
  try {
    const host=request.headers.get('host');
    if (!host) return false;
    const forwarded=request.headers.get('x-forwarded-host');
    return [new URL(request.url).hostname,new URL(`http://${host}`).hostname,...(forwarded?[new URL(`http://${forwarded}`).hostname]:[])].every(hostname=>['localhost','127.0.0.1','[::1]'].includes(hostname));
  } catch { return false; }
}

export async function supabaseServer() {
  const config = appConfig();
  if (config.mode !== 'supabase') throw new Error('Supabase is niet actief.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase-configuratie ontbreekt.');
  const jar = await cookies();
  return createServerClient(url,key,{
    cookieOptions:{httpOnly:true,secure:true,sameSite:'lax',path:'/'},
    cookies:{getAll:()=>jar.getAll(),setAll:(changes)=>changes.forEach(({name,value,options})=>jar.set(name,value,options))},
  });
}

export async function actorId(request?:NextRequest):Promise<string|null> {
  const config = appConfig();
  if (config.mode === 'local') {
    if (request && !isLocalRequest(request)) return null;
    const token = (await cookies()).get('dartflow-local')?.value;
    if (!token) return null;
    const [value,signature] = token.split('.');
    if (!value || !signature) return null;
    const expected = Buffer.from(sign(value)); const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) return null;
    try {
      const data = JSON.parse(Buffer.from(value,'base64url').toString());
      if (data.exp < Date.now() || !LOCAL_USERS.some(u=>u.id === data.id)) return null;
      return data.id;
    } catch { return null; }
  }
  const client = await supabaseServer();
  const {data:claims,error} = await client.auth.getClaims();
  if (error || !claims?.claims?.sub) return null;
  // Ask Auth for the current user in addition to verifying the JWT signature.
  const {data,error:userError} = await client.auth.getUser();
  return userError ? null : data.user?.id ?? null;
}

export async function loginLocal(id:string,request:NextRequest) {
  const config = appConfig();
  if (config.mode !== 'local' || !isLocalRequest(request)) throw new Error('Lokale login niet beschikbaar.');
  if (!LOCAL_USERS.some(u=>u.id === id)) throw new Error('Onbekend testaccount.');
  const value = Buffer.from(JSON.stringify({id,exp:Date.now()+8*60*60*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  (await cookies()).set('dartflow-local',`${value}.${sign(value)}`,{httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:8*60*60});
}

export async function saveIntent(next:unknown) {
  const config = appConfig();
  (await cookies()).set('dartflow-intent',JSON.stringify({path:safeNext(next),at:Date.now()}),{httpOnly:true,secure:config.secure,sameSite:'lax',path:'/',maxAge:600});
}
export async function consumeIntent() {
  const jar = await cookies(); const value = jar.get('dartflow-intent')?.value;
  jar.delete('dartflow-intent');
  try { const data=JSON.parse(value || '{}'); const age=Date.now()-data.at; return age>=0 && age<600_000 ? safeNext(data.path) : '/'; } catch { return '/'; }
}
export async function logout() {
  if (appConfig().mode === 'supabase') await (await supabaseServer()).auth.signOut();
  const jar=await cookies(); jar.delete('dartflow-local'); jar.delete('dartflow-intent'); jar.delete('dartflow-otp-email');
}
