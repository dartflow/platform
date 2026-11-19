import {projectMatchPublicPlayers,projectPublicIdentitySnapshots} from './public-player-projection';
import{consolationOutcome}from'./tournament-consolation';
import{guestHistoryAliases,projectClaimedGuestResult}from'./event-guests';
import {decorateCircuitQualificationState} from './circuit-qualifications';
import {primaryCorrectionBlockedFixtureIds} from './match-corrections';
import {matchMediaActors} from './match-sides';
import {getPlayerStatisticsSummary} from './player-statistics-db';
import { randomBytes, randomUUID } from 'node:crypto';
import { consumeRateLimit, database, eventAccess, executeMatchCommand, getMatch, getProfile } from './db';
import {invitationAttemptRequired} from './invitations';
import {requireScoreboardName} from './profile-name';
import { DomainError, matchView } from './domain';
import {resolveInvitation}from'./invitations';
import {boardAction}from'./platform-boards';
import {clubBoardAction,listClubBoards,revalidateClubBoardCommand}from'./club-boards';
import {communityAction,revalidateCommunityCommand,getCommunityChat} from './community';
import {recordScoreEvents} from './score-events';
import {acceptedTrainingBoardActivity,guardTrainingBoardActivity,readSourceBoardActivity,releaseBoardActivity} from './board-activity';
import {locationAction,revalidateLocationCommand} from './locations';
import {revalidateClubCommand} from './club-domain';
import { autoAssign, competitionAction,revalidateCompetitionManagementCommand } from './platform-competitions';
import { advanceFixtures, newTraining, standings, trainingAction } from './platform-domain';
import { socialAction } from './platform-social';
import {precallAction,precallAccess} from './competition-precalls';
import { blocked, canonical, createEntity, entity, hash, isClubMember, member, requireAccess, save, transaction, uuid, view } from './platform-store';
import type { EntityRow, Client } from './platform-store';
import type { PlatformCommand, PlatformMember, PlatformMessage, PlatformOverview, PlatformResponse } from './platform-types';
import type { MatchState, Profile, ResultView } from './types';
import {containsPrivatePinField} from './private-pin-fields';
import {rememberBoardGame} from './player-experience-store';
import {finalResultSql} from './result-visibility';
import {tournamentOutcome,tournamentTable} from './tournament-formats';
import {refreshTournamentTables} from './tournament-management';
export type { PlatformCommand, PlatformEntity, PlatformOverview, PlatformResponse } from './platform-types';

export async function executePlatformCommand(actorId: string, input: unknown): Promise<PlatformResponse> {
  const command = input as PlatformCommand;
  const actor = uuid(actorId);
  if (!command || typeof command !== 'object' || !command.action || typeof command.action.type !== 'string' || command.action.type.length > 80 || !command.requestId || (command.expectedRevision !== undefined && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0))) throw new DomainError('invalid_command', 'Ongeldig platformcommando.');
  if(containsPrivatePinField(command))throw new DomainError('private_field','Gebruik de beveiligde spelerspincodeflow.',400);
  uuid(command.requestId);
  if(command.action.type.startsWith('community.')){
    const limit=await consumeRateLimit(`community:actor:${actor}`,80,60);
    if(!limit.allowed)throw Object.assign(new DomainError('rate_limited',`Te veel berichten. Wacht ${limit.retryAfter} seconden.`,429),{retryAfter:limit.retryAfter});
  }
  if(command.action.type==='report.create'){
    const limit=await consumeRateLimit(`safety-report-attempt:${actor}`,30,3600);
    if(!limit.allowed)throw Object.assign(new DomainError('rate_limited','Te veel meldpogingen. Probeer het later opnieuw of mail info@dartflow.nl.',429),{retryAfter:limit.retryAfter});
  }
  // These counters must commit even when a guessed code fails and its command rolls back.
  if(invitationAttemptRequired(command.action))for(const [key,max] of [[`invite:actor:${actor}`,10],['invite:global',120]] as const){
    const limit=await consumeRateLimit(key,max,60);
    if(!limit.allowed)throw Object.assign(new DomainError('rate_limited',`Te veel uitnodigingspogingen. Wacht ${limit.retryAfter} seconden.`,429),{retryAfter:limit.retryAfter});
  }
  const payloadHash = hash(canonical({ action: command.action, expectedRevision: command.expectedRevision }));
  const response = await transaction<PlatformResponse>(async client => {
    // Per-actor command lock serializes duplicate request IDs, independent of entity.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`command:${actor}`]);
    if (!(await client.query('select 1 from dartflow_private.profiles where id=$1', [actor])).rowCount) throw new DomainError('profile_missing', 'Meld je opnieuw aan.', 403);
    if(typeof command.action.id==='string'&&/^[a-f\d-]{36}$/i.test(command.action.id)&&Boolean((await client.query("select 1 from dartflow_private.platform_entities where id=$1 and state->>'seasonManaged'='true'",[command.action.id])).rowCount))throw new DomainError('season_flow','Open dit seizoen via Competities om de actuele regels te gebruiken.',409);
    if(command.action.type==='reservation.fixture.start'&&Boolean((await client.query("select 1 from dartflow_private.board_reservations r join dartflow_private.platform_entities e on e.state->>'eventId'=r.event_id::text where r.id=$1 and e.state->>'seasonManaged'='true'",[uuid(command.action.reservationId)])).rowCount))throw new DomainError('season_flow','Open de toegewezen partij via het seizoen.',409);
    if(command.action.type==='board.start'||command.action.type.startsWith('training.')||['lobby.create','lobby.join','lobby.ready','lobby.start','competition.register','competition.checkin','competition.available','fixture.start'].includes(command.action.type))await requireScoreboardName(client,actor);
    const { rows: receipts } = await client.query('select payload_hash,response from dartflow_private.platform_receipts where actor_id=$1 and request_id=$2', [actor, command.requestId]);
    if (receipts.length) {
      if (receipts[0].payload_hash !== payloadHash) throw new DomainError('request_reused', 'Dit aanvraag-ID is eerder met andere gegevens gebruikt.', 409);
      const response=receipts[0].response as PlatformResponse;
      if(response.expired)throw new DomainError('board_session_expired','Deze baanpartij is beëindigd. Scan de baan opnieuw.',409);
      if(command.action.type==='invitation.resolve')await resolveInvitation(client,actor,command.action.code);
      await revalidateClubBoardCommand(client,actor,command,response);
      await revalidateCommunityCommand(client,actor,command);
      await revalidateLocationCommand(client,actor,command,response);
      await revalidateClubCommand(client,actor,command,response);
      await revalidateCompetitionManagementCommand(client,actor,command);await precallAccess(client,actor,command);
      if(['board.start','board.screen'].includes(command.action.type)){
        const scope=await client.query('select event_id from dartflow_private.boards where id=$1',[uuid(command.action.boardId)]);
        if(!scope.rows.length)throw new DomainError('not_found','Deze baan bestaat niet.',404);
        await eventAccess(client,actor,scope.rows[0].event_id);
      }
      if(response.entity){const row=await entity(client,response.entity.id);const m=await member(client,row.id,actor);
        if(row.kind==='training'){
      if(row.state.discarded)throw new DomainError('board_session_expired','Deze baanpartij is beëindigd. Scan de baan opnieuw.',409);
          response.entity=await view(client,row,actor);
          const activity=await readSourceBoardActivity(client,row.id,actor);if(activity)response.entity.boardActivity=activity;
        }
        if(row.kind==='club'){response.entity=await view(client,row,actor);return response;}
        if(typeof row.state.boardId==='string'&&typeof row.state.eventId==='string')await eventAccess(client,actor,row.state.eventId);
        if(m?.status==='banned'||(row.club_id&&!(await isClubMember(client,row.club_id,actor)))||await blocked(client,actor,row.owner_id)||(row.visibility==='private'&&row.owner_id!==actor&&!m?.status.match(/^(active|invited|pending|waitlisted)$/)))throw new DomainError('forbidden','Je hebt geen toegang meer tot dit onderdeel.',403);
      }
      return projectPublicIdentitySnapshots(client,response);
    }
    const action = command.action;
    let result: PlatformResponse | null = null;
    if(action.type.startsWith('community.'))result=await communityAction(client,actor,command);
    else if(action.type.startsWith('location.')||action.type.startsWith('reservation.'))result=await locationAction(client,actor,command);
    else if(action.type.startsWith('club-board.'))result=await clubBoardAction(client,actor,command);
    else if(['board.start','board.screen'].includes(action.type))result=await boardAction(client,actor,command);
    else if (action.type === 'invitation.resolve') {
      result={ok:true,...await resolveInvitation(client,actor,action.code)};
    } else if (action.type === 'cast.share' || action.type === 'cast.revoke') {
      const row = await entity(client, action.id, true);
      if (!['league','tournament'].includes(row.kind)) throw new DomainError('invalid_cast', 'Kies een competitie of toernooi.');
      await requireAccess(client, row, actor, true);
      if (action.type === 'cast.revoke') {
        await client.query('update dartflow_private.platform_cast_grants set revoked_at=now() where entity_id=$1 and id=$2', [row.id, uuid(action.grantId)]);
        result = {ok:true,id:row.id};
      } else {
        const token = randomBytes(32).toString('base64url'), grantId=randomUUID();
        await client.query("insert into dartflow_private.platform_cast_grants(id,entity_id,token_hash,created_by,expires_at) values($1,$2,$3,$4,now()+interval '12 hours')",[grantId,row.id,hash(token),actor]);
        result = {ok:true,id:row.id,grantId,token,url:`/cast/${token}`};
      }
    } else if (action.type === 'training.create') {
      const id = randomUUID(), state = newTraining(id, actor, action);
      const { row } = await createEntity(client, actor, 'training', state, 'private', null, id);
      result = { ok: true, id, entity: await view(client, row, actor) };
    } else if (['training.score', 'training.undo', 'training.finish'].includes(action.type)) {
      const scope=await entity(client,action.id);if(typeof scope.state.eventId==='string')await client.query('select id from dartflow_private.events where id=$1 for update',[scope.state.eventId]);
      const row = await entity(client, action.id, true);
      if (row.kind !== 'training' || row.owner_id !== actor) throw new DomainError('forbidden', 'Deze training hoort bij een andere speler.', 403);
      if((row.state.offlineConflict as{status?:string}|undefined)?.status==='open')throw new DomainError('training_offline_conflict','Beoordeel eerst de bewaarde invoer en de geaccepteerde trainingsscorekaart.',409);
      if(row.state.discarded)throw new DomainError('board_session_expired','Deze baanpartij is beëindigd. Scan de baan opnieuw.',409);
      if(typeof row.state.boardId==='string'){
        const activity=await guardTrainingBoardActivity(client,row);
        // Commit timeout cleanup before reporting a rejected late score to the caller.
        if(activity&&['released','interrupted'].includes(activity.phase))return {ok:true,boardActivityExpired:true};
      }
      if (command.expectedRevision === undefined || command.expectedRevision !== row.revision) throw new DomainError('revision_conflict', 'Vernieuw deze training en probeer opnieuw.', 409);
      if(typeof row.state.boardId==='string'&&action.type!=='training.finish'){
        // Serialize lease renewal against every official/free claim of this physical board.
        await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);
        await eventAccess(client,actor,String(row.state.eventId));
        const occupied=await client.query('select 1 from dartflow_private.matches where board_id=$1',[row.state.boardId]);
        if(row.state.boardHeld!==true||occupied.rowCount)throw new DomainError('board_session_expired','Deze baanopstelling is verlopen. Scan de baan opnieuw.',409);
      }
      const previousVisits=row.state.game?.visits.length??0;
      row.state = trainingAction(row.state, action);
      if(typeof row.state.boardId==='string'){
        // A natural checkout ends this physical session in the same transaction as its score.
        // Its history stays intact; the released session cannot renew or undo its way onto a new game.
        if(row.state.completed===true){row.state.boardHeld=false;row.state.boardLeaseUntil=0;}
        else row.state.boardLeaseUntil=Date.now()+30*60_000;
      }
      await save(client, row);
      if(action.type==='training.score'){
        const name=String((await client.query('select name from dartflow_private.profile_labels where id=$1',[actor])).rows[0]?.name??'Speler');
        await recordScoreEvents(client,typeof row.state.boardId==='string'?row.state.boardId:null,row.id,row.revision,'score',(row.state.game?.visits.slice(previousVisits)??[]).map(visit=>({score:visit.score,checkout:visit.checkout,bust:visit.bust,playerIndex:visit.playerIndex,playerName:visit.playerIndex===0?name:'Dartbot'})));
      }
      else if(action.type==='training.undo')await recordScoreEvents(client,typeof row.state.boardId==='string'?row.state.boardId:null,row.id,row.revision,'undo');
      await acceptedTrainingBoardActivity(client,row,action.type);
      const activity=await readSourceBoardActivity(client,row.id,actor);
      if(activity&&row.state.boardHeld===true){row.state.boardLeaseUntil=activity.deadlineAt;await client.query('update dartflow_private.platform_entities set state=$2 where id=$1',[row.id,JSON.stringify(row.state)]);}
      result = { ok: true, id: row.id, entity: await view(client, row, actor) };
      if(activity)result.entity!.boardActivity=activity;
    } else result = await precallAction(client,actor,command) ?? await socialAction(client, actor, command) ?? await competitionAction(client, actor, command);
    if (!result) throw new DomainError('invalid_action', 'Onbekende platformactie.');
    if(action.type==='board.start')await rememberBoardGame(client,actor,uuid(action.boardId),{mode:action.mode??'local',startScore:action.startScore??501,bestOfLegs:action.bestOfLegs??3});
    await client.query('insert into dartflow_private.platform_receipts(actor_id,request_id,payload_hash,response) values($1,$2,$3,$4)', [actor, command.requestId, payloadHash, JSON.stringify(result)]);
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail) values($1,$2,$3,$4)', [actor, result.entity?.id ?? null, action.type, JSON.stringify({ requestId: command.requestId, ...(result.entity ? { revision: result.entity.revision } : {}) })]);
    return result;
  });
  if(response.boardActivityExpired)throw new DomainError('board_session_expired','De baan is wegens inactiviteit vrijgegeven. Scan opnieuw om een nieuwe partij te starten.',409);
  return response;
}
export async function reconcilePlatformResults(): Promise<void> {
  const { rows } = await database().query<{ entity_id: string }>("select distinct l.entity_id from dartflow_private.platform_match_links l join dartflow_private.match_results r on r.match_id=l.match_id join dartflow_private.platform_entities e on e.id=l.entity_id where not l.projected and coalesce(e.state->>'seasonManaged','false')<>'true' limit 100");
  for (const { entity_id: id } of rows) await transaction(async client => {
    const row = await entity(client, id, true);
    const results = await client.query<{ match_id: string; fixture_id: string; snapshot: ResultView }>('select l.match_id,l.fixture_id,r.snapshot from dartflow_private.platform_match_links l join dartflow_private.match_results r on r.match_id=l.match_id where l.entity_id=$1 and not l.projected', [id]);
    if (!results.rows.length) return;
    for (const item of results.rows) {
      const fixture = row.state.fixtures?.find(f => f.id === item.fixture_id);
      if (fixture) {
        fixture.status = 'confirmed'; fixture.winnerId = item.snapshot.winnerId;
        const played=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[item.match_id])).rows[0]?.state;if(played?.primaryCorrection?.phase==='confirmed'&&(row.state.primaryCorrectionOpen as {matchId?:string}|undefined)?.matchId===item.match_id)delete row.state.primaryCorrectionOpen;fixture.administrative=Boolean(played?.administrativeDecision);fixture.started=Boolean(played&&[...played.previousSets,played.game].some(game=>game.visits.length>0));
        fixture.score = fixture.players.map(p => item.snapshot.legs[item.snapshot.players.findIndex(player => player.id === p)] ?? 0);
        for (const p of fixture.players) await client.query("update dartflow_private.platform_members set attributes=jsonb_set(attributes,'{restUntil}',to_jsonb($3::bigint)) where entity_id=$1 and user_id=$2", [row.id, p, Date.now() + Number(row.state.restSeconds ?? 90) * 1000]);
      }
      await client.query('update dartflow_private.platform_match_links set projected=true where match_id=$1', [item.match_id]);
      // Release the exact confirmed match's board; published results are immutable.
      const eventId=(await client.query<{event_id:string}>('select event_id from dartflow_private.matches where id=$1',[item.match_id])).rows[0]?.event_id;
      if(eventId)await client.query('select id from dartflow_private.events where id=$1 for update',[eventId]);
      const locked = await client.query<{ state: MatchState }>('select state from dartflow_private.matches where id=$1 for update', [item.match_id]);
      if (locked.rows[0]?.state.status === 'confirmed' && locked.rows[0].state.boardId) {
        const state = locked.rows[0].state;
        const cooldowns=(row.state.boardCooldowns??={})as Record<string,number>;cooldowns[state.boardId!]=Date.now()+Number(row.state.cooldownSeconds??30)*1000;
        const calls=row.state.calls as Record<string,unknown>|undefined;if(calls)delete calls[item.fixture_id];
        const activity=await readSourceBoardActivity(client,state.id);
        state.boardId = null;state.callRef=null; state.revision++;
        await client.query('update dartflow_private.matches set board_id=null,state=$2,revision=$3,updated_at=now() where id=$1', [state.id, JSON.stringify(state), state.revision]);
        if(activity)await releaseBoardActivity(client,{sessionId:activity.sessionId,reason:'completed'});
      }
    }
    const correctionBlocked=await primaryCorrectionBlockedFixtureIds(client,row);
    refreshTournamentTables(row);
    if(row.state.fixtures)advanceFixtures(row.state.fixtures.filter(f=>!correctionBlocked.has(f.id)));
    if(correctionBlocked.size){row.state.completed=false;delete row.state.championId;delete row.state.placings;row.state.autoSchedule=false;}
    if (row.state.fixtures&&!correctionBlocked.size) {
      const players = row.state.tournamentRules?.seedOrder??[...new Set(row.state.fixtures.flatMap(f => f.players).filter((p): p is string => p !== null))];
      if(['swiss','double-elimination-reset','double-elimination-single'].includes(String(row.state.format))){
        const outcome=tournamentOutcome(row.state.fixtures,String(row.state.format),players,row.state.tournamentRules?.swissRounds);
        row.state.completed=outcome.completed;row.state.championId=outcome.championId;row.state.placings=outcome.placings;if(outcome.standings)row.state.standings=outcome.standings;
        if(outcome.completed)row.state.autoSchedule=false;
      }else{
        const final = row.state.fixtures.filter(f => f.phase === 'knockout'&&!f.purpose).at(-1);
        if(row.state.consolation?.enabled)row.state.consolation=consolationOutcome(row.state.fixtures,row.state.consolation.title);
        if (final?.status === 'confirmed'&&row.state.fixtures.filter(f=>f.purpose==='bronze').every(f=>['confirmed','bye'].includes(f.status))&&(!row.state.consolation?.enabled||row.state.consolation.completed)) {row.state.championId = final.winnerId;row.state.autoSchedule=false;row.state.completed=true;}
        row.state.standings = row.state.tournamentControl?.poolTables?.flatMap(table=>table.rows.map(row=>({...row,pool:table.pool})))??standings(row.state.fixtures.filter(f => f.phase !== 'knockout'&&!f.purpose), players);
      }
    }
    await save(client, row);
  });
}
async function readMessages(client: Client, actor: string, rowId: string): Promise<PlatformMessage[]> {
  const { rows } = await client.query<PlatformMessage>(`select * from (
    select m.id,m.author_id as "authorId",p.name as "authorName",m.body,m.created_at as "createdAt"
    from dartflow_private.platform_messages m join dartflow_private.profile_labels p on p.id=m.author_id
    where m.room_id=$1 and not m.deleted and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$2 and b.target_id=m.author_id) or (b.target_id=$2 and b.source_id=m.author_id)))
    order by m.created_at desc,m.id desc limit 100) recent order by "createdAt",id`, [rowId, actor]);
  return rows;
}
export async function getPlatformMessages(actorId: string, roomId: string): Promise<{ messages: PlatformMessage[] }> {
  const actor = uuid(actorId), row = await entity(database(), roomId);
  if (row.kind !== 'room') throw new DomainError('invalid_room', 'Deze kamer bestaat niet.', 404);
  await requireAccess(database(), row, actor);
  return { messages: await readMessages(database(), actor, row.id) };
}
/** The scoring phone needs its current training, not the directory, history and
 * reconciliation work in the full platform overview. Keep the existing private
 * projection and ACLs inside one committed, read-only snapshot. Deadline writes
 * remain with accepted commands and the existing board-activity worker. */
export async function getPlatformTraining(actorId:string,trainingId:string):Promise<{entity:NonNullable<PlatformResponse['entity']>}> {
  const actor=uuid(actorId),id=uuid(trainingId),client=await database().connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const row=await entity(client,id);
    if(row.kind!=='training'||row.owner_id!==actor)throw new DomainError('forbidden','Deze training hoort bij een andere speler.',403);
    await requireAccess(client,row,actor);
    const projected=await view(client,row,actor);
    if(typeof row.state.boardId==='string'||row.state.discarded){
      const activity=await readSourceBoardActivity(client,row.id,actor);
      if(activity)projected.boardActivity=activity;
    }
    await client.query('commit');
    return {entity:projected};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
export async function getPlatformOverview(actorId: string): Promise<PlatformOverview> {
  const actor = uuid(actorId), profile = await getProfile(actor);
  await reconcilePlatformResults();
  await reconcilePlatformCalls();
  const client = database();
  // Entity revisions and membership permissions must describe the same committed state.
  const { rows: entities } = await client.query<EntityRow&{member_snapshot:PlatformMember[]}>(`select e.*,
    (select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.name,'role',m.role,'status',m.status,'attributes',m.attributes) order by m.created_at,m.user_id),'[]'::jsonb) from dartflow_private.platform_members m join dartflow_private.profile_labels p on p.id=m.user_id where m.entity_id=e.id) as member_snapshot,
    (select i.code from dartflow_private.invitation_codes i where i.entity_id=e.id and i.expires_at>now() order by i.created_at desc,i.code limit 1) as invitation_code from dartflow_private.platform_entities e where
    (e.owner_id=$1 or exists(select 1 from dartflow_private.platform_members m where m.entity_id=e.id and m.user_id=$1 and m.status in ('active','invited','pending','waitlisted')) or (e.visibility='public' and e.kind in ('club','room','league','tournament')) or (e.visibility='club' and exists(select 1 from dartflow_private.club_memberships c where c.club_id=e.club_id and c.user_id=$1)))
    and coalesce(e.state->>'seasonManaged','false')<>'true'
    and (e.kind<>'club' or coalesce(e.state->>'lifecycle','active')='active' or (e.owner_id=$1 and e.state->>'lifecycle'='inactive'))
    and (e.club_id is null or not exists(select 1 from dartflow_private.platform_entities c where c.id=e.club_id and c.kind='club' and coalesce(c.state->>'lifecycle','active')<>'active'))
    and not exists(select 1 from dartflow_private.platform_members m where m.entity_id=e.id and m.user_id=$1 and m.status='banned')
    and (e.club_id is null or exists(select 1 from dartflow_private.club_memberships c where c.club_id=e.club_id and c.user_id=$1) or (e.kind in ('league','tournament') and e.state->>'eligibility' in ('all','code')))
    and (e.kind<>'room' or e.state->>'competitionId' is null or exists(select 1 from dartflow_private.platform_entities ce left join dartflow_private.platform_members cm on cm.entity_id=ce.id and cm.user_id=$1 where ce.id::text=e.state->>'competitionId' and (ce.owner_id=$1 or(cm.status='active' and cm.attributes->>'registered'='true')) and (ce.club_id is null or exists(select 1 from dartflow_private.club_memberships c where c.club_id=ce.club_id and c.user_id=$1) or ce.state->>'eligibility' in ('all','code'))))
    and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=e.owner_id) or (b.target_id=$1 and b.source_id=e.owner_id)))
    order by e.updated_at desc,e.id limit 250`, [actor]);
  const memberRows={rows:entities.flatMap(row=>row.member_snapshot.map(member=>({...member,entityId:row.id})))};
  // A directory row may lose scope after the list query. Omit that club using
  // its fresh ACL; unrelated event snapshots retain their original member snapshot.
  const projected = await Promise.all(entities.map(async row => {
    try{const projected=await view(client,row,actor,memberRows.rows.filter(m=>m.entityId===row.id));if(row.kind==='training'&&(typeof row.state.boardId==='string'||row.state.discarded)){const activity=await readSourceBoardActivity(client,row.id,actor);if(activity)projected.boardActivity=activity;}return projected;}
    catch(error){if(row.kind==='club'&&error instanceof DomainError&&[403,404].includes(error.status))return null;throw error;}
  }));
  const list = projected.filter((item):item is NonNullable<typeof item>=>item!==null);
  const { rows: people } = await client.query<Profile>(`select p.id,p.name,p.username,p.display_name as "displayName",null::text as avatar from dartflow_private.profile_labels p left join dartflow_private.platform_preferences f on f.user_id=p.id where p.id<>$1 and p.display_name_confirmed and coalesce(f.discoverable,true) and not exists(select 1 from dartflow_private.event_guests guest where guest.profile_id=p.id)
    and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$1 and b.target_id=p.id) or (b.target_id=$1 and b.source_id=p.id))) order by p.name,p.id limit 200`, [actor]);
  const { rows: relationships } = await client.query<{ source_id: string; target_id: string; kind: string; name: string;username:string|null;displayName:string|null }>('select r.*,p.name,p.username,p.display_name as "displayName",null::text as avatar from dartflow_private.platform_relationships r join dartflow_private.profile_labels p on p.id=case when r.source_id=$1 then r.target_id else r.source_id end where r.source_id=$1 or r.target_id=$1', [actor]);
  const friends: PlatformOverview['friends'] = [];
  for (const rel of relationships) {
    const id = rel.source_id === actor ? rel.target_id : rel.source_id;
    if (!['friend', 'request'].includes(rel.kind) || (rel.kind === 'friend' && rel.source_id !== actor) || relationships.some(r => r.kind === 'block' && [r.source_id, r.target_id].includes(id))) continue;
    if (friends.some(f => f.id === id && f.status === 'friend')) continue;
    friends.push({ id, name: rel.name,username:rel.username,displayName:rel.displayName,avatar:null, status: rel.kind === 'friend' ? 'friend' : rel.source_id === actor ? 'outgoing' : 'incoming', favorite: relationships.some(r => r.kind === 'favorite' && r.source_id === actor && r.target_id === id) });
  }
  const { rows: prefs } = await client.query('select discoverable,allow_requests as "allowRequests" from dartflow_private.platform_preferences where user_id=$1', [actor]);
  const messages: Record<string, PlatformMessage[]> = {};
  const roomIds=entities.filter(e=>e.kind==='room'&&(e.owner_id===actor||memberRows.rows.some(m=>m.entityId===e.id&&m.id===actor&&m.status==='active'))).map(e=>e.id);
  const roomMessages=await client.query<PlatformMessage&{roomId:string}>(`select * from (select m.room_id as "roomId",m.id,m.author_id as "authorId",p.name as "authorName",m.body,m.created_at as "createdAt",row_number() over(partition by m.room_id order by m.created_at desc,m.id desc) as rn from dartflow_private.platform_messages m join dartflow_private.profile_labels p on p.id=m.author_id where m.room_id=any($1::uuid[]) and not m.deleted and not exists(select 1 from dartflow_private.platform_relationships b where b.kind='block' and ((b.source_id=$2 and b.target_id=m.author_id) or(b.target_id=$2 and b.source_id=m.author_id)))) recent where rn<=100 order by "createdAt",id`,[roomIds,actor]);
  for(const id of roomIds){messages[id]=roomMessages.rows.filter(m=>m.roomId===id).map(({roomId,...message})=>{void roomId;return message;});const projection=list.find(e=>e.id===id);if(projection)projection.state.messages=messages[id];}
  const competitions=list.filter(e=>['league','tournament'].includes(e.kind));
  const allBoards=await client.query('select b.id,b.event_id as "eventId",b.name,b.blocked,case when m.event_id=b.event_id then m.id end as "matchId" from dartflow_private.boards b left join dartflow_private.matches m on m.board_id=b.id where b.event_id=any($1::uuid[]) order by b.name,b.id',[competitions.map(e=>e.state.eventId)]);
  for(const item of competitions){
    item.state.boards=allBoards.rows.filter(b=>b.eventId===item.state.eventId);
    if(item.state.consolation?.enabled)item.state.consolation=consolationOutcome(item.state.fixtures??[],item.state.consolation.title);
    const playerIds=item.state.tournamentRules?.seedOrder??item.members.filter(m=>m.status==='active'&&m.attributes.registered===true).map(m=>m.id),fixtures=item.state.fixtures??[],format=String(item.state.format);
    const projected=tournamentTable(fixtures,format,playerIds,item.state.tournamentRules?.swissRounds);
    const poolRows=item.state.tournamentControl?.poolTables?.flatMap(table=>table.rows.map(row=>({...row,pool:table.pool})));
    item.state.standings=(projected??poolRows??standings(fixtures.filter(f=>f.phase!=='knockout'&&!f.purpose),playerIds)).map(s=>({...s,playerId:s.id,name:item.members.find(m=>m.id===s.id)?.name??'Speler'}));
    if(projected!==null){const outcome=tournamentOutcome(fixtures,format,playerIds,item.state.tournamentRules?.swissRounds);item.state.completed=outcome.completed;item.state.championId=outcome.championId;item.state.placings=outcome.placings;}
  }
  const canManageRegistrations=Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[actor])).rowCount);
  const {rows:registrations}=await client.query('select r.user_id as "userId",p.name,r.status,r.reason from dartflow_private.platform_registrations r join dartflow_private.profile_labels p on p.id=r.user_id where $2::boolean or r.user_id=$1 order by r.created_at,r.user_id',[actor,canManageRegistrations]);
  const {rows:reports}=await client.query(`select r.id,r.reporter_id as "reporterId",p.name as "reporterName",r.target_id as "targetId",r.room_id as "roomId",coalesce(e.state->>'name','DartFlow') as "roomName",r.reason,r.status,r.decision,r.category,r.target_type as "targetType",r.content_id as "contentId",r.scope_kind as "scopeKind",r.scope_id as "scopeId",
    (($2::boolean and r.target_id is distinct from $1) or (r.target_id is distinct from $1 and exists(select 1 from dartflow_private.platform_members m where m.entity_id=r.room_id and m.user_id=$1 and m.status='active' and m.role in ('owner','admin','moderator')))) as "canManage"
    from dartflow_private.platform_reports r join dartflow_private.profile_labels p on p.id=r.reporter_id left join dartflow_private.platform_entities e on e.id=r.room_id
    where r.reporter_id=$1 or (r.target_id is distinct from $1 and ($2::boolean or exists(select 1 from dartflow_private.platform_members m where m.entity_id=r.room_id and m.user_id=$1 and m.status='active' and m.role in ('owner','admin','moderator') and (e.club_id is null or exists(select 1 from dartflow_private.club_memberships c where c.club_id=e.club_id and c.user_id=$1) or (e.kind in ('league','tournament') and e.state->>'eligibility' in ('all','code')))))) order by r.created_at desc limit 100`,[actor,canManageRegistrations]);
  const {rows:ownMatchRows}=await client.query<{state:MatchState;can_manage:boolean;offline_supported:boolean}>(`select m.state,
    (c.role='organizer' and exists(select 1 from dartflow_private.event_staff s where s.event_id=m.event_id and s.user_id=$1)) as can_manage,
    exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=m.id and e.kind='tournament') as offline_supported
    from dartflow_private.matches m left join dartflow_private.club_memberships c on c.club_id=m.club_id and c.user_id=$1
    where m.state->>'status'<>'abandoned' and (exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=$1) or m.state->>'delegatedWriterId'=$1::text or m.state->'remoteWriterIds' ? $1::text or jsonb_path_exists(m.state,'$.sideParticipants[*][*] ? (@.id == $actor)',jsonb_build_object('actor',$1::text)))
    and (exists(select 1 from dartflow_private.club_boards cb where cb.event_id=m.event_id) or c.user_id is not null or (exists(select 1 from dartflow_private.entries x where x.event_id=m.event_id and x.user_id=$1 and x.status='registered') and exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=m.id and ((e.kind='lobby' and e.state->>'boardId' is null) or (e.kind in ('league','tournament') and (e.club_id is null or e.state->>'eligibility' in ('all','code'))))))) order by m.updated_at desc,m.id limit 200`,[actor]);
  const matches=[];for(const row of ownMatchRows){try{const access=await eventAccess(client,actor,row.state.eventId);matches.push({...matchView(await projectMatchPublicPlayers(client,row.state),actor,access.canManage),offlineSupported:row.offline_supported});}catch(error){if(!(error instanceof DomainError&&error.status===403))throw error;}}
  const clubBoards=await listClubBoards(client,actor,list.filter(e=>e.kind==='club').map(e=>e.id));
  const {rows:ownHistory}=await client.query<{snapshot:ResultView}>(`select r.snapshot from dartflow_private.match_results r join dartflow_private.match_players p on p.match_id=r.match_id where(p.user_id=$1 or exists(select 1 from dartflow_private.event_guest_claim_decisions claim where claim.guest_id=p.user_id and claim.account_id=$1 and claim.decision='accept'))and ${finalResultSql} order by r.created_at desc,r.match_id limit 200`,[actor]);
  const guestAliases=await guestHistoryAliases(client,actor),history=await projectPublicIdentitySnapshots(client,ownHistory.map(row=>projectClaimedGuestResult(row.snapshot,actor,guestAliases.map(alias=>alias.guestId))));
  const statistics=await getPlatformStatistics(actor);
  return { profile,matches,history,clubBoards, players: people, clubs: list.filter(e => e.kind === 'club'), rooms: list.filter(e => e.kind === 'room'), trainings: list.filter(e => e.kind === 'training'), leagues: list.filter(e => e.kind === 'league'), tournaments: list.filter(e => e.kind === 'tournament'), lobbies: list.filter(e => e.kind === 'lobby'), friends, blocked: relationships.filter(r => r.kind === 'block' && r.source_id === actor).map(r => ({ id: r.target_id, name: r.name })), preferences: prefs[0] ?? { discoverable: true, allowRequests: true }, messages,registrations,reports,canManageRegistrations,statistics };
}
export async function signalAccess(client: Client, actor: string, matchId: string): Promise<string[]> {
  const state=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[uuid(matchId)])).rows[0]?.state;
  const players=state?matchMediaActors(state):[];
  if(!state||players.length!==2||new Set(players).size!==2||!players.includes(uuid(actor)))throw new DomainError('forbidden','Alleen de twee aangewezen verbindingsdeelnemers hebben toegang.',403);
  for(const player of players)await eventAccess(client,player,state.eventId);
  if((await client.query('select id from dartflow_private.profiles where id=any($1::uuid[]) and deletion_requested_at is null and deleted_at is null',[players])).rowCount!==2)throw new DomainError('forbidden','Een verbindingsdeelnemer is niet meer beschikbaar.',403);
  if(await blocked(client,players[0],players[1])||await blocked(client,state.players[0].id,state.players[1].id))throw new DomainError('blocked','Deze verbinding is geblokkeerd.',403);
  return players;
}
export type MatchSignal = { id: number; actorId: string; senderId: string; targetId: string | null; type: string; payload: unknown; createdAt: string };
export async function getMatchSignals(actorId: string, matchId: string, after = 0): Promise<{ signals: MatchSignal[]; cursor: number }> {
  await signalAccess(database(), actorId, matchId);
  if (!Number.isSafeInteger(after) || after < 0) throw new DomainError('invalid_cursor', 'Ongeldig synchronisatiepunt.');
  const { rows } = await database().query<MatchSignal>(`select id::float8 as id,sender_id as "actorId",sender_id as "senderId",target_id as "targetId",case when kind='hangup' then 'leave' else kind end as type,payload,created_at as "createdAt" from dartflow_private.platform_signals where match_id=$1 and id>$2 and sender_id<>$3 and (target_id is null or target_id=$3) and created_at>now()-interval '24 hours' order by id limit 100`, [matchId, after, actorId]);
  return { signals: rows, cursor: rows.at(-1)?.id ?? after };
}
export async function sendMatchSignal(actorId: string, matchId: string, raw: unknown): Promise<{ ok: true; id: number }> {
  const input = raw as { requestId: string; targetId?: string; type: string; payload: unknown };
  const actor = uuid(actorId), requestId = uuid(input?.requestId);
  const kind = input.type === 'leave' ? 'hangup' : input.type;
  if (!['offer', 'answer', 'ice', 'hangup', 'chat', 'preflight'].includes(kind) || Buffer.byteLength(JSON.stringify(input.payload ?? null)) > 65536) throw new DomainError('invalid_signal', 'Ongeldig of te groot verbindingsbericht.');
  if(kind==='chat'){
    const body=input.payload&&typeof input.payload==='object'&&'body' in input.payload?input.payload.body:undefined;
    const result=await executePlatformCommand(actor,{requestId,action:{type:'community.message',scopeKind:'match',scopeId:matchId,body}});
    const message=await database().query<{id:number}>('select sequence::float8 as id from dartflow_private.community_messages where id=$1',[result.id]);
    return {ok:true,id:message.rows[0].id};
  }
  return transaction(async client => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`command:${actor}`]);
    const players = await signalAccess(client, actor, matchId);
    const target = input.targetId ? uuid(input.targetId) : players.find(p => p !== actor)!;
    if (target === actor || !players.includes(target)) throw new DomainError('forbidden', 'Dit bericht hoort niet bij deze tegenstander.', 403);
    const payloadHash = hash(canonical({ matchId, type: kind, payload: input.payload, target }));
    const prior = await client.query('select payload_hash,response from dartflow_private.platform_receipts where actor_id=$1 and request_id=$2', [actor, requestId]);
    if (prior.rows.length) { if (prior.rows[0].payload_hash !== payloadHash) throw new DomainError('request_reused', 'Dit aanvraag-ID is eerder met andere inhoud gebruikt.', 409); return prior.rows[0].response; }
    const result = await client.query<{ id: number }>('insert into dartflow_private.platform_signals(match_id,sender_id,target_id,kind,payload) values($1,$2,$3,$4,$5) returning id::float8 as id', [matchId, actor, target, kind, JSON.stringify(input.payload ?? null)]);
    const response = { ok: true as const, id: result.rows[0].id };
    await client.query('insert into dartflow_private.platform_receipts(actor_id,request_id,payload_hash,response) values($1,$2,$3,$4)', [actor, requestId, payloadHash, JSON.stringify(response)]);
    return response;
  });
}

/** Only a 256-bit read-only grant exposes this minimal, event-scoped projection. */
export async function getPlatformCast(token: string): Promise<Record<string, unknown>> {
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new DomainError('invalid_cast', 'Deze schermlink is ongeldig of verlopen.', 404);
  const { rows } = await database().query<EntityRow>('select e.* from dartflow_private.platform_cast_grants g join dartflow_private.platform_entities e on e.id=g.entity_id where g.token_hash=$1 and g.revoked_at is null and g.expires_at>now()', [hash(token)]);
  if (!rows.length) throw new DomainError('invalid_cast', 'Deze schermlink is ongeldig of verlopen.', 404);
  const row = await decorateCircuitQualificationState(database(),rows[0]);
  const underReview=Boolean(row.state.circuitSourceStale||row.state.primaryCorrectionOpen||row.state.primaryCorrectionHold);
  const { rows: boards } = await database().query<{ id: string; name: string; blocked: boolean; state: MatchState | null }>('select b.id,b.name,b.blocked,case when m.event_id=b.event_id then m.state end as state from dartflow_private.boards b left join dartflow_private.matches m on m.board_id=b.id where b.event_id=$1 order by b.name,b.id', [row.state.eventId]);
  for(const board of boards)if(board.state)board.state=await projectMatchPublicPlayers(database(),board.state);
  const names = await database().query<Profile>('select p.id,p.name from dartflow_private.platform_members m join dartflow_private.profile_labels p on p.id=m.user_id where m.entity_id=$1 and m.status=\'active\' and m.attributes->>\'registered\'=\'true\'', [row.id]);
  const publicName = (id: string | null | undefined) => id?names.rows.find(p => p.id === id)?.name ?? 'Speler':'Vrij vak';
  const sourceFixtures=row.state.fixtures??[],format=String(row.state.format),playerIds=row.state.tournamentRules?.seedOrder??names.rows.map(p=>p.id),table=tournamentTable(sourceFixtures,format,playerIds,row.state.tournamentRules?.swissRounds),outcome=table!==null?tournamentOutcome(sourceFixtures,format,playerIds,row.state.tournamentRules?.swissRounds):null;
  const fixtures = sourceFixtures.map(f => ({ id: f.id, players: f.players.map(publicName), status: f.status, phase: f.phase, round: f.round, pool: f.pool, score: f.score,purpose:f.purpose, winner: f.winnerId ? publicName(f.winnerId) : null,ready:(!f.requiresRelease||f.released===true)&&f.players.every(Boolean)&&!['confirmed','bye','void'].includes(f.status),...(typeof f.pairingNotice==='string'?{pairingNotice:f.pairingNotice.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)}:{}) }));
  const consolation=row.state.consolation?.enabled?consolationOutcome(sourceFixtures,row.state.consolation.title):null;
  const champion=underReview?null:outcome?outcome.championId:typeof row.state.championId==='string'?row.state.championId:null;
  return { event: { id: row.id, name: row.state.name, revision: row.revision, date: row.state.date,format }, cast: row.state.cast, paused: row.state.paused, champion: champion?publicName(champion):null,completed:!underReview&&(outcome?.completed??row.state.completed),underReview,notice:row.state.circuitSourceStale?'Erkenning herzien':underReview?'Uitslag onder herbeoordeling':null,
    ...(consolation?{consolation:{title:consolation.title,completed:!underReview&&consolation.completed,champion:!underReview&&consolation.championId?publicName(consolation.championId):null,placings:underReview?[]:consolation.placings.map(p=>({name:publicName(p.playerId),position:p.position})),notice:underReview?'Troosttitel onder herbeoordeling':consolation.notice}}:{}), boards: boards.map(b => ({ id: b.id, name: b.name, blocked: b.blocked, match: b.state ? { id: b.state.id, revision: b.state.revision, status: b.state.status,paused:b.state.paused, players: b.state.players.map(p => ({ name: p.name })), remaining: b.state.game.remaining, legs: b.state.game.legs, turn: b.state.game.turn, visits: b.state.game.visits.slice(-18).map(v => ({ score: v.score, playerIndex: v.playerIndex, remainingAfter: v.remainingAfter, bust: v.bust, checkout: v.checkout })) } : null })), fixtures,
    standings: (table??row.state.tournamentControl?.poolTables?.flatMap(table=>table.rows.map(row=>({...row,pool:table.pool})))??standings(sourceFixtures.filter(f=>f.phase!=='knockout'&&!f.purpose),playerIds)).map(s => ({ name: publicName(s.id),...('pool'in s?{pool:s.pool}:{}),...('position'in s?{position:s.position,shared:s.shared}:{}),played:s.played,won:s.won,drawn:s.drawn,points:s.points,legsFor:s.legsFor,legsAgainst:s.legsAgainst,...('buchholz'in s?{buchholz:s.buchholz,byes:s.byes}:{}) })) };
}

export async function getPlatformStatistics(actorId: string) {
  return getPlayerStatisticsSummary(uuid(actorId));
}

export async function exportPlatformCsv(actorId:string,kind:string,clubId?:string):Promise<string>{
 const actor=uuid(actorId),client=database();let headers:string[],rows:unknown[][];
 if(kind==='players'){
  const platform=Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')",[actor])).rowCount);
  if(!platform&&(!clubId||!(await isClubMember(client,uuid(clubId),actor,true))))throw new DomainError('forbidden','Je kunt alleen je eigen spelersregister exporteren.',403);
  const people=await client.query('select p.id,p.name,coalesce(r.status,\'approved\') as status from dartflow_private.profile_labels p left join dartflow_private.platform_registrations r on r.user_id=p.id where ($1::uuid is null or exists(select 1 from dartflow_private.club_memberships m where m.club_id=$1 and m.user_id=p.id)) order by p.name,p.id',[clubId?uuid(clubId):null]);headers=['Speler-ID','Naam','Status'];rows=people.rows.map(p=>[p.id,p.name,p.status]);
 }else if(kind==='matches'){
  const matches=await client.query<{snapshot:ResultView}>(`select r.snapshot from dartflow_private.match_results r join dartflow_private.match_players p on p.match_id=r.match_id where p.user_id=$1 and ${finalResultSql} order by r.created_at desc`,[actor]);headers=['Partij-ID','Speler 1','Speler 2','Legs 1','Legs 2','Winnaar-ID'];rows=matches.rows.map(({snapshot:s})=>[s.matchId,s.players[0].name,s.players[1].name,s.legs[0],s.legs[1],s.winnerId??'Gelijkspel']);
 }else if(kind==='rankings'){
  if(!clubId||!(await isClubMember(client,uuid(clubId),actor)))throw new DomainError('forbidden','Kies een club waarvan je lid bent.',403);
  const scores=await client.query('select s.user_id,p.name,sum(s.played)::integer as played,sum(s.won)::integer as won,sum(s.drawn)::integer as drawn,sum(s.points)::integer as points from dartflow_private.standings s join dartflow_private.events e on e.id=s.event_id join dartflow_private.profile_labels p on p.id=s.user_id where e.club_id=$1 and not exists(select 1 from dartflow_private.platform_entities managed where managed.state->>\'eventId\'=e.id::text and managed.state->>\'seasonManaged\'=\'true\') group by s.user_id,p.name order by points desc,p.name',[clubId]);headers=['Speler-ID','Naam','Gespeeld','Gewonnen','Gelijk','Punten'];rows=scores.rows.map(s=>[s.user_id,s.name,s.played,s.won,s.drawn,s.points]);
 }else throw new DomainError('invalid_export','Kies spelers, wedstrijden of ranglijst.');
 const cell=(value:unknown)=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
 return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

/** Acknowledges only the applied prefix. The caller retains all unacknowledged work. */
export async function replayMatchCommands(actorId:string,input:unknown):Promise<Record<string,unknown>>{
 const actor=uuid(actorId),batch=input as {matchId:string;baseRevision:number;commands:{requestId:string;matchId?:string;expectedRevision:number;action:Record<string,unknown>}[]};
 const matchId=uuid(batch?.matchId);
 if(!Number.isSafeInteger(batch.baseRevision)||batch.baseRevision<0||!Array.isArray(batch.commands)||batch.commands.length<1||batch.commands.length>100)throw new DomainError('invalid_replay','Gebruik een geordende wachtrij van maximaal 100 acties.');
 const ids=new Set<string>();
 for(const [i,command]of batch.commands.entries()){
  uuid(command?.requestId);
  if(ids.has(command.requestId)||command.matchId!==undefined&&command.matchId!==matchId||command.expectedRevision!==batch.baseRevision+i||!['score','undo'].includes(String(command.action?.type)))throw new DomainError('invalid_replay','De wachtrij hoort niet bij één partij en één basisrevisie.');ids.add(command.requestId);
 }
 let current:Awaited<ReturnType<typeof getMatch>>|undefined;try{current=await getMatch(actor,matchId);}catch(error){if(!(error instanceof DomainError&&error.status===403))throw error;}
 if(current&&!current.permissions.canScore&&!current.permissions.canUndo&&batch.baseRevision>=current.revision)throw new DomainError('not_writer','Alleen de actuele schrijver kan deze wachtrij herstellen.',403);
 const accepted:string[]=[];let conflict:Record<string,unknown>|undefined;
 for(const [sequence,command]of batch.commands.entries()){
  try{current=await executeMatchCommand(actor,{offline:true,matchId,requestId:command.requestId,expectedRevision:command.expectedRevision,action:command.action as Parameters<typeof executeMatchCommand>[1]['action']},{baseRevision:batch.baseRevision,sequence,acceptedPrefix:batch.commands.slice(0,accepted.length).map(v=>({...v,matchId,action:v.action as Parameters<typeof executeMatchCommand>[1]['action']}))});accepted.push(command.requestId);}
  catch(error){if(!(error instanceof DomainError))throw error;conflict={code:error.code,message:error.message,status:error.status};if(error.code!=='offline_conflict_pending')break;}
 }
 return {ok:accepted.length===batch.commands.length,matchId,accepted,pending:batch.commands.slice(accepted.length).map(c=>c.requestId),revision:current?.revision??batch.baseRevision,...(conflict?{conflict}:{})};
}

/** Durable event ticking is safe to repeat; expired calls never cancel a live match. */
export async function reconcilePlatformCalls():Promise<void>{
 const {rows}=await database().query<{id:string}>("select id from dartflow_private.platform_entities where kind in ('league','tournament') and coalesce(state->>'seasonManaged','false')<>'true' and ((jsonb_typeof(state->'calls')='object' and state->'calls'<>'{}'::jsonb) or state->>'autoSchedule'='true') order by updated_at desc limit 100");
 for(const item of rows)await transaction(async client=>{
  const row=await entity(client,item.id,true),calls=(row.state.calls??{})as Record<string,{expiresAt:number;writerId?:string|null}>;let changed=false;
  await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);
  for(const [fixtureId,call]of Object.entries(calls)){
   const fixture=row.state.fixtures?.find(f=>f.id===fixtureId);if(!fixture?.matchId){delete calls[fixtureId];changed=true;continue;}
   const {rows:matches}=await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1 for update',[fixture.matchId]);const state=matches[0]?.state;
   if(!state||!['called','ready'].includes(state.status)){delete calls[fixtureId];changed=true;continue;}
   if(state.status==='ready'||call.expiresAt>Date.now())continue;
   state.status='planned';state.boardId=null;state.callRef=null;state.accepted=[false,false];state.writerId=state.players[0].id;state.delegatedWriterId=null;state.revision++;
   await client.query('update dartflow_private.matches set board_id=null,revision=$3,state=$2,updated_at=now() where id=$1',[state.id,JSON.stringify(state),state.revision]);
   fixture.status='scheduled';delete calls[fixtureId];changed=true;
   for(const player of state.players)await client.query("update dartflow_private.platform_members set attributes=attributes||'{\"available\":false,\"needsReady\":true}'::jsonb where entity_id=$1 and user_id=$2",[row.id,player.id]);
   await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail) values($1,$2,$3,$4)',[row.owner_id,row.id,'fixture.call-expired',JSON.stringify({fixtureId,matchId:state.id,revision:state.revision,trigger:'system-tick'})]);
  }
  if(changed)row.state.calls=calls;
  if(row.state.autoSchedule===true&&!row.state.paused){const assignments=await autoAssign(client,row);if(assignments.length)changed=true;}
  if(changed)await save(client,row);
 });
}

export async function getMatchChat(actorId:string,matchId:string):Promise<{messages:PlatformMessage[]}>{
 const page=await getCommunityChat(actorId,'match',matchId);
 return {messages:page.messages.filter(message=>!message.deleted).map(({id,authorId,authorName,body,createdAt})=>({id,authorId,authorName,body,createdAt}))};
}
export async function sendMatchChat(actorId:string,matchId:string,input:unknown){
 const value=input as {requestId:string;body:unknown};if(typeof value?.body!=='string'||!value.body.trim()||value.body.length>2000)throw new DomainError('invalid_message','Gebruik een bericht van 1 tot 2000 tekens.');
 return sendMatchSignal(actorId,matchId,{requestId:value.requestId,type:'chat',payload:{body:value.body.trim()}});
}
