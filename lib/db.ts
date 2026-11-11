import pg, { type PoolClient } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {assertBoardUnreserved,assertPlayersFree,boardLease,lockPlayingActors}from'./platform-locks';
import { enqueueEventTransition,enqueueMatchTransition } from './integrations-domain';
import { applyMatchAction, checkout, DomainError, matchView, newGame, validateSettings } from './domain';
import type { Club, EventAction, MatchCommand, MatchState, MatchView, Overview, Profile, PublicSnapshot, ResultView } from './types';

const globalDb = globalThis as typeof globalThis & { dartflowPool?: pg.Pool };
export function database(): pg.Pool {
  if (!process.env.DARTFLOW_DATABASE_URL) throw new DomainError('database_unconfigured', 'De database is nog niet geconfigureerd.', 503);
  let connection: URL;
  try { connection = new URL(process.env.DARTFLOW_DATABASE_URL); }
  catch { throw new DomainError('database_url_invalid', 'De databaseverbinding heeft geen geldige URL.', 503); }
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || [...connection.searchParams.keys()].some(key => ['host', 'user', 'password', 'port', 'database'].includes(key.toLowerCase()))) throw new DomainError('database_url_invalid', 'Gebruik een Postgres-URL zonder verbindingsoverschrijvingen in queryparameters.', 503);
  if(process.env.DARTFLOW_DATA_MODE === 'local' && !['localhost','127.0.0.1','[::1]'].includes(connection.hostname.toLowerCase())) throw new DomainError('local_database_required','Lokale testaccounts vereisen een lokale database.',503);
  let configuredUser: string;
  try { configuredUser = decodeURIComponent(connection.username); }
  catch { throw new DomainError('database_url_invalid', 'De databaseverbinding heeft geen geldige gebruikersnaam.', 503); }
  if (configuredUser !== 'dartflow_app' && !configuredUser.startsWith('dartflow_app.')) throw new DomainError('database_role_invalid', 'Gebruik de beperkte dartflow_app-databaserol voor de app.', 503);
  return globalDb.dartflowPool ??= new pg.Pool({ connectionString: process.env.DARTFLOW_DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'dartflow' });
}
export async function closeDatabase() { await globalDb.dartflowPool?.end(); delete globalDb.dartflowPool; }
const assertUuid = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new DomainError('invalid_id', 'Ongeldige identificatie.');
  return value;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try { await client.query('begin'); const value = await run(client); await client.query('commit'); return value; }
  catch (error) { await client.query('rollback'); if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new DomainError('assignment_conflict', 'Deze baan of partij is inmiddels toegewezen.', 409); throw error; }
  finally { client.release(); }
}
export async function eventAccess(client: PoolClient | pg.Pool, actorId: string, eventId: string) {
  const { rows } = await client.query(`select e.*, m.role, exists(select 1 from dartflow_private.event_staff s where s.event_id=e.id and s.user_id=$1) as staff from dartflow_private.events e left join dartflow_private.club_memberships m on m.club_id=e.club_id and m.user_id=$1 where e.id=$2 and (m.user_id is not null or (exists(select 1 from dartflow_private.entries x where x.event_id=e.id and x.user_id=$1 and x.status='registered') and exists(select 1 from dartflow_private.platform_entities pe where pe.state->>'eventId'=e.id::text and ((pe.kind='lobby' and pe.state->>'boardId' is null) or (pe.kind in ('league','tournament') and (pe.club_id is null or pe.state->>'eligibility' in ('all','code')))))))`, [assertUuid(actorId), assertUuid(eventId)]);
  if (!rows.length) throw new DomainError('forbidden', 'Je hebt geen toegang tot dit evenement.', 403);
  return { ...rows[0], canManage: rows[0].role === 'organizer' && rows[0].staff === true };
}
async function matchAccess(client: PoolClient | pg.Pool, actorId: string, state: MatchState) {
  const access = await eventAccess(client, actorId, state.eventId);
  if (!access.canManage && !state.players.some(p => p.id === actorId) && state.delegatedWriterId !== actorId) throw new DomainError('forbidden', 'Deze partij hoort bij andere spelers.', 403);
  return access;
}
async function audit(client: PoolClient, actorId: string, event: { club_id?: string; clubId?: string; eventId?: string; id?: string }, action: string, detail: unknown = {}, matchId: string | null = null) {
  await client.query('insert into dartflow_private.audit_events(actor_id,club_id,event_id,match_id,action,detail) values($1,$2,$3,$4,$5,$6)', [actorId, event.club_id ?? event.clubId, event.eventId ?? event.id, matchId, action, JSON.stringify(detail)]);
}
export async function getProfile(actorId: string): Promise<Profile> {
  const { rows } = await database().query('select id,name,email from dartflow_private.profiles where id=$1', [assertUuid(actorId)]);
  if (!rows.length) throw new DomainError('profile_missing', 'Dit account is nog niet toegelaten tot de pilot.', 403);
  return rows[0];
}
export async function getMatch(actorId: string, matchId: string): Promise<MatchView> {
  const { rows } = await database().query('select state from dartflow_private.matches where id=$1', [assertUuid(matchId)]);
  if (!rows.length) throw new DomainError('not_found', 'Deze partij bestaat niet.', 404);
  const state: MatchState = rows[0].state, access = await matchAccess(database(), actorId, state);
  const link=await database().query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='tournament'",[matchId]);
  return {...matchView(state, actorId, access.canManage),offlineSupported:Boolean(link.rowCount)};
}
export async function getOverview(actorId: string, clubId?: string): Promise<Overview> {
  const profile = await getProfile(actorId);
  const { rows: clubs } = await database().query<Club>(`select c.id,c.name,m.role from dartflow_private.clubs c join dartflow_private.club_memberships m on m.club_id=c.id where m.user_id=$1 and not exists(select 1 from dartflow_private.platform_entities pe where pe.state->>'coreClubId'=c.id::text and (pe.kind='lobby' or(pe.kind in ('league','tournament') and pe.club_id is null))) order by c.name`, [actorId]);
  const currentClub = clubId ? clubs.find(c => c.id === assertUuid(clubId)) : clubs[0];
  if (clubId && !currentClub) throw new DomainError('forbidden', 'Je hebt geen toegang tot deze vereniging.', 403);
  const empty = { profile, clubs, currentClub: currentClub ?? null, events: [], matches: [], boards: [], participants: [], history: [], standings: [], permissions: { canManage: false } };
  if (!currentClub) return empty;
  const { rows: events } = await database().query(`select e.id,e.club_id as "clubId",e.name,e.date::text,e.capacity, (m.role='organizer' and exists(select 1 from dartflow_private.event_staff s where s.event_id=e.id and s.user_id=$1)) as "canManage" from dartflow_private.events e join dartflow_private.club_memberships m on m.club_id=e.club_id and m.user_id=$1 where e.club_id=$2 order by e.date,e.id`, [actorId, currentClub.id]);
  const { rows: matchRows } = await database().query('select state from dartflow_private.matches where club_id=$1 order by updated_at,id', [currentClub.id]);
  const matches = matchRows.flatMap(({ state }: { state: MatchState }) => { const manage = events.find(e => e.id === state.eventId)?.canManage === true; return manage || state.players.some(p => p.id === actorId) ? [matchView(state, actorId, manage)] : []; });
  const { rows: boards } = await database().query('select b.id,b.event_id as "eventId",b.name,b.blocked,m.id as "matchId" from dartflow_private.boards b join dartflow_private.events e on e.id=b.event_id left join dartflow_private.matches m on m.board_id=b.id where e.club_id=$1 order by b.name', [currentClub.id]);
  const { rows: participants } = await database().query('select x.id,x.event_id as "eventId",x.user_id as "playerId",p.name,x.status,x.checked_in as "checkedIn" from dartflow_private.entries x join dartflow_private.profiles p on p.id=x.user_id join dartflow_private.events e on e.id=x.event_id where e.club_id=$1 order by x.created_at,x.id', [currentClub.id]);
  const { rows: historyRows } = await database().query('select r.snapshot from dartflow_private.match_results r join dartflow_private.matches m on m.id=r.match_id where m.club_id=$1 and exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=$2) order by r.created_at desc', [currentClub.id, actorId]);
  const { rows: standings } = await database().query('select s.user_id as "playerId",p.name,s.played,s.won,s.drawn,s.points from dartflow_private.standings s join dartflow_private.profiles p on p.id=s.user_id join dartflow_private.events e on e.id=s.event_id where e.club_id=$1 order by s.points desc,p.name', [currentClub.id]);
  return { profile, clubs, currentClub, events, matches, boards, participants, history: historyRows.map(r => r.snapshot), standings, permissions: { canManage: events.some(e => e.canManage) } };
}
export async function publishResult(client: PoolClient, state: MatchState) {
  if (!state.resultPublished || !state.confirmations.every(Boolean) || state.resultRevision === null) return;
  const view = matchView(state, '', false);
  const snapshot: ResultView = { matchId: state.id, players: state.players, legs: view.legs, sets: view.sets, winnerId: state.winnerId, revision: state.resultRevision };
  const result = await client.query('insert into dartflow_private.match_results(match_id,event_id,result_revision,snapshot) values($1,$2,$3,$4) on conflict(match_id) do nothing returning match_id', [state.id, state.eventId, state.resultRevision, JSON.stringify(snapshot)]);
  if (!result.rowCount) return;
  if((await client.query("select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=$1 and e.kind='lobby'",[state.id])).rowCount)return;
  // The unique match result is the processing key; standings update in this same transaction.
  for (const player of state.players) {
    const won = state.winnerId === player.id ? 1 : 0, drawn = state.winnerId === null ? 1 : 0;
    await client.query('insert into dartflow_private.standings(event_id,user_id,played,won,drawn,points) values($1,$2,1,$3,$4,$5) on conflict(event_id,user_id) do update set played=dartflow_private.standings.played+1,won=dartflow_private.standings.won+excluded.won,drawn=dartflow_private.standings.drawn+excluded.drawn,points=dartflow_private.standings.points+excluded.points', [state.eventId, player.id, won, drawn, won * 3 + drawn]);
  }
}
export async function executeMatchCommand(actorId: string, command: MatchCommand): Promise<MatchView> {
  assertUuid(actorId); assertUuid(command?.matchId); assertUuid(command?.requestId);
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || !command.action || typeof command.action.type !== 'string') throw new DomainError('invalid_command', 'Ongeldig partijcommando.');
  const payloadHash = hash(canonical({ expectedRevision: command.expectedRevision, action: command.action }));
  return transaction(async client => {
    // A shared event lock also serializes assignments on different boards and withdrawals.
    const scope = await client.query('select event_id from dartflow_private.matches where id=$1', [command.matchId]);
    if (!scope.rows.length) throw new DomainError('not_found', 'Deze partij bestaat niet.', 404);
    await client.query('select id from dartflow_private.events where id=$1 for update', [scope.rows[0].event_id]);
    const { rows } = await client.query('select state from dartflow_private.matches where id=$1 for update', [command.matchId]);
    if (!rows.length) throw new DomainError('not_found', 'Deze partij bestaat niet.', 404);
    const source: MatchState = rows[0].state;
    const access = await matchAccess(client, actorId, source);
    const prior = await client.query('select payload_hash,response from dartflow_private.action_receipts where match_id=$1 and actor_id=$2 and request_id=$3', [source.id, actorId, command.requestId]);
    if (prior.rows.length) {
      if (prior.rows[0].payload_hash !== payloadHash) throw new DomainError('request_reused', 'Dit aanvraag-ID is eerder met andere gegevens gebruikt.', 409);
      return prior.rows[0].response;
    }
    if (source.revision !== command.expectedRevision) throw new DomainError('revision_conflict', 'De partij is gewijzigd. Vernieuw de stand en probeer opnieuw.', 409);
    if (command.action.type === 'call') {
      const board = await client.query('select * from dartflow_private.boards where id=$1 for update', [assertUuid(command.action.boardId)]);
      if (!board.rows.length || board.rows[0].event_id !== source.eventId || board.rows[0].blocked) throw new DomainError('board_unavailable', 'Deze baan is niet beschikbaar voor deze partij.', 409);
      const linked=await client.query('select entity_id,fixture_id from dartflow_private.platform_match_links where match_id=$1',[source.id]);
      await assertBoardUnreserved(client,command.action.boardId,source.eventId,linked.rows[0]?.entity_id??null,linked.rows[0]?.fixture_id);
      const actors=[...source.players.map(p=>p.id),...(source.delegatedWriterId&&source.writerId===source.delegatedWriterId?[source.delegatedWriterId]:[])];await lockPlayingActors(client,actors);await assertPlayersFree(client,actors,source.id);
      const taken = await client.query('select id from dartflow_private.matches where board_id=$1 and id<>$2', [command.action.boardId, source.id]);
      if (taken.rowCount) throw new DomainError('board_occupied', 'Op deze baan staat al een partij.', 409);
      const present = await client.query('select user_id from dartflow_private.entries where event_id=$1 and user_id=any($2::uuid[]) and status=$3 and checked_in', [source.eventId, source.players.map(p => p.id), 'registered']);
      if (present.rowCount !== 2) throw new DomainError('players_absent', 'Beide spelers moeten eerst ingecheckt zijn.', 409);

    }
    const next = applyMatchAction(source, actorId, access.canManage, command.action.type==='call'?{...command.action,callRef:command.requestId}:command.action);
    await client.query('update dartflow_private.matches set state=$2,revision=$3,board_id=$4,updated_at=now() where id=$1', [next.id, JSON.stringify(next), next.revision, next.boardId]);
    if(['score','undo','approve-correction'].includes(command.action.type)||(command.action.type==='resolve'&&command.action.decision==='resume')){
      const visits = [...next.previousSets, next.game].flatMap(game => game.visits);
      await client.query('delete from dartflow_private.visits where match_id=$1', [next.id]);
      if(visits.length)await client.query('insert into dartflow_private.visits(match_id,sequence,data) select $1,ordinality-1,value from jsonb_array_elements($2::jsonb) with ordinality',[next.id,JSON.stringify(visits)]);
    }
    if(source.resultRevision!==next.resultRevision||source.confirmations.some((value,index)=>value!==next.confirmations[index])){
      await client.query('delete from dartflow_private.match_confirmations where match_id=$1', [next.id]);
      const confirmed=next.players.filter((_p,index)=>next.confirmations[index]).map(p=>p.id);
      if(confirmed.length)await client.query('insert into dartflow_private.match_confirmations(match_id,user_id,result_revision) select $1,unnest($2::uuid[]),$3',[next.id,confirmed,next.resultRevision]);
    }
    await publishResult(client, next);
    await audit(client, actorId, next, command.action.type, { requestId: command.requestId, revision: next.revision, action: command.action }, next.id);
    await enqueueMatchTransition(client,actorId,source,next,command);
    const response = matchView(next, actorId, access.canManage);
    await client.query('insert into dartflow_private.action_receipts(match_id,actor_id,request_id,payload_hash,response) values($1,$2,$3,$4,$5)', [next.id, actorId, command.requestId, payloadHash, JSON.stringify(response)]);
    return response;
  });
}
export async function executeEventCommand(actorId: string, eventId: string, action: EventAction): Promise<{ matchId?: string; ok: true }> {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new DomainError('invalid_action', 'Ongeldig evenementcommando.');
  return transaction(async client => {
    const event = await eventAccess(client, actorId, eventId);
    await client.query('select id from dartflow_private.events where id=$1 for update', [eventId]);
    const beforeEntries=await client.query<{id:string;user_id:string;status:'registered'|'waitlisted'|'withdrawn'}>('select id,user_id,status from dartflow_private.entries where event_id=$1',[eventId]);
    if (action.type === 'plan') {
      if (!event.canManage) throw new DomainError('forbidden', 'Alleen de wedstrijdleiding kan partijen plannen.', 403);
      if (!Array.isArray(action.playerIds) || action.playerIds.length !== 2 || action.playerIds[0] === action.playerIds[1]) throw new DomainError('invalid_players', 'Kies twee verschillende deelnemers.');
      const { rows: players } = await client.query('select p.id,p.name from dartflow_private.profiles p join dartflow_private.entries x on x.user_id=p.id where x.event_id=$1 and p.id=any($2::uuid[]) and x.status=$3', [eventId, action.playerIds.map(assertUuid), 'registered']);
      if (players.length !== 2) throw new DomainError('invalid_players', 'Beide spelers moeten ingeschreven zijn.');
      players.sort((a, b) => action.playerIds.indexOf(a.id) - action.playerIds.indexOf(b.id));
      const settings = validateSettings(action.settings), id = randomUUID();
      const state: MatchState = { id, eventId, clubId: event.club_id, boardId: null, revision: 0, status: 'planned', players, writerId: players[0].id, settings, accepted: [false, false], confirmations: [false, false], resultRevision: null, game: newGame(id, players.map(p => p.id), settings), previousSets: [], winnerId: null, resultPublished: false, dispute: null };
      await client.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state) values($1,$2,$3,0,$4)', [id, event.club_id, eventId, JSON.stringify(state)]);
      for (let index = 0; index < 2; index++) await client.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3)', [id, players[index].id, index]);
      await audit(client, actorId, event, 'plan', { players: action.playerIds }, id);
      return { ok: true, matchId: id };
    }
    if (!['register', 'withdraw', 'check-in'].includes(action.type)) throw new DomainError('invalid_action', 'Onbekende evenementactie.');
    const playerId = assertUuid(action.playerId ?? actorId);
    if (playerId !== actorId && !event.canManage) throw new DomainError('forbidden', 'Je kunt alleen je eigen deelname wijzigen.', 403);
    const member = await client.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2', [event.club_id, playerId]);
    if (!member.rowCount) throw new DomainError('forbidden', 'Deze speler hoort niet bij deze vereniging.', 403);
    if (action.type === 'register') {
      const filled = await client.query('select count(*)::int as count from dartflow_private.entries where event_id=$1 and status=$2', [eventId, 'registered']);
      const status = filled.rows[0].count >= event.capacity ? 'waitlisted' : 'registered';
      await client.query(`insert into dartflow_private.entries(id,event_id,user_id,status) values($1,$2,$3,$4) on conflict(event_id,user_id) do update set status=case when dartflow_private.entries.status='withdrawn' then excluded.status else dartflow_private.entries.status end,checked_in=case when dartflow_private.entries.status='withdrawn' then false else dartflow_private.entries.checked_in end`, [randomUUID(), eventId, playerId, status]);
    } else if (action.type === 'check-in') {
      const changed = await client.query('update dartflow_private.entries set checked_in=true where event_id=$1 and user_id=$2 and status=$3', [eventId, playerId, 'registered']);
      if (!changed.rowCount) throw new DomainError('not_registered', 'Schrijf je eerst in; deelnemers op de wachtlijst kunnen nog niet inchecken.', 409);
    } else {
      const active = await client.query(`select 1 from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id where m.event_id=$1 and p.user_id=$2 and m.state->>'status' in ('called','ready','live','result','disputed')`, [eventId, playerId]);
      if (active.rowCount) throw new DomainError('active_match', 'Rond eerst je actieve partij af.', 409);
      await client.query('update dartflow_private.entries set status=$3,checked_in=false where event_id=$1 and user_id=$2', [eventId, playerId, 'withdrawn']);
      await client.query(`update dartflow_private.entries set status='registered' where id=(select id from dartflow_private.entries where event_id=$1 and status='waitlisted' order by created_at,id limit 1) and (select count(*) from dartflow_private.entries where event_id=$1 and status='registered')<$2`, [eventId, event.capacity]);
    }
    await audit(client, actorId, event, action.type, { playerId });
    const afterEntries=await client.query<{id:string;user_id:string;status:'registered'|'waitlisted'|'withdrawn'}>('select id,user_id,status from dartflow_private.entries where event_id=$1',[eventId]);
    await enqueueEventTransition(client,actorId,event,action,{ok:true,transitions:afterEntries.rows.map(entry=>({entryId:entry.id,userId:entry.user_id,from:beforeEntries.rows.find(old=>old.id===entry.id)?.status??null,to:entry.status})).filter(change=>change.from!==change.to)});
    return { ok: true };
  });
}
export async function createScreen(actorId: string, eventId: string, boardId: string): Promise<{ id: string; token: string; url: string }> {
  return transaction(async client => {
    const access = await eventAccess(client, actorId, eventId);
    if (!access.canManage) throw new DomainError('forbidden', 'Alleen de wedstrijdleiding kan een scherm koppelen.', 403);
    const { rowCount } = await client.query('select 1 from dartflow_private.boards where id=$1 and event_id=$2', [assertUuid(boardId), eventId]);
    if (!rowCount) throw new DomainError('invalid_board', 'Deze baan hoort niet bij dit evenement.');
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    await client.query(`insert into dartflow_private.screen_capabilities(id,event_id,board_id,token_hash,created_by,expires_at) values($1,$2,$3,$4,$5,now()+interval '12 hours')`, [id, eventId, boardId, hash(token), actorId]);
    await audit(client, actorId, access, 'screen.create', { capabilityId: id, boardId });
    return { id, token, url: `/scherm/${token}` };
  });
}
export async function revokeScreen(actorId: string, capabilityId: string): Promise<void> {
  await transaction(async client => {
    const { rows } = await client.query('select event_id from dartflow_private.screen_capabilities where id=$1 for update', [assertUuid(capabilityId)]);
    if (!rows.length) throw new DomainError('not_found', 'Deze schermkoppeling bestaat niet.', 404);
    const access = await eventAccess(client, actorId, rows[0].event_id);
    if (!access.canManage) throw new DomainError('forbidden', 'Alleen de wedstrijdleiding kan dit scherm intrekken.', 403);
    await client.query('update dartflow_private.screen_capabilities set revoked_at=now() where id=$1', [capabilityId]);
    await audit(client, actorId, access, 'screen.revoke', { capabilityId });
  });
}
export async function getPublicSnapshot(token: string): Promise<PublicSnapshot> {
  if (typeof token !== 'string' || !/^(?:[\w-]{43}|[\w-]{64})$/.test(token)) throw new DomainError('invalid_screen', 'Deze schermkoppeling is ongeldig of verlopen.', 404);
  const { rows } = await database().query('select b.id,b.name,b.event_id,c.created_by,e.name as event_name,m.state from dartflow_private.screen_capabilities c join dartflow_private.boards b on b.id=c.board_id and b.event_id=c.event_id join dartflow_private.events e on e.id=c.event_id left join dartflow_private.matches m on m.board_id=b.id where c.token_hash=$1 and c.revoked_at is null and c.expires_at>now()', [hash(token)]);
  if (!rows.length) throw new DomainError('invalid_screen', 'Deze schermkoppeling is ongeldig of verlopen.', 404);
  const row = rows[0],lease=await boardLease(database(),row.id);
  if(token.length===64){
    try{await eventAccess(database(),row.created_by,row.event_id);}catch{throw new DomainError('invalid_screen','Deze schermkoppeling is niet meer beschikbaar.',404);}
    const hex=Buffer.from(token,'base64url').subarray(0,16).toString('hex'),session=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    const bound=await database().query("select id,kind,state from dartflow_private.platform_entities where id=$1",[session]);
    const entity=bound.rows[0];
    const current=entity?(entity.kind==='training'?lease?.id===session&&!row.state:entity.kind==='lobby'&&entity.state.boardId===row.id&&(entity.state.matchId?row.state?.id===entity.state.matchId:lease?.id===session&&!row.state)):row.state?.id===session;
    if(!current)throw new DomainError('invalid_screen','Deze schermkoppeling hoort bij een beëindigde baanopstelling.',404);
  }
  if(!row.state&&lease?.kind==='training'){
    const game=lease.state.game as MatchState['game'],profile=await database().query('select name from dartflow_private.profiles where id=$1',[lease.owner_id]);
    return {board:{id:row.id,name:row.name},event:{name:row.event_name},match:{id:lease.id,revision:Number((await database().query('select revision from dartflow_private.platform_entities where id=$1',[lease.id])).rows[0].revision),status:game.status==='finished'?'result':'live',players:[{id:'player-1',name:profile.rows[0]?.name??'Speler'}],remaining:[game.remaining[0]],legs:[game.legs[0]],sets:[0],turn:0,checkout:game.status==='live'?checkout(game.remaining[0]):null,visits:game.visits.map(v=>({...v,player:'player-1',playerIndex:0})),writerId:'player-1',stats:[{...game.stats[0],average:game.stats[0].darts?Math.round(game.stats[0].total/game.stats[0].darts*300)/100:0}],legNumber:Math.max(1,...game.visits.map(v=>v.leg)),setNumber:1,winnerId:game.status==='finished'?'player-1':null,resultPublished:false,settings:{startScore:game.startScore as 301|501|701,bestOfLegs:1,bestOfSets:1},paused:false}};
  }
  const view = row.state ? matchView(row.state, '', false) : null;
  return { board: { id: row.id, name: row.name }, event: { name: row.event_name }, match: view ? { id: view.id, revision: view.revision, status: view.status, players: view.players.map((p, i) => ({ id: `player-${i + 1}`, name: p.name })), remaining: view.remaining, legs: view.legs, sets: view.sets, turn: view.turn, checkout: view.checkout, visits: (row.state as MatchState).game.visits.filter(v=>v.leg===view.legNumber).map(v => ({ ...v, player: `player-${v.playerIndex + 1}` })), writerId:view.players.some(p=>p.id===view.writerId)?`player-${view.players.findIndex(p=>p.id===view.writerId)+1}`:'writer-external',stats:view.stats,legNumber:view.legNumber,setNumber:view.setNumber,winnerId: view.winnerId ? `player-${view.players.findIndex(p => p.id === view.winnerId) + 1}` : null, resultPublished: view.resultPublished, settings: view.settings,paused:view.paused } : null };
}
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const { rows } = await database().query(`insert into dartflow_private.auth_limits(key,count,reset_at) values($1,1,now()+$2*interval '1 second') on conflict(key) do update set count=case when dartflow_private.auth_limits.reset_at<=now() then 1 else dartflow_private.auth_limits.count+1 end, reset_at=case when dartflow_private.auth_limits.reset_at<=now() then now()+$2*interval '1 second' else dartflow_private.auth_limits.reset_at end returning count, greatest(1,ceil(extract(epoch from(reset_at-now()))))::int as retry`, [key, windowSeconds]);
  return { allowed: rows[0].count <= limit, retryAfter: rows[0].count <= limit ? 0 : rows[0].retry };
}

export async function checkDatabaseReady(): Promise<{ ready: boolean; schemaVersion: number }> {
  const { rows } = await database().query("select current_user as role,(select max(version) from dartflow_private.schema_migrations) as version,(select version from dartflow_private.feature_versions where name='v15') as feature_version");
  return { ready: rows[0].role === 'dartflow_app' && rows[0].version === 1 && rows[0].feature_version === 15, schemaVersion: rows[0].version ?? 0 };
}

/** A fixed board UUID resolves its actual event, independently of UI club selection. */
export async function getBoardForActor(actorId:string,boardId:string):Promise<{board:{id:string;name:string;occupied:boolean};event:{id:string;name:string};matchId?:string;practiceId?:string;pendingLobbyId?:string;ownLobbyId?:string;canStart:boolean}>{
  const {rows}=await database().query<{id:string;name:string;blocked:boolean;event_id:string;state:MatchState|null}>('select b.id,b.name,b.blocked,b.event_id,m.state from dartflow_private.boards b left join dartflow_private.matches m on m.board_id=b.id where b.id=$1',[assertUuid(boardId)]);
  if(!rows.length)throw new DomainError('not_found','Deze baan bestaat niet.',404);
  const row=rows[0],event=await eventAccess(database(),actorId,row.event_id),lease=await boardLease(database(),boardId);
  let matchId:string|undefined,practiceId:string|undefined,pendingLobbyId:string|undefined,ownLobbyId:string|undefined;
  if(row.state){try{await matchAccess(database(),actorId,row.state);matchId=row.state.id;}catch(error){if(!(error instanceof DomainError&&error.status===403))throw error;}}
  if(lease?.kind==='training'&&lease.owner_id===actorId)practiceId=lease.id;
  if(lease?.kind==='lobby'){
    const own=lease.owner_id===actorId||Boolean((await database().query("select 1 from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and status in ('active','invited')",[lease.id,actorId])).rowCount);
    if(own)ownLobbyId=lease.id;
    if(lease.state.setup==='localone'&&!(await database().query("select 1 from dartflow_private.platform_relationships where kind='block' and ((source_id=$1 and target_id=$2) or (source_id=$2 and target_id=$1))",[actorId,lease.owner_id])).rowCount)pendingLobbyId=lease.id;
  }
  let canStart=!row.blocked&&!row.state&&!lease;
  if(canStart){try{await assertBoardUnreserved(database(),boardId,event.id);}catch(error){if(error instanceof DomainError&&error.code==='board_reserved')canStart=false;else throw error;}}
  return {board:{id:row.id,name:row.name,occupied:Boolean(row.state||lease)},event:{id:row.event_id,name:event.name},canStart,...(matchId?{matchId}:{}),...(practiceId?{practiceId}:{}),...(pendingLobbyId?{pendingLobbyId}:{}),...(ownLobbyId?{ownLobbyId}:{})};
}
