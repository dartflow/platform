import {NextRequest,NextResponse} from 'next/server';
import {nativePlayerCallback} from '@/lib/native-player';

export const dynamic='force-dynamic';
/** Optional explicit callback alias; capabilities use the established /auth/callback route. */
export function GET(request:NextRequest){return nativePlayerCallback(request)??NextResponse.json({code:'native_callback',error:'Open Google-login vanuit de DartFlow-app.'},{status:400,headers:{'Cache-Control':'private, no-store'}});}
