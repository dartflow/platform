import{assertCircuitQualificationCommand}from'./circuit-qualifications';
import{parseTournamentRuleOverrides,snapshotTournamentRules}from'./tournament-rule-overrides';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, validateSettings } from './domain';
import {rotateEntityInvitation}from'./invitations';
import {assertBoardUnreserved,boardLease,lockPlayingActors}from'./platform-locks';
import { enqueueMatchTransition } from './integrations-domain';
import {eventAccess, publishResult } from './db';
import type { MatchState } from './types';
import { enqueueDomainMail } from './integrations-mail';
import { advanceFixtures, roundRobin, tournamentFixtures } from './platform-domain';
import { acceptsCode, addMember, allowsExternalParticipants, blocked, createCoreEvent, createCoreMatch, createEntity, entity, isClubMember, member, number, requireAccess, save, syncCompetitionRoom, text, uuid, view } from './platform-store';
import type { EntityRow } from './platform-store';
import type { PlatformCommand, PlatformResponse, PlatformState } from './platform-types';
import {assertPhysicalBoardEvent,eventPhysicalBoards,physicalBoard,locationManager} from './location-access';
import {clubPermission} from './club-access';
import {drawTournamentPlayers,TOURNAMENT_ALGORITHM_VERSION,swissRoundLimit,nextSwissRound,tournamentOutcome} from './tournament-formats';
import {assertEventRankingMutable} from './ranking-events';
import {assertPrimaryCorrectionFixtureAllowed,primaryCorrectionBlockedFixtureIds} from './match-corrections';
import {assertAccountActive} from './account-removal';
import {publishTournamentDraw,manageTournamentRound,assertTournamentManagerReplay} from './tournament-management';
import {tournamentFixtureReleased} from './tournament-pools';
import {parseTournamentPlanning,buildTournamentPlan,type TournamentPlanningInput} from './tournament-planning';
import {enqueueAuditedNotification} from './notification-audit-source';

/** Receipt replay checks the original scope again, including a copy's independently authorized destination. */
export async function revalidateCompetitionManagementCommand(client:PoolClient,actor:string,command:PlatformCommand):Promise<void>{
 await assertTournamentManagerReplay(client,actor,command);
 const action=command.action;if(!['competition.copy','competition.coorganizer','competition.rules'].includes(action.type))return;
 const source=await entity(client,action.id);await requireAccess(client,source,actor,true);
 if(action.type==='competition.coorganizer'&&source.owner_id!==actor)throw new DomainError('forbidden','Alleen de eigenaar wijst medebeheerders voor dit evenement aan.',403);
 if(action.type==='competition.copy'){
  const ownership=String(action.ownership??source.state.ownership??(source.club_id?'club':'platform'));
  if(ownership==='club'&&!await clubPermission(client,uuid(action.clubId),actor,source.kind==='league'?'competitions.manage':'tournaments.manage'))throw new DomainError('forbidden','De nieuwe organisator vereist een actueel eigen organisatierecht.',403);
  if(ownership==='platform'&&!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount)throw new DomainError('forbidden','Een nieuw platformevenement vereist platformbeheer.',403);
 }
}

/** Both self-scan and the server-verified PIN coupling share the locked second-slot rules. */
export async function joinLobbyMember(client:PoolClient,actor:string,row:EntityRow,input:{boardId?:unknown;code?:unknown;requestId:string;pinAuthorizer?:string}):Promise<void>{
 const self=await member(client,row.id,actor),boundBoard=typeof row.state.boardId==='string'?row.state.boardId:null;
 if(row.kind!=='lobby'||row.state.closed||row.state.matchId||self?.status==='banned'||await blocked(client,actor,row.owner_id))throw new DomainError('lobby_unavailable','Deze lobby is niet beschikbaar.',409);
 if(self?.status!=='active'&&self?.status!=='invited'&&!(boundBoard&&input.boardId===boundBoard&&(row.state.setup==='localone'||input.pinAuthorizer===row.owner_id&&row.state.setup==='localtwo'))&&!acceptsCode(row,input.code))throw new DomainError('invite_required','Gebruik een geldige uitnodiging.',403);
 if(self?.status==='active')return;
 const count=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id]);
 if(count.rows[0].n>=2)throw new DomainError('lobby_full','Deze lobby heeft al twee spelers.',409);
 const invited=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='invited'",[row.id]);
 if(invited.rows.length&&!invited.rows.some(r=>r.user_id===actor))throw new DomainError('invite_recipient','Deze uitnodiging hoort bij een andere speler.',403);
 await addMember(client,row.id,actor,'member','active',input.pinAuthorizer?{pinLinkedBy:input.pinAuthorizer}:{});
 await enqueueDomainMail(client,{actorId:actor,id:`${input.requestId}:challenge-accepted:${row.owner_id}`,templateId:'challenge-accepted',scope:'platform',recipientId:row.owner_id,entityId:row.id,variables:{eventName:row.state.name,startScore:String(row.state.settings?.startScore??501),bestOf:String(row.state.settings?.bestOfLegs??5),actionUrl:`/app/lobby/${row.id}`}});
}

export async function competitionAction(client: PoolClient, actor: string, command: PlatformCommand): Promise<PlatformResponse | null> {
  const a = command.action, type = a.type;
  if (type === 'lobby.create') {
    const settings = validateSettings({ ...a, startScore: Number(a.startScore ?? 501) as 301 | 501 | 701, bestOfLegs: Number(a.bestOfLegs ?? 3) });
    const setup = String(a.setup ?? 'localone');
    if (!['localone', 'localtwo', 'remote', 'hybrid'].includes(setup)) throw new DomainError('invalid_setup', 'Kies een geldige speelopstelling.');
    const { row, code } = await createEntity(client, actor, 'lobby', { name: a.name ? text(a.name) : 'Vrije wedstrijd', setup, settings, capacity: 2, ready: {} }, 'private');
    if (a.opponentId) {
      const user = uuid(a.opponentId);
      if (user === actor || await blocked(client, actor, user)) throw new DomainError('blocked', 'Deze uitnodiging is niet toegestaan.', 403);
      await addMember(client, row.id, user, 'member', 'invited');
      await enqueueDomainMail(client, { actorId:actor, id: `${command.requestId}:challenge-invite:${user}`, templateId: 'challenge-invite', scope: 'platform', recipientId: user, variables: { actionUrl: `/app#lobby/${row.id}`, eventName: row.state.name, startScore:String(row.state.settings?.startScore??501),bestOf:String(row.state.settings?.bestOfLegs??5) }, entityId: row.id });
    }
    return { ok: true, id: row.id, code, entity: await view(client, row, actor) };
  }
  if (type === 'league.create' || type === 'tournament.create') {
    const clubId = a.clubId ? uuid(a.clubId) : null;
    const ownership=String(a.ownership??(clubId?'club':'platform'));
    if(!['personal','club','platform'].includes(ownership)||ownership==='club'&&!clubId||ownership!=='club'&&clubId||ownership==='personal'&&type!=='tournament.create')throw new DomainError('invalid_ownership','Kies persoonlijk, een bevoegde vereniging of het platform.');
    if(a.rankingDestinations!==undefined&&(!Array.isArray(a.rankingDestinations)||a.rankingDestinations.length))throw new DomainError('ranking_not_authorized','Dit evenement heeft geen goedgekeurde officiële rankingbestemming.',403);
    if (clubId) {
      if (!(await clubPermission(client,clubId,actor,type==='league.create'?'competitions.manage':'tournaments.manage'))) throw new DomainError('forbidden', 'Je mist het organisatierecht voor dit evenement.', 403);
    } else if (ownership==='platform'&&!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')", [actor])).rowCount) throw new DomainError('forbidden', 'Een wereldwijd evenement vereist platformbeheer. Kies persoonlijk of je eigen club.', 403);
    const kind = type === 'league.create' ? 'league' : 'tournament';
    const eligibility=a.eligibility==='invite'?'code':String(a.eligibility??(clubId?'club':'all'));
    if(!['all','club','code'].includes(eligibility)||(eligibility==='club'&&!clubId))throw new DomainError('invalid_eligibility','Kies open, clubleden of een uitnodigingscode.');
    const format = String(a.format ?? (kind === 'league' ? 'best5' : 'pools-knockout'));
    if (kind === 'league' ? !['best5', 'best7', 'fixed8', 'fixed10', 'round-robin'].includes(format) : !['pools-knockout', 'knockout','swiss','double-elimination-reset','double-elimination-single'].includes(format)) throw new DomainError('invalid_format', 'Kies een ondersteund competitie- of toernooiformat.');
    const settings = validateSettings({ ...a, startScore: Number(a.startScore ?? 501) as 301 | 501 | 701, bestOfLegs: Number(a.bestOfLegs ?? (format === 'best7' ? 7 : 5)), ...(format.startsWith('fixed') ? { legLimit: Number(format.slice(5)) } : {}) });
    const date = a.date === undefined ? new Date().toISOString().slice(0, 10) : text(a.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)) throw new DomainError('invalid_date', 'Kies een geldige datum.');
    const visibility=String(a.visibility??(eligibility==='club'?'club':ownership==='personal'?'private':'public'));
    if(!['public','private','club'].includes(visibility)||visibility==='club'&&!clubId)throw new DomainError('invalid_visibility','Kies een geldige zichtbaarheid voor dit evenement.');
    const state: PlatformState = { name: text(a.name), ownership, rankingDestinations:[], description: a.description ? text(a.description, 2000) : '',location:a.location?text(a.location,200):'', capacity: number(a.capacity, 32, 2, 128),approvalRequired:kind==='tournament'&&a.approvalRequired===true,eligibility, format, settings, date, poolCount: number(a.poolCount, 2, 1, 8), fixtures: [], registrationOpen: true, paused: false, autoSchedule: false, callSeconds: 120, restSeconds: 90, cooldownSeconds: 30, requireWriter: a.requireWriter !== false, cast: { scene: 'hall', updatedAt: new Date().toISOString() } };
    if(kind==='tournament'&&a.planning!==undefined){try{const planningFormat: TournamentPlanningInput['format']=format==='pools-knockout'?'pools-ko':format.startsWith('double-elimination')?'double-elimination':format as TournamentPlanningInput['format'];state.planning=parseTournamentPlanning(a.planning,{players:state.capacity,boards:number(a.boards,4,1,32),pools:state.poolCount,format:planningFormat});state.planningPreview=buildTournamentPlan(state.planning as TournamentPlanningInput);}catch(error){throw new DomainError('invalid_planning',error instanceof Error?error.message:'Controleer de planning.');}}
    if(state.planningPreview){const preview=state.planningPreview as ReturnType<typeof buildTournamentPlan>;if(preview.endAt&&preview.input.deadline&&Date.parse(preview.endAt)>Date.parse(preview.input.deadline)){if(a.acceptPlanningWarnings!==true)throw new DomainError('planning_deadline_ack','Pas de eindtijd/planning aan of bevestig de tijdoverschrijding vóór publicatie.',409);state.planningDeadlineAcceptedAt=new Date().toISOString();state.planningDeadlineAcceptedUntil=preview.endAt;}}
    state.bronze=a.bronze===true||a.thirdPlace===true;if(a.consolation===true){if(format!=='knockout')throw new DomainError('consolation_format','Kies enkele eliminatie voor een afzonderlijke eerste-rondeverliezersbeker.',409);state.consolation={enabled:true,title:a.consolationTitle===undefined?'Troostbeker':text(a.consolationTitle,80),completed:false,placings:[]};}if(a.tournamentRuleOverrides!==undefined)state.tournamentRuleOverrides=parseTournamentRuleOverrides(a.tournamentRuleOverrides,settings);
    await createCoreEvent(client, actor, state, clubId);
    state.drawCheckedInOnly=a.drawCheckedInOnly===true||['swiss','double-elimination-reset','double-elimination-single'].includes(format);
    if(format==='swiss'&&a.swissRounds!==undefined)state.swissRounds=number(a.swissRounds,1,1,128);
    const { row, code } = await createEntity(client, actor, kind, state, visibility, clubId);
    await client.query("update dartflow_private.platform_members set attributes='{\"registered\":false}' where entity_id=$1 and user_id=$2", [row.id, actor]);
    const {row:room}=await createEntity(client,actor,'room',{name:`${state.name} · Spelerslounge`,description:'De geautoriseerde spelerskamer van deze speeldag.',capacity:64,slowMode:0,competitionId:row.id,organizerClubId:clubId},'private');
    row.state.roomId=room.id;await save(client,row);
    const boards = number(a.boards, 4, 1, 32);
    for (let i = 0; i < boards; i++) await client.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)', [randomUUID(), state.eventId, `Baan ${i + 1}`]);
    return { ok: true, id: row.id, code, entity: await view(client, row, actor) };
  }
  if (!type.startsWith('lobby.') && !type.startsWith('competition.') && !type.startsWith('fixture.') && !type.startsWith('cast.') && !type.startsWith('board.')) return null;
  const row = await entity(client, a.id, true);
  if (command.expectedRevision !== undefined && command.expectedRevision !== row.revision) throw new DomainError('revision_conflict', 'Dit onderdeel is gewijzigd. Vernieuw en probeer opnieuw.', 409);
  if (type.startsWith('lobby.')) return lobbyAction(client, actor, command, row);
  if (!['league', 'tournament'].includes(row.kind)) throw new DomainError('invalid_kind', 'Open eerst een competitie of toernooi.');
  await assertCircuitQualificationCommand(client,row,type);
  if(type.startsWith('fixture.')||['competition.plan','competition.redraw','competition.pool-decider','competition.advance-decider','competition.release-round','competition.next-round','competition.autoplan','competition.settings','competition.rules'].includes(type))await assertPrimaryCorrectionFixtureAllowed(client,row,type.startsWith('fixture.')?String(a.fixtureId??''):undefined);
  if(type==='competition.rules'){
    await requireAccess(client,row,actor,true);if(row.kind!=='tournament')throw new DomainError('invalid_kind','Faseregels horen bij een toernooi.');
    if(command.expectedRevision===undefined)throw new DomainError('revision_required','Publiceer faseregels op de actuele evenementversie.',409);
    await assertEventRankingMutable(client,row.id);if(row.state.fixtures?.length)throw new DomainError('phase_rules_locked','Publiceer de spelregels vóór de loting. Kopieer de editie voor andere regels.',409);
    row.state.tournamentRuleOverrides=parseTournamentRuleOverrides(a.overrides,row.state.settings!);row.state.ruleVersion=Number(row.state.ruleVersion??0)+1;
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,$3,$4)',[actor,row.id,type,JSON.stringify({requestId:command.requestId,ruleVersion:row.state.ruleVersion,overrides:row.state.tournamentRuleOverrides})]);await save(client,row);return{ok:true,id:row.id,entity:await view(client,row,actor)};
  }
  if(type==='competition.copy'){
    await requireAccess(client,row,actor,true);
    const ownership=String(a.ownership??row.state.ownership??(row.club_id?'club':'platform')),clubId=ownership==='club'?uuid(a.clubId):null;
    const sourceSettings=row.state.settings!,boardCount=(await client.query<{count:number}>('select count(*)::int count from dartflow_private.boards where event_id=$1',[row.state.eventId])).rows[0].count;
    const copied=await competitionAction(client,actor,{requestId:command.requestId,action:{type:row.kind==='league'?'league.create':'tournament.create',name:text(a.name),ownership,clubId,
      description:row.state.description??'',location:row.state.location??'',format:row.state.format,capacity:row.state.capacity,poolCount:row.state.poolCount,
      date:a.date??row.state.date,visibility:a.visibility??(ownership==='personal'?'private':row.visibility==='club'&&!clubId?'private':row.visibility),
      eligibility:a.eligibility??(row.state.eligibility==='club'&&!clubId?'all':row.state.eligibility),approvalRequired:row.state.approvalRequired,
      boards:Math.max(1,boardCount),requireWriter:row.state.requireWriter,drawCheckedInOnly:row.state.drawCheckedInOnly,swissRounds:row.state.tournamentRules?.swissRounds??row.state.swissRounds,tournamentRuleOverrides:row.state.tournamentRuleOverrides,...sourceSettings}});
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,$3,$4)',[actor,copied!.id,'competition.copy.definition',JSON.stringify({sourceId:row.id,sourceRevision:row.revision,requestId:command.requestId})]);return copied;
  }
  if(type==='competition.coorganizer'){
    await requireAccess(client,row,actor,true);if(row.owner_id!==actor)throw new DomainError('forbidden','Alleen de eigenaar wijst medebeheerders voor dit evenement aan.',403);
    if(typeof a.enabled!=='boolean')throw new DomainError('invalid_coorganizer','Kies medebeheer toestaan of intrekken.');
    const target=uuid(a.userId);if(target===row.owner_id)throw new DomainError('owner_role_locked','De eigenaar kan niet via deze rol worden gewijzigd.',409);await assertAccountActive(target,client);
    const existing=await member(client,row.id,target);if(a.enabled){
      if(existing?.status==='banned'||await blocked(client,actor,target))throw new DomainError('forbidden','Deze speler kan niet als medebeheerder worden toegevoegd.',403);
      if(!(await client.query('select 1 from dartflow_private.profiles where id=$1 and display_name_confirmed=true',[target])).rowCount)throw new DomainError('display_name_required','De medebeheerder heeft een bevestigd spelersprofiel nodig.',409);
      if(row.club_id&&!await clubPermission(client,row.club_id,target,row.kind==='league'?'competitions.manage':'tournaments.manage'))throw new DomainError('forbidden','Een clubmedebeheerder heeft het actuele organisatierecht van deze vereniging nodig.',403);
      if(!row.club_id){
        if((await client.query('select 1 from dartflow_private.events where club_id=$1 and id<>$2 limit 1',[row.state.coreClubId,row.state.eventId])).rowCount)throw new DomainError('coorganizer_scope_unsupported','Dit oudere evenement deelt zijn beheerscope. Maak een afzonderlijke kopie voor lokale medebeheerders.',409);
        await client.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'organizer')on conflict(club_id,user_id)do update set role='organizer'",[row.state.coreClubId,target]);
      }
      await addMember(client,row.id,target,'moderator','active',{...existing?.attributes,coOrganizer:true});await client.query('insert into dartflow_private.event_staff(event_id,user_id)values($1,$2)on conflict do nothing',[row.state.eventId,target]);
    }else{
      if(existing?.attributes.coOrganizer!==true)throw new DomainError('coorganizer_missing','Deze speler heeft geen lokaal medebeheer om in te trekken.',409);
      const attributes={...existing.attributes};delete attributes.coOrganizer;
      await client.query('update dartflow_private.platform_members set role=$3,status=$4,attributes=$5 where entity_id=$1 and user_id=$2',[row.id,target,'member',attributes.registered===true?'active':'left',JSON.stringify(attributes)]);
      await client.query('delete from dartflow_private.event_staff where event_id=$1 and user_id=$2',[row.state.eventId,target]);
      if(!row.club_id)await client.query("delete from dartflow_private.club_memberships where club_id=$1 and user_id=$2 and role='organizer'",[row.state.coreClubId,target]);
    }
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,$3,$4)',[actor,row.id,'competition.coorganizer.decision',JSON.stringify({target,enabled:a.enabled,requestId:command.requestId})]);await save(client,row);return{ok:true,id:row.id,entity:await view(client,row,actor)};
  }
  snapshotTournamentRules(row.state);
  const self = await member(client, row.id, actor);
  if (row.club_id && !allowsExternalParticipants(row) && !(await isClubMember(client,row.club_id,actor)))throw new DomainError('forbidden','Dit evenement is voor clubleden.',403);
  if (type === 'competition.register') {
    if (row.state.registrationOpen === false || row.state.fixtures?.length) throw new DomainError('registration_closed', 'De inschrijving is gesloten.', 409);
    if (self?.attributes.registered === true || self?.status === 'waitlisted') return { ok: true, id: row.id };
    if(row.visibility==='private'&&!['active','invited'].includes(self?.status??'')&&!acceptsCode(row,a.code??a.inviteCode))throw new DomainError('invite_required','Gebruik de uitnodiging voor dit besloten evenement.',403);
    if(row.state.eligibility==='code'&&!acceptsCode(row,a.code??a.inviteCode))throw new DomainError('invite_required','Gebruik een geldige uitnodigingscode voor dit evenement.',403);
    const { rows } = await client.query("select count(*)::integer as count from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'", [row.id]);
    const status = row.kind==='tournament'&&row.state.approvalRequired===true?'pending':rows[0].count < (row.state.capacity ?? 32) ? 'active' : 'waitlisted';
    await addMember(client, row.id, actor, self?.role ?? 'member', status, { registered: true, checkedIn: false, available: false, restUntil: 0 });
    if(status!=='pending')await client.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,$4,false) on conflict(event_id,user_id) do update set status=excluded.status,checked_in=false",[randomUUID(),row.state.eventId,actor,status==='active'?'registered':'waitlisted']);
    await syncCompetitionRoom(client,row,actor,status);
    await enqueueDomainMail(client, { actorId:actor, id: `${command.requestId}:entry:${actor}`, templateId: row.kind === 'league' ? 'competition-entry' : status==='pending'?'tournament-entry':status === 'waitlisted' ? 'tournament-waitlist' : 'tournament-approved', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: actor, entityId: row.id, variables: { eventName: row.state.name, status: status==='pending'?'In behandeling':status === 'active' ? 'Ingeschreven' : 'Wachtlijst' } });
  } else if (type === 'competition.withdraw') {
    if(self?.attributes.registered!==true||!['active','waitlisted','pending'].includes(self.status))throw new DomainError('registration_required','Je hebt geen actieve inschrijving.',409);
    if (row.state.fixtures?.some(f => f.players.includes(actor) && !['confirmed', 'bye'].includes(f.status))) throw new DomainError('active_fixture', 'Je bent ingedeeld. Vraag de wedstrijdleiding om een beslissing.', 409);
    await client.query("update dartflow_private.platform_members set attributes=jsonb_set(attributes,'{registered}','false'),status=case when role='owner' then 'active' else 'left' end where entity_id=$1 and user_id=$2", [row.id, actor]);
    await syncCompetitionRoom(client,row,actor,'left');
    if(row.kind==='tournament')await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:withdrawn:${actor}`,templateId:'tournament-withdrawn',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:actor,entityId:row.id,variables:{eventName:row.state.name,status:'Uitgeschreven'}});
    await client.query("update dartflow_private.entries set status='withdrawn',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,actor]);
    const waiting = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='waitlisted' order by created_at,user_id limit 1", [row.id]);
    if (self.status==='active'&&waiting.rows.length) {
      const user = waiting.rows[0].user_id;
      await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2", [row.id, user]);
      await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,user]);
      await syncCompetitionRoom(client,row,user,'active');
      await enqueueDomainMail(client, { actorId:actor, id: `${command.requestId}:promoted:${user}`, templateId: 'tournament-promoted', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: user, entityId: row.id, variables: { eventName: row.state.name } });
    }
  } else if(type==='competition.approve'){
    if(row.state.registrationOpen===false||row.state.fixtures?.length)throw new DomainError('registration_closed','De inschrijving is gesloten.',409);
    if(row.kind!=='tournament')throw new DomainError('invalid_kind','Kies een toernooiaanmelding.');
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),entry=await member(client,row.id,target);
    if(entry?.status!=='pending'||entry.attributes.registered!==true)throw new DomainError('request_missing','Deze speler heeft geen open aanvraag.',409);
    const count=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]),status=count.rows[0].n<(row.state.capacity??32)?'active':'waitlisted';
    await client.query('update dartflow_private.platform_members set status=$3 where entity_id=$1 and user_id=$2',[row.id,target,status]);
    await client.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,$4,false) on conflict(event_id,user_id) do update set status=excluded.status,checked_in=false",[randomUUID(),row.state.eventId,target,status==='active'?'registered':'waitlisted']);await syncCompetitionRoom(client,row,target,status);
    await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:approved:${target}`,templateId:status==='active'?'tournament-approved':'tournament-waitlist',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:status==='active'?'Bevestigd':'Wachtlijst'}});
  } else if(type==='competition.reject'){
    if(row.kind!=='tournament')throw new DomainError('invalid_kind','Deze afwijzingsprocedure hoort bij een toernooiaanmelding.');
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),entry=await member(client,row.id,target),reason=text(a.reason,500);
    if(!entry||entry.attributes.registered!==true||!['active','waitlisted','pending'].includes(entry.status))throw new DomainError('registration_required','Deze speler heeft geen inschrijving.',409);
    if(row.state.fixtures?.some(f=>f.players.includes(target)&&!['confirmed','bye'].includes(f.status)))throw new DomainError('active_fixture','Beslis eerst over de ingedeelde partij.',409);
    await client.query("update dartflow_private.platform_members set attributes=attributes||$3::jsonb,status=case when role='owner' then 'active' else 'left' end where entity_id=$1 and user_id=$2",[row.id,target,JSON.stringify({registered:false,checkedIn:false,available:false,decisionReason:reason})]);
    await client.query("update dartflow_private.entries set status='withdrawn',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,target]);await syncCompetitionRoom(client,row,target,'left');
    await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:rejected:${target}`,templateId:'tournament-rejected',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:'Afgewezen',reason:'Bekijk het besluit in DartFlow'}});
    if(entry.status==='active'){
      const waiting=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='waitlisted' order by created_at,user_id limit 1",[row.id]);
      if(waiting.rows.length){const user=waiting.rows[0].user_id;await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2",[row.id,user]);await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,user]);await syncCompetitionRoom(client,row,user,'active');await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:promoted:${user}`,templateId:row.kind==='tournament'?'tournament-promoted':'competition-entry',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:user,entityId:row.id,variables:{eventName:row.state.name,status:'Bevestigd'}});}
    }
  } else if(type==='competition.promote'){
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),waiting=await member(client,row.id,target);if(waiting?.status!=='waitlisted')throw new DomainError('waitlist_required','Deze speler staat niet op de wachtlijst.',409);
    const count=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]);if(count.rows[0].n>=(row.state.capacity??32))throw new DomainError('capacity_reached','Er is geen bevestigde plek beschikbaar.',409);
    await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2",[row.id,target]);await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,target]);
    await syncCompetitionRoom(client,row,target,'active');
    await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:promoted:${target}`,templateId:row.kind==='tournament'?'tournament-promoted':'competition-entry',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:'Bevestigd'}});
  } else if (type === 'competition.checkin' || type === 'competition.available') {
    const target = a.userId ? uuid(a.userId) : actor;
    if (target !== actor) await requireAccess(client, row, actor, true);
    const m = await member(client, row.id, target);
    if (m?.status !== 'active' || m.attributes.registered !== true) throw new DomainError('registration_required', 'Deze speler heeft geen bevestigde inschrijving.', 409);
    await client.query("update dartflow_private.platform_members set attributes=attributes || $3::jsonb where entity_id=$1 and user_id=$2", [row.id, target, JSON.stringify(type === 'competition.checkin' ? { checkedIn: true, available: true } : { available: a.available !== false })]);
    if(type==='competition.checkin')await client.query("update dartflow_private.entries set checked_in=true where event_id=$1 and user_id=$2 and status='registered'",[row.state.eventId,target]);
  } else if (type === 'competition.plan'||type==='competition.redraw') {
    await requireAccess(client, row, actor, true);
    if(row.kind==='tournament')await publishTournamentDraw(client,row,actor,command);
    else {
    if (row.state.fixtures?.length) throw new DomainError('schedule_exists', 'Dit schema is al vastgelegd.', 409);
    const { rows } = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true' and ($2::boolean=false or attributes->>'checkedIn'='true') order by created_at,user_id", [row.id,row.state.drawCheckedInOnly===true]);
    const players = rows.map(r => String(r.user_id));
    if(row.kind==='league')row.state.fixtures=roundRobin(players);else{
      const drawSeed=randomUUID(),seedOrder=drawTournamentPlayers(players,drawSeed),swissRounds=row.state.format==='swiss'?swissRoundLimit(players.length,row.state.swissRounds):undefined;
      row.state.tournamentRules={algorithmVersion:TOURNAMENT_ALGORITHM_VERSION,seedOrder,drawSeed,...(swissRounds?{swissRounds}:{}),...(row.state.format?.startsWith('double-elimination')?{finalVariant:row.state.format==='double-elimination-reset'?'reset':'single'}:{})};
      row.state.fixtures=tournamentFixtures(seedOrder,row.state.format!,row.state.poolCount,{swissRounds});
      if(row.state.format==='swiss')row.state.standings=tournamentOutcome(row.state.fixtures,'swiss',seedOrder,swissRounds).standings;
    }
    row.state.registrationOpen = false;
    }
  }else if(['competition.pool-decider','competition.advance-decider','competition.release-round'].includes(type)){
    await requireAccess(client,row,actor,true);if(command.expectedRevision===undefined)throw new DomainError('revision_required','Deze fasebeslissing vereist de actuele revisie.',409);manageTournamentRound(row,a);
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,$3,$4)',[actor,row.id,type,JSON.stringify({requestId:command.requestId,reason:text(a.reason,1000),pool:a.pool,round:a.round,decisionId:a.decisionId})]);
  }else if(type==='competition.next-round'){
    await requireAccess(client,row,actor,true);nextSwissRound(row.state);
    row.state.standings=tournamentOutcome(row.state.fixtures!,'swiss',row.state.tournamentRules!.seedOrder,row.state.tournamentRules!.swissRounds).standings;
  } else if(type==='competition.invite'){
    await requireAccess(client,row,actor,true);const code=await rotateEntityInvitation(client,row);await save(client,row);return {ok:true,id:row.id,code,entity:await view(client,row,actor)};
  } else if (type === 'competition.settings') {
    await requireAccess(client, row, actor, true);
    if(a.eligibility!==undefined)await assertEventRankingMutable(client,row.id);
    if(['ownership','clubId','rankingDestinations'].some(key=>a[key]!==undefined))throw new DomainError('ownership_locked','Organisator en officiële bestemmingen kunnen niet via evenementinstellingen worden gewijzigd.',409);
    if(a.approvalRequired!==undefined){if(row.kind!=='tournament'||typeof a.approvalRequired!=='boolean')throw new DomainError('invalid_approval','Kies een geldige toernooigoedkeuring.');const registrations=await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and attributes->>'registered'='true' limit 1",[row.id]);if(registrations.rowCount)throw new DomainError('approval_locked','De goedkeuring staat vast zodra er aanmeldingen zijn.',409);row.state.approvalRequired=a.approvalRequired;}
    const previous={name:row.state.name,date:row.state.date,location:row.state.location};
    if(a.name!==undefined)row.state.name=text(a.name,80);
    if(a.location!==undefined)row.state.location=text(a.location,200,false);
    if(a.description!==undefined)row.state.description=text(a.description,2000,false);
    if(a.date!==undefined){const date=text(a.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||(Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date))throw new DomainError('invalid_date','Kies een geldige datum.');row.state.date=date;}
    if(a.eligibility!==undefined){const eligibility=a.eligibility==='invite'?'code':String(a.eligibility);if(!['all','club','code'].includes(eligibility)||(eligibility==='club'&&!row.club_id))throw new DomainError('invalid_eligibility','Kies open, clubleden of code.');const active=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and attributes->>'registered'='true' and status in ('active','waitlisted','pending')",[row.id]);if(active.rows[0].n>0||row.state.fixtures?.length)throw new DomainError('eligibility_locked','De inschrijftoegang staat vast zodra deelnemers zijn aangemeld.',409);row.state.eligibility=eligibility;if(row.visibility!=='private')row.visibility=eligibility==='club'?'club':'public';}
    if(a.capacity!==undefined){const capacity=number(a.capacity,32,2,128),active=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]);if(capacity<active.rows[0].n)throw new DomainError('capacity_below_members','De capaciteit kan niet lager zijn dan de bevestigde deelnemers.',409);row.state.capacity=capacity;}
    await client.query('update dartflow_private.events set name=$2,date=$3,capacity=$4 where id=$1',[row.state.eventId,row.state.name,row.state.date,row.state.capacity]);
    if (typeof a.paused === 'boolean') row.state.paused = a.paused;
    if (typeof a.autoSchedule === 'boolean') row.state.autoSchedule = a.autoSchedule;
    if (typeof a.requireWriter === 'boolean') row.state.requireWriter = a.requireWriter;
    for (const key of ['callSeconds', 'restSeconds', 'cooldownSeconds'] as const) if (a[key] !== undefined) row.state[key] = number(a[key], 0, key === 'callSeconds' ? 30 : 0, 3600);
    for(const key of ['startsAt','checkInAt']as const)if(a[key]!==undefined){if(typeof a[key]!=='string'||Number.isNaN(new Date(a[key]).getTime()))throw new DomainError('invalid_date','Kies een geldig tijdstip.');row.state[key]=new Date(a[key]).toISOString();}
    if (typeof a.registrationOpen === 'boolean' && !row.state.fixtures?.length) row.state.registrationOpen = a.registrationOpen;
    if(row.kind==='tournament'&&(previous.name!==row.state.name||previous.date!==row.state.date||previous.location!==row.state.location)){
      const recipients=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]);
      for(const recipient of recipients.rows)await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:changed:${recipient.user_id}`,templateId:'tournament-changed',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:recipient.user_id,entityId:row.id,variables:{eventName:row.state.name,date:String(row.state.date??''),location:String(row.state.location??'')}});
    }
  } else if (type === 'fixture.assign') {
    await requireAccess(client,row,actor,true);
    const fixtureId=uuid(a.fixtureId),boardId=uuid(a.boardId),writerId=a.writerId?uuid(a.writerId):undefined;
    const assignments=await autoAssign(client,row,{fixtureId,boardId,writerId},{actorId:actor,requestId:command.requestId});
    if(!assignments.length)throw new DomainError('assignment_unavailable','Baan, spelers of schrijver zijn niet beschikbaar.',409);
    await save(client,row);return {ok:true,id:row.id,assignments,matchId:assignments[0].matchId,entity:await view(client,row,actor)};
  } else if (type === 'board.reserve') {
    await requireAccess(client,row,actor,true);await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);const boardId=uuid(a.boardId);
    await client.query('select id from dartflow_private.boards where id=$1 for update',[boardId]);
    await assertPhysicalBoardEvent(client,boardId,row.state.eventId!);
    const reservations=(row.state.boardReservations??={})as Record<string,unknown>;
    if(a.reserved!==false&&await boardLease(client,boardId))throw new DomainError('board_occupied','Op deze baan staat al een actieve opstelling.',409);
    if(a.reserved===false)delete reservations[boardId];
    else {if(a.fixtureId&&!row.state.fixtures?.some(f=>f.id===a.fixtureId))throw new DomainError('invalid_fixture','Deze partij hoort niet bij deze speeldag.');reservations[boardId]={fixtureId:a.fixtureId?uuid(a.fixtureId):null,reason:typeof a.reason==='string'?text(a.reason,300,false):''};}
  } else if (type === 'competition.autoplan') {
    await requireAccess(client, row, actor, true);
    const assignments = await autoAssign(client, row,undefined,{actorId:actor,requestId:command.requestId});
    await save(client, row);
    return { ok: true, id: row.id, assignments, entity: await view(client, row, actor) };
  } else if (type.startsWith('fixture.')) {
    await fixtureAction(client, actor, command, row);
    const fixture = row.state.fixtures?.find(f => f.id === a.fixtureId);
    advanceFixtures(row.state.fixtures ?? []);
    await save(client, row);
    return { ok: true, id: row.id, ...(fixture?.matchId ? { matchId: fixture.matchId } : {}), entity: await view(client, row, actor) };
  }
  else if (type === 'board.block') {
    await requireAccess(client, row, actor, true);
    await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);
    const board = uuid(a.boardId);
    if(await physicalBoard(client,board))throw new DomainError('forbidden','Deze fysieke baan wordt door de locatie beheerd.',403);
    if(a.blocked!==false&&await boardLease(client,board))throw new DomainError('board_occupied','Op deze baan staat al een actieve opstelling.',409);
    const assigned = await client.query('select 1 from dartflow_private.matches where board_id=$1', [board]);
    if (assigned.rowCount) throw new DomainError('board_occupied', 'Maak deze baan eerst vrij.', 409);
    const result = await client.query('update dartflow_private.boards set blocked=$3 where id=$1 and event_id=$2 returning id', [board, row.state.eventId, a.blocked !== false]);
    if (!result.rowCount) throw new DomainError('invalid_board', 'Deze baan hoort niet bij deze speeldag.', 403);
  } else if (type === 'cast.update') {
    await requireAccess(client, row, actor, true);
    const scene = String(a.scene ?? row.state.cast?.scene ?? 'hall');
    if (!['hall', 'board', '180', 'finish', 'result', 'next', 'break'].includes(scene)) throw new DomainError('invalid_scene', 'Kies een geldige schermscene.');
    if(a.boardId)await assertPhysicalBoardEvent(client,uuid(a.boardId),row.state.eventId!);
    const previous = row.state.cast;
    row.state.cast = { scene: a.live === false ? previous?.scene ?? 'hall' : scene, ...(a.boardId ? { boardId: String(a.boardId) } : previous?.boardId ? { boardId: previous.boardId } : {}), preview: scene, updatedAt: new Date().toISOString() };
  } else throw new DomainError('invalid_action', 'Onbekende competitieactie.');
  snapshotTournamentRules(row.state);
  await save(client, row);
  return { ok: true, id: row.id, ...(row.state.matchId ? { matchId: row.state.matchId } : {}), entity: await view(client, row, actor) };
}
async function lobbyAction(client: PoolClient, actor: string, command: PlatformCommand, row: EntityRow): Promise<PlatformResponse> {
  const a = command.action,wasReady=row.state.ready?.[actor]===true;
  if (row.kind !== 'lobby') throw new DomainError('invalid_kind', 'Open eerst een wedstrijdlobby.');
  const boundBoard=typeof row.state.boardId==='string'?row.state.boardId:null;
  if(boundBoard){await eventAccess(client,actor,row.state.eventId!);if(!row.state.matchId&&Number(row.state.boardLeaseUntil??0)<=Date.now())throw new DomainError('board_session_expired','De wachtende baanopstelling is verlopen. Scan opnieuw.',409);}
  if(a.type==='lobby.board.bind'){
    await requireAccess(client,row,actor);
    if(!['remote','hybrid'].includes(String(row.state.setup))||row.state.closed||row.state.matchId)throw new DomainError('remote_board_unavailable','Koppel je eigen fysieke baan voordat de remote partij start.',409);
    const target=uuid(a.boardId),scope=(await client.query<{event_id:string}>('select event_id from dartflow_private.boards where id=$1',[target])).rows[0];
    if(!scope)throw new DomainError('not_found','Deze baan bestaat niet.',404);
    if(!boundBoard&&row.owner_id!==actor)throw new DomainError('host_board_required','De host koppelt eerst zijn fysieke baan.',409);
    if(boundBoard&&row.owner_id===actor&&target!==boundBoard)throw new DomainError('host_board_fixed','De host speelt op de baan waarop deze opstelling is begonnen.',409);
    const events=[...new Set([scope.event_id,...(typeof row.state.eventId==='string'?[row.state.eventId]:[])])].sort();
    await client.query('select id from dartflow_private.events where id=any($1::uuid[]) order by id for update',[events]);
    const access=await eventAccess(client,actor,scope.event_id),physical=await physicalBoard(client,target);
    if(physical?.kind==='home'&&!await locationManager(client,actor,physical.location_id))throw new DomainError('forbidden','Je kunt alleen je eigen toegestane thuisbaan koppelen.',403);
    const map={...((row.state.remoteBoardIds as Record<string,string>|undefined)??{}),[actor]:target};
    if(boundBoard)map[row.owner_id]=boundBoard;
    if(Object.entries(map).some(([user,board])=>user!==actor&&board===target))throw new DomainError('remote_board_duplicate','Kies voor de remote tegenstander een andere fysieke baan.',409);
    const boardIds=[...new Set(Object.values(map))].sort();if(boardIds.length>2)throw new DomainError('remote_board_limit','Deze partij heeft maximaal twee fysieke banen.',409);
    await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[boardIds]);
    await assertPhysicalBoardEvent(client,target,scope.event_id);
    if((await client.query('select 1 from dartflow_private.matches where board_id=$1',[target])).rowCount)throw new DomainError('board_occupied','Deze baan heeft al een actieve partij.',409);
    await assertBoardUnreserved(client,target,scope.event_id,row.id);
    if(!boundBoard){row.state.boardId=target;row.state.eventId=scope.event_id;row.state.coreClubId=access.club_id;row.state.boardLeaseUntil=Date.now()+120000;}
    row.state.remoteBoardIds=map;row.state.ready={};
  }else if (a.type === 'lobby.join') {
    await joinLobbyMember(client,actor,row,{boardId:a.boardId,code:a.code,requestId:command.requestId});
  } else if(a.type==='lobby.starter'){
    if(row.owner_id!==actor)throw new DomainError('forbidden','Alleen de host kiest de startspeler.',403);
    if(row.state.settings?.startProcedure)throw new DomainError('start_procedure_fixed','De gepubliceerde bull-, lotings- of thuisregel bepaalt de startspeler.',409);
    if(row.state.matchId||row.state.closed)throw new DomainError('lobby_started','Deze lobby is al gestart of gesloten.',409);
    const starter=uuid(a.starterId);if((await member(client,row.id,starter))?.status!=='active')throw new DomainError('invalid_starter','Kies een aanwezige speler.');
    row.state.starterId=starter;row.state.ready={};
    if(boundBoard&&['localone','localtwo'].includes(String(row.state.setup))){
      const companions=await client.query<{user_id:string}>("select user_id from dartflow_private.platform_members where entity_id=$1 and user_id<>$2 and status='active' and attributes->>'pinLinkedBy'=$2::text",[row.id,actor]);
      for(const companion of companions.rows)row.state.ready[companion.user_id]=true;
    }
  } else if (a.type === 'lobby.ready') {
    await requireAccess(client, row, actor);
    if (row.state.matchId || row.state.closed) throw new DomainError('lobby_started', 'Deze lobby is al gestart of gesloten.', 409);
    row.state.ready ??= {}; row.state.ready[actor] = a.ready !== false;
  } else if (a.type === 'lobby.start') {
    await requireAccess(client, row, actor);
    if (row.state.matchId) return { ok: true, id: row.id, matchId: row.state.matchId };
    if (row.state.closed) throw new DomainError('lobby_closed', 'Deze lobby is gesloten.', 409);
    const { rows } = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' order by case when role='owner' then 0 else 1 end,created_at,user_id", [row.id]);
    const players = rows.map(r => String(r.user_id));
    if (players.length !== 2 || !players.every(p => row.state.ready?.[p])) throw new DomainError('players_not_ready', 'Beide spelers moeten eerst gereed zijn.', 409);
    if(boundBoard){await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);for(const player of players)await eventAccess(client,player,row.state.eventId!);if(Number(row.state.boardLeaseUntil??0)<=Date.now())throw new DomainError('board_session_expired','Deze baanopstelling is verlopen.',409);const {rows:boards}=await client.query('select blocked from dartflow_private.boards where id=$1 and event_id=$2 for update',[boundBoard,row.state.eventId]);if(!boards.length||boards[0].blocked||(await client.query('select 1 from dartflow_private.matches where board_id=$1',[boundBoard])).rowCount)throw new DomainError('board_occupied','De baan is niet meer beschikbaar.',409);await assertPhysicalBoardEvent(client,boundBoard,row.state.eventId!);await assertBoardUnreserved(client,boundBoard,row.state.eventId!,row.id);}
    if(row.state.remoteBoardIds&&typeof row.state.remoteBoardIds==='object'){
      const map=row.state.remoteBoardIds as Record<string,string>,boardIds=[...new Set(Object.values(map).map(uuid))].sort();
      await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[boardIds]);
      for(const [player,id]of Object.entries(map)){
        if(!players.includes(player))throw new DomainError('remote_board_owner','De gekoppelde baan hoort niet bij een deelnemer.',409);
        const scope=(await client.query<{event_id:string}>('select event_id from dartflow_private.boards where id=$1',[id])).rows[0];if(!scope)throw new DomainError('not_found','Een gekoppelde baan bestaat niet.',404);
        await eventAccess(client,player,scope.event_id);await assertPhysicalBoardEvent(client,id,scope.event_id);
        const physical=await physicalBoard(client,id);if(physical?.kind==='home'&&!await locationManager(client,player,physical.location_id))throw new DomainError('forbidden','De deelnemer heeft geen actuele toegang tot zijn thuisbaan.',403);
        if((await client.query('select 1 from dartflow_private.matches where board_id=$1',[id])).rowCount)throw new DomainError('board_occupied','Een gekoppelde baan heeft al een actieve partij.',409);
        await assertBoardUnreserved(client,id,scope.event_id,row.id);
      }
    }
    row.state.matchId = await createCoreMatch(client, row, players, row.state.settings!, 'free');
    const companion=players[1]?await member(client,row.id,players[1]):undefined;
    if(boundBoard&&['localone','localtwo'].includes(String(row.state.setup))&&players[0]===row.owner_id&&companion?.attributes.pinLinkedBy===row.owner_id){
      const {rows:matches}=await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[row.state.matchId]);const state=matches[0].state;
      state.localCompanion={playerId:players[1],writerId:row.owner_id,lobbyId:row.id};state.accepted[1]=true;
      await client.query('update dartflow_private.matches set state=$2 where id=$1',[state.id,JSON.stringify(state)]);
    }
    if(boundBoard){const {rows:matches}=await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[row.state.matchId]);const state=matches[0].state,before=structuredClone(state);state.boardId=boundBoard;state.callRef=command.requestId;state.revision++;await client.query('update dartflow_private.matches set board_id=$2,state=$3,revision=$4 where id=$1',[state.id,boundBoard,JSON.stringify(state),state.revision]);await enqueueMatchTransition(client,actor,before,state,{requestId:command.requestId,matchId:state.id,expectedRevision:before.revision,action:{type:'call',boardId:boundBoard}});}
  } else if (a.type === 'lobby.cancel') {
    await requireAccess(client, row, actor);
    if (row.state.matchId) throw new DomainError('match_started', 'De wedstrijd is al gestart.', 409);
    row.state.closed = true;
    const others=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and user_id<>$2 and status in ('active','invited')",[row.id,actor]);
    for(const other of others.rows)await enqueueDomainMail(client,{actorId:actor,id:`${command.requestId}:challenge-cancelled:${other.user_id}`,templateId:'challenge-cancelled',scope:'platform',recipientId:other.user_id,entityId:row.id,variables:{eventName:row.state.name,reason:'Uitnodiging ingetrokken'}});
  } else throw new DomainError('invalid_action', 'Onbekende lobbyactie.');
  await save(client, row);
  if(a.type==='lobby.ready'&&!wasReady&&row.state.ready?.[actor]===true){const recipients=(await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active'",[row.id])).rows.map(p=>p.user_id);await enqueueAuditedNotification(client,{eventId:`lobby-ready:${row.id}:${command.requestId}`,templateId:'match-ready',actorId:actor,recipientIds:recipients,source:{kind:'lobby-ready',lobbyId:row.id,readyPlayerId:actor},href:`/app/lobby/${row.id}`,expiresAt:new Date(Date.now()+5*60_000).toISOString()});}
  return { ok: true, id: row.id, ...(row.state.matchId ? { matchId: row.state.matchId } : {}), entity: await view(client, row, actor) };
}
async function fixtureAction(client: PoolClient, actor: string, command: PlatformCommand, row: EntityRow) {
  const a = command.action, fixture = row.state.fixtures?.find(f => f.id === a.fixtureId);
  if (!fixture) throw new DomainError('not_found', 'Deze geplande partij bestaat niet.', 404);
  const participant = fixture.players.includes(actor);
  if (a.type === 'fixture.propose' || a.type === 'fixture.accept') {
    await requireAccess(client, row, actor);
    if (!participant || fixture.matchId || fixture.status === 'confirmed') throw new DomainError('forbidden', 'Je kunt alleen je eigen nog te spelen partij afspreken.', 403);
    if (a.type === 'fixture.propose') {
      const time = text(a.time, 40);
      if (Number.isNaN(new Date(time).getTime())) throw new DomainError('invalid_date', 'Kies een geldig tijdstip.');
      fixture.proposedTime = new Date(time).toISOString(); fixture.proposedBy = actor; fixture.status = 'proposed';
    } else {
      if (fixture.status !== 'proposed' || fixture.proposedBy === actor) throw new DomainError('counterparty_required', 'Alleen de tegenstander kan dit voorstel accepteren.', 403);
      fixture.time = fixture.proposedTime; delete fixture.proposedTime; delete fixture.proposedBy; fixture.status = 'scheduled';
    }
    const recipients=a.type==='fixture.accept'?fixture.players:fixture.players.filter(p=>p!==actor);
    for(const other of recipients)await enqueueDomainMail(client, { actorId:actor, id: `${command.requestId}:fixture:${other}`, templateId: a.type === 'fixture.propose' ? 'fixture-changed' : 'fixture-scheduled', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: other!, entityId: row.id, variables: { eventName: row.state.name, date: String(fixture.time ?? fixture.proposedTime), actionUrl: `/app#leagues/${row.id}` } });
  } else if (a.type === 'fixture.start') {
    if (!participant) await requireAccess(client, row, actor, true); else await requireAccess(client, row, actor);
    if(!tournamentFixtureReleased(fixture))throw new DomainError('round_not_released','De wedstrijdleiding moet deze ronde eerst expliciet vrijgeven.',409);
    if (fixture.status === 'proposed' || fixture.players.some(p => !p)) throw new DomainError('fixture_not_ready', 'Bevestig eerst het tijdstip en de tegenstanders.', 409);
    if (!fixture.matchId) { fixture.matchId = await createCoreMatch(client, row, fixture.players as string[], fixture.settings??row.state.settings!, fixture.id); fixture.status = 'live'; }
  } else if (a.type === 'fixture.walkover') {
    await requireAccess(client, row, actor, true);
    if(!tournamentFixtureReleased(fixture))throw new DomainError('round_not_released','De wedstrijdleiding moet deze ronde eerst expliciet vrijgeven.',409);
    if (fixture.matchId || fixture.status === 'confirmed' || !fixture.players.includes(String(a.winnerId))) throw new DomainError('invalid_walkover', 'Gebruik een nog niet gestarte partij en een toegewezen winnaar.');
    const reason=text(a.reason,1000);
    fixture.matchId=await createCoreMatch(client,row,fixture.players as string[],row.state.settings!,fixture.id,true);
    const {rows}=await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1 for update',[fixture.matchId]);
    const beforeAward=structuredClone(rows[0].state);
    const state=rows[0].state as MatchState&{administrativeDecision:{type:'walkover';actorId:string;reason:string}};
    fixture.winnerId=uuid(a.winnerId);fixture.score=fixture.players.map(p=>p===fixture.winnerId?Math.ceil(row.state.settings!.bestOfLegs/2):0);
    state.status='confirmed';state.revision++;state.resultRevision=state.revision;state.confirmations=[true,true];state.accepted=[true,true];state.resultPublished=true;state.winnerId=fixture.winnerId;
    state.game.status='finished';state.game.winner=fixture.winnerId;state.game.legs=fixture.score;state.administrativeDecision={type:'walkover',actorId:actor,reason};
    // The administrative award has no fabricated darts; the existing unique publisher
    // records its history and standings in this same transaction.
    await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=now() where id=$1',[state.id,JSON.stringify(state),state.revision]);
    await publishResult(client,state);
    await enqueueMatchTransition(client,actor,beforeAward,state,{requestId:command.requestId,matchId:state.id,expectedRevision:beforeAward.revision,action:{type:'recover'}});
    await client.query('insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail) values($1,$2,$3,$4)',[actor,row.id,'fixture.walkover.decision',JSON.stringify({fixtureId:fixture.id,matchId:state.id,winnerId:fixture.winnerId,reason})]);
    fixture.status='confirmed';
  } else throw new DomainError('invalid_action', 'Onbekende fixtureactie.');
}
export async function autoAssign(client: PoolClient, row: EntityRow, manual?:{fixtureId:string;boardId:string;writerId?:string},context?:{actorId:string;requestId:string}): Promise<{ fixtureId: string; matchId: string; boardId: string; writerId?: string }[]> {
  await assertCircuitQualificationCommand(client,row,'competition.autoplan');
  const correctionBlocked=await primaryCorrectionBlockedFixtureIds(client,row);
  if (row.state.paused) throw new DomainError('event_paused', 'Deze speeldag is gepauzeerd.', 409);
  const assignments: { fixtureId: string; matchId: string; boardId: string; writerId?: string }[] = [];
  await client.query('select id from dartflow_private.events where id=$1 for update', [row.state.eventId]);
  const boards = await eventPhysicalBoards(client,row.state.eventId!,true);
  const members = await client.query("select user_id,attributes from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'", [row.id]);
  await lockPlayingActors(client,members.rows.map(m=>String(m.user_id)));
  const requestedMatch=manual?row.state.fixtures?.find(f=>f.id===manual.fixtureId)?.matchId:null;
  const resumeMatch=requestedMatch&&(await client.query("select id from dartflow_private.matches where id=$1 and state->>'status'='interrupted' and board_id is null",[requestedMatch])).rows[0]?.id;
  const occupied = await client.query("select state from dartflow_private.matches where ($3::uuid is null or id<>$3) and state->>'status' in ('called','ready','live','result','disputed','interrupted') and (exists(select 1 from dartflow_private.match_players p where p.match_id=dartflow_private.matches.id and p.user_id=any($1::uuid[])) or (state->>'delegatedWriterId'=state->>'writerId' and state->>'delegatedWriterId'=any($2::text[])))",[members.rows.map(m=>m.user_id),members.rows.map(m=>m.user_id),resumeMatch??null]);
  const busy = new Set<string>(occupied.rows.flatMap(r => [...r.state.players.map((p: { id: string }) => p.id), ...(r.state.delegatedWriterId&&r.state.writerId===r.state.delegatedWriterId ? [r.state.delegatedWriterId] : [])]));
  const eligible = (id: string) => {
    const m = members.rows.find(m => m.user_id === id);
    return m && m.attributes.checkedIn === true && m.attributes.available !== false && Number(m.attributes.restUntil ?? 0) <= Date.now() && !busy.has(id);
  };
  for (const board of boards) {
    if(board.blocked||(await client.query('select 1 from dartflow_private.matches where board_id=$1',[board.id])).rowCount)continue;
    try{await assertPhysicalBoardEvent(client,board.id,row.state.eventId!);}catch(error){if(error instanceof DomainError&&['board_reserved','reservation_window','board_unavailable'].includes(error.code))continue;throw error;}
    if(await boardLease(client,board.id))continue;
    if(manual&&board.id!==manual.boardId)continue;
    if(Number((row.state.boardCooldowns as Record<string,number>|undefined)?.[board.id]??0)>Date.now())continue;
    const reservation=(row.state.boardReservations as Record<string,{fixtureId?:string}>|undefined)?.[board.id];
    if(reservation&&!reservation.fixtureId)continue;
    const fixture = row.state.fixtures?.find(f => tournamentFixtureReleased(f)&&!correctionBlocked.has(f.id) && (f.status === 'scheduled'||Boolean(manual&&resumeMatch&&f.matchId===resumeMatch)) && (!manual||f.id===manual.fixtureId) && (!reservation?.fixtureId||f.id===reservation.fixtureId) && (manual||!f.time||new Date(f.time).getTime()<=Date.now()+5*60_000) && f.players.every((p): p is string => p !== null && Boolean(eligible(p))));
    if (!fixture) continue;
    try{await assertBoardUnreserved(client,board.id,row.state.eventId!,row.id,fixture.id);}catch(error){if(error instanceof DomainError&&error.code==='board_reserved')continue;throw error;}
    const players = fixture.players as string[];
    const writer = manual?.writerId ? members.rows.find(m=>m.user_id===manual.writerId&&!players.includes(m.user_id)&&eligible(m.user_id))?.user_id : row.state.requireWriter === false ? undefined : members.rows.find(m => !players.includes(m.user_id) && eligible(m.user_id))?.user_id;
    if(manual?.writerId&&!writer)throw new DomainError('writer_unavailable','Deze schrijver is niet beschikbaar of hoort niet bij deze speeldag.',409);
    if (row.state.requireWriter !== false && !writer) continue;
    if (!fixture.matchId) fixture.matchId = await createCoreMatch(client, row, players, fixture.settings??row.state.settings!, fixture.id);
    await assertPhysicalBoardEvent(client,board.id,row.state.eventId!,fixture.matchId,true);
    const match = await client.query('select state from dartflow_private.matches where id=$1 for update', [fixture.matchId]);
    const state = match.rows[0].state;
    const beforeCall=structuredClone(state);
    if(!['planned','called',...(manual?['interrupted']:[])].includes(state.status)||state.boardId)throw new DomainError('match_active','Deze partij is al actief.',409);
    state.boardId = board.id; state.status = 'called'; state.revision++;state.callRef=context?.requestId??randomUUID();state.accepted=[false,false];state.paused=false;state.correction=null;
    if (writer) {
      // Writer came from this event's checked-in, registered, unoccupied members.
      if(!(await client.query("select 1 from dartflow_private.entries where event_id=$1 and user_id=$2 and status='registered' and checked_in",[row.state.eventId,writer])).rowCount)throw new DomainError('writer_unavailable','Deze schrijver heeft geen bevestigde, ingecheckte deelname.',409);
      state.delegatedWriterId = writer; state.writerId = writer;
    }
    await client.query('update dartflow_private.matches set board_id=$2,revision=$3,state=$4,updated_at=now() where id=$1', [fixture.matchId, board.id, state.revision, JSON.stringify(state)]);
    await enqueueMatchTransition(client,context?.actorId??row.owner_id,beforeCall,state,{requestId:state.callRef,matchId:state.id,expectedRevision:beforeCall.revision,action:{type:'call',boardId:board.id}});
    fixture.status = 'live';
    if(reservation)delete (row.state.boardReservations as Record<string,unknown>)[board.id];
    row.state.calls ??= {};
    (row.state.calls as Record<string, unknown>)[fixture.id] = { expiresAt: Date.now() + Number(row.state.callSeconds ?? 120) * 1000, writerId: writer ?? null };
    players.forEach(p => busy.add(p)); if (writer) busy.add(writer);
    assignments.push({ fixtureId: fixture.id, matchId: fixture.matchId, boardId: board.id, ...(writer ? { writerId: String(writer) } : {}) });
  }
  return assignments;
}
