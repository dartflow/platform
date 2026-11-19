import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database } from './db';
import { DomainError } from './domain';
import { assertAccountActive } from './account-removal';
import { clubIsActiveMember, clubPermission } from './club-access';
import { entity, requireAccess, text, uuid } from './platform-store';
import { assertRankingEventNotStarted, eventDeclarations, finalizeOfficialCircuit } from './ranking-events';
import type { RankingDeclaration } from './ranking-events';
import { lockRankingLists, rankingList, rebuildRankingGeneration } from './ranking-generations';
import type { RankingListRecord, RankingSourceData } from './ranking-generations';
import { effectiveRankingRule, parseRankingPolicy, parseRankingRules, publishedRatingFormat } from './ranking-service-domain';
import type { RankingDeclarationView, RankingEventDetails, RankingListView, RankingServiceCommand, RankingServiceResponse } from './ranking-service-types';
import type { MatchState } from './types';
import {containsPrivatePinField} from './private-pin-fields';
import{rankingSeason,rankingEventContext,requireRankingEventManager,seasonRankingParticipant,seasonMatchRankingConfirmed}from'./ranking-seasons';
import{acceptChangedRosters,rosterReconfirmations}from'./ranking-rosters';
import{executeCircuitQualification,requireCircuitQualificationManager}from'./circuit-qualifications';

type Client = Pick<PoolClient, 'query'>;
const iso = (value: Date | string): string => new Date(value).toISOString();
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) ?? 'null' : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;

export async function canManageRankingList(client: Client, list: Pick<RankingListRecord, 'scope' | 'club_id'>, actor: string): Promise<boolean> {
  return list.scope === 'national' ? Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')", [actor])).rowCount) : clubPermission(client, list.club_id!, actor, 'settings.edit');
}

export async function canReadRankingList(client: Client, list: Pick<RankingListRecord, 'scope' | 'club_id'>, actor: string): Promise<boolean> {
  return list.scope === 'national' || clubIsActiveMember(client, list.club_id!, actor);
}

export async function rankingListView(client: Client, list: RankingListRecord, actor: string): Promise<RankingListView> {
  return { id: list.id, scope: list.scope, kind: list.kind, clubId: list.club_id, name: list.name, policyVersion: list.policy_version, policy: list.policy, generation: list.active_generation, closesAt: list.closes_at ? iso(list.closes_at) : null, canManage: await canManageRankingList(client, list, actor) };
}

export async function readableRankingLists(client: Client, actor: string): Promise<RankingListView[]> {
  const rows = (await client.query<RankingListRecord>('select l.*,p.policy from dartflow_private.ranking_lists l join dartflow_private.ranking_list_policies p on p.list_id=l.id and p.version=l.policy_version order by l.scope desc,l.kind,l.name,l.id')).rows;
  const result = [];
  for (const row of rows) if (await canReadRankingList(client, row, actor)) result.push(await rankingListView(client, row, actor));
  return result;
}

async function declarationView(client: Client, declaration: RankingDeclaration, actor: string, eventName: string): Promise<RankingDeclarationView> {
  const accepted = (await client.query('select 1 from dartflow_private.ranking_event_confirmations where declaration_id=$1 and player_id=$2', [declaration.id, actor])).rowCount;
  const reconfirmationRequired=(await rosterReconfirmations(client,declaration.entity_id,actor)).some(row=>!row.accepted);
  const canApprove=await canManageRankingList(client,declaration,actor);
  const recertificationRequired=declaration.kind==='circuit'&&Boolean((await client.query(`select 1 from dartflow_private.ranking_primary_correction_holds h where h.entity_id=$1 and h.list_id=$2 and not exists(select 1 from dartflow_private.ranking_primary_correction_releases r where r.request_id=h.request_id and r.list_id=h.list_id)limit 1`,[declaration.entity_id,declaration.list_id])).rowCount);
  const canRecertify=declaration.kind==='circuit'&&declaration.status==='approved'&&canApprove&&!(await client.query(`select 1 from dartflow_private.platform_match_links l join dartflow_private.matches m on m.id=l.match_id where l.entity_id=$1 and m.state->'players' @> $2::jsonb limit 1`,[declaration.entity_id,JSON.stringify([{id:actor}])])).rowCount;
  return { id: declaration.id, entityId: declaration.entity_id, eventName, listId: declaration.list_id, listName: declaration.name, scope: declaration.scope, kind: declaration.kind, status: declaration.status, policyVersion: declaration.policy_version, policy: declaration.policy, rules: declaration.rules, reason: canApprove||declaration.requested_by===actor?declaration.reason:null, canApprove, accepted: Boolean(accepted)&&!reconfirmationRequired,canRecertify,recertificationRequired,reconfirmationRequired };
}

export async function pendingRankingApprovals(client: Client, actor: string): Promise<RankingDeclarationView[]> {
  const entities = (await client.query<{ entity_id: string; name: string }>("select distinct d.entity_id,e.state->>'name' as name from dartflow_private.ranking_event_declarations d join dartflow_private.platform_entities e on e.id=d.entity_id where d.status='pending' order by d.entity_id")).rows;
  const result = [];
  for (const event of entities) for (const declaration of await eventDeclarations(client, event.entity_id)) if (declaration.status === 'pending' && await canManageRankingList(client, declaration, actor)) result.push(await declarationView(client, declaration, actor, event.name));
  return result;
}

export async function getEventRankingDetails(actorId: string, entityId: string): Promise<RankingEventDetails> {
  const client = database(), actor = uuid(actorId), event = await entity(client, uuid(entityId));
  await rankingEventContext(client,event);
  const declarations = await eventDeclarations(client, event.id);
  const authority = (await Promise.all(declarations.map(item => canManageRankingList(client, item, actor)))).some(Boolean);
  let canRequest = false;
  try { await requireRankingEventManager(client, event, actor); canRequest = true; } catch (error) { if (!(error instanceof DomainError && error.status === 403)) throw error; }
  if (!canRequest && !authority) {
    try { await requireAccess(client, event, actor); } catch (error) { if (!(error instanceof DomainError && error.status === 403 && event.visibility === 'public')) throw error; }
  }
  const season=await rankingSeason(client,event),canAccept=season?await seasonRankingParticipant(client,season,actor):Boolean((await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status='active'and attributes->>'registered'='true'",[event.id,actor])).rowCount);
  return { entityId: event.id, name: event.state.name, ownership: String(event.state.ownership ?? (event.club_id ? 'club' : 'platform')), canRequest: canRequest && event.state.ownership !== 'personal',canAccept,fixtures:event.state.fixtures?.map(fixture=>({id:fixture.id,phase:fixture.phase,round:fixture.round})),rosterReconfirmations:await rosterReconfirmations(client,event.id,actor,canRequest), canFinalize: canRequest && Boolean(event.state.fixtures?.length)&&event.state.fixtures!.every(f=>['confirmed','bye','void'].includes(f.status))&&declarations.some(item => item.status === 'approved' && item.kind === 'circuit'), declarations: await Promise.all(declarations.map(item => declarationView(client, item, actor, event.state.name))), availableLists: await readableRankingLists(client, actor) };
}

async function authorizeServiceCommand(client: PoolClient, actor: string, command: RankingServiceCommand): Promise<void> {
  const a = command.action;
  if(a.type.startsWith('qualification.')){const listId=a.type==='qualification.create'?uuid(a.listId):uuid(((await entity(client,uuid(a.qualificationId))).state.circuitQualification as{listId?:string}|undefined)?.listId);await requireCircuitQualificationManager(client,actor,listId);
  }else if (a.type === 'list.create') {
    if (!await clubPermission(client, uuid(a.clubId), actor, 'settings.edit')) throw new DomainError('forbidden', 'Je mist het rankingbeheerrecht van deze vereniging.', 403);
  } else if (['list.policy', 'list.close'].includes(a.type)) {
    if (!await canManageRankingList(client, await rankingList(client, uuid(a.listId)), actor)) throw new DomainError('forbidden', 'Je beheert deze ranking niet.', 403);
  } else if (['event.request', 'event.finalize', 'event.cancel'].includes(a.type)) {
    await requireRankingEventManager(client, await entity(client, uuid(a.entityId)), actor);
  } else if (a.type === 'event.accept') {
    const event = await entity(client, uuid(a.entityId));
    await requireAccess(client, event, actor);
    const season=await rankingSeason(client,event);if(season&&!await seasonRankingParticipant(client,season,actor))throw new DomainError('ranking_participation_required','Alleen een actueel speelgerechtigde seizoensdeelnemer aanvaardt deze gevolgen.',403);
    const member = await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status='active' and attributes->>'registered'='true'", [event.id, actor]);
    if (!member.rowCount) throw new DomainError('ranking_participation_required', 'Alleen een ingeschreven deelnemer bevestigt de gepubliceerde gevolgen.', 403);
  } else if (a.type === 'event.approve') {
    const d = (await client.query<{ list_id: string }>('select list_id from dartflow_private.ranking_event_declarations where id=$1', [uuid(a.declarationId)])).rows[0];
    if (!d || !await canManageRankingList(client, await rankingList(client, d.list_id), actor)) throw new DomainError('forbidden', 'Alleen de bevoegde rankingbeheerder beslist over deze bestemming.', 403);
  } else if(a.type==='event.recertify'){
    const list=await rankingList(client,uuid(a.listId));
    if(list.kind!=='circuit'||!await canManageRankingList(client,list,actor)||!(await client.query("select 1 from dartflow_private.ranking_event_declarations where entity_id=$1 and list_id=$2 and status='approved'",[uuid(a.entityId),list.id])).rowCount)throw new DomainError('forbidden','Alleen de bevoegde circuitbeheerder erkent de gewijzigde officiële eindstand.',403);
  } else if (a.type === 'source.decide') {
    const source = (await client.query<{ list_id: string }>('select list_id from dartflow_private.ranking_sources where id=$1', [uuid(a.sourceId)])).rows[0];
    if (!source || !await canManageRankingList(client, await rankingList(client, source.list_id), actor)) throw new DomainError('forbidden', 'Alleen de bevoegde rankingbeheerder behandelt deze bron.', 403);
  } else throw new DomainError('invalid_ranking_action', 'Onbekende rankingactie.');
}

export async function executeRankingServiceCommand(actorId: string, command: RankingServiceCommand): Promise<RankingServiceResponse> {
  const actor = uuid(actorId), requestId = uuid(command?.requestId);
  if (!command.action || typeof command.action.type !== 'string') throw new DomainError('invalid_command', 'Ongeldig rankingcommando.');
  if(containsPrivatePinField(command))throw new DomainError('private_field','Gebruik de beveiligde spelerspincodeflow.',400);
  const client = await database().connect();
  try {
    await client.query('begin'); await assertAccountActive(actor, client);
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`dartflow:ranking-command:${actor}`]);
    await authorizeServiceCommand(client, actor, command);
    const payloadHash = createHash('sha256').update(canonical(command.action)).digest('hex');
    const prior = (await client.query<{ payload_hash: string; response: RankingServiceResponse }>('select payload_hash,response from dartflow_private.ranking_service_receipts where actor_id=$1 and request_id=$2', [actor, requestId])).rows[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw new DomainError('request_reused', 'Dit aanvraag-ID is eerder voor een andere rankingactie gebruikt.', 409);
      await client.query('commit'); return prior.response;
    }
    const a = command.action; let response: RankingServiceResponse;
    if(a.type.startsWith('qualification.')){response=await executeCircuitQualification(client,actor,a);
    }else if (a.type === 'list.create') {
      if (!['rating', 'circuit'].includes(String(a.kind))) throw new DomainError('invalid_ranking_kind', 'Kies spelersrating of circuit.');
      const id = randomUUID(), policy = parseRankingPolicy(a.policy, `club-${id}-v1`);
      await client.query("insert into dartflow_private.ranking_lists(id,scope,kind,club_id,name,created_by)values($1,'club',$2,$3,$4,$5)", [id, a.kind, uuid(a.clubId), text(a.name, 120), actor]);
      await client.query('insert into dartflow_private.ranking_list_policies(list_id,version,policy,published_by)values($1,1,$2,$3)', [id, JSON.stringify(policy), actor]);
      response = { ok: true, id, ...await rebuildRankingGeneration(client, await rankingList(client, id, true)) };
    } else if (a.type === 'list.policy') {
      const list = await rankingList(client, uuid(a.listId), true);
      if (list.scope === 'national') throw new DomainError('ranking_national_policy_fixed', 'Het landelijke pilotreglement is vastgezet; maak een nieuw landelijk seizoen via de beheerde migratie.', 409);
      if ((await client.query('select 1 from dartflow_private.ranking_event_declarations where list_id=$1 limit 1', [list.id])).rowCount) throw new DomainError('ranking_policy_locked', 'Dit beleid is aan evenementen toegezegd. Maak een nieuwe seizoenlijst voor gewijzigde regels.', 409);
      const version = list.policy_version + 1, policy = parseRankingPolicy(a.policy, `club-${list.id}-v${version}`);
      await client.query('insert into dartflow_private.ranking_list_policies(list_id,version,policy,published_by)values($1,$2,$3,$4)', [list.id, version, JSON.stringify(policy), actor]);
      await client.query('update dartflow_private.ranking_lists set policy_version=$2 where id=$1', [list.id, version]);
      response = { ok: true, id: list.id };
    } else if (a.type === 'list.close') {
      const list = await rankingList(client, uuid(a.listId), true); text(a.reason, 1000);
      const closesAt = typeof a.closesAt === 'string' ? new Date(a.closesAt) : new Date(NaN);
      if (!Number.isFinite(closesAt.getTime())) throw new DomainError('invalid_date', 'Geef de ingangsdatum van sluiting op.');
      await client.query('update dartflow_private.ranking_lists set closes_at=$2 where id=$1', [list.id, closesAt.toISOString()]);
      response = { ok: true, id: list.id };
    } else if (a.type === 'event.request') {
      const event = await entity(client, uuid(a.entityId), true);
      await client.query('select id from dartflow_private.events where id=$1 for update', [event.state.eventId]);
      await assertRankingEventNotStarted(client, event);
      const list = await rankingList(client, uuid(a.listId), true);
      if(event.state.seasonManaged===true&&list.kind!=='rating')throw new DomainError('ranking_season_circuit_unsupported','Een competitieontmoeting levert alleen vooraf geselecteerde singlerating op; publiceer een afzonderlijk toernooi voor individuele circuiteindplaatsen.',409);
      if (list.closes_at && list.closes_at.getTime() <= Date.now()) throw new DomainError('ranking_closed', 'Deze ranking is gesloten voor nieuwe evenementen.', 409);
      if (list.scope === 'club' && event.club_id !== list.club_id && !(event.club_id===null&&event.state.ownership==='platform')) throw new DomainError('ranking_club_link_required', 'Een clubbestemming vereist voorafgaande organisatie of koppeling namens diezelfde club.', 403);
      const rules = parseRankingRules(a.rules);
      if(((event.state.settings as{discipline?:string}|undefined)?.discipline??'x01')!==list.policy.discipline)throw new DomainError('ranking_discipline_ineligible','Een X01- en Cricket-reeks hebben afzonderlijke officiële bronnen.',409);
      if (rules.some(rule => rule.fixtureId && !event.state.fixtures!.some(fixture => fixture.id === rule.fixtureId))) throw new DomainError('ranking_fixture_unknown', 'Een bestemmingsregel verwijst buiten het vastgelegde schema.');
      for (const fixture of event.state.fixtures!) effectiveRankingRule(rules, fixture);
      if (list.kind === 'rating' && !publishedRatingFormat(event.state.settings!, list.policy)) throw new DomainError('ranking_format_ineligible', 'Het gepubliceerde spelprofiel past niet bij deze rating.', 409);
      if (list.kind === 'circuit' && !['knockout','pools-knockout','double-elimination-reset','double-elimination-single','swiss'].includes(String(event.state.format))) throw new DomainError('ranking_classification_required', 'Een circuitbestemming vereist een toernooischema met canonieke eindplaatsen.', 409);
      if(list.kind==='circuit'&&rules.some(rule=>rule.phase||rule.round||rule.fixtureId))throw new DomainError('ranking_circuit_scope','Circuitpunten volgen de volledige eindplaats; gebruik een algemene evenementbestemming.');
      if (list.kind === 'circuit' && (await client.query<{ n: number }>("select count(*)::int n from dartflow_private.ranking_event_declarations where list_id=$1 and status in('pending','approved')", [list.id])).rows[0].n >= list.policy.eventCount) throw new DomainError('ranking_circuit_full', 'Het gepubliceerde aantal circuitevenementen is bereikt. De seizoensfinale krijgt een afzonderlijke titel.', 409);
      const id = randomUUID();
      await client.query('insert into dartflow_private.ranking_event_declarations(id,entity_id,list_id,policy_version,rules,requested_by)values($1,$2,$3,$4,$5,$6)', [id, event.id, list.id, list.policy_version, JSON.stringify(rules), actor]);
      response = { ok: true, id };
    } else if (a.type === 'event.approve') {
      const current = (await client.query<{ entity_id: string; status: string }>('select entity_id,status from dartflow_private.ranking_event_declarations where id=$1', [uuid(a.declarationId)])).rows[0];
      const event = await entity(client, current.entity_id, true);
      await client.query('select id from dartflow_private.events where id=$1 for update', [event.state.eventId]);
      await assertRankingEventNotStarted(client, event);
      if (current.status !== 'pending') throw new DomainError('ranking_declaration_locked', 'Deze gepubliceerde bestemmingsbeslissing is al definitief.', 409);
      if (!['approve', 'reject'].includes(String(a.decision))) throw new DomainError('invalid_decision', 'Kies goedkeuren of afwijzen.');
      const changed = await client.query("update dartflow_private.ranking_event_declarations set status=$2,decided_by=$3,reason=$4,decided_at=clock_timestamp()where id=$1 and status='pending' returning id", [a.declarationId, a.decision === 'approve' ? 'approved' : 'rejected', actor, text(a.reason, 1000)]);
      if (!changed.rowCount) throw new DomainError('revision_conflict', 'De bestemmingsbeslissing is inmiddels gewijzigd.', 409);
      response = { ok: true, id: String(a.declarationId) };
    } else if (a.type === 'event.accept') {
      const event = await entity(client, uuid(a.entityId), true);
      const declarations = await eventDeclarations(client, event.id);
      if (declarations.some(item => item.status === 'pending')) throw new DomainError('ranking_declaration_pending', 'Wacht op de gepubliceerde bestemmingsbeslissingen.', 409);
      await acceptChangedRosters(client,event.id,actor,a.rosterVersions);
      for (const declaration of declarations.filter(item => item.status === 'approved')) await client.query('insert into dartflow_private.ranking_event_confirmations(declaration_id,player_id)values($1,$2)on conflict(declaration_id,player_id)do nothing', [declaration.id, actor]);
      response = { ok: true, id: event.id };
    } else if (a.type === 'event.finalize'||a.type==='event.recertify') {
      const event = await entity(client, uuid(a.entityId), true);
      await client.query('select id from dartflow_private.events where id=$1 for update', [event.state.eventId]);
      const generations = await finalizeOfficialCircuit(client, event,a.type==='event.recertify'?{listId:uuid(a.listId),actorId:actor,reason:text(a.reason,1000)}:undefined);
      response = { ok: true, id: event.id, ...(generations[0] ?? {}) };
    } else if (a.type === 'source.decide') {
      const source = (await client.query<{ id: string; list_id: string; match_id: string | null; source_kind: string }>('select id,list_id,match_id,source_kind from dartflow_private.ranking_sources where id=$1', [uuid(a.sourceId)])).rows[0];
      const list = await rankingList(client, source.list_id, true);
      const latest = (await client.query<{ revision: number; verdict: string; data: RankingSourceData }>('select revision,verdict,data from dartflow_private.ranking_source_revisions where source_id=$1 order by revision desc limit 1', [source.id])).rows[0];
      if (!Number.isSafeInteger(a.expectedRevision) || a.expectedRevision !== latest.revision) throw new DomainError('revision_conflict', 'De bron is gewijzigd. Vernieuw het dossier.', 409);
      if (latest.data.players.includes(actor)) throw new DomainError('ranking_independent_review_required', 'Een onafhankelijke beheerder behandelt een bron waarin je zelf deelnam.', 403);
      if (!['void', 'restore'].includes(String(a.decision))) throw new DomainError('invalid_decision', 'Kies ongeldig verklaren of erkenning herstellen.');
      if(a.decision==='restore'&&source.source_kind==='event')throw new DomainError('ranking_circuit_recertification_required','Erken de actuele canonieke evenementstand opnieuw via de circuitbeheerder; een oude eindplaats kan niet afzonderlijk teruggezet worden.',409);
      if(a.decision==='restore'&&latest.data.dependencyCorrectionId)throw new DomainError('primary_correction_dependency_hold','Herstel eerst het dossier met afhankelijke vervolgpartijen; de oude deelnemers kunnen niet via een rankingbesluit worden teruggezet.',409);
      if (a.decision === 'restore' && source.match_id) {
        const match = (await client.query<{ state: MatchState }>('select state from dartflow_private.matches where id=$1', [source.match_id])).rows[0]?.state;
        if (!match || match.status !== 'confirmed' || !match.resultPublished || match.resultRevision !== latest.data.resultRevision || match.winnerId !== latest.data.winnerId) throw new DomainError('ranking_primary_source_changed', 'Herstel eerst de primaire, wederzijds bevestigde uitslag.', 409);
        if(!await seasonMatchRankingConfirmed(client,match))throw new DomainError('ranking_season_confirmation_required','Laat eerst beide captains of onafhankelijke wedstrijdleiding de actuele ontmoeting bevestigen.',409);
      }
      const decidedData={...latest.data};delete decidedData.seasonConfirmationWithdrawn;
      await client.query('insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,$2,$3,$4,$5,$6)', [source.id, latest.revision + 1, a.decision === 'void' ? 'void' : 'valid', JSON.stringify(decidedData), actor, text(a.reason, 1000)]);
      response = { ok: true, id: source.id, ...await rebuildRankingGeneration(client, list) };
    } else if (a.type === 'event.cancel') {
      const event = await entity(client, uuid(a.entityId), true), declarations = (await eventDeclarations(client, event.id)).filter(item => item.kind === 'circuit' && item.status === 'approved');
      const lists = await lockRankingLists(client, declarations.map(item => item.list_id)), reason = text(a.reason, 1000);
      for (const list of lists) {
        if (!await canManageRankingList(client, list, actor)) throw new DomainError('forbidden', 'Elke circuitbestemming vereist de eigen bevoegde beslisser.', 403);
        const sources = (await client.query<{ id: string; revision: number; data: RankingSourceData }>(`select s.id,r.revision,r.data from dartflow_private.ranking_sources s join lateral(select revision,data from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true where s.entity_id=$1 and s.list_id=$2`, [event.id, list.id])).rows;
        for (const source of sources) {
          if (source.data.players.includes(actor)) throw new DomainError('ranking_independent_review_required', 'Laat een onafhankelijke beheerder je eigen circuitevenement afgelasten.', 403);
          await client.query("insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,$2,'void',$3,$4,$5)", [source.id, source.revision + 1, JSON.stringify(source.data), actor, reason]);
        }
        await rebuildRankingGeneration(client, list);
      }
      response = { ok: true, id: event.id };
    } else throw new DomainError('invalid_ranking_action', 'Onbekende rankingactie.');
    await client.query('insert into dartflow_private.ranking_service_receipts(actor_id,request_id,payload_hash,response)values($1,$2,$3,$4)', [actor, requestId, payloadHash, JSON.stringify(response)]);
    await client.query('insert into dartflow_private.ranking_service_audit(actor_id,request_id,action,detail)values($1,$2,$3,$4)',[actor,requestId,command.action.type,JSON.stringify(command.action)]);
    await client.query('commit'); return response;
  } catch (error) {
    await client.query('rollback');
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new DomainError('ranking_declaration_exists', 'Deze bron of bestemming is al eenmaal vastgelegd.', 409);
    throw error;
  } finally { client.release(); }
}
