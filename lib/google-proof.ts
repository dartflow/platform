import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { integrationRuntime } from './integrations-core';
import { hasRecentVerifiedAuthentication } from './reauth';

export const GOOGLE_ATTEMPT_COOKIE='dartflow-google-attempt';
const MAX_AGE=600_000;
const USERINFO='https://openidconnect.googleapis.com/v1/userinfo';
export type GoogleAttempt={nonce:string;createdAt:number;revision:number;environment:string;projectRef:string};
/** Call only with claims verified by Supabase Auth, never a decoded client token or user metadata. */
export function hasFreshOtpRecoveryProof(actor:string,claims:unknown,now=Date.now()):boolean {
 return hasRecentVerifiedAuthentication(actor,claims,{now,method:'otp'});
}
function signingKey() {const value=process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY||'';const key=Buffer.from(value,'base64');if(!/^[A-Za-z0-9+/]{43}=$/.test(value)||key.length!==32)throw new Error('Google proof signing is unavailable.');return key;}
function signature(value:string) {const runtime=integrationRuntime();return createHmac('sha256',signingKey()).update(`dartflow-google-attempt:${runtime.environment}:${runtime.projectRef}:`).update(value).digest('base64url');}
export function createGoogleAttempt(revision:number,now=Date.now()) {
 if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid Google configuration revision.');const runtime=integrationRuntime();
 const attempt:GoogleAttempt={nonce:randomBytes(16).toString('base64url'),createdAt:now,revision,environment:runtime.environment,projectRef:runtime.projectRef};
 const value=Buffer.from(JSON.stringify(attempt)).toString('base64url');return `${value}.${signature(value)}`;
}
export function readGoogleAttempt(cookie:string|undefined|null,now=Date.now()):GoogleAttempt|null {
 try {if(typeof cookie!=='string'||cookie.length>700)return null;const[value,mac,...rest]=cookie.split('.');if(rest.length||!value||!mac||!/^[A-Za-z0-9_-]+$/.test(value)||!/^[A-Za-z0-9_-]{43}$/.test(mac))return null;
  const expected=Buffer.from(signature(value)),actual=Buffer.from(mac);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  const attempt=JSON.parse(Buffer.from(value,'base64url').toString('utf8')) as GoogleAttempt,runtime=integrationRuntime();
  if(!Number.isSafeInteger(attempt.createdAt)||now-attempt.createdAt<0||now-attempt.createdAt>MAX_AGE||!Number.isSafeInteger(attempt.revision)||attempt.revision<0||!/^[A-Za-z0-9_-]{22}$/.test(attempt.nonce)||attempt.environment!==runtime.environment||attempt.projectRef!==runtime.projectRef)return null;
  return attempt;
 }catch{return null;}
}
async function boundedJson(response:Response) {
 if(Number(response.headers.get('content-length')||0)>16384)throw new Error('Provider response exceeds proof limit.');const reader=response.body?.getReader();if(!reader)throw new Error('Empty proof response.');const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('Provider response exceeds proof limit.');}parts.push(value);}
 const data=JSON.parse(Buffer.concat(parts).toString('utf8'));return data&&typeof data==='object'&&!Array.isArray(data)?data:null;
}
/** Optional evidence only. Authentication and authorization remain with verified Supabase Auth. */
export async function verifyGoogleLoginProof(input:{attemptCookie:string|undefined|null;providerToken:string|undefined|null;user:Pick<User,'id'|'identities'>;currentRevision:number;amr:unknown},fetcher:typeof fetch=fetch,now=Date.now()):Promise<{revision:number}|null> {
 const attempt=readGoogleAttempt(input.attemptCookie,now);if(!attempt||attempt.revision!==input.currentRevision||typeof input.providerToken!=='string'||input.providerToken.length<8||input.providerToken.length>4096||/[\r\n]/.test(input.providerToken))return null;
 const freshOAuth=Array.isArray(input.amr)&&input.amr.some(entry=>entry&&typeof entry==='object'&&entry.method==='oauth'&&Number.isFinite(entry.timestamp)&&entry.timestamp*1000>=attempt.createdAt-5000&&entry.timestamp*1000<=now+5000);
 if(!freshOAuth)return null;
 const identities=input.user.identities?.filter(identity=>identity.provider==='google'&&identity.user_id===input.user.id)||[];if(!identities.length)return null;
 try{
  const response=await fetcher(USERINFO,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${input.providerToken}`,Accept:'application/json'}});if(!response.ok)return null;
  const data=await boundedJson(response);if(typeof data?.sub!=='string'||data.sub.length>256)return null;
  const matches=identities.some(identity=>{const providerId=typeof identity.identity_data?.sub==='string'?identity.identity_data.sub:identity.id;return providerId===data.sub;});
  return matches?{revision:attempt.revision}:null;
 }catch{return null;}
}
