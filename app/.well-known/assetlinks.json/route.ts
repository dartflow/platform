import {NextResponse} from 'next/server';
import {appConfig} from '@/lib/config';
import {androidAppLinks} from '@/lib/android-app-links';

export const dynamic='force-dynamic';
export function GET(){
  const origin=appConfig().origin;
  const environment=origin==='https://dartflow.nl'?'production':origin==='https://staging.dartflow.nl'?'staging':'development';
  return NextResponse.json(androidAppLinks(environment),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
}
