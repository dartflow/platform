import { NextRequest, NextResponse } from 'next/server';
import { consumeIntent, supabaseServer } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { getProfile } from '@/lib/db';
import { ensureAuthProfile } from '@/lib/accounts';
import { cookies } from 'next/headers';
import { ownerAccess } from '@/lib/integrations-core';
import { GOOGLE_ATTEMPT_COOKIE, verifyGoogleLoginProof } from '@/lib/google-proof';
import { googleConfigurationRevision, recordVerifiedGoogleLogin } from '@/lib/integrations';

export async function GET(request:NextRequest) {
  const config=appConfig(); const code=request.nextUrl.searchParams.get('code');
  const jar=await cookies(),attemptCookie=jar.get(GOOGLE_ATTEMPT_COOKIE)?.value;
  jar.delete(GOOGLE_ATTEMPT_COOKIE);jar.delete('dartflow-oauth-provider');
  if (config.mode === 'supabase' && code) {
    try {
      const client=await supabaseServer();
      const {data:exchanged,error}=await client.auth.exchangeCodeForSession(code);
      const {data}=await client.auth.getUser();
      if (!error && data.user) await ensureAuthProfile(data.user);
      if (!error && data.user && await getProfile(data.user.id).catch(()=>null)) {
        try {
          await ownerAccess(data.user.id);
          const claims=await client.auth.getClaims();
          if(!claims.error&&claims.data?.claims?.sub===data.user.id&&exchanged.user?.id===data.user.id){
            const proof=await verifyGoogleLoginProof({attemptCookie,providerToken:exchanged.session?.provider_token,user:data.user,currentRevision:await googleConfigurationRevision(),amr:claims.data.claims.amr});
            if(proof)await recordVerifiedGoogleLogin(data.user.id,'google',proof.revision);
          }
        }catch{/* Optional provider evidence never breaks an otherwise verified user login. */}
        const response=NextResponse.redirect(new URL(await consumeIntent(),config.origin));
        response.headers.set('Cache-Control','private, no-store'); return response;
      }
      await client.auth.signOut();
    } catch { /* Generic recovery, never echo callback or provider credentials. */ }
  }
  await consumeIntent();
  return NextResponse.redirect(new URL('/inloggen?error=oauth',config.origin),{headers:{'Cache-Control':'private, no-store'}});
}
