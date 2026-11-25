import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import type {MatchState} from './types';
import type {SeasonState} from './seasons-types';
import {clubIsActiveMember,clubPermission} from './club-access';
import {locationManager,canOrganizeReservedEvent} from './location-access';
import {blocked,entity,requireAccess,type Client} from './platform-store';

export type AuditNotificationSource=
 |{kind:'account';accountId:string}
 |{kind:'reservation';reservationId:string;revision:number}
 |{kind:'match';matchId:string;phase:'ready'|'started';callRef:string|null;readyPlayerId?:string}
 |{kind:'lobby-ready';lobbyId:string;readyPlayerId:string}
 |{kind:'season-fixture';seasonId:string;fixtureId:string;status:string;checkedInPlayerId?:string}
 |{kind:'season-participant';seasonId:string;playerId:string;status:string}
 |{kind:'chat-message';store:'community'|'room';messageId:string}
 |{kind:'moderation';reportId:string;view:'reviewer'|'reporter'|'subject'}
 |{kind:'club-member';clubId:string;playerId:string}
 |{kind:'club-activity';activityId:string;clubId:string}
 |{kind:'ownership-offer';transferId:string}
 |{kind:'club-membership-status';clubId:string;playerId:string;status:string}
 |{kind:'location-role';locationId:string;playerId:string;manager:boolean};

/** Resolve current source and scope for every channel and tap, not copied labels. */
export async function auditNotificationApplicable(client:Pick<PoolClient,'query'>,recipient:string,source:AuditNotificationSource):Promise<boolean>{
 if(!(await client.query('select 1 from dartflow_private.profiles where id=$1 and deletion_requested_at is null and deleted_at is null',[recipient])).rowCount)return false;
 try{
  if(source.kind==='account')return source.accountId===recipient;
  if(source.kind==='location-role')return source.playerId===recipient&&Boolean((await client.query('select 1 from dartflow_private.locations where id=$1',[source.locationId])).rowCount)&&await locationManager(client,recipient,source.locationId)===source.manager;
  if(source.kind==='ownership-offer'){
   const offer=(await client.query("select t.* from dartflow_private.club_ownership_transfers t join dartflow_private.platform_entities e on e.id=t.club_id and e.owner_id=t.owner_id where t.id=$1 and t.recipient_id=$2 and t.status='pending' and t.expires_at>now()",[source.transferId,recipient])).rows[0];return Boolean(offer)&&await clubIsActiveMember(client,offer.club_id,recipient);
  }
  if(source.kind==='club-membership-status')return source.playerId===recipient&&Boolean((await client.query('select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status=$3',[source.clubId,recipient,source.status])).rowCount);
  if(source.kind==='club-member')return source.playerId===recipient&&await clubIsActiveMember(client,source.clubId,recipient);
  if(source.kind==='club-activity')return await clubIsActiveMember(client,source.clubId,recipient)&&Boolean((await client.query("select 1 from dartflow_private.club_activities a join dartflow_private.club_activity_entries e on e.activity_id=a.id where a.id=$1 and a.club_id=$2 and e.user_id=$3 and e.status='registered' and a.ends_at>now()",[source.activityId,source.clubId,recipient])).rowCount);
  if(source.kind==='reservation'){
   const row=(await client.query('select * from dartflow_private.board_reservations where id=$1',[source.reservationId])).rows[0];if(!row||row.revision!==source.revision)return false;
   return await locationManager(client,recipient,row.location_id)||await canOrganizeReservedEvent(client,recipient,row.event_id);
  }
  if(source.kind==='match'){
   const state=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[source.matchId])).rows[0]?.state;if(!state||(state.callRef??null)!==source.callRef||!state.players.some(p=>p.id===recipient))return false;
   const {eventAccess}=await import('./db');await eventAccess(client,recipient,state.eventId);
   if(source.phase==='started')return state.status==='live';
   const index=state.players.findIndex(p=>p.id===source.readyPlayerId);return ['called','ready'].includes(state.status)&&index>=0&&state.accepted[index]===true;
  }
  if(source.kind==='lobby-ready'){
   const lobby=await entity(client,source.lobbyId);if(lobby.kind!=='lobby'||lobby.state.closed||lobby.state.matchId||lobby.state.ready?.[source.readyPlayerId]!==true)return false;await requireAccess(client,lobby,recipient);return Boolean((await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status='active'",[lobby.id,recipient])).rowCount);
  }
  if(source.kind==='season-fixture'||source.kind==='season-participant'){
   const s=(await client.query<{state:SeasonState}>('select state from dartflow_private.competition_seasons where id=$1',[source.seasonId])).rows[0]?.state;if(!s)return false;
   if(source.kind==='season-participant'){const p=s.participants.find(p=>p.id===source.playerId);return recipient===source.playerId&&Boolean(p&&p.status===source.status)&&(!s.clubId||await clubIsActiveMember(client,s.clubId,recipient));}
   const f=s.fixtures.find(f=>f.id===source.fixtureId);if(!f||f.status!==source.status||source.checkedInPlayerId&&!f.checkIns.includes(source.checkedInPlayerId))return false;
   const {seasonMailRecipients}=await import('./season-reminders');return(await seasonMailRecipients(client,s,f,true)).includes(recipient);
  }
  if(source.kind==='chat-message'){
   const table=source.store==='community'?'community_messages':'platform_messages',message=(await client.query(`select * from dartflow_private.${table} where id=$1 and not deleted`,[source.messageId])).rows[0];if(!message||message.author_id===recipient||await blocked(client,recipient,message.author_id))return false;
   if(source.store==='community'){if(message.scope_kind!=='match')return false;const {communityScope}=await import('./community');await communityScope(client,recipient,'match',message.scope_id);return true;}
   const room=await entity(client,message.room_id);if(room.visibility!=='private'||room.state.closed)return false;await requireAccess(client,room,recipient);const members=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active'",[room.id]);return members.rows.length===2&&members.rows.some(p=>p.user_id===recipient);
  }
  if(source.kind==='moderation'){
   const report=(await client.query('select * from dartflow_private.platform_reports where id=$1',[source.reportId])).rows[0];if(!report)return false;
   if(source.view==='reporter')return report.reporter_id===recipient&&report.status==='resolved';
   if(source.view==='subject')return report.target_id===recipient&&report.status==='resolved';
   if(report.target_id===recipient||report.status==='resolved')return false;
   if((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[recipient])).rowCount)return true;
   if(report.scope_kind==='club'&&report.scope_id&&await clubPermission(client,report.scope_id,recipient,'chat.moderate'))return true;
   if(report.room_id){const room=await entity(client,report.room_id);await requireAccess(client,room,recipient,true);return true;}return false;
  }
  return false;
 }catch(error){if(error instanceof DomainError&&[403,404,409].includes(error.status))return false;throw error;}
}
export async function enqueueAuditedNotification(client:Client,input:{eventId:string;templateId:string;actorId?:string;recipientIds:string[];source:AuditNotificationSource;href:string;status?:string;variables?:Record<string,string>;allowSelf?:boolean;expiresAt?:string}){
 const {enqueueDomainMail}=await import('./integrations-mail');
 for(const recipientId of new Set(input.recipientIds)){
  if(!input.allowSelf&&recipientId===input.actorId||!await auditNotificationApplicable(client,recipientId,input.source))continue;
  await enqueueDomainMail(client as PoolClient,{id:input.eventId,templateId:input.templateId,scope:'platform',recipientId,actorId:input.actorId,notificationSource:input.source,expiresAt:input.expiresAt,variables:{status:input.status??'',roomName:'DartFlow',actorName:'Een speler',reason:'Open de beveiligde afhandeling in DartFlow voor de actuele informatie.',...input.variables,actionUrl:input.href}});
 }
}
