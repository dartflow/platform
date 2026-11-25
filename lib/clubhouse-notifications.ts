import type {PoolClient} from 'pg';
import {enqueueDomainMail} from './integrations-mail';
import {clubIsActiveMember} from './club-access';
import type {Client} from './platform-store';
export async function notifyClubhouse(client:Client,input:{clubId:string;actorId:string;templateId:'club-activity-update'|'club-activity-withdrawal'|'club-task-update';resourceId:string;revision:number;eventSuffix?:string;recipientIds:string[];name:string;expiresAt?:string}){
 const club=(await client.query("select state->>'name' as name from dartflow_private.platform_entities where id=$1 and kind='club'",[input.clubId])).rows[0];
 for(const recipient of [...new Set(input.recipientIds)].sort()){
  if(recipient===input.actorId||!await clubIsActiveMember(client,input.clubId,recipient))continue;
  await enqueueDomainMail(client as PoolClient,{id:`clubhouse:${input.templateId}:${input.resourceId}:${input.revision}:${input.eventSuffix??'update'}`,templateId:input.templateId,scope:`club:${input.clubId}`,recipientId:recipient,actorId:input.actorId,entityId:input.clubId,variables:{clubName:club?.name??'Je vereniging',eventName:input.name,actionUrl:`/app/clubs/${input.clubId}/${input.templateId==='club-task-update'?'taken?task':'agenda?activity'}=${input.resourceId}`},expiresAt:input.expiresAt});
 }
}
