import type { User } from '@supabase/supabase-js';
import { database } from './db';
import { enqueueDomainMail } from './integrations-mail';
import {normalizeDisplayName} from './display-name';

export function verifiedProfileValues(user:Pick<User,'id'|'email'|'email_confirmed_at'|'user_metadata'>) {
  const candidate = user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name;
  const name = typeof candidate==='string' ? normalizeDisplayName(candidate.replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,80) : '';
  const email = typeof user.email==='string' ? user.email.trim().toLowerCase().slice(0,254) : null;
  return {id:user.id,name:name || 'Nieuwe speler',email,emailVerified:Boolean(user.email_confirmed_at && email)};
}

/** Only call with the user returned by a verified Supabase getUser/verifyOtp response. */
export async function ensureAuthProfile(user:Pick<User,'id'|'email'|'email_confirmed_at'|'user_metadata'>) {
  const value=verifiedProfileValues(user);
  const client=await database().connect();
  try {
    await client.query('begin');
    const result=await client.query(`insert into dartflow_private.profiles(id,name,email,email_verified,display_name_confirmed,onboarding_complete) values($1,$2,$3,$4,false,false)
      on conflict(id) do update set email=excluded.email,email_verified=excluded.email_verified returning (xmax=0) as created`,[value.id,value.name,value.email,value.emailVerified]);
    if(result.rows[0].created && value.emailVerified)await enqueueDomainMail(client,{id:`profile:${value.id}:created`,templateId:'welcome',scope:'platform',recipientId:value.id,variables:{name:value.name}});
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
