import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertAccountActive,requestAccountDeletion} from '../lib/account-removal';
import {privacyWorkerPool,supabaseAuthEraser} from '../lib/account-removal-worker';

test('account deletion requires explicit confirmation and a genuinely recent authentication before querying storage',async()=>{
 const actor=randomUUID(),requestId=randomUUID();
 await assert.rejects(requestAccountDeletion(actor,{requestId,confirmation:'verwijderen'},{recentAuth:true}),{code:'account_deletion_confirmation'});
 await assert.rejects(requestAccountDeletion(actor,{requestId,confirmation:'VERWIJDEREN'},{recentAuth:false}),{code:'reauth_required'});
 await assert.rejects(requestAccountDeletion(actor,{requestId:'invalid',confirmation:'VERWIJDEREN'},{recentAuth:true}),{code:'invalid_request'});
});
test('a tombstone rejects otherwise valid Auth tokens, while an unseen signup can still create its profile',async()=>{
 for(const row of [{deletion_requested_at:new Date(),deleted_at:null},{deletion_requested_at:null,deleted_at:new Date()}]){
  await assert.rejects(assertAccountActive(randomUUID(),{query:async()=>({rows:[row]})} as never),{code:'account_deleted',status:403});
 }
 await assertAccountActive(randomUUID(),{query:async()=>({rows:[]})} as never);
 await assertAccountActive(randomUUID(),{query:async()=>({rows:[{deleted_at:null,deletion_requested_at:null}]})} as never);
});
test('privacy worker configuration refuses the normal runtime role and insecure Auth origins',()=>{
 const before=process.env.DARTFLOW_PRIVACY_DATABASE_URL,url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_AUTH_ADMIN_KEY;
 try{
  process.env.DARTFLOW_PRIVACY_DATABASE_URL='postgresql://dartflow_app:synthetic@127.0.0.1/test';assert.throws(privacyWorkerPool,/eigen beperkte/);
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://localhost:8000';process.env.SUPABASE_AUTH_ADMIN_KEY='synthetic-not-a-real-key';assert.throws(supabaseAuthEraser,/Auth-origin/);
 }finally{
  for(const[k,v]of [['DARTFLOW_PRIVACY_DATABASE_URL',before],['NEXT_PUBLIC_SUPABASE_URL',url],['SUPABASE_AUTH_ADMIN_KEY',key]])if(v===undefined)delete process.env[k!];else process.env[k!]=v;
 }
});
