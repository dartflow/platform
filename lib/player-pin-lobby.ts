import {createHmac} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,eventAccess} from './db';
import {validUsername} from './display-name';
import {DomainError} from './domain';
import {assertPhysicalBoardEvent} from './location-access';
import {assertBoardUnreserved,assertPlayersFree,boardLease,lockPlayingActors} from './platform-locks';
import {joinLobbyMember} from './platform-competitions';
import {blocked,entity,member,save,transaction,uuid,view,type EntityRow} from './platform-store';
import {requireScoreboardName} from './profile-name';
import {limitPlayerPinAttempts,playerPinVerifier,verifyPlayerPin,recordPlayerPinOutcome} from './player-pin';
import type {PlatformResponse} from './platform-types';

const genericFailure=()=>new DomainError('player_pin_invalid','Gebruikersnaam of spelerspincode klopt niet.',403);
const receiptFingerprint=(lobbyId:string,usernameKey:string)=>createHmac('sha256','dartflow-pin-lobby-receipt-v1').update(`${lobbyId}:${usernameKey}`).digest('hex');
async function assertLocalLobby(client:PoolClient,actor:string,row:EntityRow,options:{allowStarted?:boolean}={}):Promise<string>{
 const own=await member(client,row.id,actor);
 if(row.kind!=='lobby'||row.owner_id!==actor||own?.status!=='active'||own.role!=='owner')throw new DomainError('forbidden','Alleen de eerste speler kan een tegenstander toevoegen.',403);
 if(!['localone','localtwo'].includes(String(row.state.setup))||typeof row.state.boardId!=='string'||typeof row.state.eventId!=='string')throw new DomainError('local_lobby_required','Scan een vrije baan en open een lokale partij om een speler toe te voegen.',409);
 if(row.state.closed||row.state.discarded)throw new DomainError('board_session_expired','Deze baanopstelling is verlopen. Scan de baan opnieuw.',409);
 if(row.state.matchId){
  if(!options.allowStarted)throw new DomainError('lobby_started','Deze partij is al gestart. Vernieuw de lobby.',409);
  const {rows}=await client.query<{state:{status:string}}>('select state from dartflow_private.matches where id=$1',[row.state.matchId]);
  if(!rows.length||rows[0].state.status==='abandoned')throw new DomainError('board_session_expired','Deze baanpartij is beëindigd. Scan de baan opnieuw.',409);
  return row.state.boardId;
 }
 await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);
 await eventAccess(client,actor,row.state.eventId);
 const now=(await client.query<{now:number}>('select floor(extract(epoch from clock_timestamp())*1000)::float8 as now')).rows[0].now;
 if(Number(row.state.boardLeaseUntil??0)<=now)throw new DomainError('board_session_expired','Deze baanopstelling is verlopen. Scan de baan opnieuw.',409);
 const boardId=uuid(row.state.boardId),board=await client.query<{blocked:boolean}>('select blocked from dartflow_private.boards where id=$1 and event_id=$2 for update',[boardId,row.state.eventId]);
 if(!board.rows.length||board.rows[0].blocked||(await client.query('select 1 from dartflow_private.matches where board_id=$1',[boardId])).rowCount)throw new DomainError('board_occupied','Deze baan is niet meer beschikbaar voor deze lobby.',409);
 await assertPhysicalBoardEvent(client,boardId,row.state.eventId);
 await assertBoardUnreserved(client,boardId,row.state.eventId,row.id);
 const lease=await boardLease(client,boardId);
 if(!lease||lease.id!==row.id)throw new DomainError('board_session_expired','De baan is inmiddels aan een andere partij gekoppeld. Scan opnieuw.',409);
 return boardId;
}
/** PIN grants one match-scoped participant role; it never creates or changes an Auth session. */
export async function addLocalLobbyPlayer(actor:string,input:{requestId?:unknown;lobbyId?:unknown;expectedRevision?:unknown;username?:unknown;pin?:unknown},ipKey?:string):Promise<PlatformResponse>{
 const actorId=uuid(actor),requestId=uuid(input.requestId),lobbyId=uuid(input.lobbyId);
 // One authoritative key also covers contextual Unicode casing differences between Node and PostgreSQL.
 const usernameKey=(await database().query<{key:string}>('select dartflow_private.username_key($1) as key',[typeof input.username==='string'?input.username:''])).rows[0].key;
 const fingerprint=receiptFingerprint(lobbyId,usernameKey);
 const prior=await database().query<{fingerprint:string}>('select fingerprint from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind=$3',[actorId,requestId,'lobby-add']);
 if(prior.rows.length){
  if(prior.rows[0].fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor een andere koppeling gebruikt.',409);
  return transaction(async client=>{const row=await entity(client,lobbyId,true);await assertLocalLobby(client,actorId,row,{allowStarted:true});return {ok:true,id:row.id,...(row.state.matchId?{matchId:row.state.matchId}:{}),entity:await view(client,row,actorId)};});
 }
 // Validate owner/session before spending target limits or starting an expensive KDF.
 const replay=await transaction(async client=>{
  const row=await entity(client,lobbyId,true),receipt=await client.query<{fingerprint:string}>('select fingerprint from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind=$3',[actorId,requestId,'lobby-add']);
  if(receipt.rows.length){if(receipt.rows[0].fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor een andere koppeling gebruikt.',409);await assertLocalLobby(client,actorId,row,{allowStarted:true});return {ok:true as const,id:row.id,entity:await view(client,row,actorId)};}
  await assertLocalLobby(client,actorId,row);const count=await client.query<{n:number}>("select count(*)::int as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[lobbyId]);if(count.rows[0].n>=2)throw new DomainError('lobby_full','Deze lobby heeft al twee spelers.',409);return null;
 });
 if(replay)return replay;
 await limitPlayerPinAttempts(actorId,usernameKey,'link',ipKey);
 const {rows}=validUsername(input.username)?await database().query<{id:string}>(`select id from dartflow_private.profiles where display_name_confirmed and dartflow_private.username_key(name)=$1`,[usernameKey]):{rows:[]};
 const target=rows.length===1?rows[0].id:null,verifier=target?await playerPinVerifier(target):null;
 const verified=await verifyPlayerPin(input.pin,verifier);
 if(!verified||!target||!verifier){await recordPlayerPinOutcome(actorId,'rejected','link',target??undefined);throw genericFailure();}
 return transaction(async client=>{
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`command:${actorId}`]);
  const row=await entity(client,lobbyId,true);
  const receipt=await client.query<{fingerprint:string}>('select fingerprint from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind=$3',[actorId,requestId,'lobby-add']);
  if(receipt.rows.length){if(receipt.rows[0].fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor een andere koppeling gebruikt.',409);await assertLocalLobby(client,actorId,row,{allowStarted:true});return {ok:true,id:row.id,entity:await view(client,row,actorId)};}
  const boardId=await assertLocalLobby(client,actorId,row);
  if(input.expectedRevision!==undefined&&input.expectedRevision!==row.revision)throw new DomainError('revision_conflict','De lobby is gewijzigd. Vernieuw en probeer opnieuw.',409);
  if(target===actorId)throw new DomainError('same_player','Je kunt jouw eigen account niet op beide spelersplekken zetten.',409);
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`player-pin:${target}`]);
  const current=await playerPinVerifier(target,client);
  if(!current||current.version!==verifier.version||current.verifier!==verifier.verifier)throw genericFailure();
  if(await blocked(client,actorId,target)||(await member(client,row.id,target))?.status==='banned')throw genericFailure();
  const registration=await client.query<{status:string}>('select status from dartflow_private.platform_registrations where user_id=$1',[target]);
  if(registration.rows[0]?.status==='rejected')throw genericFailure();
  await requireScoreboardName(client,target);await requireScoreboardName(client,actorId);
  await eventAccess(client,target,row.state.eventId!);
  await lockPlayingActors(client,[actorId,target]);await assertPlayersFree(client,[actorId,target]);
  await joinLobbyMember(client,target,row,{boardId,requestId,pinAuthorizer:actorId});
  row.state.ready??={};row.state.ready[target]=true;
  await save(client,row);
  await client.query("insert into dartflow_private.player_pin_receipts(actor_id,request_id,kind,fingerprint,lobby_id,target_id) values($1,$2,'lobby-add',$3,$4,$5)",[actorId,requestId,fingerprint,lobbyId,target]);
  await client.query("insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail) values($1,$2,'player-pin.lobby-added',$3)",[actorId,lobbyId,JSON.stringify({requestId,targetId:target})]);
  return {ok:true,id:row.id,entity:await view(client,row,actorId)};
 });
}
