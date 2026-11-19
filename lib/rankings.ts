import{getCircuitQualification}from'./circuit-qualifications';
import type { PoolClient } from 'pg';
import { database } from './db';
import { DomainError } from './domain';
import { nationalRatingFormat, rankRatingRows } from './ranking-domain';
import {NATIONAL_RATING_ID,postFreeRankingSource,rankingList} from './ranking-generations';
import {admitOfficialRankingMatch,bookOfficialRankingMatch,hasOfficialRankingAdmission} from './ranking-events';
import {canReadRankingList,pendingRankingApprovals,rankingListView,readableRankingLists} from './ranking-service';
import { NATIONAL_RATING_POLICY as policy } from './ranking-policy';
import type { RankingEligibility, RankingRow, RankingsResponse } from './ranking-types';
import type {MatchRankingDestination} from './ranking-types';
import type { MatchAction, MatchState } from './types';

type Client = Pick<PoolClient, 'query'>;
const timestamp = (value: Date | string): string => new Date(value).toISOString();

/** Original result proofs stay immutable; this projection reports their current effective books. */
export async function getMatchRankingDestinations(client:Client,state:MatchState):Promise<MatchRankingDestination[]>{
  type Row={list_id:string;name:string;scope:'national'|'club';kind:'rating'|'circuit';policy:{version:string};active_generation:string|null;publication_paused:boolean;eligible:boolean|null;reason:string|null;source_id:string|null;source_revision:number|null;verdict:'valid'|'void'|null};
  const rows=(await client.query<Row>(`with destinations as(
    select d.list_id,d.policy_version,a.eligible,a.reason from dartflow_private.ranking_match_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id where a.match_id=$1
    union select s.list_id,s.policy_version,true,null from dartflow_private.ranking_sources s where s.match_id=$1 and s.declaration_id is null)
    select l.id as list_id,l.name,l.scope,l.kind,p.policy,l.active_generation,l.publication_paused,d.eligible,d.reason,s.id as source_id,r.revision as source_revision,r.verdict from destinations d join dartflow_private.ranking_lists l on l.id=d.list_id join dartflow_private.ranking_list_policies p on p.list_id=l.id and p.version=d.policy_version
    left join dartflow_private.ranking_sources s on s.list_id=l.id and s.match_id=$1 left join lateral(select revision,verdict from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true order by l.id`,[state.id])).rows;
  const result:MatchRankingDestination[]=[];
  for(const row of rows){
    const booking=row.source_id?(await client.query<{player_id:string;before_rating:number;after_rating:number;delta:number}>('select player_id,before_rating,after_rating,delta from dartflow_private.ranking_generation_bookings where generation_id=$1 and source_id=$2',[row.active_generation,row.source_id])).rows:[];
    const ordered=state.players.map(player=>booking.find(value=>value.player_id===player.id));
    result.push({listId:row.list_id,name:row.name,scope:row.scope,kind:row.kind,policyVersion:row.policy.version,publicationPaused:row.publication_paused,status:row.verdict==='void'?'void':row.source_id&&booking.length?'booked':row.eligible?'admitted':'excluded',generation:row.active_generation,...(row.source_id?{sourceId:row.source_id,sourceRevision:row.source_revision!}:{}),...(ordered.every(Boolean)?{before:ordered.map(item=>Number(item!.before_rating)),after:ordered.map(item=>Number(item!.after_rating)),deltas:ordered.map(item=>Number(item!.delta))}:{}),reason:row.publication_paused?'Publicatie van deze ranglijst is tijdelijk gepauzeerd; de geaccepteerde score blijft bewaard.':row.verdict==='void'?'Deze bron is na een onafhankelijk besluit ongeldig voor deze bestemming.':row.reason});
  }
  return result;
}

/** Origins are read from the existing link; a client cannot promote an event to ranked. */
export async function matchRankingEligibility(client: Client, state: MatchState): Promise<RankingEligibility> {
  const reject = (reason: string): RankingEligibility => ({ eligible: false, reason });
  if(state.guestPlayerIds?.length)return reject('Een eventgast heeft geen geauthenticeerde rankingidentiteit. Een latere historieclaim verandert deze oorspronkelijke toelating niet.');
  if (!['planned', 'called', 'ready'].includes(state.status) || state.game.visits.length || state.previousSets.length) return reject('De rankingkeuze staat vast zodra de partij start.');
  if (!nationalRatingFormat(state.settings)) return reject('Landelijke rating vereist singles 501, dubbel uit, één set en best of 5 tot en met 19 oneven legs.');
  if (state.players.length !== 2 || state.players[0].id === state.players[1].id) return reject('Twee verschillende ingelogde spelers zijn vereist.');
  if(state.sideParticipants?.some(side=>side.length!==1))return reject('Individuele Elo geldt uitsluitend voor singles; koppels en teams hebben een eigen stand.');
  if (state.localCompanion) return reject('Beide spelers bevestigen een rankingpartij en de uitslag vanuit hun eigen sessie.');
  const origins = await client.query<{ kind: string; fixture_id: string }>('select e.kind,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1', [state.id]);
  if (origins.rows.length !== 1 || origins.rows[0].kind !== 'lobby' || origins.rows[0].fixture_id !== 'free') return reject('Deze partij heeft geen vooraf toegelaten landelijke rankingbestemming.');
  const players = await client.query('select id from dartflow_private.profiles where id=any($1::uuid[]) and deletion_requested_at is null and deleted_at is null and display_name_confirmed', [state.players.map(p => p.id)]);
  if (players.rowCount !== 2) return reject('Beide spelers moeten een actief, bevestigd account gebruiken.');
  return { eligible: true, reason: null };
}

/** Runs inside the existing match transaction, after the match/event locks. */
export async function prepareMatchRanking(client: PoolClient, actorId: string, source: MatchState, next: MatchState, action: MatchAction): Promise<void> {
  if(action.type==='start')await admitOfficialRankingMatch(client,source);
  if(action.type==='resolve'&&(source.ranking?.status==='reserved'||await hasOfficialRankingAdmission(client,source.id))&&source.players.some(player=>player.id===actorId))throw new DomainError('ranking_independent_review_required','Een betwiste rankingpartij vereist een onafhankelijke wedstrijdleider. Je kunt je eigen partij niet beoordelen.',403);
  if (action.type === 'ranking-consent' || (action.type === 'start' && next.ranking?.consents.every(Boolean))) {
    const eligibility = await matchRankingEligibility(client, source);
    if (!eligibility.eligible) throw new DomainError('ranking_ineligible', eligibility.reason!, 409);
  }
  if (action.type === 'start' && next.ranking?.consents.every(Boolean)) {
    if (next.ranking.policyVersion !== policy.version) throw new DomainError('ranking_policy_changed', 'De rankingregels zijn gewijzigd. Bevestig de actuele versie vóór de start.', 409);
    const pair = next.players.map(p => p.id).sort();
    // Pair locks also serialize simultaneous starts from different free lobbies.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`dartflow:ranking:pair:${pair.join(':')}`]);
    const now = timestamp((await client.query<{ now: Date }>('select clock_timestamp() as now')).rows[0].now);
    const used = await client.query<{ n: number }>(`select count(*)::integer as n from dartflow_private.ranking_reservations r join dartflow_private.matches m on m.id=r.match_id
      where r.player_a=$1 and r.player_b=$2 and r.reserved_at>$3::timestamptz-interval '7 days' and r.reserved_at<=$3::timestamptz
      and (r.first_throw_at is not null or m.state->>'status'<>'abandoned')`, [pair[0], pair[1], now]);
    if (used.rows[0].n >= policy.freeMatchesPerWindow) throw new DomainError('ranking_rematch_limit', 'Jullie hebben al twee vrije rankingpartijen in de afgelopen zeven dagen. Trek de rankingkeuze in om vrij te spelen.', 409);
    await client.query('insert into dartflow_private.ranking_reservations(match_id,policy_version,player_a,player_b,reserved_at,declaration_revision) values($1,$2,$3,$4,$5,$6)', [next.id, policy.version, pair[0], pair[1], now, source.revision]);
    next.ranking.status = 'reserved';
    next.ranking.reservedAt = now;
  }
  if (action.type === 'score' && source.ranking?.status === 'reserved') {
    // A later undo does not refund a slot after an actual first throw.
    await client.query('update dartflow_private.ranking_reservations set first_throw_at=coalesce(first_throw_at,clock_timestamp()) where match_id=$1', [next.id]);
  }
}

/** Both books, the counters and the match projection commit in one transaction. */
export async function bookMatchRanking(client: PoolClient, state: MatchState): Promise<void> {
  await bookOfficialRankingMatch(client,state);
  if(state.guestPlayerIds?.length)return;
  if (state.ranking?.status !== 'reserved' || !state.resultPublished || !state.confirmations.every(Boolean) || state.status !== 'confirmed' || state.resultRevision === null) return;
  if (state.administrativeDecision || !state.winnerId || !state.players.some(p => p.id === state.winnerId) || state.game.status !== 'finished' || !nationalRatingFormat(state.settings)) throw new DomainError('ranking_source_invalid', 'Deze uitslag is niet sportief uitgespeeld voor de ranking.', 409);
  const reservation = await client.query<{ policy_version: string; first_throw_at: Date | null }>('select policy_version,first_throw_at from dartflow_private.ranking_reservations where match_id=$1', [state.id]);
  if (!reservation.rows[0]?.first_throw_at || reservation.rows[0].policy_version !== policy.version || !state.ranking.consents.every(Boolean)) throw new DomainError('ranking_source_invalid', 'De vooraf bevestigde rankingtoelating ontbreekt.', 409);
  // A single policy lock gives every source one stable server order across all players.
  await client.query('select id from dartflow_private.ranking_policies where id=$1 for update', [policy.version]);
  const existing = await client.query<{ sequence: string; before_ratings: [number, number]; after_ratings: [number, number]; deltas: [number, number] }>('select sequence,before_ratings,after_ratings,deltas from dartflow_private.ranking_bookings where match_id=$1', [state.id]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    // A reviewed primary correction keeps the original receipt while its new proof replays the canonical ledger.
    await postFreeRankingSource(client,state);
    state.ranking.status = 'booked';
    state.ranking.booking = { sequence: Number(row.sequence), before: row.before_ratings, after: row.after_ratings, deltas: row.deltas };
    return;
  }
  const ids = state.players.map(p => p.id);
  for (const id of [...ids].sort()) await client.query('insert into dartflow_private.ranking_accounts(player_id) values($1) on conflict(player_id) do nothing', [id]);
  const accounts = await client.query<{ player_id: string; rating: number }>('select player_id,rating from dartflow_private.ranking_accounts where player_id=any($1::uuid[]) order by player_id for update', [ids]);
  void accounts;
  const canonical=await postFreeRankingSource(client,state),before=canonical.before,calculated={after:canonical.after,deltas:canonical.deltas},sequence=canonical.sequence;
  await client.query('update dartflow_private.ranking_policies set sequence=greatest(sequence,$2) where id=$1',[policy.version,sequence]);
  const playedAt = timestamp((await client.query<{ now: Date }>('select clock_timestamp() as now')).rows[0].now);
  await client.query(`insert into dartflow_private.ranking_bookings(match_id,policy_version,sequence,result_revision,players,winner_id,before_ratings,after_ratings,deltas,played_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [state.id, policy.version, sequence, state.resultRevision, ids, state.winnerId, before, calculated.after, calculated.deltas, playedAt]);
  for (const [index, id] of ids.entries()) {
    const opponent = await client.query('insert into dartflow_private.ranking_opponents(player_id,opponent_id) values($1,$2) on conflict(player_id,opponent_id) do nothing returning player_id', [id, ids[1 - index]]);
    await client.query('update dartflow_private.ranking_accounts set rating=$2,played=played+1,unique_opponents=unique_opponents+$3,last_played_at=$4 where player_id=$1', [id, calculated.after[index], opponent.rowCount ?? 0, playedAt]);
  }
  state.ranking.status = 'booked';
  state.ranking.booking = { sequence, before, after: calculated.after, deltas: calculated.deltas };
}

export async function getRankings(actorId: string, options: { listId?: string; view?: 'top' | 'around'; status?: 'all' | 'active' | 'provisional' | 'inactive'; limit?: number } = {}): Promise<RankingsResponse> {
  const client = await database().connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const now = timestamp((await client.query<{ now: Date }>('select clock_timestamp() as now')).rows[0].now);
    const selected=await rankingList(client,options.listId??NATIONAL_RATING_ID);
    if(!await canReadRankingList(client,selected,actorId))throw new DomainError('forbidden','Je hebt geen actuele toegang tot deze clubranking.',403);
    type StoredRow={playerId:string;name:string;rating:number;played:number;uniqueOpponents:number;lastPlayedAt:Date|null;points:number;results:NonNullable<RankingRow['results']>};
    const stored=await client.query<StoredRow>(`select a.player_id as "playerId",coalesce(nullif(p.display_name,''),p.name) as name,a.rating,a.played,a.unique_opponents as "uniqueOpponents",a.last_played_at as "lastPlayedAt",a.points,a.results
      from dartflow_private.ranking_generation_accounts a join dartflow_private.profiles p on p.id=a.player_id where a.generation_id=$1 and p.deleted_at is null and p.deletion_requested_at is null`,[selected.active_generation]);
    const base=stored.rows.map(row=>({...row,rating:Number(row.rating),lastPlayedAt:row.lastPlayedAt?timestamp(row.lastPlayedAt):null}));
    let all:RankingRow[];
    if(selected.kind==='rating')all=rankRatingRows(base,Date.parse(now),selected.policy);
    else{
      const compare=(a:typeof base[number],b:typeof base[number])=>{if(b.points!==a.points)return b.points-a.points;for(let i=0;i<selected.policy.bestResults;i++){const difference=(b.results[i]?.points??0)-(a.results[i]?.points??0);if(difference)return difference;}return 0;};
      const sorted=base.sort((a,b)=>compare(a,b)||a.playerId.localeCompare(b.playerId));
      all=sorted.map((row,index)=>({...row,displayRating:row.points,provisional:false,active:true,position:index>0&&compare(sorted[index-1],row)===0?0:index+1}));
      all.forEach((row,index)=>{if(row.position===0)row.position=all[index-1].position;});
    }
    let me=all.find(row=>row.playerId===actorId)??null;
    if(!me){const profile=await client.query<{name:string}>("select coalesce(nullif(display_name,''),name)as name from dartflow_private.profiles where id=$1 and deletion_requested_at is null and deleted_at is null",[actorId]);if(profile.rows[0])me={playerId:actorId,name:profile.rows[0].name,rating:selected.kind==='rating'?selected.policy.initialRating:0,displayRating:selected.kind==='rating'?selected.policy.initialRating:0,played:0,uniqueOpponents:0,position:null,provisional:selected.kind==='rating',active:false,lastPlayedAt:null,points:0,results:[]};}
    const limit=Math.max(1,Math.min(100,Number.isSafeInteger(options.limit)?options.limit!:50));
    const filtered=all.filter(row=>options.status==='active'?row.active&&!row.provisional:options.status==='provisional'?row.provisional:options.status==='inactive'?!row.active:true);
    const index=filtered.findIndex(row=>row.playerId===actorId),offset=options.view==='around'&&index>=0?Math.max(0,Math.min(Math.max(0,filtered.length-limit),index-Math.floor(limit/2))):0;
    const selectedList=await rankingListView(client,selected,actorId);
    const history=await client.query<{source_id:string;source_revision:number;source_kind:'match'|'event';match_id:string|null;entity_id:string|null;sequence:string;before_rating:number;after_rating:number;delta:number;points:number;place:number|null;recorded_at:Date;opponent_name:string}>(`select b.*,s.source_kind,s.match_id,s.entity_id,s.sequence,
      case when s.source_kind='event' then coalesce(e.state->>'name','Evenement') when p.deleted_at is not null or p.deletion_requested_at is not null then 'Verwijderde speler' else coalesce(nullif(p.display_name,''),p.name,'Speler')end as opponent_name
      from dartflow_private.ranking_generation_bookings b join dartflow_private.ranking_sources s on s.id=b.source_id join dartflow_private.ranking_source_revisions r on r.source_id=b.source_id and r.revision=b.source_revision
      left join dartflow_private.profiles p on p.id=(r.data->'players'->>(case when r.data->'players'->>0=$2::text then 1 else 0 end))::uuid left join dartflow_private.platform_entities e on e.id=s.entity_id
      where b.generation_id=$1 and b.player_id=$2::uuid order by s.sequence desc limit 50`,[selected.active_generation,actorId]);
    const generationRow=(await client.query<{id:string;previous_generation:string|null;created_at:Date;source_count:number}>('select *from dartflow_private.ranking_generations where id=$1',[selected.active_generation])).rows[0];
    const managementSources:NonNullable<RankingsResponse['managementSources']>=[];
    if(selectedList.canManage){
      const sources=(await client.query<{id:string;revision:number;source_kind:'match'|'event';match_id:string|null;entity_id:string|null;verdict:'valid'|'void';data:{players:string[]};reason:string;sequence:string}>(`select s.id,s.source_kind,s.match_id,s.entity_id,s.sequence,r.revision,r.verdict,r.data,r.reason from dartflow_private.ranking_sources s join lateral(select *from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true where s.list_id=$1 order by s.sequence desc limit 50`,[selected.id])).rows;
      for(const source of sources){const labels=await client.query<{name:string}>("select case when deleted_at is not null or deletion_requested_at is not null then 'Verwijderde speler' else coalesce(nullif(display_name,''),name)end as name from dartflow_private.profiles where id=any($1::uuid[])order by array_position($1::uuid[],id)",[source.data.players]);managementSources.push({id:source.id,revision:source.revision,kind:source.source_kind,matchId:source.match_id,entityId:source.entity_id,verdict:source.verdict,playersNames:labels.rows.map(row=>row.name),reason:source.reason,sequence:Number(source.sequence)});}
    }
    const result:RankingsResponse={...await getCircuitQualification(client,selected,actorId),policy:{...policy,...selected.policy},updatedAt:now,rows:filtered.slice(offset,offset+limit),me,lists:await readableRankingLists(client,actorId),selectedList,approvals:await pendingRankingApprovals(client,actorId),generation:generationRow?{id:generationRow.id,previousId:generationRow.previous_generation,createdAt:timestamp(generationRow.created_at),sourceCount:generationRow.source_count}:null,managementSources,
      history:history.rows.map(row=>({sourceId:row.source_id,sourceRevision:row.source_revision,sourceKind:row.source_kind,entityId:row.entity_id,matchId:row.match_id??'',sequence:Number(row.sequence),before:Number(row.before_rating),after:Number(row.after_rating),delta:Number(row.delta),points:row.points,place:row.place,recordedAt:timestamp(row.recorded_at),opponentName:row.opponent_name}))};
    await client.query('commit');return result;
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
