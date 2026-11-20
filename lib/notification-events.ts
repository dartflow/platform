import type {PoolClient} from 'pg';
import {enqueueDomainMail} from './integrations-mail';
import {notificationUuid} from './notification-core';
export type SupportNotificationKind='support.created'|'support.received'|'support.user-replied'|'support.reopened'|'support.answered'|'support.status-changed';
export type CommunicationReference={kind:'support';ticketId:string;ticketNumber:string;recipientView:'user'|'support'}|{kind:'campaign';campaignId:string;product:'dartflow'|'oche-live';channel:'web'|'android'|'all'}|{kind:'test';messageId:string;product:'dartflow'|'oche-live';channel:'web'|'android'|'all'};
export type Communication={reference:CommunicationReference;title:string;body:string;href:string};
const supportTitles:Record<SupportNotificationKind,string>={'support.created':'Nieuw supportticket','support.received':'Supportticket ontvangen','support.user-replied':'Nieuwe reactie op supportticket','support.reopened':'Ticket heropend','support.answered':'Reactie van DartFlow Support','support.status-changed':'Ticketstatus gewijzigd'};
/** Domain callers keep this in their own transaction. No user text enters push. */
export async function enqueueNotificationEvent(client:PoolClient,input:{eventId:string;kind:SupportNotificationKind;actorId:string;recipientIds:string[];reference:{ticketId:string;ticketNumber:string;recipientView:'user'|'support'};href:string;title:string;body:string}){
 const ref=input.reference;notificationUuid(ref.ticketId);if(!/^DF-[1-9]\d{0,14}$/.test(ref.ticketNumber))throw new Error('Invalid server ticket number');
 const {supportNotificationRecipientEligible}=await import('./support-tickets');
 for(const recipient of new Set(input.recipientIds)){
  if(recipient===input.actorId&&input.kind!=='support.received'||!await supportNotificationRecipientEligible(client,recipient,ref))continue;
  const href=`${ref.recipientView==='support'?'/app/admin/support':'/app/support'}/${ref.ticketId}`;
  await enqueueDomainMail(client,{id:input.eventId,templateId:input.kind.replace('.','-'),scope:'platform',recipientId:recipient,actorId:input.actorId,entityId:ref.ticketId,variables:{ticketNumber:ref.ticketNumber,actionUrl:href},communication:{reference:{kind:'support',...ref},href,title:`${supportTitles[input.kind]} · ${ref.ticketNumber}`,body:`Bekijk de opvolging van supportticket ${ref.ticketNumber} in DartFlow.`}});
 }
}
export async function communicationApplicable(client:Pick<PoolClient,'query'>,recipient:string,c:Communication):Promise<boolean>{
 const ref=c.reference;
 if(ref.kind==='support'){const {supportNotificationRecipientEligible}=await import('./support-tickets');return supportNotificationRecipientEligible(client,recipient,ref);}
 const {communicationCampaignEligible}=await import('./notification-campaigns');return communicationCampaignEligible(client,recipient,ref);
}
