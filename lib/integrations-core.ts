import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from './db';
import { DomainError } from './domain';
import { appConfig } from './config';
import { clubPermission } from './club-access';

export type IntegrationEnvironment='development'|'staging'|'production';
export type MailMode='log'|'test'|'live';
export type CredentialKind='resend-api'|'resend-webhook';
export type Envelope={keyVersion:number;nonce:string;ciphertext:string;tag:string};
export const PROJECTS={staging:'dsnqnvbckkqpzadblshu',production:'wlrnowuownakqqgjxnbb'} as const;
export function integrationRuntime() {
 const config=appConfig();
 const environment=process.env.DARTFLOW_ENV || (config.mode==='local'?'development':'');
 if (!['development','staging','production'].includes(environment) || (config.mode==='supabase' && environment==='development')) throw new DomainError('integration_environment','De integratieomgeving is niet ingericht.',503);
 const env=environment as IntegrationEnvironment;
 const projectRef=env==='development'?'local':PROJECTS[env];
 if(config.mode==='supabase' && process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${projectRef}.supabase.co`) throw new DomainError('integration_project','De integratie hoort niet bij dit Supabase-project.',503);
 const list=(value:string|undefined)=>new Set((value||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
 const maxMode=process.env.DARTFLOW_MAIL_MAX_MODE||'log';
 if(!['log','test','live'].includes(maxMode)) throw new DomainError('mail_policy','De mailgrens is ongeldig.',503);
 return {environment:env,projectRef,origin:config.origin,allowedFrom:list(process.env.DARTFLOW_MAIL_ALLOWED_FROM),allowedReplyTo:list(process.env.DARTFLOW_MAIL_ALLOWED_REPLY_TO),testAllowlist:list(process.env.DARTFLOW_MAIL_TEST_RECIPIENTS),maxMode:maxMode as MailMode};
}
function encryptionKey() { const value=process.env.DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY||''; const key=Buffer.from(value,'base64'); if(!/^[A-Za-z0-9+/]{43}=$/.test(value)||key.length!==32) throw new DomainError('encryption_unconfigured','De beveiligde credentialopslag is nog niet ingericht.',503); return key; }
export function encryptCredential(secret:string,kind:CredentialKind):Envelope {
 const runtime=integrationRuntime(); const nonce=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',encryptionKey(),nonce);
 cipher.setAAD(Buffer.from(`dartflow:${runtime.environment}:${runtime.projectRef}:${kind}:1`));
 const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return {keyVersion:1,nonce:nonce.toString('base64'),ciphertext:encrypted.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
export function decryptCredential(envelope:Envelope,kind:CredentialKind) {
 const runtime=integrationRuntime(); if(envelope.keyVersion!==1) throw new DomainError('credential_version','De credentialversie wordt niet ondersteund.',503);
 try {const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(envelope.nonce,'base64')); decipher.setAAD(Buffer.from(`dartflow:${runtime.environment}:${runtime.projectRef}:${kind}:1`));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8');}
 catch{throw new DomainError('credential_invalid','Het beveiligde credential kon niet worden geopend.',503);}
}
export async function readCredential(kind:CredentialKind) {
 const {rows}=await database().query('select key_version,nonce,ciphertext,tag from dartflow_private.integration_credentials where environment=$1 and kind=$2',[integrationRuntime().environment,kind]);
 if(!rows.length)return null; const row=rows[0]; return decryptCredential({keyVersion:row.key_version,nonce:row.nonce,ciphertext:row.ciphertext,tag:row.tag},kind);
}
export async function storeCredential(client:PoolClient,actor:string,kind:CredentialKind,secret:string) {
 const value=encryptCredential(secret,kind);
 await client.query('insert into dartflow_private.integration_credentials(environment,kind,key_version,nonce,ciphertext,tag,changed_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(environment,kind) do update set key_version=excluded.key_version,nonce=excluded.nonce,ciphertext=excluded.ciphertext,tag=excluded.tag,changed_by=excluded.changed_by,changed_at=now()',[integrationRuntime().environment,kind,value.keyVersion,value.nonce,value.ciphertext,value.tag,actor]);
}
export async function ownerAccess(actor:string,client:PoolClient|ReturnType<typeof database>=database()) {
 const {rowCount}=await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role='owner'",[actor]);
 if(!rowCount) throw new DomainError('owner_required','Alleen de platformeigenaar beheert integraties.',403);
}
export async function mailScopeAccess(actor:string,scope:string,client:PoolClient|ReturnType<typeof database>=database()) {
 if(scope==='platform') return ownerAccess(actor,client);
 if(!/^club:[0-9a-f-]{36}$/i.test(scope))throw new DomainError('mail_scope','Ongeldige mailomgeving.');
 const platformOwner=await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role='owner'",[actor]);
 if(platformOwner.rowCount)return;
 const clubId=scope.slice(5);
 // Transactional callers retain this lock until their mail change commits.
 await client.query("select id from dartflow_private.platform_entities where id=$1 and kind='club' for share",[clubId]);
 if(!await clubPermission(client,clubId,actor,'settings.edit'))throw new DomainError('mail_forbidden','Je beheert de mail van deze vereniging niet.',403);
}
export async function integrationTransaction<T>(fn:(client:PoolClient)=>Promise<T>) { const client=await database().connect();try{await client.query('begin');const value=await fn(client);await client.query('commit');return value;}catch(error){await client.query('rollback');throw error;}finally{client.release();} }
export function exactKeys(value:Record<string,unknown>,allowed:readonly string[]) {if(Object.keys(value).some(key=>!allowed.includes(key)))throw new DomainError('unknown_field','De aanvraag bevat een onbekend veld.');}
export function emailAddress(value:unknown) {if(typeof value!=='string'||value.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))throw new DomainError('email','Vul een geldig e-mailadres in.');return value.trim().toLowerCase();}
export function textField(value:unknown,max=200) {if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000-\u001f]/.test(value))throw new DomainError('invalid_field','Controleer de ingevoerde waarde.');return value.trim();}
