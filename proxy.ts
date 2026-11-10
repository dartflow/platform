import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request:NextRequest) {
  let response=NextResponse.next({request});
  response.headers.set('Cache-Control','private, no-store');
  if (process.env.DARTFLOW_DATA_MODE !== 'supabase') return response;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const client=createServerClient(url,key,{
    cookieOptions:{httpOnly:true,secure:true,sameSite:'lax',path:'/'},
    cookies:{getAll:()=>request.cookies.getAll(),setAll:(changes,cacheHeaders)=>{
      changes.forEach(({name,value})=>request.cookies.set(name,value));
      response=NextResponse.next({request});
      changes.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      Object.entries(cacheHeaders || {}).forEach(([name,value])=>response.headers.set(name,value));
      response.headers.set('Cache-Control','private, no-store');
    }},
  });
  await client.auth.getClaims();
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|assets|favicon.ico|api/health|api/screen).*)']};
