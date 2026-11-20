import type { User } from '@supabase/supabase-js';
import { database } from './db';
import { enqueueDomainMail } from './integrations-mail';
import {normalizeDisplayName} from './display-name';
import {assertAccountActive} from './account-removal';
import {randomUUID} from 'node:crypto';
import {enqueueAuditedNotification} from './notification-audit-source';

export function verifiedProfileValues(user:Pick<User,'id'|'email'|'email_confirmed_at'|'user_metadata'>) {
  const candidate=user.user_metadata?.full_name??user.user_metadata?.name;
  const publicCandidate=user.user_metadata?.display_name;
  const name = typeof candidate==='string' ? normalizeDisplayName(candidate.replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,80) : '';
  const email = typeof user.email==='string' ? user.email.trim().toLowerCase().slice(0,254) : null;
  return {id:user.id,name:'Nieuwe speler',fullName:name||null,displayName:typeof publicCandidate==='string'?normalizeDisplayName(publicCandidate).slice(0,80)||null:null,email,emailVerified:Boolean(user.email_confirmed_at && email)};
}

/** Only call with the user returned by a verified Supabase getUser/verifyOtp response. */
export async function ensureAuthProfile(user:Pick<User,'id'|'email'|'email_confirmed_at'|'user_metadata'>) {
  await assertAccountActive(user.id);
  const value=verifiedProfileValues(user);
  const client=await database().connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`account-deletion:${value.id}`]);
    const previous=(await client.query('select id,email,email_verified from dartflow_private.profiles where id=$1 for update',[value.id])).rows[0];
    await assertAccountActive(value.id,client);
    const result=await client.query(`insert into dartflow_private.profiles(id,name,email,email_verified,full_name,display_name,display_name_confirmed,onboarding_complete) values($1,$2,$3,$4,$5,$6,false,false)
      on conflict(id) do update set email=excluded.email,email_verified=excluded.email_verified returning (xmax=0) as created`,[value.id,value.name,value.email,value.emailVerified,value.fullName,value.displayName]);
    if(result.rows[0].created && value.emailVerified)await enqueueDomainMail(client,{id:`profile:${value.id}:created`,templateId:'welcome',scope:'platform',recipientId:value.id,variables:{}});
    if(previous?.email&&value.emailVerified&&previous.email!==value.email)await enqueueAuditedNotification(client,{eventId:`account-email:${value.id}:${randomUUID()}`,templateId:'account-email-changed',actorId:value.id,recipientIds:[value.id],allowSelf:true,source:{kind:'account',accountId:value.id},href:'/app/profiel',status:'Je geverifieerde accountadres is gewijzigd.'});
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
