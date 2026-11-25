import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {DomainError} from './domain';
import {releaseBoardActivity} from './board-activity';

export const ACCOUNT_REMOVAL_CONFIRMATION='VERWIJDEREN';
export const ACCOUNT_REMOVAL_SUPPORT='info@dartflow.nl';
type QueryClient=Pick<PoolClient,'query'>;
export type AccountDeletionStatus={status:'active'|'pending'|'processing'|'completed';requestedAt?:string;completedAt?:string;supportEmail:string;reauthenticationRequired:boolean};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Check before accepting any cookie/bearer principal or refreshing its profile.
 * Auth JWTs can remain cryptographically valid after an Auth user is deleted. */
export async function assertAccountActive(actor:string,client:QueryClient=database()):Promise<void>{
 const row=(await client.query('select deletion_requested_at,deleted_at from dartflow_private.profiles where id=$1',[actor])).rows[0];
 if(row&&(row.deletion_requested_at||row.deleted_at))throw new DomainError('account_deleted','Dit account wordt verwijderd of is verwijderd. Je kunt het niet meer gebruiken. Neem voor vragen contact op met info@dartflow.nl.',403);
 const disabled=await client.query('select 1 from dartflow_private.play_review_accounts where (user_id=$1 or companion_user_id=$1) and not enabled',[actor]);
 if(disabled.rowCount)throw new DomainError('unauthorized','Deze beoordelaarstoegang is ingetrokken.',401);
}

export async function getAccountDeletionStatus(actor:string,client:QueryClient=database()):Promise<AccountDeletionStatus>{
 const row=(await client.query('select status,requested_at,completed_at from dartflow_private.account_deletion_jobs where actor_id=$1',[actor])).rows[0];
 return {status:row?.status==='completed'?'completed':row?.status==='pending'?'pending':row?'processing':'active',...(row?{requestedAt:new Date(row.requested_at).toISOString()}:{}),...(row?.completed_at?{completedAt:new Date(row.completed_at).toISOString()}:{}),supportEmail:ACCOUNT_REMOVAL_SUPPORT,reauthenticationRequired:true};
}

/** Actor comes exclusively from verified server authentication, never the body.
 * No cancellation window: a successful confirmation blocks access immediately. */
export async function requestAccountDeletion(actor:string,input:Record<string,unknown>,options:{recentAuth:boolean}){
 if(!uuid(actor)||!uuid(input.requestId))throw new DomainError('invalid_request','Gebruik een geldige aanvraag-ID.');
 if(input.confirmation!==ACCOUNT_REMOVAL_CONFIRMATION)throw new DomainError('account_deletion_confirmation','Typ VERWIJDEREN om je account en persoonsgegevens te verwijderen.');
 if(!options.recentAuth)throw new DomainError('reauth_required','Bevestig eerst opnieuw je eigen aanmelding via Google of een e-mailcode. Je verificatie mag maximaal 15 minuten oud zijn.',403);
 const client=await database().connect();
 try{
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`account-deletion:${actor}`]);
  const profile=(await client.query('select id from dartflow_private.profiles where id=$1 for update',[actor])).rows[0];
  if(!profile)throw new DomainError('account_missing','Dit account is niet beschikbaar.',404);
  const prior=(await client.query('select request_id,requested_at,status from dartflow_private.account_deletion_jobs where actor_id=$1',[actor])).rows[0];
  if(prior){
   await client.query('commit');
   return {ok:true,status:prior.status==='completed'?'completed':'pending',requestId:prior.request_id,requestedAt:new Date(prior.requested_at).toISOString()};
  }
  const sessions=await client.query<{id:string}>("select id from dartflow_private.board_activity_sessions where $1=any(actor_ids) and status='active' order by id",[actor]);
  for(const session of sessions.rows)await releaseBoardActivity(client,{sessionId:session.id,reason:'forced',actorId:actor});
  const {releaseAccountPlaySessions}=await import('./play-sessions');await releaseAccountPlaySessions(client,actor);
  const created=(await client.query('insert into dartflow_private.account_deletion_jobs(id,actor_id,request_id) values($1,$2,$3) returning requested_at',[randomUUID(),actor,input.requestId])).rows[0];
  await client.query('update dartflow_private.profiles set deletion_requested_at=clock_timestamp() where id=$1',[actor]);
  await client.query('commit');
  return {ok:true,status:'pending',requestId:input.requestId,requestedAt:new Date(created.requested_at).toISOString()};
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
