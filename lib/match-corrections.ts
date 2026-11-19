import{createHash,randomUUID}from'node:crypto';
import type{PoolClient}from'pg';
import{enqueueDomainMail}from'./integrations-mail';
import{DEFAULT_CORRECTION_POLICY,validateCorrectionPolicy,correctionMoments,caseEntries,caseNow,appendCaseEntry,evidence,category,casePolicy,caseRetention,caseResponseDue,hasOpponentResponse}from'./match-correction-cases';
import{database,eventAccess}from'./db';
import{DomainError}from'./domain';
import{assertAccountActive}from'./account-removal';
import{containsPrivatePinField}from'./private-pin-fields';
import{canonical,save,text,uuid}from'./platform-store';
import type{EntityRow}from'./platform-store';
import{lockRankingLists,rebuildRankingGeneration}from'./ranking-generations';
import type{RankingSourceData}from'./ranking-generations';
import type{MatchAction,MatchState,ResultView}from'./types';
import{matchParticipants}from'./match-sides';
import{advanceFixtures}from'./platform-domain';
import{readSourceBoardActivity,releaseBoardActivity}from'./board-activity';
import type{MatchCorrectionCommand,MatchCorrectionResponse,MatchCorrectionsView,MatchCorrectionView}from'./match-corrections-types';

type Client=Pick<PoolClient,'query'>;
type RequestRow={id:string;match_id:string;requested_by:string;requested_by_name:string;reason:string;base_revision:number;result_revision:number;undo_count:number;prior_state:MatchState;created_at:Date;decision:MatchCorrectionView['status']|null;actor_id:string|null;decision_reason:string|null;decided_at:Date|null;decided_by_name:string|null};
type CorrectionState=MatchState&{primaryCorrection?:{requestId:string;originalResultRevision:number;phase:'rescoring'|'confirmed'}};
type Hold={requestId:string;matchId:string;downstreamFixtureIds:string[]};
const reasonForHold='Een heropende bronuitslag raakt al toegewezen vervolgpartijen. De wedstrijdleiding moet de afhankelijkheden beoordelen voordat het evenement verdergaat.';

async function currentMatch(client:Client,id:string):Promise<CorrectionState>{const state=(await client.query<{state:CorrectionState}>('select state from dartflow_private.matches where id=$1',[id])).rows[0]?.state;if(!state)throw new DomainError('not_found','Deze partij bestaat niet.',404);return state;}
async function access(client:Client,state:MatchState,actor:string):Promise<{participant:boolean;manager:boolean}>{
 const event=await eventAccess(client,actor,state.eventId),participant=matchParticipants(state).some(player=>player.id===actor);
 if(!participant&&!event.canManage)throw new DomainError('forbidden','Dit correctiedossier hoort bij de deelnemers en wedstrijdleiding van deze partij.',403);
 return{participant,manager:Boolean(event.canManage)};
}
const isPublished=(state:MatchState)=>state.status==='confirmed'&&state.resultPublished&&state.resultRevision!==null&&state.confirmations.every(Boolean)&&state.game.status==='finished'&&!state.administrativeDecision;
const undoCapacity=(state:MatchState)=>Math.min(100,[...state.previousSets,state.game].reduce((count,game)=>count+game.history.length,0));
const requestsSql=`select q.*,coalesce(nullif(p.display_name,''),p.name)requested_by_name,d.decision,d.actor_id,d.reason decision_reason,d.created_at decided_at,coalesce(nullif(reviewer.display_name,''),reviewer.name)decided_by_name from dartflow_private.match_correction_requests q join dartflow_private.profiles p on p.id=q.requested_by left join dartflow_private.match_correction_decisions d on d.request_id=q.id left join dartflow_private.profiles reviewer on reviewer.id=d.actor_id`;
async function origin(client:Client,state:MatchState,lock=false):Promise<(EntityRow&{fixture_id:string})|undefined>{return(await client.query<EntityRow&{fixture_id:string}>(`select e.*,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1${lock?' for update of e':''}`,[state.id])).rows[0];}
function dependencyHold(event:EntityRow|undefined):Hold|undefined{return event?.state.primaryCorrectionHold as Hold|undefined;}

/** This journal is append-only; match_results remains the one current confirmed projection. */
export async function recordPrimaryResultVersion(client:Client,state:MatchState):Promise<void>{
 if(!isPublished(state))return;
 const current=(await client.query<{snapshot:ResultView}>('select snapshot from dartflow_private.match_results where match_id=$1 and result_revision=$2',[state.id,state.resultRevision])).rows[0];
 if(current)await client.query('insert into dartflow_private.match_result_versions(match_id,result_revision,snapshot,state)values($1,$2,$3,$4)on conflict(match_id,result_revision)do nothing',[state.id,state.resultRevision,JSON.stringify(current.snapshot),JSON.stringify(state)]);
}

/** A frozen continuation cannot be scored or assigned using participants from an invalidated parent. */
export async function assertPrimaryCorrectionMatchAllowed(client:Client,state:MatchState,_action:MatchAction):Promise<void>{
 void _action;const event=await origin(client,state);if(!event)return;
 const hold=dependencyHold(event),open=event.state.primaryCorrectionOpen as{matchId:string}|undefined;
 if(hold?.downstreamFixtureIds.includes(event.fixture_id))throw new DomainError('primary_correction_dependency_hold',reasonForHold,409);
 const openFixture=open?event.state.fixtures?.find(f=>f.matchId===open.matchId):undefined;
 if(openFixture&&dependentFixtures(event,openFixture.id,false).includes(event.fixture_id))throw new DomainError('primary_correction_dependency_hold',reasonForHold,409);
 const blocked=await primaryCorrectionBlockedFixtureIds(client,event);if(blocked.has(event.fixture_id)&&open?.matchId!==state.id)throw new DomainError('primary_correction_dependency_hold',reasonForHold,409);
}
export function assertPrimaryCorrectionEventMutable(event:EntityRow):void{
 if(event.state.primaryCorrectionOpen||event.state.primaryCorrectionHold)throw new DomainError('primary_correction_dependency_hold',reasonForHold,409);
}
/** Pending objections freeze their actual descendants, while unrelated boards continue. */
export async function primaryCorrectionBlockedFixtureIds(client:Client,event:EntityRow):Promise<Set<string>>{
 const blocked=new Set<string>(dependencyHold(event)?.downstreamFixtureIds??[]),open=event.state.primaryCorrectionOpen as{matchId:string}|undefined;
 for(const id of [...blocked])for(const descendant of dependentFixtures(event,id,false))blocked.add(descendant);
 const source=open?event.state.fixtures?.find(f=>f.matchId===open.matchId):undefined;if(source){blocked.add(source.id);for(const id of dependentFixtures(event,source.id,false))blocked.add(id);}
 const pending=(await client.query<{fixture_id:string}>(`select l.fixture_id from dartflow_private.match_correction_requests q join dartflow_private.platform_match_links l on l.match_id=q.match_id where l.entity_id=$1 and not exists(select 1 from dartflow_private.match_correction_decisions d where d.request_id=q.id)`,[event.id])).rows;
 for(const row of pending){blocked.add(row.fixture_id);for(const id of dependentFixtures(event,row.fixture_id,false))blocked.add(id);}return blocked;
}
export async function assertPrimaryCorrectionFixtureAllowed(client:Client,event:EntityRow,fixtureId?:string):Promise<void>{
 const blocked=await primaryCorrectionBlockedFixtureIds(client,event);if(fixtureId?blocked.has(fixtureId):blocked.size>0)throw new DomainError('primary_correction_dependency_hold',reasonForHold,409);
}

/** Final scoring still uses the ordinary writer/turn protocol and both current signatures. */
export async function preparePrimaryCorrectionResult(client:PoolClient,next:MatchState):Promise<void>{
 void client;
 const state=next as CorrectionState;if(state.primaryCorrection?.phase!=='rescoring'||!isPublished(state))return;
 state.primaryCorrection.phase='confirmed';
}

function dependentFixtures(event:EntityRow,fixtureId:string,assignedOnly=true):string[]{
 const fixtures=event.state.fixtures??[],source=fixtures.find(row=>row.id===fixtureId);if(!source)return[];
 const affected=new Set<string>();let changed=true;
 while(changed){changed=false;for(const fixture of fixtures){if(fixture.id===fixtureId||affected.has(fixture.id))continue;
  const follows=fixture.sources?.some(link=>link.fixtureId&&(link.fixtureId===fixtureId||affected.has(link.fixtureId))||source.phase==='pool'&&link.pool===source.pool)||fixture.resetOf&&(fixture.resetOf===fixtureId||affected.has(fixture.resetOf))||source.phase==='swiss'&&fixture.phase==='swiss'&&fixture.round>source.round;
  if(follows){affected.add(fixture.id);changed=true;}
 }}
 return fixtures.filter(fixture=>affected.has(fixture.id)&&(!assignedOnly||fixture.matchId)).map(fixture=>fixture.id);
}

async function releaseOldActivity(client:Client,state:MatchState):Promise<void>{const activity=await readSourceBoardActivity(client,state.id);if(activity)await releaseBoardActivity(client,{sessionId:activity.sessionId,reason:'completed'});}

async function repairDependencies(client:PoolClient,actor:string,row:RequestRow,state:CorrectionState,reason:string):Promise<void>{
 const event=await origin(client,state,true),hold=dependencyHold(event);if(!event||!hold||hold.requestId!==row.id||row.decision!=='approved')throw new DomainError('correction_repair_unavailable','Dit dossier heeft geen open vervolgpartijen om opnieuw in te delen.',409);
 if(!isPublished(state)||state.primaryCorrection?.requestId!==row.id||state.primaryCorrection.phase!=='confirmed')throw new DomainError('correction_source_unconfirmed','Beide spelers moeten eerst de werkelijk herstelde primaire uitslag bevestigen.',409);
 const source=event.state.fixtures?.find(fixture=>fixture.id===event.fixture_id);if(!source||source.status!=='confirmed')throw new DomainError('correction_source_unconfirmed','Verwerk eerst de actuele primaire uitslag in het evenement.',409);
 const allDescendants=dependentFixtures(event,event.fixture_id,false),affected=event.state.fixtures!.filter(fixture=>allDescendants.includes(fixture.id)),before=structuredClone(event.state);
 for(const fixture of affected){if(!fixture.matchId)continue;await client.query('select id from dartflow_private.matches where id=$1 for update',[fixture.matchId]);const old=await currentMatch(client,fixture.matchId);
  if(matchParticipants(old).some(player=>player.id===actor))throw new DomainError('independent_correction_review_required','Een onafhankelijke wedstrijdleider moet ook buiten alle getroffen vervolgpartijen staan.',403);
  if((await client.query('select 1 from dartflow_private.match_results where match_id=$1',[old.id])).rowCount)throw new DomainError('correction_dependency_still_published','Een getroffen vervolgbron is nog officieel gepubliceerd. Laat eerst het correctiedossier beoordelen.',409);
  old.status='abandoned';old.resultPublished=false;old.confirmations=[false,false];old.boardId=null;old.paused=true;old.dispute=reasonForHold;old.revision++;
  await client.query('update dartflow_private.matches set state=$2,revision=$3,board_id=null,updated_at=clock_timestamp()where id=$1',[old.id,JSON.stringify(old),old.revision]);await client.query('update dartflow_private.platform_match_links set projected=true where match_id=$1',[old.id]);await releaseOldActivity(client,old);
 }
 if(source.phase==='swiss')event.state.fixtures=event.state.fixtures!.filter(fixture=>!allDescendants.includes(fixture.id));
 else{
  const replacements=new Map(allDescendants.map(id=>[id,randomUUID()]));
  event.state.fixtures=event.state.fixtures!.map(fixture=>{
   const result=structuredClone(fixture);if(replacements.has(result.id)){
    const original=(result as typeof result&{rankingOriginalFixtureId?:string}).rankingOriginalFixtureId??result.id;result.id=replacements.get(result.id)!;(result as typeof result&{rankingOriginalFixtureId?:string}).rankingOriginalFixtureId=original;
    delete result.matchId;delete result.score;delete result.winnerId;delete result.started;delete result.administrative;delete result.proposedBy;delete result.proposedTime;result.players=[null,null];result.status='scheduled';
   }
   if(result.sources)result.sources=result.sources.map(link=>({...link,...(link.fixtureId&&replacements.has(link.fixtureId)?{fixtureId:replacements.get(link.fixtureId)!}:{})}));
   if(result.resetOf&&replacements.has(result.resetOf))result.resetOf=replacements.get(result.resetOf)!;return result;
  });advanceFixtures(event.state.fixtures);
 }
 delete event.state.primaryCorrectionHold;delete event.state.primaryCorrectionOpen;event.state.paused=false;event.state.autoSchedule=false;event.state.completed=false;delete event.state.championId;delete event.state.placings;delete event.state.standings;
 await client.query('insert into dartflow_private.match_correction_repairs(request_id,actor_id,reason,before_event,after_event)values($1,$2,$3,$4,$5)',[row.id,actor,reason,JSON.stringify(before),JSON.stringify(event.state)]);await save(client,event);
}

async function reopen(client:PoolClient,actor:string,row:RequestRow,state:CorrectionState):Promise<MatchCorrectionsView['dependencyHold']>{
 if(!isPublished(state)||state.resultRevision!==row.result_revision||state.revision!==row.base_revision)throw new DomainError('revision_conflict','De primaire uitslag is gewijzigd sinds het verzoek. Dien een nieuw verzoek in.',409);
 if(undoCapacity(state)<row.undo_count)throw new DomainError('correction_history_missing','De gevraagde werkelijke beurthistorie ontbreekt.',409);
 await recordPrimaryResultVersion(client,state);const next=structuredClone(state);
 for(let index=0;index<row.undo_count;index++){
  if(!next.game.history.length&&next.previousSets.length)next.game=next.previousSets.pop()!;
  const snapshot=next.game.history.at(-1);if(!snapshot)throw new DomainError('correction_history_missing','De gevraagde beurthistorie ontbreekt.',409);
  next.game={...structuredClone(snapshot),history:structuredClone(next.game.history.slice(0,-1))};
 }
 next.status='live';next.boardId=null;next.callRef=null;next.winnerId=null;next.resultRevision=null;next.resultPublished=false;next.confirmations=[false,false];next.correction=null;next.dispute=null;next.paused=false;next.pausedBy=null;next.revision++;next.scoringRevision=next.revision;
 next.primaryCorrection={requestId:row.id,originalResultRevision:row.result_revision,phase:'rescoring'};
 if(next.ranking?.status==='booked')next.ranking.status='reserved';
 const event=await origin(client,state,true);let hold:MatchCorrectionsView['dependencyHold']=null;const affectedMatchIds=[state.id];
 if(event&&event.state.seasonManaged===true)throw new DomainError('season_correction_required','Gebruik de eigen beoordeelde seizoenscorrectie voor een samengestelde ontmoeting.',409);
 if(event&&['league','tournament'].includes(event.kind)){
  if(event.state.primaryCorrectionOpen||event.state.primaryCorrectionHold)throw new DomainError('correction_repair_pending','Rond eerst de eerder beoordeelde primaire correctie af voordat een tweede bron wordt heropend.',409);
  const descendants=dependentFixtures(event,event.fixture_id),fixture=event.state.fixtures?.find(item=>item.id===event.fixture_id);
  if(fixture){fixture.status='live';delete fixture.winnerId;delete fixture.score;}
  event.state.primaryCorrectionOpen={requestId:row.id,matchId:state.id};delete event.state.championId;delete event.state.placings;delete event.state.standings;event.state.completed=false;event.state.autoSchedule=false;
  if(descendants.length){event.state.primaryCorrectionHold={requestId:row.id,matchId:state.id,downstreamFixtureIds:descendants};hold={requestId:row.id,entityId:event.id,downstreamFixtureIds:descendants,message:reasonForHold};
   for(const fixture of event.state.fixtures??[]){if(!descendants.includes(fixture.id)||!fixture.matchId)continue;
    await client.query('select id from dartflow_private.matches where id=$1 for update',[fixture.matchId]);const dependent=await currentMatch(client,fixture.matchId);affectedMatchIds.push(dependent.id);
    if(isPublished(dependent)){
     await recordPrimaryResultVersion(client,dependent);await client.query('insert into dartflow_private.match_correction_dependencies(request_id,match_id,result_revision,fixture_id)values($1,$2,$3,$4)',[row.id,dependent.id,dependent.resultRevision,fixture.id]);
     await client.query('delete from dartflow_private.match_results where match_id=$1',[dependent.id]);
    }
    dependent.status='disputed';dependent.dispute=reasonForHold;dependent.resultPublished=false;dependent.confirmations=[false,false];dependent.boardId=null;dependent.callRef=null;dependent.paused=true;dependent.revision++;
    await client.query('delete from dartflow_private.match_confirmations where match_id=$1',[dependent.id]);await client.query('update dartflow_private.matches set state=$2,revision=$3,board_id=null,updated_at=clock_timestamp()where id=$1',[dependent.id,JSON.stringify(dependent),dependent.revision]);await releaseOldActivity(client,dependent);
    fixture.status='live';delete fixture.score;delete fixture.winnerId;
   }
  }
  await save(client,event);
 }
 // Every circuit declaration is a dependency, including one not yet finalized at the time of reopening.
 if(event)await client.query(`insert into dartflow_private.ranking_primary_correction_holds(request_id,list_id,entity_id)select $1,d.list_id,d.entity_id from dartflow_private.ranking_event_declarations d join dartflow_private.ranking_lists l on l.id=d.list_id where d.entity_id=$2 and d.status='approved' and l.kind='circuit' on conflict do nothing`,[row.id,event.id]);
 const sourceScope=[affectedMatchIds,event?.id??null],listIds=(await client.query<{list_id:string}>('select distinct list_id from dartflow_private.ranking_sources where match_id=any($1::uuid[]) or($2::uuid is not null and entity_id=$2)',sourceScope)).rows;
 const lists=await lockRankingLists(client,listIds.map(source=>source.list_id));
 const sources=(await client.query<{id:string;list_id:string;match_id:string|null;revision:number;verdict:string;data:RankingSourceData}>(`select s.id,s.list_id,s.match_id,r.revision,r.verdict,r.data from dartflow_private.ranking_sources s join lateral(select revision,verdict,data from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true where s.match_id=any($1::uuid[]) or($2::uuid is not null and s.entity_id=$2) order by s.list_id,s.id`,sourceScope)).rows;
 for(const source of sources)if(source.verdict==='valid')await client.query("insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,$2,'void',$3,$4,$5)",[source.id,source.revision+1,JSON.stringify({...source.data,...(source.match_id&&source.match_id!==state.id?{dependencyCorrectionId:row.id}:{})}),actor,`Primaire uitslag heropend via dossier ${row.id}: ${row.decision_reason}`]);
 for(const list of lists)await rebuildRankingGeneration(client,list);
 const withdrawn=await client.query('delete from dartflow_private.match_results where match_id=$1 returning match_id',[state.id]);if(withdrawn.rowCount!==1)throw new DomainError('correction_journal_missing','De huidige uitslag kon niet met haar bewaarde primaire versie worden ingetrokken.',409);
 // Rebuild the small event projection from its remaining primary results; no old winner remains in standings.
 await client.query('delete from dartflow_private.standings where event_id=$1',[state.eventId]);
 if(!event||event.kind!=='lobby')await client.query(`insert into dartflow_private.standings(event_id,user_id,played,won,drawn,points)
  select m.event_id,p.user_id,count(*)::int,count(*)filter(where m.state->>'winnerId'=p.user_id::text)::int,count(*)filter(where m.state->>'winnerId' is null)::int,
   sum(case when m.state->>'winnerId'=p.user_id::text then 3 when m.state->>'winnerId' is null then 1 else 0 end)::int
  from dartflow_private.match_results r join dartflow_private.matches m on m.id=r.match_id join dartflow_private.match_players p on p.match_id=m.id
  where m.event_id=$1 and coalesce(m.state->'sideParticipants','[]'::jsonb)='[]'::jsonb group by m.event_id,p.user_id`,[state.eventId]);
 await client.query('delete from dartflow_private.match_confirmations where match_id=$1',[state.id]);
 await client.query('delete from dartflow_private.visits where match_id=$1',[state.id]);const visits=[...next.previousSets,next.game].flatMap(game=>game.visits);
 if(visits.length)await client.query('insert into dartflow_private.visits(match_id,sequence,data)select $1,ordinality-1,value from jsonb_array_elements($2::jsonb)with ordinality',[state.id,JSON.stringify(visits)]);
 await client.query('update dartflow_private.matches set state=$2,revision=$3,board_id=null,updated_at=clock_timestamp()where id=$1',[state.id,JSON.stringify(next),next.revision]);
 await releaseOldActivity(client,next);
 await client.query('update dartflow_private.platform_match_links set projected=false where match_id=$1',[state.id]);
 await client.query('insert into dartflow_private.audit_events(actor_id,club_id,event_id,match_id,action,detail)values($1,$2,$3,$4,$5,$6)',[actor,state.clubId,state.eventId,state.id,'primary-correction-approved',JSON.stringify({requestId:row.id,undoCount:row.undo_count,originalResultRevision:row.result_revision,reason:row.decision_reason,revision:next.revision})]);
 return hold;
}

export async function getMatchCorrections(actorId:string,matchId:string):Promise<MatchCorrectionsView>{
 const actor=uuid(actorId),id=uuid(matchId),client=database();await assertAccountActive(actor,client);const state=await currentMatch(client,id),rights=await access(client,state,actor),event=await origin(client,state);
 await client.query('select dartflow_private.purge_expired_correction_evidence(50)');
 const requests=(await client.query<RequestRow>(`${requestsSql} where q.match_id=$1 order by q.created_at desc,q.id limit 50`,[id])).rows,entries=await caseEntries(client,requests.map(r=>r.id)),now=await caseNow(client);
 const independent=rights.manager&&!rights.participant,capacity=undoCapacity(state),hold=dependencyHold(event),participants=matchParticipants(state).map(p=>p.id),seasonManaged=event?.state.seasonManaged===true;
 const views=[];for(const row of requests){const records=entries.filter(e=>e.request_id===row.id),opened=records.find(e=>e.kind==='opened'),policy=casePolicy(records),retainUntil=caseRetention(records,row.created_at),expired=now>=retainUntil,responseDue=caseResponseDue(records,row.created_at),appeal=records.find(e=>e.kind==='appeal'),closed=records.find(e=>e.kind==='closed'),appealOf=typeof opened?.data.appealOf==='string'?opened.data.appealOf:undefined,priorReviewer=opened?.data.priorReviewer,deadline=row.decided_at?new Date(row.decided_at.getTime()+policy.appealHours*3600000):undefined;
  const responseReady=hasOpponentResponse(records,row.requested_by,participants)||now>=responseDue,review=independent&&priorReviewer!==actor&&row.requested_by!==actor&&!row.decision&&!closed&&responseReady;
  views.push({id:row.id,status:row.decision??'pending' as const,requestedBy:row.requested_by,requestedByName:row.requested_by_name,reason:expired?'De private toelichting valt buiten de bewaartermijn.':row.reason,baseRevision:row.base_revision,resultRevision:row.result_revision,undoCount:row.undo_count,createdAt:row.created_at.toISOString(),decidedBy:row.actor_id,decisionReason:row.decision_reason,decidedAt:row.decided_at?.toISOString()??null,canReview:!seasonManaged&&review,canCancel:!row.decision&&!closed&&row.requested_by===actor,canRepair:independent&&row.decision==='approved'&&hold?.requestId===row.id&&isPublished(state),category:category(opened?.data.category),moment:opened?.data.moment as import('./match-corrections-types').CorrectionMoment|null??null,...(!expired&&typeof opened?.data.evidenceText==='string'?{evidenceText:opened.data.evidenceText}:{}),evidenceExpired:expired,retainUntil:retainUntil.toISOString(),responseDueAt:responseDue.toISOString(),responses:records.filter(e=>e.kind==='response').map(e=>({actorId:e.actor_id,actorName:e.actor_name,reason:expired?'Reactie buiten bewaartermijn.':String(e.data.reason),at:e.created_at.toISOString(),...(!expired&&typeof e.data.evidenceText==='string'?{evidenceText:e.data.evidenceText}:{})})),...(appealOf?{appealOf}:{}),...(deadline?{appealDeadline:deadline.toISOString()}:{}),canRespond:rights.participant&&row.requested_by!==actor&&!row.decision&&!closed&&!records.some(e=>e.kind==='response'&&e.actor_id===actor),canAppeal:rights.participant&&row.decision==='rejected'&&!appealOf&&!appeal&&!closed&&!!deadline&&now<=deadline&&state.resultRevision===row.result_revision,canClose:independent&&priorReviewer!==actor&&Boolean(row.decision)&&!closed&&!appeal&&(row.decision==='cancelled'||row.decision==='rejected'&&(Boolean(appealOf)||!!deadline&&now>deadline)||row.decision==='approved'&&isPublished(state)&&hold?.requestId!==row.id),...(closed?{closedAt:closed.created_at.toISOString()}:{}),timeline:[{type:'requested',actorName:row.requested_by_name,at:row.created_at.toISOString()},...records.filter(e=>!['access','opened'].includes(e.kind)).map(e=>({type:e.kind,actorName:e.kind==='purged'?'Systeem':e.actor_name,at:e.created_at.toISOString(),...(!expired&&typeof e.data.reason==='string'?{reason:e.data.reason}:{})})),...(row.decision?[{type:row.decision,actorName:row.decided_by_name??'Wedstrijdleiding',at:row.decided_at!.toISOString(),reason:row.decision_reason??''}]:[])].sort((a,b)=>a.at.localeCompare(b.at))});
  await appendCaseEntry(client,row.id,actor,'access',{operation:'read'},retainUntil);
 }
 const rejected=requests.find(row=>row.decision==='rejected'&&row.result_revision===state.resultRevision),requestAllowed=!rejected||!!rejected.decided_at&&now.getTime()>rejected.decided_at.getTime()+casePolicy(entries.filter(e=>e.request_id===rejected.id)).appealHours*3600000;
 return{matchId:id,canRequest:!seasonManaged&&isPublished(state)&&capacity>0&&requestAllowed&&!requests.some(row=>!row.decision),canReview:!seasonManaged&&independent,maxUndoCount:capacity,policy:validateCorrectionPolicy(event?.state.integrityPolicy??DEFAULT_CORRECTION_POLICY),moments:correctionMoments(state),...(seasonManaged?{unavailableReason:'Deze partij hoort bij een samengestelde seizoensontmoeting. Gebruik de beoordeelde seizoensprocedure.'}:{}),dependencyHold:hold&&event?{requestId:hold.requestId,entityId:event.id,downstreamFixtureIds:hold.downstreamFixtureIds,message:reasonForHold}:null,requests:views};
}

async function correctionNotices(client:PoolClient,state:MatchState,requestId:string,kind:string):Promise<void>{
 const staff=(await client.query<{user_id:string}>('select user_id from dartflow_private.event_staff where event_id=$1',[state.eventId])).rows.map(p=>p.user_id),recipients=[...new Set([...matchParticipants(state).map(p=>p.id),...staff])],linked=await origin(client,state),scope=linked?.club_id?`club:${linked.club_id}`:linked?'platform':`club:${state.clubId}`;
 for(const recipientId of recipients)await enqueueDomainMail(client,{id:`correction:${requestId}:${kind}`,templateId:kind==='approved'||kind==='rejected'||kind==='closed'?'result-resolved':'result-disputed',scope,recipientId,entityId:state.id,variables:{eventName:'Wedstrijd',score:'',reason:'Er is een besloten dossierbericht. Open de beveiligde wedstrijd voor de actuele reden, uitkomst en beroepsroute.',actionUrl:`/wedstrijd/${state.id}`}});
}

export async function executeMatchCorrectionCommand(actorId:string,command:MatchCorrectionCommand,expectedMatchId?:string):Promise<MatchCorrectionResponse>{
 const actor=uuid(actorId),requestId=uuid(command?.requestId);if(containsPrivatePinField(command))throw new DomainError('private_field','Gebruik de beveiligde spelerspincodeflow.',400);
 if(!command?.action||!['correction.request','correction.decide','correction.cancel','correction.repair','correction.respond','correction.appeal','correction.close'].includes(command.action.type))throw new DomainError('invalid_correction_action','Kies een beoordeeld correctiecommando.');
 const client=await database().connect();try{
  await client.query('begin');await assertAccountActive(actor,client);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`dartflow:primary-correction:${actor}`]);
  const action=command.action;let row:RequestRow|undefined;if(action.type!=='correction.request')row=(await client.query<RequestRow>(`${requestsSql} where q.id=$1`,[uuid(action.correctionId)])).rows[0];
  if(action.type!=='correction.request'&&!row)throw new DomainError('not_found','Dit correctieverzoek bestaat niet.',404);
  const id=action.type==='correction.request'?uuid(action.matchId):row!.match_id,scope=(await client.query<{event_id:string;entity_id:string|null}>('select m.event_id,l.entity_id from dartflow_private.matches m left join dartflow_private.platform_match_links l on l.match_id=m.id where m.id=$1',[id])).rows[0];if(!scope)throw new DomainError('not_found','Deze partij bestaat niet.',404);
  if(expectedMatchId&&uuid(expectedMatchId)!==id)throw new DomainError('invalid_id','De partij en het correctiedossier komen niet overeen.');
  if(scope.entity_id)await client.query('select id from dartflow_private.platform_entities where id=$1 for update',[scope.entity_id]);
  // Match commands and platform assignment take the same event then match order.
  await client.query('select id from dartflow_private.events where id=$1 for update',[scope.event_id]);await client.query('select id from dartflow_private.matches where id=$1 for update',[id]);
  const state=await currentMatch(client,id),rights=await access(client,state,actor),independent=rights.manager&&!rights.participant;
  if((await origin(client,state))?.state.seasonManaged===true)throw new DomainError('season_correction_required','Gebruik Competities → het seizoen → de ontmoeting → Beslissing / heropenen, zodat de slotbevestigingen en seizoensstand worden hersteld.',409);
  if(['correction.decide','correction.repair','correction.close'].includes(action.type)&&(!independent||row!.requested_by===actor))throw new DomainError('independent_correction_review_required','Een onafhankelijke wedstrijdleider die niet aan deze partij deelnam beoordeelt de primaire uitslag.',403);
  if(action.type==='correction.cancel'&&row!.requested_by!==actor)throw new DomainError('forbidden','Alleen de aanvrager trekt dit verzoek in.',403);
  const payloadHash=createHash('sha256').update(canonical(action)).digest('hex'),receipt=(await client.query<{payload_hash:string;response:MatchCorrectionResponse}>('select payload_hash,response from dartflow_private.match_correction_receipts where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];
  if(receipt){if(receipt.payload_hash!==payloadHash)throw new DomainError('request_reused','Dit aanvraag-ID is eerder voor een andere correctieactie gebruikt.',409);await client.query('commit');return receipt.response;}
  const records=row?await caseEntries(client,[row.id]):[],opened=records.find(e=>e.kind==='opened'),now=await caseNow(client),participants=matchParticipants(state).map(p=>p.id),policy=row?casePolicy(records):validateCorrectionPolicy((await origin(client,state))?.state.integrityPolicy),retainUntil=row?caseRetention(records,row.created_at):new Date(now.getTime()+policy.evidenceDays*86400000);
  if(row&&records.some(e=>e.kind==='closed'))throw new DomainError('correction_case_closed','Dit dossier is gesloten.',409);
  if(['correction.decide','correction.repair','correction.close'].includes(action.type)&&opened?.data.priorReviewer===actor)throw new DomainError('independent_appeal_review_required','Een andere onafhankelijke beslisser behandelt het beroep.',403);
  let response:MatchCorrectionResponse;
  if(action.type==='correction.request'){
   if(!Number.isSafeInteger(action.expectedRevision)||action.expectedRevision!==state.revision)throw new DomainError('revision_conflict','De partij is gewijzigd. Vernieuw de primaire uitslag.',409);
   if(!isPublished(state)||!undoCapacity(state))throw new DomainError('correction_unavailable','Alleen een werkelijk uitgespeelde, wederzijds bevestigde uitslag met beurthistorie kan worden heropend.',409);
   let undoCount=action.undoCount;if(action.visitIndex!==undefined){if(!Number.isSafeInteger(action.visitIndex)||!correctionMoments(state).some(m=>m.visitIndex===action.visitIndex))throw new DomainError('invalid_correction_moment','Kies een werkelijk opgeslagen beurt.');undoCount=correctionMoments(state).length-action.visitIndex;}
   if(!Number.isSafeInteger(undoCount)||undoCount<1||undoCount>undoCapacity(state))throw new DomainError('invalid_undo_count',`Kies één tot ${undoCapacity(state)} werkelijke laatste beurten.`);
   const event=await origin(client,state);if(event?.state.seasonManaged===true)throw new DomainError('season_correction_required','Gebruik de seizoensprocedure voor deze ontmoeting.',409);
   if((await client.query('select 1 from dartflow_private.match_correction_requests q where match_id=$1 and not exists(select 1 from dartflow_private.match_correction_decisions d where d.request_id=q.id)',[id])).rowCount)throw new DomainError('correction_pending','Er ligt al een open verzoek voor deze primaire uitslag.',409);
   const previousRejection=(await client.query<{actor_id:string;created_at:Date}>(`select d.actor_id,d.created_at from dartflow_private.match_correction_requests q join dartflow_private.match_correction_decisions d on d.request_id=q.id where q.match_id=$1 and q.result_revision=$2 and d.decision='rejected' order by d.created_at desc limit 1`,[id,state.resultRevision])).rows[0];if(previousRejection&&(now.getTime()<=previousRejection.created_at.getTime()+policy.appealHours*3600000||!action.lateReason))throw new DomainError('correction_appeal_required','Gebruik het gekoppelde beroep na afwijzing; later ontdekte nieuwe feiten vereisen een afzonderlijke late motivering.',409);const published=(await client.query<{recorded_at:Date}>('select recorded_at from dartflow_private.match_result_versions where match_id=$1 and result_revision=$2',[id,state.resultRevision])).rows[0]?.recorded_at;if(published&&now.getTime()-published.getTime()>policy.requestHours*3600000&&!action.lateReason)throw new DomainError('late_objection_reason_required','Na de gepubliceerde bezwaartermijn is een afzonderlijke reden voor late ontdekking vereist.',409);const lateReason=action.lateReason?text(action.lateReason,1000):undefined;const correctionId=randomUUID();await client.query('insert into dartflow_private.match_correction_requests(id,match_id,requested_by,reason,base_revision,result_revision,undo_count,prior_state)values($1,$2,$3,$4,$5,$6,$7,$8)',[correctionId,id,actor,text(action.reason,1000),state.revision,state.resultRevision,undoCount,JSON.stringify(state)]);await appendCaseEntry(client,correctionId,actor,'opened',{policy,category:category(action.category),moment:action.visitIndex===undefined?null:correctionMoments(state).find(m=>m.visitIndex===action.visitIndex),evidenceText:evidence(action.evidenceText),lateReason,...(previousRejection?{priorReviewer:previousRejection.actor_id}:{})},retainUntil);response={ok:true,id:correctionId,matchId:id,status:'pending'};
  }else if(action.type==='correction.respond'){
   if(!rights.participant||row!.requested_by===actor||row!.decision)throw new DomainError('correction_response_unavailable','Alleen de tegenpartij reageert op een nog open dossier.',403);if(records.some(e=>e.kind==='response'&&e.actor_id===actor))throw new DomainError('correction_response_exists','Je reactie is al vastgelegd.',409);await appendCaseEntry(client,row!.id,actor,'response',{reason:text(action.reason,1000),evidenceText:evidence(action.evidenceText)},retainUntil);response={ok:true,id:row!.id,matchId:id,status:'pending'};
  }else if(action.type==='correction.appeal'){
   if(!rights.participant||row!.decision!=='rejected'||!row!.decided_at||opened?.data.appealOf||records.some(e=>e.kind==='appeal')||now.getTime()>row!.decided_at.getTime()+policy.appealHours*3600000)throw new DomainError('correction_appeal_unavailable','Beroep kan eenmaal binnen de gepubliceerde termijn na afwijzing.',409);if(!isPublished(state)||state.resultRevision!==row!.result_revision)throw new DomainError('revision_conflict','Deze primaire uitslag is inmiddels gewijzigd.',409);if((await client.query('select 1 from dartflow_private.match_correction_requests q where match_id=$1 and not exists(select 1 from dartflow_private.match_correction_decisions d where d.request_id=q.id)',[id])).rowCount)throw new DomainError('correction_pending','Er ligt al een open dossier voor deze primaire uitslag.',409);
   const child=randomUUID(),reason=text(action.reason,1000),until=new Date(now.getTime()+policy.evidenceDays*86400000);await client.query('insert into dartflow_private.match_correction_requests(id,match_id,requested_by,reason,base_revision,result_revision,undo_count,prior_state)values($1,$2,$3,$4,$5,$6,$7,$8)',[child,id,actor,reason,state.revision,state.resultRevision,row!.undo_count,JSON.stringify(state)]);await appendCaseEntry(client,child,actor,'opened',{policy,category:category(opened?.data.category),moment:opened?.data.moment??null,appealOf:row!.id,priorReviewer:row!.actor_id,evidenceText:evidence(action.evidenceText)},until);await appendCaseEntry(client,row!.id,actor,'appeal',{childId:child,reason},retainUntil);response={ok:true,id:child,matchId:id,status:'pending'};
  }else if(action.type==='correction.close'){
   const deadline=row!.decided_at?row!.decided_at.getTime()+policy.appealHours*3600000:Infinity;if(!row!.decision||records.some(e=>e.kind==='appeal')||row!.decision==='rejected'&&!opened?.data.appealOf&&now.getTime()<=deadline||row!.decision==='approved'&&(!isPublished(state)||dependencyHold(await origin(client,state))?.requestId===row!.id))throw new DomainError('correction_close_unavailable','Rond eerst herstel en de beschikbare beroepsprocedure af.',409);await appendCaseEntry(client,row!.id,actor,'closed',{reason:text(action.reason,1000)},retainUntil);if(typeof opened?.data.appealOf==='string'){const parent=await caseEntries(client,[opened.data.appealOf]);if(!parent.some(e=>e.kind==='closed'))await appendCaseEntry(client,opened.data.appealOf,actor,'closed',{reason:'Beroep definitief afgehandeld; zie gekoppeld dossier.'},caseRetention(parent,row!.created_at));}response={ok:true,id:row!.id,matchId:id,status:row!.decision};
  }else if(action.type==='correction.repair'){
   await repairDependencies(client,actor,row!,state,text(action.reason,1000));response={ok:true,id:row!.id,matchId:id,status:'approved'};
  }else{
   row=(await client.query<RequestRow>(`${requestsSql} where q.id=$1`,[row!.id])).rows[0];if(row.decision)throw new DomainError('correction_decided','Dit correctieverzoek heeft al een definitieve beslissing.',409);
   if(action.type==='correction.decide'&&!hasOpponentResponse(records,row.requested_by,participants)&&now<caseResponseDue(records,row.created_at))throw new DomainError('correction_response_pending','Geef de tegenpartij gelegenheid te reageren tot de gepubliceerde reactietermijn verstreken is.',409);
   const decision=action.type==='correction.cancel'?'cancelled':action.decision==='approve'?'approved':action.decision==='reject'?'rejected':null;if(!decision)throw new DomainError('invalid_decision','Kies goedkeuren of afwijzen.');
   const decisionReason=action.type==='correction.cancel'?'Ingetrokken door de aanvrager.':text(action.reason,1000);
   await client.query('insert into dartflow_private.match_correction_decisions(request_id,actor_id,decision,reason,detail)values($1,$2,$3,$4,$5)',[row.id,actor,decision,decisionReason,JSON.stringify({requestId,baseRevision:row.base_revision,resultRevision:row.result_revision,undoCount:row.undo_count})]);row.decision_reason=decisionReason;
   const hold=decision==='approved'?await reopen(client,actor,row,state):undefined;response={ok:true,id:row.id,matchId:id,status:decision,...(hold?{dependencyHold:hold}:{})};
  }
  if(action.type==='correction.request'||action.type==='correction.appeal'||action.type==='correction.cancel'||action.type==='correction.decide'&&response.status==='rejected')await client.query('update dartflow_private.platform_match_links set projected=false where match_id=$1',[state.id]);
  await correctionNotices(client,state,requestId,action.type==='correction.decide'?response.status:action.type.slice(11));
  await client.query('insert into dartflow_private.match_correction_receipts(actor_id,request_id,match_id,payload_hash,response)values($1,$2,$3,$4,$5)',[actor,requestId,id,payloadHash,JSON.stringify(response)]);await client.query('commit');return response;
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
