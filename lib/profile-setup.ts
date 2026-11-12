import {createHash} from 'node:crypto';
import {database,getProfile} from './db';
import {DomainError} from './domain';
import {normalizeDisplayName,normalizeUsername,validDisplayName,validUsername} from './display-name';
import {getPlayerPinStatus,preparePlayerPinUpdate,savePreparedPlayerPin} from './player-pin';
import {saveScoreboardName} from './profile-name';
import {uuid} from './platform-store';

/** PIN preparation/receipts remain private; generic command receipts never receive PIN fields. */
export async function completePlayerProfile(actor:string,input:Record<string,unknown>) {
 const id=uuid(actor),requestId=uuid(input.requestId);
 if(!validUsername(input.username))throw new DomainError('username','Vul een geldige, unieke gebruikersnaam in. Gebruik hoogstens één voorloop-@.');
 if(!validDisplayName(input.displayName))throw new DomainError('display_name','Vul een geldige weergavenaam in van maximaal 80 tekens.');
 const username=normalizeUsername(input.username),displayName=normalizeDisplayName(input.displayName);
 const status=await getPlayerPinStatus(id);
 const prepared=!status.pinConfigured||input.pin!==undefined?await preparePlayerPinUpdate(id,{requestId,pin:input.pin,pinConfirmation:input.pinConfirmation,mode:'initial'},{recentAuth:false}):null;
 // Only non-secret profile labels are hashed here. The PIN subsystem owns its keyed receipt.
 const fingerprint=createHash('sha256').update(JSON.stringify({username,displayName})).digest('hex');
 const client=await database().connect();
 try{
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`profile-setup:${id}`]);
  const prior=await client.query('select fingerprint from dartflow_private.profile_setup_receipts where actor_id=$1 and request_id=$2',[id,requestId]);
  if(prior.rows.length){if(prior.rows[0].fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor andere profielgegevens gebruikt. Vernieuw je profiel.',409);}
  else{
   await saveScoreboardName(client,id,username,displayName);
   if(prepared)await savePreparedPlayerPin(client,id,prepared);
   if(!(await getPlayerPinStatus(id,client)).pinConfigured)throw new DomainError('player_pin_required','Stel je spelerspincode in om je profiel af te ronden.');
   await client.query('update dartflow_private.profiles set onboarding_complete=true where id=$1',[id]);
   await client.query('insert into dartflow_private.profile_setup_receipts(actor_id,request_id,fingerprint) values($1,$2,$3)',[id,requestId,fingerprint]);
  }
  await client.query('commit');
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
 return {ok:true,user:await getProfile(id)};
}
