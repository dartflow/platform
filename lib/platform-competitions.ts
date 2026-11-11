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

export async function competitionAction(client: PoolClient, actor: string, command: PlatformCommand): Promise<PlatformResponse | null> {
  const a = command.action, type = a.type;
  if (type === 'lobby.create') {
    const settings = validateSettings({ startScore: Number(a.startScore ?? 501) as 301 | 501 | 701, bestOfLegs: Number(a.bestOfLegs ?? 3) });
    const setup = String(a.setup ?? 'localone');
    if (!['localone', 'localtwo', 'remote', 'hybrid'].includes(setup)) throw new DomainError('invalid_setup', 'Kies een geldige speelopstelling.');
    const { row, code } = await createEntity(client, actor, 'lobby', { name: a.name ? text(a.name) : 'Vrije wedstrijd', setup, settings, capacity: 2, ready: {} }, 'private');
    if (a.opponentId) {
      const user = uuid(a.opponentId);
      if (user === actor || await blocked(client, actor, user)) throw new DomainError('blocked', 'Deze uitnodiging is niet toegestaan.', 403);
      await addMember(client, row.id, user, 'member', 'invited');
      await enqueueDomainMail(client, { id: `${command.requestId}:challenge-invite:${user}`, templateId: 'challenge-invite', scope: 'platform', recipientId: user, variables: { actionUrl: `/app#lobby/${row.id}`, eventName: row.state.name }, entityId: row.id });
    }
    return { ok: true, id: row.id, code, entity: await view(client, row, actor) };
  }
  if (type === 'league.create' || type === 'tournament.create') {
    const clubId = a.clubId ? uuid(a.clubId) : null;
    if (clubId) {
      if (!(await isClubMember(client, clubId, actor, true))) throw new DomainError('forbidden', 'Alleen de clubbeheerder kan dit evenement maken.', 403);
    } else if (!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in ('owner','admin')", [actor])).rowCount) throw new DomainError('forbidden', 'Een wereldwijd evenement vereist platformbeheer. Kies je eigen club.', 403);
    const kind = type === 'league.create' ? 'league' : 'tournament';
    const eligibility=a.eligibility==='invite'?'code':String(a.eligibility??(clubId?'club':'all'));
    if(!['all','club','code'].includes(eligibility)||(eligibility==='club'&&!clubId))throw new DomainError('invalid_eligibility','Kies open, clubleden of een uitnodigingscode.');
    const format = String(a.format ?? (kind === 'league' ? 'best5' : 'pools-knockout'));
    if (kind === 'league' ? !['best5', 'best7', 'fixed8', 'fixed10', 'round-robin'].includes(format) : !['pools-knockout', 'knockout'].includes(format)) throw new DomainError('invalid_format', 'Kies een ondersteund competitie- of toernooiformat.');
    const settings = validateSettings({ startScore: Number(a.startScore ?? 501) as 301 | 501 | 701, bestOfLegs: Number(a.bestOfLegs ?? (format === 'best7' ? 7 : 5)), ...(format.startsWith('fixed') ? { legLimit: Number(format.slice(5)) } : {}) });
    const date = a.date === undefined ? new Date().toISOString().slice(0, 10) : text(a.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) throw new DomainError('invalid_date', 'Kies een geldige datum.');
    const state: PlatformState = { name: text(a.name), description: a.description ? text(a.description, 2000) : '',location:a.location?text(a.location,200):'', capacity: number(a.capacity, 32, 2, 128),approvalRequired:kind==='tournament'&&a.approvalRequired===true,eligibility, format, settings, date, poolCount: number(a.poolCount, 2, 1, 8), fixtures: [], registrationOpen: true, paused: false, autoSchedule: false, callSeconds: 120, restSeconds: 90, cooldownSeconds: 30, requireWriter: a.requireWriter !== false, cast: { scene: 'hall', updatedAt: new Date().toISOString() } };
    await createCoreEvent(client, actor, state, clubId);
    const { row, code } = await createEntity(client, actor, kind, state, eligibility==='club' ? 'club' : 'public', clubId);
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
  const self = await member(client, row.id, actor);
  if (row.club_id && !allowsExternalParticipants(row) && !(await isClubMember(client,row.club_id,actor)))throw new DomainError('forbidden','Dit evenement is voor clubleden.',403);
  if (type === 'competition.register') {
    if (row.state.registrationOpen === false || row.state.fixtures?.length) throw new DomainError('registration_closed', 'De inschrijving is gesloten.', 409);
    if (self?.attributes.registered === true || self?.status === 'waitlisted') return { ok: true, id: row.id };
    if(row.state.eligibility==='code'&&!acceptsCode(row,a.code??a.inviteCode))throw new DomainError('invite_required','Gebruik een geldige uitnodigingscode voor dit evenement.',403);
    const { rows } = await client.query("select count(*)::integer as count from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'", [row.id]);
    const status = row.kind==='tournament'&&row.state.approvalRequired===true?'pending':rows[0].count < (row.state.capacity ?? 32) ? 'active' : 'waitlisted';
    await addMember(client, row.id, actor, self?.role ?? 'member', status, { registered: true, checkedIn: false, available: false, restUntil: 0 });
    if(status!=='pending')await client.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,$4,false) on conflict(event_id,user_id) do update set status=excluded.status,checked_in=false",[randomUUID(),row.state.eventId,actor,status==='active'?'registered':'waitlisted']);
    await syncCompetitionRoom(client,row,actor,status);
    await enqueueDomainMail(client, { id: `${command.requestId}:entry:${actor}`, templateId: row.kind === 'league' ? 'competition-entry' : status==='pending'?'tournament-entry':status === 'waitlisted' ? 'tournament-waitlist' : 'tournament-approved', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: actor, entityId: row.id, variables: { eventName: row.state.name, status: status==='pending'?'In behandeling':status === 'active' ? 'Ingeschreven' : 'Wachtlijst' } });
  } else if (type === 'competition.withdraw') {
    if(self?.attributes.registered!==true||!['active','waitlisted','pending'].includes(self.status))throw new DomainError('registration_required','Je hebt geen actieve inschrijving.',409);
    if (row.state.fixtures?.some(f => f.players.includes(actor) && !['confirmed', 'bye'].includes(f.status))) throw new DomainError('active_fixture', 'Je bent ingedeeld. Vraag de wedstrijdleiding om een beslissing.', 409);
    await client.query("update dartflow_private.platform_members set attributes=jsonb_set(attributes,'{registered}','false'),status=case when role='owner' then 'active' else 'left' end where entity_id=$1 and user_id=$2", [row.id, actor]);
    await syncCompetitionRoom(client,row,actor,'left');
    if(row.kind==='tournament')await enqueueDomainMail(client,{id:`${command.requestId}:withdrawn:${actor}`,templateId:'tournament-withdrawn',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:actor,entityId:row.id,variables:{eventName:row.state.name,status:'Uitgeschreven'}});
    await client.query("update dartflow_private.entries set status='withdrawn',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,actor]);
    const waiting = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='waitlisted' order by created_at,user_id limit 1", [row.id]);
    if (self.status==='active'&&waiting.rows.length) {
      const user = waiting.rows[0].user_id;
      await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2", [row.id, user]);
      await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,user]);
      await syncCompetitionRoom(client,row,user,'active');
      await enqueueDomainMail(client, { id: `${command.requestId}:promoted:${user}`, templateId: 'tournament-promoted', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: user, entityId: row.id, variables: { eventName: row.state.name } });
    }
  } else if(type==='competition.approve'){
    if(row.state.registrationOpen===false||row.state.fixtures?.length)throw new DomainError('registration_closed','De inschrijving is gesloten.',409);
    if(row.kind!=='tournament')throw new DomainError('invalid_kind','Kies een toernooiaanmelding.');
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),entry=await member(client,row.id,target);
    if(entry?.status!=='pending'||entry.attributes.registered!==true)throw new DomainError('request_missing','Deze speler heeft geen open aanvraag.',409);
    const count=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]),status=count.rows[0].n<(row.state.capacity??32)?'active':'waitlisted';
    await client.query('update dartflow_private.platform_members set status=$3 where entity_id=$1 and user_id=$2',[row.id,target,status]);
    await client.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,$4,false) on conflict(event_id,user_id) do update set status=excluded.status,checked_in=false",[randomUUID(),row.state.eventId,target,status==='active'?'registered':'waitlisted']);await syncCompetitionRoom(client,row,target,status);
    await enqueueDomainMail(client,{id:`${command.requestId}:approved:${target}`,templateId:status==='active'?'tournament-approved':'tournament-waitlist',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:status==='active'?'Bevestigd':'Wachtlijst'}});
  } else if(type==='competition.reject'){
    if(row.kind!=='tournament')throw new DomainError('invalid_kind','Deze afwijzingsprocedure hoort bij een toernooiaanmelding.');
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),entry=await member(client,row.id,target),reason=text(a.reason,500);
    if(!entry||entry.attributes.registered!==true||!['active','waitlisted','pending'].includes(entry.status))throw new DomainError('registration_required','Deze speler heeft geen inschrijving.',409);
    if(row.state.fixtures?.some(f=>f.players.includes(target)&&!['confirmed','bye'].includes(f.status)))throw new DomainError('active_fixture','Beslis eerst over de ingedeelde partij.',409);
    await client.query("update dartflow_private.platform_members set attributes=attributes||$3::jsonb,status=case when role='owner' then 'active' else 'left' end where entity_id=$1 and user_id=$2",[row.id,target,JSON.stringify({registered:false,checkedIn:false,available:false,decisionReason:reason})]);
    await client.query("update dartflow_private.entries set status='withdrawn',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,target]);await syncCompetitionRoom(client,row,target,'left');
    await enqueueDomainMail(client,{id:`${command.requestId}:rejected:${target}`,templateId:'tournament-rejected',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:'Afgewezen',reason:'Bekijk het besluit in DartFlow'}});
    if(entry.status==='active'){
      const waiting=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='waitlisted' order by created_at,user_id limit 1",[row.id]);
      if(waiting.rows.length){const user=waiting.rows[0].user_id;await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2",[row.id,user]);await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,user]);await syncCompetitionRoom(client,row,user,'active');await enqueueDomainMail(client,{id:`${command.requestId}:promoted:${user}`,templateId:row.kind==='tournament'?'tournament-promoted':'competition-entry',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:user,entityId:row.id,variables:{eventName:row.state.name,status:'Bevestigd'}});}
    }
  } else if(type==='competition.promote'){
    await requireAccess(client,row,actor,true);const target=uuid(a.userId),waiting=await member(client,row.id,target);if(waiting?.status!=='waitlisted')throw new DomainError('waitlist_required','Deze speler staat niet op de wachtlijst.',409);
    const count=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'",[row.id]);if(count.rows[0].n>=(row.state.capacity??32))throw new DomainError('capacity_reached','Er is geen bevestigde plek beschikbaar.',409);
    await client.query("update dartflow_private.platform_members set status='active' where entity_id=$1 and user_id=$2",[row.id,target]);await client.query("update dartflow_private.entries set status='registered',checked_in=false where event_id=$1 and user_id=$2",[row.state.eventId,target]);
    await syncCompetitionRoom(client,row,target,'active');
    await enqueueDomainMail(client,{id:`${command.requestId}:promoted:${target}`,templateId:row.kind==='tournament'?'tournament-promoted':'competition-entry',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:target,entityId:row.id,variables:{eventName:row.state.name,status:'Bevestigd'}});
  } else if (type === 'competition.checkin' || type === 'competition.available') {
    const target = a.userId ? uuid(a.userId) : actor;
    if (target !== actor) await requireAccess(client, row, actor, true);
    const m = await member(client, row.id, target);
    if (m?.status !== 'active' || m.attributes.registered !== true) throw new DomainError('registration_required', 'Deze speler heeft geen bevestigde inschrijving.', 409);
    await client.query("update dartflow_private.platform_members set attributes=attributes || $3::jsonb where entity_id=$1 and user_id=$2", [row.id, target, JSON.stringify(type === 'competition.checkin' ? { checkedIn: true, available: true } : { available: a.available !== false })]);
    if(type==='competition.checkin')await client.query("update dartflow_private.entries set checked_in=true where event_id=$1 and user_id=$2 and status='registered'",[row.state.eventId,target]);
  } else if (type === 'competition.plan') {
    await requireAccess(client, row, actor, true);
    if (row.state.fixtures?.length) throw new DomainError('schedule_exists', 'Dit schema is al vastgelegd.', 409);
    const { rows } = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true' order by created_at,user_id", [row.id]);
    const players = rows.map(r => String(r.user_id));
    row.state.fixtures = row.kind === 'league' ? roundRobin(players) : tournamentFixtures(players, row.state.format!, row.state.poolCount);
    row.state.registrationOpen = false;
  } else if(type==='competition.invite'){
    await requireAccess(client,row,actor,true);const code=await rotateEntityInvitation(client,row);await save(client,row);return {ok:true,id:row.id,code,entity:await view(client,row,actor)};
  } else if (type === 'competition.settings') {
    await requireAccess(client, row, actor, true);
    if(a.approvalRequired!==undefined){if(row.kind!=='tournament'||typeof a.approvalRequired!=='boolean')throw new DomainError('invalid_approval','Kies een geldige toernooigoedkeuring.');const registrations=await client.query("select 1 from dartflow_private.platform_members where entity_id=$1 and attributes->>'registered'='true' limit 1",[row.id]);if(registrations.rowCount)throw new DomainError('approval_locked','De goedkeuring staat vast zodra er aanmeldingen zijn.',409);row.state.approvalRequired=a.approvalRequired;}
    const previous={name:row.state.name,date:row.state.date,location:row.state.location};
    if(a.name!==undefined)row.state.name=text(a.name,80);
    if(a.location!==undefined)row.state.location=text(a.location,200,false);
    if(a.description!==undefined)row.state.description=text(a.description,2000,false);
    if(a.date!==undefined){const date=text(a.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()))throw new DomainError('invalid_date','Kies een geldige datum.');row.state.date=date;}
    if(a.eligibility!==undefined){const eligibility=a.eligibility==='invite'?'code':String(a.eligibility);if(!['all','club','code'].includes(eligibility)||(eligibility==='club'&&!row.club_id))throw new DomainError('invalid_eligibility','Kies open, clubleden of code.');const active=await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and attributes->>'registered'='true' and status in ('active','waitlisted','pending')",[row.id]);if(active.rows[0].n>0||row.state.fixtures?.length)throw new DomainError('eligibility_locked','De inschrijftoegang staat vast zodra deelnemers zijn aangemeld.',409);row.state.eligibility=eligibility;row.visibility=eligibility==='club'?'club':'public';}
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
      for(const recipient of recipients.rows)await enqueueDomainMail(client,{id:`${command.requestId}:changed:${recipient.user_id}`,templateId:'tournament-changed',scope:row.club_id?`club:${row.club_id}`:'platform',recipientId:recipient.user_id,entityId:row.id,variables:{eventName:row.state.name,date:String(row.state.date??''),location:String(row.state.location??'')}});
    }
  } else if (type === 'fixture.assign') {
    await requireAccess(client,row,actor,true);
    const fixtureId=uuid(a.fixtureId),boardId=uuid(a.boardId),writerId=a.writerId?uuid(a.writerId):undefined;
    const assignments=await autoAssign(client,row,{fixtureId,boardId,writerId},{actorId:actor,requestId:command.requestId});
    if(!assignments.length)throw new DomainError('assignment_unavailable','Baan, spelers of schrijver zijn niet beschikbaar.',409);
    await save(client,row);return {ok:true,id:row.id,assignments,matchId:assignments[0].matchId,entity:await view(client,row,actor)};
  } else if (type === 'board.reserve') {
    await requireAccess(client,row,actor,true);await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);const boardId=uuid(a.boardId);
    if(!(await client.query('select 1 from dartflow_private.boards where id=$1 and event_id=$2',[boardId,row.state.eventId])).rowCount)throw new DomainError('invalid_board','Deze baan hoort niet bij deze speeldag.',403);
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
    if(a.blocked!==false&&await boardLease(client,board))throw new DomainError('board_occupied','Op deze baan staat al een actieve opstelling.',409);
    const assigned = await client.query('select 1 from dartflow_private.matches where board_id=$1', [board]);
    if (assigned.rowCount) throw new DomainError('board_occupied', 'Maak deze baan eerst vrij.', 409);
    const result = await client.query('update dartflow_private.boards set blocked=$3 where id=$1 and event_id=$2 returning id', [board, row.state.eventId, a.blocked !== false]);
    if (!result.rowCount) throw new DomainError('invalid_board', 'Deze baan hoort niet bij deze speeldag.', 403);
  } else if (type === 'cast.update') {
    await requireAccess(client, row, actor, true);
    const scene = String(a.scene ?? row.state.cast?.scene ?? 'hall');
    if (!['hall', 'board', '180', 'finish', 'result', 'next', 'break'].includes(scene)) throw new DomainError('invalid_scene', 'Kies een geldige schermscene.');
    if (a.boardId && !(await client.query('select 1 from dartflow_private.boards where id=$1 and event_id=$2', [uuid(a.boardId), row.state.eventId])).rowCount) throw new DomainError('invalid_board', 'Deze baan hoort niet bij deze speeldag.', 403);
    const previous = row.state.cast;
    row.state.cast = { scene: a.live === false ? previous?.scene ?? 'hall' : scene, ...(a.boardId ? { boardId: String(a.boardId) } : previous?.boardId ? { boardId: previous.boardId } : {}), preview: scene, updatedAt: new Date().toISOString() };
  } else throw new DomainError('invalid_action', 'Onbekende competitieactie.');
  await save(client, row);
  return { ok: true, id: row.id, ...(row.state.matchId ? { matchId: row.state.matchId } : {}), entity: await view(client, row, actor) };
}
async function lobbyAction(client: PoolClient, actor: string, command: PlatformCommand, row: EntityRow): Promise<PlatformResponse> {
  const a = command.action;
  if (row.kind !== 'lobby') throw new DomainError('invalid_kind', 'Open eerst een wedstrijdlobby.');
  const self = await member(client, row.id, actor);
  const boundBoard=typeof row.state.boardId==='string'?row.state.boardId:null;
  if(boundBoard){await eventAccess(client,actor,row.state.eventId!);if(!row.state.matchId&&Number(row.state.boardLeaseUntil??0)<=Date.now())throw new DomainError('board_session_expired','De wachtende baanopstelling is verlopen. Scan opnieuw.',409);}
  if (a.type === 'lobby.join') {
    if (row.state.closed || row.state.matchId || await blocked(client, actor, row.owner_id)) throw new DomainError('lobby_unavailable', 'Deze lobby is niet beschikbaar.', 409);
    if (self?.status !== 'active' && self?.status !== 'invited' && !(boundBoard&&a.boardId===boundBoard&&row.state.setup==='localone') && !acceptsCode(row, a.code)) throw new DomainError('invite_required', 'Gebruik een geldige uitnodiging.', 403);
    if (self?.status !== 'active') {
      const count = await client.query("select count(*)::integer as n from dartflow_private.platform_members where entity_id=$1 and status='active'", [row.id]);
      if (count.rows[0].n >= 2) throw new DomainError('lobby_full', 'Deze lobby heeft al twee spelers.', 409);
      // A directed invitation cannot be redeemed by a third account with its code.
      const invited = await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='invited'", [row.id]);
      if (invited.rows.length && !invited.rows.some(r => r.user_id === actor)) throw new DomainError('invite_recipient', 'Deze uitnodiging hoort bij een andere speler.', 403);
      await addMember(client, row.id, actor);
      await enqueueDomainMail(client,{id:`${command.requestId}:challenge-accepted:${row.owner_id}`,templateId:'challenge-accepted',scope:'platform',recipientId:row.owner_id,entityId:row.id,variables:{eventName:row.state.name}});
    }
  } else if(a.type==='lobby.starter'){
    if(row.owner_id!==actor)throw new DomainError('forbidden','Alleen de host kiest de startspeler.',403);
    if(row.state.matchId||row.state.closed)throw new DomainError('lobby_started','Deze lobby is al gestart of gesloten.',409);
    const starter=uuid(a.starterId);if((await member(client,row.id,starter))?.status!=='active')throw new DomainError('invalid_starter','Kies een aanwezige speler.');
    row.state.starterId=starter;row.state.ready={};
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
    if(boundBoard){await client.query('select id from dartflow_private.events where id=$1 for update',[row.state.eventId]);for(const player of players)await eventAccess(client,player,row.state.eventId!);if(Number(row.state.boardLeaseUntil??0)<=Date.now())throw new DomainError('board_session_expired','Deze baanopstelling is verlopen.',409);const {rows:boards}=await client.query('select blocked from dartflow_private.boards where id=$1 and event_id=$2 for update',[boundBoard,row.state.eventId]);if(!boards.length||boards[0].blocked||(await client.query('select 1 from dartflow_private.matches where board_id=$1',[boundBoard])).rowCount)throw new DomainError('board_occupied','De baan is niet meer beschikbaar.',409);await assertBoardUnreserved(client,boundBoard,row.state.eventId!,row.id);}
    row.state.matchId = await createCoreMatch(client, row, players, row.state.settings!, 'free');
    if(boundBoard){const {rows:matches}=await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[row.state.matchId]);const state=matches[0].state,before=structuredClone(state);state.boardId=boundBoard;state.callRef=command.requestId;state.revision++;await client.query('update dartflow_private.matches set board_id=$2,state=$3,revision=$4 where id=$1',[state.id,boundBoard,JSON.stringify(state),state.revision]);await enqueueMatchTransition(client,actor,before,state,{requestId:command.requestId,matchId:state.id,expectedRevision:before.revision,action:{type:'call',boardId:boundBoard}});}
  } else if (a.type === 'lobby.cancel') {
    await requireAccess(client, row, actor);
    if (row.state.matchId) throw new DomainError('match_started', 'De wedstrijd is al gestart.', 409);
    row.state.closed = true;
    const others=await client.query("select user_id from dartflow_private.platform_members where entity_id=$1 and user_id<>$2 and status in ('active','invited')",[row.id,actor]);
    for(const other of others.rows)await enqueueDomainMail(client,{id:`${command.requestId}:challenge-cancelled:${other.user_id}`,templateId:'challenge-cancelled',scope:'platform',recipientId:other.user_id,entityId:row.id,variables:{eventName:row.state.name,reason:'Uitnodiging ingetrokken'}});
  } else throw new DomainError('invalid_action', 'Onbekende lobbyactie.');
  await save(client, row);
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
    for(const other of recipients)await enqueueDomainMail(client, { id: `${command.requestId}:fixture:${other}`, templateId: a.type === 'fixture.propose' ? 'fixture-changed' : 'fixture-scheduled', scope: row.club_id ? `club:${row.club_id}` : 'platform', recipientId: other!, entityId: row.id, variables: { eventName: row.state.name, date: String(fixture.time ?? fixture.proposedTime), actionUrl: `/app#leagues/${row.id}` } });
  } else if (a.type === 'fixture.start') {
    if (!participant) await requireAccess(client, row, actor, true); else await requireAccess(client, row, actor);
    if (fixture.status === 'proposed' || fixture.players.some(p => !p)) throw new DomainError('fixture_not_ready', 'Bevestig eerst het tijdstip en de tegenstanders.', 409);
    if (!fixture.matchId) { fixture.matchId = await createCoreMatch(client, row, fixture.players as string[], row.state.settings!, fixture.id); fixture.status = 'live'; }
  } else if (a.type === 'fixture.walkover') {
    await requireAccess(client, row, actor, true);
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
  if (row.state.paused) throw new DomainError('event_paused', 'Deze speeldag is gepauzeerd.', 409);
  const assignments: { fixtureId: string; matchId: string; boardId: string; writerId?: string }[] = [];
  await client.query('select id from dartflow_private.events where id=$1 for update', [row.state.eventId]);
  const boards = await client.query('select b.* from dartflow_private.boards b where event_id=$1 and not blocked and not exists(select 1 from dartflow_private.matches m where m.board_id=b.id) order by b.name,b.id', [row.state.eventId]);
  const members = await client.query("select user_id,attributes from dartflow_private.platform_members where entity_id=$1 and status='active' and attributes->>'registered'='true'", [row.id]);
  await lockPlayingActors(client,members.rows.map(m=>String(m.user_id)));
  const occupied = await client.query("select state from dartflow_private.matches where state->>'status' in ('called','ready','live','result','disputed') and (exists(select 1 from dartflow_private.match_players p where p.match_id=dartflow_private.matches.id and p.user_id=any($1::uuid[])) or (state->>'delegatedWriterId'=state->>'writerId' and state->>'delegatedWriterId'=any($2::text[])))",[members.rows.map(m=>m.user_id),members.rows.map(m=>m.user_id)]);
  const busy = new Set<string>(occupied.rows.flatMap(r => [...r.state.players.map((p: { id: string }) => p.id), ...(r.state.delegatedWriterId&&r.state.writerId===r.state.delegatedWriterId ? [r.state.delegatedWriterId] : [])]));
  const eligible = (id: string) => {
    const m = members.rows.find(m => m.user_id === id);
    return m && m.attributes.checkedIn === true && m.attributes.available !== false && Number(m.attributes.restUntil ?? 0) <= Date.now() && !busy.has(id);
  };
  for (const board of boards.rows) {
    if(await boardLease(client,board.id))continue;
    if(manual&&board.id!==manual.boardId)continue;
    if(Number((row.state.boardCooldowns as Record<string,number>|undefined)?.[board.id]??0)>Date.now())continue;
    const reservation=(row.state.boardReservations as Record<string,{fixtureId?:string}>|undefined)?.[board.id];
    if(reservation&&!reservation.fixtureId)continue;
    const fixture = row.state.fixtures?.find(f => f.status === 'scheduled' && (!manual||f.id===manual.fixtureId) && (!reservation?.fixtureId||f.id===reservation.fixtureId) && (manual||!f.time||new Date(f.time).getTime()<=Date.now()+5*60_000) && f.players.every((p): p is string => p !== null && Boolean(eligible(p))));
    if (!fixture) continue;
    try{await assertBoardUnreserved(client,board.id,row.state.eventId!,row.id,fixture.id);}catch(error){if(error instanceof DomainError&&error.code==='board_reserved')continue;throw error;}
    const players = fixture.players as string[];
    const writer = manual?.writerId ? members.rows.find(m=>m.user_id===manual.writerId&&!players.includes(m.user_id)&&eligible(m.user_id))?.user_id : row.state.requireWriter === false ? undefined : members.rows.find(m => !players.includes(m.user_id) && eligible(m.user_id))?.user_id;
    if(manual?.writerId&&!writer)throw new DomainError('writer_unavailable','Deze schrijver is niet beschikbaar of hoort niet bij deze speeldag.',409);
    if (row.state.requireWriter !== false && !writer) continue;
    if (!fixture.matchId) fixture.matchId = await createCoreMatch(client, row, players, row.state.settings!, fixture.id);
    const match = await client.query('select state from dartflow_private.matches where id=$1 for update', [fixture.matchId]);
    const state = match.rows[0].state;
    const beforeCall=structuredClone(state);
    if(!['planned','called'].includes(state.status)||state.boardId)throw new DomainError('match_active','Deze partij is al actief.',409);
    state.boardId = board.id; state.status = 'called'; state.revision++;state.callRef=context?.requestId??randomUUID();state.accepted=[false,false];
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
