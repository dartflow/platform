import type {PoolClient} from 'pg';
import {publicIdentity,socialIdentityLabel} from './public-identity';

type Client=Pick<PoolClient,'query'>;
export const PERSON_MAIL_TEMPLATES=new Set(['friend-request','friend-accepted','room-invite','club-invite','club-request','challenge-invite','challenge-accepted','challenge-cancelled','fixture-changed','fixture-scheduled','result-disputed']);
export type MailIdentitySource={id:string;templateId:string;recipientId:string;actorId?:string|null;opponentId?:string|null};
/** IDs come from authorized domain transitions. Never recover an identity from a legacy name. */
export async function mailPublicPerson(client:Client,id:string|null|undefined){
 if(!id)return null;
 const row=(await client.query('select l.id,l.display_name as "displayName",l.username from dartflow_private.profile_labels l join dartflow_private.profiles p on p.id=l.id where l.id=$1 and p.deleted_at is null and p.deletion_requested_at is null',[id])).rows[0];
 return row?publicIdentity(row):null;
}
export async function resolveMailActorId(client:Client,event:MailIdentitySource):Promise<string|null>{
 if(event.actorId)return event.actorId;
 // Legacy social events embed the exact authorized platform command request ID.
 const match=/^platform:([0-9a-f-]{36}):(friend-request|friend-accepted|room-invite):([0-9a-f-]{36})$/i.exec(event.id);
 if(match&&match[2]===event.templateId&&match[3]===event.recipientId){
  const action={'friend-request':'friend.request','friend-accepted':'friend.accept','room-invite':'room.invite'}[match[2]];
  const actors=(await client.query('select distinct actor_id from dartflow_private.platform_audit where detail->>\'requestId\'=$1 and action=$2 and actor_id<>$3',[match[1],action,event.recipientId])).rows;
  if(actors.length===1)return actors[0].actor_id;
 }
 const challenge=/^([0-9a-f-]{36}):(challenge-invite|challenge-accepted|challenge-cancelled):([0-9a-f-]{36})$/i.exec(event.id);
 if(challenge&&challenge[2]===event.templateId&&challenge[3]===event.recipientId){
  const actions=event.templateId==='challenge-invite'?['lobby.create','board.start']:event.templateId==='challenge-accepted'?['lobby.join','board.join']:['lobby.cancel'];
  const actors=(await client.query('select distinct actor_id from dartflow_private.platform_audit where detail->>\'requestId\'=$1 and action=any($2::text[]) and actor_id<>$3',[challenge[1],actions,event.recipientId])).rows;
  if(actors.length===1)return actors[0].actor_id;
 }
 const clubInvite=/^club-invite:([0-9a-f-]{36})$/i.exec(event.id);
 if(event.templateId==='club-invite'&&clubInvite){const row=(await client.query('select invited_by from dartflow_private.club_invites where id=$1 and user_id=$2',[clubInvite[1],event.recipientId])).rows[0];return row?.invited_by??null;}
 const clubRequest=/^club-request:([0-9a-f-]{36}):reviewers$/i.exec(event.id);
 if(event.templateId==='club-request'&&clubRequest){const row=(await client.query('select user_id from dartflow_private.club_join_requests where id=$1',[clubRequest[1]])).rows[0];return row?.user_id??null;}
 return null;
}
export async function mailIdentityVariables(client:Client,event:MailIdentitySource,variables:Record<string,string>){
 const recipient=await mailPublicPerson(client,event.recipientId),actorId=await resolveMailActorId(client,event),actor=await mailPublicPerson(client,actorId),opponent=await mailPublicPerson(client,event.opponentId);
 const resolved:Record<string,string>={...variables,name:recipient?.displayName||recipient?.username||''};
 if(PERSON_MAIL_TEMPLATES.has(event.templateId)||event.actorId){resolved.actorName=actor&&(actor.displayName||actor.username)?socialIdentityLabel(actor):'';}
 if(event.opponentId)resolved.opponentName=opponent&&(opponent.displayName||opponent.username)?socialIdentityLabel(opponent):'';
 if(event.templateId==='challenge-cancelled'&&!event.opponentId)resolved.opponentName=resolved.actorName||'';
 return {variables:resolved,actorId,opponentId:event.opponentId??null,actor,recipient};
}
