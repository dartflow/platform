import type { PoolClient } from 'pg';
import { matchView } from './domain';
import { enqueueDomainMail } from './integrations-mail';
import type { EventAction, MatchCommand, MatchState } from './types';

/** Invoked only after an authorized core transition, in its existing transaction. */
export async function enqueueMatchTransition(client:PoolClient,actorId:string,source:MatchState,next:MatchState,command:MatchCommand) {
 const kinds:{id:string;recipients:string[];reason?:string}[]=[];
 if(next.status==='called'&&next.boardId&&(source.status!=='called'||source.boardId!==next.boardId||source.callRef!==next.callRef))kinds.push({id:'board-call',recipients:next.players.map(player=>player.id)});
 if(next.status==='result'&&(source.status!=='result'||source.resultRevision!==next.resultRevision))kinds.push({id:'result-confirm',recipients:next.players.filter((_player,index)=>!next.confirmations[index]).map(player=>player.id)});
 if(next.resultPublished&&!source.resultPublished)kinds.push({id:'result-confirmed',recipients:next.players.map(player=>player.id)});
 if(next.status==='disputed'&&source.status!=='disputed'){
  const staff=await client.query('select user_id from dartflow_private.event_staff where event_id=$1',[next.eventId]);
  kinds.push({id:'result-disputed',recipients:[...new Set([...next.players.map(player=>player.id),...staff.rows.map(row=>row.user_id)])],reason:'De uitslag wordt beoordeeld. Open de beveiligde wedstrijd voor het dossier.'});
 }
 if(source.status==='disputed'&&next.status!=='disputed')kinds.push({id:'result-resolved',recipients:next.players.map(player=>player.id),reason:'De wedstrijdleiding heeft een besluit vastgelegd. Open de wedstrijd voor de actuele stand.'});
 if(!kinds.length)return;
 const linked=await client.query('select e.club_id,e.state from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1',[next.id]);
 const scope=linked.rows.length?(linked.rows[0].club_id?`club:${linked.rows[0].club_id}`:'platform'):`club:${next.clubId}`;
 const event=await client.query('select name,date::text from dartflow_private.events where id=$1',[next.eventId]);
 const actor=await client.query('select name from dartflow_private.profile_labels where id=$1',[actorId]);
 const board=next.boardId?await client.query('select name from dartflow_private.boards where id=$1',[next.boardId]):null;
 const view=matchView(next,actorId,false),score=(next.settings.bestOfSets>1?view.sets:view.legs).join(' – ');
 for(const kind of kinds)for(const recipientId of kind.recipients){
  const opponent=next.players.find(player=>player.id!==recipientId);
  await enqueueDomainMail(client,{id:`match:${next.id}:${command.requestId}:${kind.id}`,templateId:kind.id,scope,recipientId,actorId,opponentId:opponent?.id,entityId:next.id,...(kind.id==='board-call'?{...(next.callRef&&next.boardId?{call:{ref:next.callRef,boardId:next.boardId}}:{}),expiresAt:new Date(Date.now()+5*60_000).toISOString()}:{}),variables:{actorName:actor.rows[0]?.name||'Een speler',opponentName:opponent?.name||'Deelnemers',eventName:event.rows[0]?.name||'Wedstrijd',date:event.rows[0]?.date||'',boardName:board?.rows[0]?.name||'Baan',score,reason:kind.reason||'',actionUrl:`/wedstrijd/${next.id}`}});
 }
}

type EntryStatus='registered'|'waitlisted'|'withdrawn';
export type EntryMailTransition={entryId:string;userId:string;from:EntryStatus|null;to:EntryStatus};
export async function enqueueEventTransition(client:PoolClient,actorId:string,event:{id:string;club_id:string;name:string},action:EventAction,result:{matchId?:string;ok:true;transitions?:EntryMailTransition[];auditId?:string}) {
 if(!result.transitions?.length||action.type==='check-in'||action.type==='plan')return;
 const linked=await client.query("select club_id from dartflow_private.platform_entities where state->>'eventId'=$1 limit 1",[event.id]);
 const scope=linked.rows.length?(linked.rows[0].club_id?`club:${linked.rows[0].club_id}`:'platform'):`club:${event.club_id}`;
 const auditId=result.auditId||(await client.query('select id::text from dartflow_private.audit_events where event_id=$1 and actor_id=$2 and action=$3 order by id desc limit 1',[event.id,actorId,action.type])).rows[0]?.id;
 if(!auditId)return;
 for(const transition of result.transitions){
  if(transition.from===transition.to)continue;
  const templateId=transition.to==='withdrawn'?'tournament-withdrawn':transition.to==='waitlisted'?'tournament-waitlist':transition.from==='waitlisted'?'tournament-promoted':'tournament-approved';
  await enqueueDomainMail(client,{id:`event:${event.id}:audit:${auditId}:entry:${transition.entryId}:${transition.to}`,templateId,scope,recipientId:transition.userId,variables:{eventName:event.name,status:transition.to==='registered'?'Bevestigd':transition.to==='waitlisted'?'Wachtlijst':'Afgemeld',clubName:event.name}});
 }
}
