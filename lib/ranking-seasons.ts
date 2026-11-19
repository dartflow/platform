import type{PoolClient}from'pg';
import{DomainError}from'./domain';
import{clubIsActiveMember,clubPermission}from'./club-access';
import{requireAccess}from'./platform-store';
import type{EntityRow}from'./platform-store';
import{coreSeasonSettings}from'./seasons-types';
import type{SeasonFixture,SeasonState}from'./seasons-types';
import type{MatchState}from'./types';
import{appendRankingSource,lockRankingLists,rebuildRankingGeneration}from'./ranking-generations';
import type{RankingSourceData}from'./ranking-generations';

type Client=Pick<PoolClient,'query'>;
export async function rankingSeason(client:Client,event:EntityRow):Promise<SeasonState|undefined>{return event.state.seasonManaged===true?(await client.query<{state:SeasonState}>('select state from dartflow_private.competition_seasons where id=$1',[event.id])).rows[0]?.state:undefined;}
export async function seasonRankingManager(client:Client,season:SeasonState,actor:string):Promise<boolean>{
 if(season.scope==='national')return Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);
 return season.clubId!==null&&(await clubPermission(client,season.clubId,actor,'competitions.manage')||season.managerIds.includes(actor)&&await clubIsActiveMember(client,season.clubId,actor));
}
export async function requireRankingEventManager(client:Client,event:EntityRow,actor:string):Promise<void>{
 const season=await rankingSeason(client,event);if(!season){await requireAccess(client,event,actor,true);return;}
 if(!await seasonRankingManager(client,season,actor))throw new DomainError('forbidden','Je hebt geen actueel beheerrecht voor dit competitieseizoen.',403);
}
export async function seasonRankingParticipant(client:Client,season:SeasonState,actor:string):Promise<boolean>{
 const participant=season.participants.find(player=>player.id===actor&&player.status==='active');if(participant)return season.scope==='national'||Boolean(season.clubId&&await clubIsActiveMember(client,season.clubId,actor));
 for(const team of season.teams.filter(team=>team.status==='active'&&team.playerIds.includes(actor)))if(await clubIsActiveMember(client,team.clubId,actor))return true;return false;
}
/** The published template includes unopened team slots, while the public event hides unrevealed lineups. */
export async function rankingEventContext(client:Client,event:EntityRow):Promise<SeasonState|undefined>{
 const season=await rankingSeason(client,event);if(!season)return;
 event.state.settings=coreSeasonSettings(season.settings);event.state.ownership=season.scope==='national'?'platform':'club';
 event.state.fixtures=season.fixtures.flatMap(fixture=>fixture.slots.map(slot=>({id:slot.id,players:slot.players,round:fixture.round,phase:'league' as const,status:slot.status==='confirmed'&&fixture.status==='confirmed'?'confirmed' as const:slot.matchId?'live' as const:'scheduled' as const,...(slot.matchId?{matchId:slot.matchId}:{})})));
 return season;
}

export async function seasonMatchRankingConfirmed(client:Client,state:MatchState):Promise<boolean>{
 const link=(await client.query<{state:SeasonState;fixture_id:string}>('select s.state,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.competition_seasons s on s.id=l.entity_id where l.match_id=$1',[state.id])).rows[0];if(!link)return true;
 const fixture=link.state.fixtures.find(fixture=>fixture.slots.some(slot=>slot.id===link.fixture_id&&slot.matchId===state.id)),slot=fixture?.slots.find(slot=>slot.id===link.fixture_id);
 return Boolean(fixture&&slot&&fixture.status==='confirmed'&&!fixture.administrative&&!fixture.classification&&new Set(fixture.confirmations).size===2&&fixture.confirmations.includes(fixture.homeId)&&fixture.confirmations.includes(fixture.awayId)&&slot.status==='confirmed'&&!slot.administrative&&slot.resultRevision===state.resultRevision&&(slot.kind??'single')==='single');
}

/** A manager who played any recognized component cannot independently judge that encounter. */
export async function assertSeasonRankingDecision(client:Client,season:SeasonState,fixture:SeasonFixture,actor:string):Promise<void>{
 const ids=fixture.slots.flatMap(slot=>slot.matchId?[slot.matchId]:[]);if(!ids.length)return;
 const involved=(await client.query<{state:MatchState}>(`select m.state from dartflow_private.matches m where m.id=any($1::uuid[])and exists(select 1 from dartflow_private.ranking_match_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id where a.match_id=m.id and a.eligible and d.status='approved')`,[ids])).rows;
 const people=[...fixture.slots.flatMap(slot=>slot.sidePlayerIds?.flat()??slot.players.filter((id):id is string=>Boolean(id))),...season.teams.filter(team=>[fixture.homeId,fixture.awayId].includes(team.id)).flatMap(team=>team.playerIds)];
 if(involved.length&&(people.includes(actor)||involved.some(({state})=>[...state.players,...(state.sideParticipants?.flat()??[])].some(player=>player.id===actor))))throw new DomainError('ranking_independent_review_required','Een onafhankelijke wedstrijdleider beoordeelt een erkende ontmoeting waaraan je zelf deelnam.',403);
}

/** Called under the season's existing event/season lock, after captain status or a canonical slot changes. */
export async function syncSeasonRanking(client:PoolClient,season:SeasonState,actor:string,reason:string):Promise<void>{
 const matchIds=season.fixtures.flatMap(fixture=>fixture.slots.flatMap(slot=>slot.matchId?[slot.matchId]:[]));if(!matchIds.length)return;
 const admissions=(await client.query<{match_id:string;list_id:string;declaration_id:string;policy_version:number}>(`select a.match_id,d.list_id,d.id declaration_id,d.policy_version from dartflow_private.ranking_match_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id join dartflow_private.ranking_lists l on l.id=d.list_id where a.match_id=any($1::uuid[])and a.eligible and d.status='approved'and l.kind='rating'order by d.list_id,a.match_id`,[matchIds])).rows;if(!admissions.length)return;
 const lists=await lockRankingLists(client,admissions.map(admission=>admission.list_id)),changed=new Set<string>();
 const matches=(await client.query<{id:string;state:MatchState;created_at:Date|null}>('select m.id,m.state,r.created_at from dartflow_private.matches m left join dartflow_private.match_results r on r.match_id=m.id where m.id=any($1::uuid[])',[matchIds])).rows;
 for(const fixture of season.fixtures)for(const slot of fixture.slots){if(!slot.matchId)continue;const match=matches.find(match=>match.id===slot.matchId),state=match?.state;
  const fullyConfirmed=fixture.status==='confirmed'&&new Set(fixture.confirmations).size===2&&fixture.confirmations.includes(fixture.homeId)&&fixture.confirmations.includes(fixture.awayId)&&!fixture.administrative&&!fixture.classification;
  const sporting=fullyConfirmed&&slot.status==='confirmed'&&!slot.administrative&&(slot.kind??'single')==='single'&&(!slot.sidePlayerIds||slot.sidePlayerIds.every(side=>side.length===1))&&state?.status==='confirmed'&&state.resultPublished&&state.confirmations.every(Boolean)&&state.resultRevision!==null&&state.resultRevision===slot.resultRevision&&!state.administrativeDecision&&state.game.status==='finished'&&state.winnerId&&state.players.some(player=>player.id===state.winnerId)&&!state.sideParticipants?.some(side=>side.length!==1)&&[...state.previousSets,state.game].some(game=>game.visits.length)&&match!.created_at;
  for(const admission of admissions.filter(admission=>admission.match_id===slot.matchId)){
   const list=lists.find(list=>list.id===admission.list_id)!;
   if(sporting){
    const posted=await appendRankingSource(client,list,{kind:'match',key:state!.id,matchId:state!.id,declarationId:admission.declaration_id,policyVersion:admission.policy_version,
     data:{players:state!.players.map(player=>player.id),winnerId:state!.winnerId!,resultRevision:state!.resultRevision!,playedAt:match!.created_at!.toISOString()},actorId:actor,reason:`Dubbel bevestigde competitiesingle na definitieve ontmoeting: ${reason.slice(0,600)}`,reactivateExistingMatch:true});if(posted.changed)changed.add(list.id);
   }else{
    const source=(await client.query<{id:string;revision:number;verdict:string;data:RankingSourceData}>(`select s.id,r.revision,r.verdict,r.data from dartflow_private.ranking_sources s join lateral(select revision,verdict,data from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true where s.list_id=$1 and s.match_id=$2`,[list.id,slot.matchId])).rows[0];
    if(source?.verdict==='valid'){await client.query("insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,$2,'void',$3,$4,$5)",[source.id,source.revision+1,JSON.stringify({...source.data,seasonConfirmationWithdrawn:fixture.id}),actor,`Ontmoeting niet definitief erkend: ${reason.slice(0,700)}`]);changed.add(list.id);}
   }
  }
 }
 for(const list of lists)if(changed.has(list.id))await rebuildRankingGeneration(client,list);
}
