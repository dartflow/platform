import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {normalizeDisplayName,normalizeUsername,requiresDisplayName,validDisplayName,validUsername} from './display-name';
import type {MatchState} from './types';
import {database} from './db';
import {enqueueAuditedNotification} from './notification-audit-source';

export async function requireScoreboardName(client: Pick<PoolClient,'query'>, actor: string): Promise<void> {
 const {rows}=await client.query('select name,name as username,display_name_confirmed as "displayNameConfirmed",onboarding_complete from dartflow_private.profiles where id=$1',[actor]);
 if(!rows[0]||requiresDisplayName(rows[0]))throw new DomainError('display_name_required','Kies en bevestig eerst je vaste gebruikersnaam om te spelen.',409);
 if(rows[0].onboarding_complete===false)throw new DomainError('profile_incomplete','Rond eerst je gebruikersnaam, displaynaam en spelerspincode af.',409);
}
export async function usernameAvailability(actor:string,value:unknown){
 const valid=validUsername(value),username=valid?normalizeUsername(value):null;
 const {rows}=await database().query('select name,username_locked_at from dartflow_private.profiles where id=$1',[actor]);
 if(!rows.length)throw new DomainError('profile_missing','Je profiel bestaat niet.',403);
 const locked=Boolean(rows[0].username_locked_at);
 if(!valid)return{valid:false,available:false,username:null,locked,error:'Gebruik 1 tot 80 tekens, minstens één letter of cijfer en geen witruimte of onzichtbare tekens.'};
 const taken=await database().query('select 1 from dartflow_private.profiles where display_name_confirmed and dartflow_private.username_key(name)=dartflow_private.username_key($1) and id<>$2',[username,actor]);
 return{valid:true,available:!taken.rowCount&&(!locked||rows[0].name===username),username,locked,...(locked&&rows[0].name!==username?{error:'Je gebruikersnaam staat vast en kan niet worden gewijzigd.'}:{})};
}

/** Own-profile transaction. IDs and sport results remain unchanged. */
export async function saveScoreboardName(client:PoolClient,actor:string,value:unknown,displayValue?:unknown,fullValue?:unknown):Promise<void>{
 const scope=await client.query("select distinct m.event_id from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where p.user_id=$1 and m.state->>'status'<>'confirmed' order by m.event_id",[actor]);
 for(const event of scope.rows)await client.query('select id from dartflow_private.events where id=$1 for update',[event.event_id]);
 const row=(await client.query('select name,display_name,full_name,username_locked_at,display_name_confirmed from dartflow_private.profiles where id=$1 for no key update',[actor])).rows[0];
 if(!row)throw new DomainError('profile_missing','Je profiel bestaat niet.',403);
 const supplied=value!==undefined;
 if(supplied&&!validUsername(value))throw new DomainError('display_name','Gebruik een gebruikersnaam van 1 tot 80 tekens met minstens één letter of cijfer, zonder witruimte of onzichtbare tekens.');
 const name=supplied?normalizeUsername(value):row.name;
 if(row.username_locked_at&&name!==row.name)throw new DomainError('username_locked','Je gebruikersnaam staat vast en kan niet worden gewijzigd.',409);
 if(!row.username_locked_at&&!supplied)throw new DomainError('username_required','Kies en bevestig eerst een vaste gebruikersnaam.',409);
 const displayName=displayValue===undefined?row.display_name:normalizeDisplayName(displayValue);
 if(displayValue!==undefined&&!validDisplayName(displayName))throw new DomainError('display_name','Vul een geldige displaynaam in van maximaal 80 tekens.');
 const fullName=fullValue===undefined?row.full_name:normalizeDisplayName(fullValue);
 if(fullValue!==undefined&&(fullValue!==null&&typeof fullValue!=='string'||(fullName??'').length>160||/[\p{Cc}\p{Cf}]/u.test(fullName)))throw new DomainError('full_name','Gebruik een volledige naam van maximaal 160 tekens zonder onzichtbare tekens.');
 try{await client.query('update dartflow_private.profiles set name=$2,display_name=$3,full_name=$4,display_name_confirmed=true,identity_needs_review=false where id=$1',[actor,name,displayName,fullName||null]);}
 catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23505')throw new DomainError('username_taken','Deze gebruikersnaam is al in gebruik. Kies een andere naam.',409);throw error;}
 if(row.display_name_confirmed&&(row.name!==name||row.display_name!==displayName||(row.full_name??null)!==(fullName||null))){
  const audit=(await client.query("insert into dartflow_private.platform_audit(actor_id,action,detail)values($1,'profile.identity-updated','{}')returning id::text",[actor])).rows[0].id;
  await enqueueAuditedNotification(client,{eventId:`account-profile:${actor}:${audit}`,templateId:'account-profile-changed',actorId:actor,recipientIds:[actor],allowSelf:true,source:{kind:'account',accountId:actor},href:'/app/profiel',status:'Je profielgegevens zijn gewijzigd. Open je profiel om ze te controleren.'});
 }
 const label=String((await client.query('select name from dartflow_private.profile_labels where id=$1',[actor])).rows[0].name);
 const {rows}=await client.query<{state:MatchState}>("select m.state from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where p.user_id=$1 and m.state->>'status'<>'confirmed' order by m.id for update of m",[actor]);
 for(const {state}of rows){let changed=false;for(const player of [...state.players,...(state.sideParticipants?.flat()??[])])if(player.id===actor&&player.name!==label){player.name=label;changed=true;}if(changed){state.revision++;await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now() where id=$1',[state.id,JSON.stringify(state),state.revision]);}}
}
