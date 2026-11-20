import type {PoolClient} from 'pg';
import type {SeasonState} from './seasons-types';
import {seasonMailRecipients} from './season-reminders';
import {enqueueAuditedNotification} from './notification-audit-source';

/** Called after canonical season persistence, inside the same source transaction. */
export async function enqueueSeasonAuditTransitions(client:PoolClient,before:SeasonState|undefined,next:SeasonState,actor:string,eventId:string){
 for(const participant of next.participants){
  const previous=before?.participants.find(p=>p.id===participant.id);if(previous?.status===participant.status)continue;
  await enqueueAuditedNotification(client,{eventId:`season-entry:${eventId}:${participant.id}`,templateId:'season-entry',actorId:actor,recipientIds:[participant.id],allowSelf:true,source:{kind:'season-participant',seasonId:next.id,playerId:participant.id,status:participant.status},href:`/app/competities/${next.id}`,status:participant.status==='active'?'Je deelname is bevestigd.':participant.status==='waiting'?'Je staat op de wachtlijst.':participant.status==='invited'?'Je bent uitgenodigd voor deze competitie.':'Je deelname is beëindigd.'});
 }
 for(const fixture of next.fixtures){
  const previous=before?.fixtures.find(f=>f.id===fixture.id);if(!previous)continue;
  for(const player of fixture.checkIns.filter(id=>!previous.checkIns.includes(id)))await enqueueAuditedNotification(client,{eventId:`season-check-in:${eventId}:${fixture.id}:${player}`,templateId:'season-check-in',actorId:actor,recipientIds:(await seasonMailRecipients(client,next,fixture)).filter(id=>id!==player),source:{kind:'season-fixture',seasonId:next.id,fixtureId:fixture.id,status:fixture.status,checkedInPlayerId:player},href:`/app/competities/${next.id}`,expiresAt:new Date(Date.now()+15*60_000).toISOString()});
  if(previous.status===fixture.status&&previous.confirmations.length===fixture.confirmations.length)continue;
  if(!['provisional','disputed','confirmed','administrative','canceled','interrupted'].includes(fixture.status)&&previous.status!=='disputed')continue;
  let recipients=await seasonMailRecipients(client,next,fixture,fixture.status==='disputed');
  if(fixture.status==='provisional'&&['teams','doubles'].includes(next.format))recipients=recipients.filter(id=>next.teams.some(team=>[fixture.homeId,fixture.awayId].includes(team.id)&&[team.captainId,team.deputyId].includes(id)));
  await enqueueAuditedNotification(client,{eventId:`season-result-review:${eventId}:${fixture.id}`,templateId:'season-result-review',actorId:actor,recipientIds:recipients,source:{kind:'season-fixture',seasonId:next.id,fixtureId:fixture.id,status:fixture.status},href:`/app/competities/${next.id}`,status:fixture.status==='provisional'?'De ontmoeting wacht op de bevestigingen van de captains.':fixture.status==='disputed'?'De uitslag vraagt een besloten beoordeling door de competitieleiding.':'De uitslag of afhandeling van de ontmoeting is bijgewerkt.'});
 }
}
