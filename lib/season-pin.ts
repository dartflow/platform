import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {validUsername} from './display-name';
import {DomainError} from './domain';
import {blocked,transaction,uuid} from './platform-store';
import {limitPlayerPinAttempts,playerPinVerifier,recordPlayerPinOutcome,verifyPlayerPin} from './player-pin';
import {assertSeasonPinParticipant} from './seasons';
import {requireScoreboardName} from './profile-name';
import type {MatchState} from './types';

type Input={requestId?:unknown;matchId?:unknown;expectedRevision?:unknown;username?:unknown;pin?:unknown};
const failure=()=>new DomainError('player_pin_invalid','Gebruikersnaam of spelerspincode klopt niet.',403);
async function currentMatch(client:PoolClient,id:string):Promise<MatchState>{
 const event=(await client.query<{event_id:string}>('select event_id from dartflow_private.matches where id=$1',[id])).rows[0];if(!event)throw new DomainError('not_found','Deze partij bestaat niet.',404);
 await client.query('select id from dartflow_private.events where id=$1 for update',[event.event_id]);
 const state=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1 for update',[id])).rows[0].state;return state;
}
/** No authentication cookie is issued. The existing writer remains the only shared score writer. */
export async function acceptSeasonPlayerPin(actor:string,input:Input,ipKey?:string):Promise<{ok:true;matchId:string;revision:number}>{
 const actorId=uuid(actor),matchId=uuid(input.matchId),requestId=uuid(input.requestId),key=(await database().query<{key:string}>('select dartflow_private.username_key($1) as key',[typeof input.username==='string'?input.username:''])).rows[0].key;
 const fingerprint=createHash('sha256').update(`season-pin:${matchId}:${key}`).digest('hex');
 const receipt=async(client:Pick<PoolClient,'query'>)=>{const r=(await client.query<{fingerprint:string;target_id:string}>('select fingerprint,target_id from dartflow_private.season_pin_receipts where actor_id=$1 and request_id=$2',[actorId,requestId])).rows[0];if(r&&r.fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor een andere koppeling gebruikt.',409);return r;};
 const prior=await receipt(database());if(prior)return transaction(async client=>{const state=await currentMatch(client,matchId);await assertSeasonPinParticipant(client,actorId,prior.target_id,state,{existingGrant:true});return {ok:true,matchId,revision:state.revision};});
 // Reject an unrelated or already-started match before spending a target's attempt budget.
 await transaction(async client=>{const match=await currentMatch(client,matchId),target=match.players.find(p=>p.id!==actorId)?.id;if(!target)throw new DomainError('official_pin_unavailable','Deze partij kan niet worden gekoppeld.',409);await assertSeasonPinParticipant(client,actorId,target,match);});
 await limitPlayerPinAttempts(actorId,key,'link',ipKey);
 const target=validUsername(input.username)?(await database().query<{id:string}>('select id from dartflow_private.profiles where display_name_confirmed and dartflow_private.username_key(name)=$1',[key])).rows[0]?.id??null:null;
 const verifier=target?await playerPinVerifier(target):null,verified=await verifyPlayerPin(input.pin,verifier);
 if(!verified||!target||!verifier){await recordPlayerPinOutcome(actorId,'rejected','official-link',target??undefined);throw failure();}
 return transaction(async client=>{
  const match=await currentMatch(client,matchId),prior=await receipt(client);if(prior){await assertSeasonPinParticipant(client,actorId,prior.target_id,match,{existingGrant:true});return {ok:true,matchId,revision:match.revision};}
  if(!match.players.some(p=>p.id===target))throw failure();
  await assertSeasonPinParticipant(client,actorId,target,match);
  if(input.expectedRevision!==undefined&&input.expectedRevision!==match.revision)throw new DomainError('revision_conflict','De partij is gewijzigd. Vernieuw en probeer opnieuw.',409);
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`player-pin:${target}`]);const current=await playerPinVerifier(target,client);
  if(!current||current.version!==verifier.version||current.verifier!==verifier.verifier||await blocked(client,actorId,target))throw failure();
  if((await client.query("select 1 from dartflow_private.platform_registrations where user_id=$1 and status in('rejected','blocked')",[target])).rowCount)throw failure();
  await requireScoreboardName(client,target);const activity=await client.query(`select 1 from dartflow_private.board_activity_sessions s join dartflow_private.board_activity_links l on l.session_id=s.id where s.source_id=$1 and l.board_id=$2 and s.status='active' and s.deadline_at>clock_timestamp() for update of s`,[match.id,match.boardId]);if(!activity.rowCount)throw new DomainError('board_session_expired','Deze baantoewijzing is verlopen. Laat de leiding de partij opnieuw oproepen.',409);
  const index=match.players.findIndex(p=>p.id===target);match.accepted[index]=true;match.revision++;if(match.accepted.every(Boolean))match.status='ready';
  await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now() where id=$1',[match.id,JSON.stringify(match),match.revision]);
  await client.query('insert into dartflow_private.season_pin_receipts(actor_id,request_id,match_id,target_id,fingerprint) values($1,$2,$3,$4,$5)',[actorId,requestId,match.id,target,fingerprint]);
  await client.query("insert into dartflow_private.platform_audit(actor_id,action,detail) values($1,'player-pin.official-accepted',$2)",[actorId,JSON.stringify({matchId,targetId:target,requestId})]);
  return {ok:true,matchId,revision:match.revision};
 });
}
