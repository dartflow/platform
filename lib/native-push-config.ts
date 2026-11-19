import {createCipheriv,createDecipheriv,createHash,randomBytes,createSign} from 'node:crypto';
import {DomainError} from './domain';
import {integrationRuntime} from './integrations-core';

export const PUSH_CATEGORIES=['Sociaal','Wedstrijden','Competitie','Toernooien'] as const;
export type PushSdkConfig={projectId:'dartflow';applicationId:string;senderId:string;apiKey:string;packageName:string};
export function pushPackage(){return {production:'nl.dartflow.app',staging:'nl.dartflow.app.staging',development:'nl.dartflow.app.dev'}[integrationRuntime().environment];}
export function publicPushConfig():PushSdkConfig|null{
 try{const list=JSON.parse(process.env.DARTFLOW_FIREBASE_ANDROID_CONFIG||'[]');if(!Array.isArray(list))return null;const c=list.find(value=>value?.packageName===pushPackage());if(!c||c.projectId!=='dartflow'||!/^1:[0-9]+:android:[a-fA-F0-9]+$/.test(c.applicationId)||!/^\d{1,30}$/.test(c.senderId)||!c.applicationId.startsWith(`1:${c.senderId}:android:`)||!/^[A-Za-z0-9_-]{20,200}$/.test(c.apiKey))return null;return {projectId:'dartflow',applicationId:c.applicationId,senderId:c.senderId,apiKey:c.apiKey,packageName:pushPackage()};}catch{return null;}
}
function key(){const bytes=Buffer.from(process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY||'','base64');if(bytes.length!==32)throw new DomainError('push_configuration','Meldingen zijn nog niet ingericht.',503);return bytes;}
function aad(actor:string,installation:string){return Buffer.from(`dartflow:push:1:${integrationRuntime().environment}:${pushPackage()}:${actor}:${installation}`);}
export function encryptPushToken(token:string,actor:string,installation:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(aad(actor,installation));const data=Buffer.concat([cipher.update(token),cipher.final()]);return {v:1,iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
export function decryptPushToken(envelope:Record<string,unknown>,actor:string,installation:string){if(envelope.v!==1)throw new Error('Unsupported push token version');const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(String(envelope.iv),'base64'));decipher.setAAD(aad(actor,installation));decipher.setAuthTag(Buffer.from(String(envelope.tag),'base64'));return Buffer.concat([decipher.update(Buffer.from(String(envelope.data),'base64')),decipher.final()]).toString();}
export const pushTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
let oauth:{token:string;expires:number}|null=null;
export function fcmCredentialsConfigured(){try{const value=JSON.parse(process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON||'null');return value?.type==='service_account'&&value.project_id==='dartflow'&&typeof value.client_email==='string'&&value.client_email.endsWith('@dartflow.iam.gserviceaccount.com')&&typeof value.private_key==='string'&&value.private_key.startsWith('-----BEGIN PRIVATE KEY-----');}catch{return false;}}
export async function fcmAccessToken(fetcher:typeof fetch=fetch):Promise<string>{
 if(oauth&&oauth.expires>Date.now()+60000)return oauth.token;
 if(!fcmCredentialsConfigured())throw new DomainError('push_configuration','De verzendkoppeling voor meldingen is nog niet ingericht.',503);
 const c=JSON.parse(process.env.DARTFLOW_FCM_SERVICE_ACCOUNT_JSON!),now=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:c.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
 const signature=createSign('RSA-SHA256').update(unsigned).end().sign(c.private_key,'base64url');
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`})});
 if(!response.ok)throw new DomainError('push_transport','De meldingenkoppeling kon niet worden geverifieerd.',503);
 const value=await response.json();if(typeof value.access_token!=='string'||value.access_token.length>16384||!Number.isFinite(value.expires_in))throw new Error('Invalid FCM OAuth response');
 oauth={token:value.access_token,expires:Date.now()+Math.min(3600,Number(value.expires_in))*1000};return oauth.token;
}
export const pushMessage=(id:string,deviceId:string,category:string,token:string)=>({message:{token,data:{id,deviceId,category},android:{priority:'HIGH',ttl:'300s',collapse_key:id}}});
