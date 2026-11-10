import { NextRequest, NextResponse } from 'next/server';
import { consumeIntent, supabaseServer } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { getProfile } from '@/lib/db';

export async function GET(request:NextRequest) {
  const config=appConfig(); const code=request.nextUrl.searchParams.get('code');
  if (config.mode === 'supabase' && code) {
    try {
      const client=await supabaseServer();
      const {error}=await client.auth.exchangeCodeForSession(code);
      const {data}=await client.auth.getUser();
      if (!error && data.user && await getProfile(data.user.id).catch(()=>null)) {
        const response=NextResponse.redirect(new URL(await consumeIntent(),config.origin));
        response.headers.set('Cache-Control','private, no-store'); return response;
      }
      await client.auth.signOut();
    } catch { /* Generic recovery, never echo callback or provider credentials. */ }
  }
  await consumeIntent();
  return NextResponse.redirect(new URL('/inloggen?error=oauth',config.origin),{headers:{'Cache-Control':'private, no-store'}});
}
