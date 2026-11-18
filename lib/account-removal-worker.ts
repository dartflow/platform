import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';

type ClaimedJob={id:string;actor_id:string;status:'pending'|'app_erased';lease_token:string;attempts:number};
type AuthEraser=(id:string)=>Promise<void>;
/** Explicitly separate from database(): the web role cannot erase other data. */
export function privacyWorkerPool():pg.Pool{
 const raw=process.env.DARTFLOW_PRIVACY_DATABASE_URL;
 if(!raw)throw new Error('DARTFLOW_PRIVACY_DATABASE_URL ontbreekt.');
 const url=new URL(raw);
 const username=decodeURIComponent(url.username);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!/^dartflow_privacy_worker(?:\.[a-z]{20})?$/.test(username)||[...url.searchParams.keys()].some(k=>['host','user','password','port','database'].includes(k.toLowerCase())))throw new Error('De privacyworker vereist zijn eigen beperkte databaserol.');
 if(process.env.DARTFLOW_DATA_MODE==='local'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Lokale privacytests vereisen loopback.');
 return new pg.Pool({connectionString:raw,max:2,connectionTimeoutMillis:5000,application_name:'dartflow-privacy-worker'});
}

export function supabaseAuthEraser():AuthEraser{
 const origin=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_AUTH_ADMIN_KEY;
 if(!origin||!key)throw new Error('Supabase Auth adminconfiguratie voor privacyverwerking ontbreekt.');
 const target=new URL(origin);
 if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('Ongeldige Supabase Auth-origin.');
 const client=createClient(target.origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})}});
 return async id=>{
  // Hard delete also removes identities/refresh sessions. The local tombstone
  // independently rejects any still cryptographically valid access JWT.
  const {error}=await client.auth.admin.deleteUser(id,false);
  if(error&&error.status!==404&&error.code!=='user_not_found')throw new Error('auth_delete_failed');
 };
}

/** Durable lease + transactional app erasure + retryable Auth hard delete.
 * Never log request bodies, names, addresses, IDs, credentials or provider errors. */
export async function processAccountRemovalBatch(pool:pg.Pool,eraseAuth:AuthEraser,limit=5):Promise<{processed:number;retrying:number}>{
 let processed=0,retrying=0;
 for(let i=0;i<Math.max(1,Math.min(20,limit));i++){
  const token=randomUUID();
  const claimed=await pool.query<ClaimedJob>(`update dartflow_private.account_deletion_jobs j set lease_token=$1,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1
   where id=(select id from dartflow_private.account_deletion_jobs where status<>'completed' and available_at<=clock_timestamp() and(lease_until is null or lease_until<=clock_timestamp()) order by requested_at,id for update skip locked limit 1)
   returning id,actor_id,status,lease_token,attempts`,[token]);
  const job=claimed.rows[0];if(!job)break;
  try{
   if(job.status==='pending')await pool.query('select dartflow_private.erase_account_job($1,$2)',[job.id,token]);
   await eraseAuth(job.actor_id);
   const done=await pool.query("update dartflow_private.account_deletion_jobs set status='completed',completed_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null where id=$1 and lease_token=$2 and status='app_erased'",[job.id,token]);
   if(done.rowCount===1)processed++;
  }catch{
   retrying++;
   await pool.query("update dartflow_private.account_deletion_jobs set lease_token=null,lease_until=null,last_error_code='privacy_retry',available_at=clock_timestamp()+least(3600,power(2,least(attempts,10))::int)*interval '1 second' where id=$1 and lease_token=$2",[job.id,token]);
  }
 }
 return {processed,retrying};
}
