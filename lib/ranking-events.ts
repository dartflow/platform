import type { PoolClient } from 'pg';
import { DomainError } from './domain';
import {clubIsActiveMember} from './club-access';
import { appendRankingSource, lockRankingLists, rebuildRankingGeneration } from './ranking-generations';
import { circuitPoints, effectiveRankingRule, knockoutPlacements, publishedRatingFormat } from './ranking-service-domain';
import type { RankingPolicy, RankingRule } from './ranking-service-types';
import type { MatchState } from './types';
import type { EntityRow } from './platform-store';
import {tournamentOutcome} from './tournament-formats';
import{rankingEventContext,seasonMatchRankingConfirmed}from'./ranking-seasons';
import{assertRankingRosterConfirmed}from'./ranking-rosters';

export type RankingDeclaration = { id: string; entity_id: string; list_id: string; policy_version: number; rules: RankingRule[]; status: 'pending' | 'approved' | 'rejected'; scope: 'national' | 'club'; kind: 'rating' | 'circuit'; club_id: string | null; name: string; policy: RankingPolicy; requested_by: string; decided_by: string | null; reason: string | null };

export async function eventDeclarations(client: Pick<PoolClient, 'query'>, entityId: string): Promise<RankingDeclaration[]> {
  return (await client.query<RankingDeclaration>(`select d.*,l.scope,l.kind,l.club_id,l.name,p.policy from dartflow_private.ranking_event_declarations d join dartflow_private.ranking_lists l on l.id=d.list_id join dartflow_private.ranking_list_policies p on p.list_id=d.list_id and p.version=d.policy_version where d.entity_id=$1 order by d.list_id`, [entityId])).rows;
}

export async function assertEventRankingMutable(client: Pick<PoolClient, 'query'>, entityId: string): Promise<void> {
  if ((await client.query("select 1 from dartflow_private.ranking_event_declarations where entity_id=$1 and status in('pending','approved') limit 1", [entityId])).rowCount) throw new DomainError('ranking_event_rules_locked', 'Regels en schema staan vast bij een gepubliceerde rankingbestemming. Maak een nieuw evenement voor gewijzigde regels.', 409);
}

export async function assertRankingEventNotStarted(client: Pick<PoolClient, 'query'>, event: EntityRow): Promise<void> {
  if (event.state.ownership === 'personal') throw new DomainError('ranking_personal_forbidden', 'Een persoonlijk evenement kan nooit officiële rankingbestemmingen krijgen.', 403);
  if (!['tournament', 'league'].includes(event.kind)) throw new DomainError('ranking_event_unsupported', 'Publiceer de rankingbestemming op een individuele competitie of toernooi met een vastgelegd schema.', 409);
  const season=await rankingEventContext(client,event);
  if(season&&!season.publishedAt)throw new DomainError('ranking_season_unpublished','Publiceer eerst het gecontroleerde seizoensprogramma en de regels, daarna de rankingbestemmingen vóór de eerste partij.',409);
  if (!event.state.fixtures?.length) throw new DomainError('ranking_schedule_required', 'Leg eerst het volledige schema vast en publiceer daarna de bestemmingen vóór de eerste partij.', 409);
  if ((await client.query(`select 1 from dartflow_private.platform_match_links l join dartflow_private.matches m on m.id=l.match_id where l.entity_id=$1 and (m.state->>'status' not in('planned','called','ready') or jsonb_array_length(m.state->'game'->'visits')>0) limit 1`, [event.id])).rowCount) throw new DomainError('ranking_event_started', 'Rankingbestemmingen kunnen niet na de start van het evenement worden toegekend.', 409);
}

async function participantEligibility(client: PoolClient, declaration: RankingDeclaration, playerId: string,eventGuest=false): Promise<{ eligible: boolean; reason: string | null }> {
  if(eventGuest)return{eligible:false,reason:'Eventgast zonder geauthenticeerde rankingidentiteit; een latere historieclaim wijzigt deze oorspronkelijke toelating niet.'};
  const profile = (await client.query('select display_name_confirmed,deleted_at,deletion_requested_at from dartflow_private.profiles where id=$1', [playerId])).rows[0];
  if (!profile || !profile.display_name_confirmed || profile.deleted_at || profile.deletion_requested_at) return { eligible: false, reason: 'Geen bevestigd actief spelersaccount bij toelating.' };
  if (declaration.scope === 'club' && !declaration.policy.allowGuests && !await clubIsActiveMember(client,declaration.club_id!,playerId)) return { eligible: false, reason: 'Gast zonder puntenrecht volgens de gepubliceerde clubregel.' };
  return { eligible: true, reason: null };
}

/** Called under the existing event+match lock before match.start accepts the first turn. */
export async function admitOfficialRankingMatch(client: PoolClient, state: MatchState): Promise<void> {
  const origin = (await client.query<EntityRow & { fixture_id: string }>(`select e.*,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind in('league','tournament')`, [state.id])).rows[0];
  if (!origin) return;
  const season=await rankingEventContext(client,origin),seasonFixture=season?.fixtures.find(fixture=>fixture.slots.some(slot=>slot.id===origin.fixture_id)),seasonSlot=seasonFixture?.slots.find(slot=>slot.id===origin.fixture_id);
  const declarations = await eventDeclarations(client, origin.id);
  if (!declarations.length) return;
  if (origin.state.ownership === 'personal') throw new DomainError('ranking_personal_forbidden', 'Een persoonlijk evenement kan geen officiële rankingboekingen ontvangen.', 403);
  if (declarations.some(declaration => declaration.status === 'pending')) throw new DomainError('ranking_declaration_pending', 'De rankingtoelating is nog niet door de bevoegde beheerder beslist.', 409);
  const fixture = origin.state.fixtures?.find(item => item.id === origin.fixture_id);
  if (!fixture) throw new DomainError('ranking_fixture_unknown', 'De gepubliceerde rankingregel verwijst niet naar deze partij.', 409);
  for (const declaration of declarations.filter(item => item.status === 'approved')) {
    if(season&&(seasonFixture?.classification||(seasonSlot?.kind??'single')!=='single'||state.sideParticipants?.some(side=>side.length!==1))){await client.query('insert into dartflow_private.ranking_match_admissions(match_id,declaration_id,eligible,reason,source_revision)values($1,$2,false,$3,$4)on conflict(match_id,declaration_id)do nothing',[state.id,declaration.id,'Alleen vooraf geselecteerde reguliere competitiesingles tellen mee; dubbels, teamgames en plaatsingsbeslissingen blijven afzonderlijk.',state.revision]);continue;}
    await assertRankingRosterConfirmed(client,state);
    const accountIds=state.players.filter(player=>!state.guestPlayerIds?.includes(player.id)).map(player=>player.id);
    const accepted = await client.query('select player_id from dartflow_private.ranking_event_confirmations where declaration_id=$1 and player_id=any($2::uuid[])', [declaration.id,accountIds]);
    if (accepted.rowCount !== accountIds.length) throw new DomainError('ranking_event_confirmation_required', 'De geauthenticeerde deelnemers moeten de gepubliceerde rankinggevolgen vóór hun eerste partij bevestigen. Eventgasten krijgen geen rankingtoelating.', 409);
    const originalFixtureId=(fixture as typeof fixture&{rankingOriginalFixtureId?:string}).rankingOriginalFixtureId;
    let eligible = effectiveRankingRule(declaration.rules, originalFixtureId?{...fixture,id:originalFixtureId}:fixture), reason: string | null = eligible ? null : 'Deze fase of partij is vooraf uitgesloten.';
    const players = [];
    for (const player of state.players) {
      const verdict = await participantEligibility(client, declaration, player.id,state.guestPlayerIds?.includes(player.id));
      const checkIn=season?Boolean(seasonFixture?.checkIns.includes(player.id)||season.participants.some(entry=>entry.id===player.id&&entry.checkedIn)):Boolean((await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and attributes->>'checkedIn'='true'",[origin.id,player.id])).rowCount);
      await client.query('insert into dartflow_private.ranking_participant_admissions(declaration_id,player_id,eligible,reason,checked_in)values($1,$2,$3,$4,$5)on conflict(declaration_id,player_id)do nothing', [declaration.id, player.id, verdict.eligible, verdict.reason,checkIn]);
      const stored = (await client.query<{ eligible: boolean }>('select eligible from dartflow_private.ranking_participant_admissions where declaration_id=$1 and player_id=$2', [declaration.id, player.id])).rows[0];
      players.push(stored.eligible);
    }
    if (declaration.kind === 'rating' && (!publishedRatingFormat(state.settings, declaration.policy) || players.some(value => !value)||state.sideParticipants?.some(side=>side.length!==1))) { eligible = false; reason = 'Format of speler was bij de start niet toegelaten voor deze rating.'; }
    await client.query('insert into dartflow_private.ranking_match_admissions(match_id,declaration_id,eligible,reason,source_revision)values($1,$2,$3,$4,$5)on conflict(match_id,declaration_id)do nothing', [state.id, declaration.id, eligible, reason, state.revision]);
  }
}

export async function bookOfficialRankingMatch(client: PoolClient, state: MatchState): Promise<void> {
  if(state.guestPlayerIds?.length)return;
  if (state.status !== 'confirmed' || !state.resultPublished || !state.confirmations.every(Boolean) || state.resultRevision === null || state.administrativeDecision || state.game.status !== 'finished' || !state.winnerId ||state.sideParticipants?.some(side=>side.length!==1)|| ![...state.previousSets, state.game].some(game => game.visits.length)) return;
  if(!await seasonMatchRankingConfirmed(client,state))return;
  const admissions = (await client.query<{ list_id: string; declaration_id: string; policy_version: number }>(`select d.list_id,d.id as declaration_id,d.policy_version from dartflow_private.ranking_match_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id join dartflow_private.ranking_lists l on l.id=d.list_id where a.match_id=$1 and a.eligible and d.status='approved' and l.kind='rating' order by d.list_id`, [state.id])).rows;
  const lists = await lockRankingLists(client, admissions.map(item => item.list_id));
  const playedAt = (await client.query<{ now: Date }>('select clock_timestamp()as now')).rows[0].now.toISOString();
  for (const admission of admissions) {
    const list = lists.find(item => item.id === admission.list_id)!;
    const source = await appendRankingSource(client, list, { kind: 'match', key: state.id, matchId: state.id, declarationId: admission.declaration_id, policyVersion: admission.policy_version, data: { players: state.players.map(player => player.id), winnerId: state.winnerId, resultRevision: state.resultRevision, playedAt }, reason: 'Vooraf toegelaten en wederzijds bevestigde officiële single' });
    if (source.changed) await rebuildRankingGeneration(client, list);
  }
}

export async function finalizeOfficialCircuit(client: PoolClient, event: EntityRow,recertification?:{listId:string;actorId:string;reason:string}): Promise<{ generation: string; previousGeneration: string | null; affectedPlayers: number }[]> {
  if (event.state.ownership === 'personal') throw new DomainError('ranking_personal_forbidden', 'Een persoonlijk evenement kan geen officiële circuitboekingen ontvangen.', 403);
  const declarations = (await eventDeclarations(client, event.id)).filter(item => item.status === 'approved' && item.kind === 'circuit'&&(!recertification||item.list_id===recertification.listId));
  if (!declarations.length) throw new DomainError('ranking_circuit_not_declared', 'Er is geen vooraf goedgekeurde circuitbestemming.', 409);
  if(event.state.primaryCorrectionOpen||event.state.primaryCorrectionHold)throw new DomainError('primary_correction_dependency_hold','Bevestig eerst de heropende bronpartij en handel de afhankelijke vervolgpartijen af.',409);
  const holds=(await client.query<{request_id:string;list_id:string}>(`select h.request_id,h.list_id from dartflow_private.ranking_primary_correction_holds h where h.entity_id=$1 and h.list_id=any($2::uuid[])and not exists(select 1 from dartflow_private.ranking_primary_correction_releases r where r.request_id=h.request_id and r.list_id=h.list_id)`,[event.id,declarations.map(item=>item.list_id)])).rows;
  if(holds.length&&!recertification)throw new DomainError('ranking_circuit_recertification_required','Een onafhankelijke circuitbeheerder moet de eindstand na de primaire correctie opnieuw erkennen.',409);
  const states = (await client.query<{ state: MatchState; fixture_id: string }>('select m.state,l.fixture_id from dartflow_private.platform_match_links l join dartflow_private.matches m on m.id=l.match_id where l.entity_id=$1', [event.id])).rows.filter(item=>event.state.fixtures?.some(fixture=>fixture.id===item.fixture_id));
  if(recertification&&states.some(({state})=>state.players.some(player=>player.id===recertification.actorId)))throw new DomainError('ranking_independent_review_required','Een onafhankelijke circuitbeheerder erkent de gewijzigde eindstand van een evenement waaraan je deelnam.',403);
  if(states.some(({state})=>state.sideParticipants?.some(side=>side.length!==1)))throw new DomainError('ranking_individual_event_required','Een individueel circuit accepteert geen koppel- of teamuitslagen.',409);
  const fixtures = structuredClone(event.state.fixtures ?? []);
  for (const fixture of fixtures) {
    if (['bye','void'].includes(fixture.status)) continue;
    const match = states.find(item => item.fixture_id === fixture.id)?.state;
    if (!match || match.status !== 'confirmed' || !match.resultPublished || !match.confirmations.every(Boolean)) throw new DomainError('ranking_event_incomplete', 'Niet alle bronuitslagen zijn definitief en vrij van geschil.', 409);
    fixture.status = 'confirmed'; fixture.winnerId = match.winnerId; fixture.players = match.players.map(player => player.id);
    fixture.score=match.game.legs;fixture.started=[...match.previousSets,match.game].some(game=>game.visits.length);fixture.administrative=Boolean(match.administrativeDecision);
  }
  const outcome=(event.state.format==='swiss'||String(event.state.format).startsWith('double-elimination'))?tournamentOutcome(fixtures,String(event.state.format),event.state.tournamentRules?.seedOrder??[...new Set(fixtures.flatMap(f=>f.players.filter((id):id is string=>Boolean(id))))],event.state.tournamentRules?.swissRounds):null;
  if(outcome&&!outcome.completed)throw new DomainError('ranking_event_incomplete','Alle gepubliceerde toernooironden moeten definitief zijn.',409);
  const places = outcome?outcome.placings.map(row=>({playerId:row.playerId,place:row.position})):knockoutPlacements(fixtures);
  const checkedIn = new Set((await client.query<{ player_id: string }>('select distinct a.player_id from dartflow_private.ranking_participant_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id where d.entity_id=$1 and a.checked_in', [event.id])).rows.map(row => row.player_id));
  const started = new Set<string>(), played = new Set<string>();
  for (const { state } of states) {
    if (!state.administrativeDecision && [...state.previousSets, state.game].some(game => game.visits.length)) for (const player of state.players) if (checkedIn.has(player.id)) started.add(player.id);
    if (!state.administrativeDecision && state.status === 'confirmed' && state.resultPublished && state.game.status === 'finished' && [...state.previousSets, state.game].some(game => game.visits.length)) for (const player of state.players) played.add(player.id);
  }
  const lists = await lockRankingLists(client, declarations.map(item => item.list_id));
  const result = [];
  for (const declaration of declarations) {
    if(!effectiveRankingRule(declaration.rules,{id:event.id,phase:'knockout',round:0}))continue;
    const list = lists.find(item => item.id === declaration.list_id)!;
    let changed = false;
    const now = (await client.query<{ now: Date }>('select clock_timestamp()as now')).rows[0].now.toISOString();
    for (const place of places) {
      const admission = (await client.query<{ eligible: boolean }>('select eligible from dartflow_private.ranking_participant_admissions where declaration_id=$1 and player_id=$2', [declaration.id, place.playerId])).rows[0];
      const eligible = admission?.eligible === true, validPlayed = played.has(place.playerId), isStarter = started.has(place.playerId);
      const source = await appendRankingSource(client, list, { kind: 'event', key: `${event.id}:${place.playerId}`, entityId: event.id, declarationId: declaration.id, policyVersion: declaration.policy_version, data: { players: [place.playerId], place: place.place, starters: started.size, played: validPlayed && isStarter, eligible, points: circuitPoints(started.size, place.place, validPlayed && isStarter && eligible, true, false, declaration.policy.minimumStarters), playedAt: now }, reason: recertification?.reason??'Definitieve canonieke eindplaats van volledig uitgespeeld evenement',...(recertification?{actorId:recertification.actorId,replaceExistingEvent:true}:{}) });
      changed ||= source.changed;
    }
    if (changed){const generation=await rebuildRankingGeneration(client,list);result.push(generation);if(recertification)for(const hold of holds.filter(item=>item.list_id===list.id))await client.query('insert into dartflow_private.ranking_primary_correction_releases(request_id,list_id,actor_id,reason,generation_id)values($1,$2,$3,$4,$5)on conflict do nothing',[hold.request_id,list.id,recertification.actorId,recertification.reason,generation.generation]);}
  }
  return result;
}

export async function hasOfficialRankingAdmission(client: Pick<PoolClient, 'query'>, matchId: string): Promise<boolean> {
  return Boolean((await client.query('select 1 from dartflow_private.ranking_match_admissions where match_id=$1 and eligible limit 1', [matchId])).rowCount);
}
