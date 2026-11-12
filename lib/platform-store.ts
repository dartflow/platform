import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {assertPlayersFree,lockPlayingActors}from'./platform-locks';
import { database } from './db';
import { DomainError, newGame } from './domain';
import {allocateInvitationCode,invitationCodeAccepted}from'./invitations';
import type { PlatformEntity, PlatformKind, PlatformMember, PlatformState } from './platform-types';
import type { MatchState, Profile, Settings } from './types';
import { requireScoreboardName } from './profile-name';
import {clubView} from './club-domain';
import {clubIsActiveMember,clubPermission} from './club-access';

export type EntityRow = { id: string; kind: PlatformKind; owner_id: string; club_id: string | null; visibility: string; revision: number; state: PlatformState; invite_hash: string | null; invite_expires_at: Date | null;invitation_code?:string|null };
export type Client = Pick<PoolClient, 'query'>;
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new DomainError('invalid_id', 'Ongeldige identificatie.');
  return value;
}
export function text(value: unknown, max = 80, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) throw new DomainError('invalid_text', `Vul geldige tekst in van maximaal ${max} tekens.`);
  return value.trim();
}
export function number(value: unknown, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new DomainError('invalid_number', `Kies een geheel getal tussen ${min} en ${max}.`);
  return n;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try { await client.query('begin'); const result = await run(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new DomainError('assignment_conflict', 'Deze actie is inmiddels door een andere aanvraag uitgevoerd.', 409); throw error; }
  finally { client.release(); }
}
export async function entity(client: Client, id: unknown, lock = false): Promise<EntityRow> {
  const { rows } = await client.query<EntityRow>(`select e.*,(select i.code from dartflow_private.invitation_codes i where i.entity_id=e.id and i.expires_at>now() order by i.created_at desc,i.code limit 1) as invitation_code from dartflow_private.platform_entities e where e.id=$1${lock ? ' for update of e' : ''}`, [uuid(id)]);
  if (!rows.length) throw new DomainError('not_found', 'Dit onderdeel bestaat niet.', 404);
  return rows[0];
}
export async function member(client: Client, id: string, actor: string): Promise<PlatformMember | undefined> {
  const { rows } = await client.query<PlatformMember>('select m.user_id as id,p.name,m.role,m.status,m.attributes from dartflow_private.platform_members m join dartflow_private.profiles p on p.id=m.user_id where m.entity_id=$1 and m.user_id=$2', [id, actor]);
  return rows[0];
}
export async function isClubMember(client: Client, clubId: string, actor: string, manage = false): Promise<boolean> {
  return manage?await clubPermission(client,clubId,actor,'competitions.manage')||await clubPermission(client,clubId,actor,'tournaments.manage'):clubIsActiveMember(client,clubId,actor);
}
export async function blocked(client: Client, a: string, b: string): Promise<boolean> {
  return Boolean((await client.query("select 1 from dartflow_private.platform_relationships where kind='block' and ((source_id=$1 and target_id=$2) or (source_id=$2 and target_id=$1))", [a, b])).rowCount);
}
export function allowsExternalParticipants(row:EntityRow):boolean{return ['league','tournament'].includes(row.kind)&&['all','code'].includes(String(row.state.eligibility));}
export async function requireAccess(client: Client, row: EntityRow, actor: string, manage = false): Promise<PlatformMember | undefined> {
  const own = row.owner_id === actor, m = await member(client, row.id, actor);
  if(row.kind==='room'&&typeof row.state.competitionId==='string'){const competition=await entity(client,row.state.competitionId),entry=await member(client,competition.id,actor);await requireAccess(client,competition,actor,entry?.attributes.registered!==true);}
  if (['room','lobby'].includes(row.kind) && await blocked(client,actor,row.owner_id))throw new DomainError('blocked','Deze ruimte is geblokkeerd.',403);
  if (m?.status === 'banned') throw new DomainError('room_banned', 'Je hebt geen toegang tot deze ruimte.', 403);
  if (row.club_id && !(await isClubMember(client, row.club_id, actor))) {if(manage||!allowsExternalParticipants(row)||m?.status!=='active'||m.attributes.registered!==true)throw new DomainError('forbidden','Je hebt geen toegang tot deze club of dit evenement.',403);}
  if(manage&&row.club_id&&['league','tournament'].includes(row.kind)){
    if(!await clubPermission(client,row.club_id,actor,row.kind==='league'?'competitions.manage':'tournaments.manage'))throw new DomainError('forbidden','Je hebt geen actueel beheerrecht voor dit evenement.',403);
    return m;
  }
  if (manage ? !(own || m?.status === 'active' && ['owner', 'admin', 'moderator'].includes(m.role)) : !(own || m?.status === 'active')) throw new DomainError('forbidden', 'Je hebt geen toegang tot dit onderdeel.', 403);
  return m;
}
export async function view(client: Client, row: EntityRow, actor: string,cachedMembers?:PlatformMember[]): Promise<PlatformEntity> {
  if(row.kind==='club')return clubView(client,row,actor,cachedMembers);
  const members=cachedMembers??(await client.query<PlatformMember>('select m.user_id as id,p.name,m.role,m.status,m.attributes from dartflow_private.platform_members m join dartflow_private.profiles p on p.id=m.user_id where m.entity_id=$1 order by m.created_at,m.user_id', [row.id])).rows;
  const own = row.owner_id === actor, self = members.find(m => m.id === actor);
  const canManage = row.club_id&&['league','tournament'].includes(row.kind)?await clubPermission(client,row.club_id,actor,row.kind==='league'?'competitions.manage':'tournaments.manage'):own || self?.status === 'active' && ['owner', 'admin', 'moderator'].includes(self.role);
  const full = own || self?.status === 'active';
  const state = structuredClone(row.state);
  if (!full) { delete state.game; delete state.undo; delete state.ready; delete state.coreClubId; }
  const visibleMembers = full ? members.filter(m => canManage || ['active', 'waitlisted'].includes(m.status) || m.id === actor) : members.filter(m => m.id === actor);
  return { id: row.id, kind: row.kind, name: state.name, ownerId: row.owner_id, clubId: row.club_id, visibility: row.visibility, revision: row.revision, state, members: visibleMembers, canManage: Boolean(canManage),...(full&&self?.status!=='banned'&&invitationCodeAccepted(row,row.invitation_code)?{inviteCode:row.invitation_code!}:{}) };
}
export async function addMember(client: Client, id: string, user: string, role = 'member', status = 'active', attributes: Record<string, unknown> = {}) {
  await client.query('insert into dartflow_private.platform_members(entity_id,user_id,role,status,attributes) values($1,$2,$3,$4,$5) on conflict(entity_id,user_id) do update set role=excluded.role,status=excluded.status,attributes=excluded.attributes', [id, uuid(user), role, status, JSON.stringify(attributes)]);
}
export async function createEntity(client: Client, actor: string, kind: PlatformKind, state: PlatformState, visibility: string, clubId: string | null = null, id = randomUUID()): Promise<{ row: EntityRow; code: string }> {
  let code = randomBytes(18).toString('base64url');
  await client.query("insert into dartflow_private.platform_entities(id,kind,owner_id,club_id,visibility,state,invite_hash,invite_expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')", [id, kind, actor, clubId, visibility, JSON.stringify(state), hash(code)]);
  await addMember(client, id, actor, 'owner');
  if(kind!=='training'){const current=await entity(client,id);code=await allocateInvitationCode(client,id,current.invite_expires_at!);await client.query('update dartflow_private.platform_entities set invite_hash=$2 where id=$1',[id,hash(code)]);}
  return { row: await entity(client, id), code };
}
export async function save(client: Client, row: EntityRow) {
  row.revision++;
  await client.query('update dartflow_private.platform_entities set owner_id=$2,revision=$3,state=$4,visibility=$5,updated_at=now() where id=$1', [row.id, row.owner_id, row.revision, JSON.stringify(row.state),row.visibility]);
}
export function acceptsCode(row: EntityRow, code: unknown): boolean {
  return invitationCodeAccepted(row,code);
}
export async function available(client: Client, row: EntityRow) {
  const { rows } = await client.query("select count(*)::integer as count from dartflow_private.platform_members where entity_id=$1 and status='active'", [row.id]);
  if (rows[0].count >= (row.state.capacity ?? 64)) throw new DomainError('capacity_reached', 'Dit onderdeel heeft geen vrije plaatsen meer.', 409);
}
export async function createCoreEvent(client: Client, owner: string, state: PlatformState, clubId?: string | null): Promise<void> {
  if (state.eventId) return;
  const eventId = randomUUID(), coreClubId = clubId || randomUUID();
  if (!clubId) {
    await client.query('insert into dartflow_private.clubs(id,name) values($1,$2)', [coreClubId, state.name]);
    await client.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'organizer') on conflict do nothing", [coreClubId, owner]);
  }
  await client.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,$4,$5)', [eventId, coreClubId, state.name, typeof state.date === 'string' ? state.date : new Date().toISOString().slice(0, 10), state.capacity ?? 128]);
  await client.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2) on conflict do nothing', [eventId, owner]);
  state.eventId = eventId; state.coreClubId = coreClubId;
}
export async function provisionPlayer(client: Client, state: PlatformState, player: string) {
  await client.query("insert into dartflow_private.entries(id,event_id,user_id,status,checked_in) values($1,$2,$3,'registered',true) on conflict(event_id,user_id) do update set status='registered',checked_in=true", [randomUUID(), state.eventId, player]);
}
export async function createCoreMatch(client: Client, row: EntityRow, players: string[], settings: Settings, fixtureId: string,administrative=false): Promise<string> {
  if (players.length !== 2 || players[0] === players[1]) throw new DomainError('invalid_players', 'Deze partij heeft twee verschillende spelers nodig.');
  await createCoreEvent(client, row.owner_id, row.state, row.club_id);
  for (const id of players) await provisionPlayer(client, row.state, id);
  // Lock verified names through insertion so concurrent profile completion cannot
  // pass validation after an older, unconfirmed name was already snapshotted.
  const { rows: profiles } = await client.query<Profile>('select id,name from dartflow_private.profiles where id=any($1::uuid[]) order by id for share', [players]);
  if (profiles.length !== 2) throw new DomainError('invalid_players', 'Een speler bestaat niet.');
  for(const player of players)await requireScoreboardName(client,player);
  const participants = players.map(id => profiles.find(p => p.id === id)!);
  if(!administrative){await lockPlayingActors(client,players);await assertPlayersFree(client,players);}
  const id = randomUUID();
  const starter=row.kind==='lobby'&&typeof row.state.starterId==='string'?players.indexOf(row.state.starterId):0;
  if(starter<0)throw new DomainError('invalid_starter','De startspeler is niet aanwezig.');
  const scoringMode=row.kind==='lobby'&&['remote','hybrid'].includes(String(row.state.setup))?'per-player':'shared-writer';
  const state: MatchState = { id, clubId: row.state.coreClubId!, eventId: row.state.eventId!, boardId: null, revision: 0, status: 'called', players: participants,scoringMode,writerId:players[scoringMode==='per-player'?starter:0], settings, accepted: [false, false], confirmations: [false, false], resultRevision: null, game: newGame(id, players, settings,starter), previousSets: [], winnerId: null, resultPublished: false, dispute: null };
  await client.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state) values($1,$2,$3,0,$4)', [id, state.clubId, state.eventId, JSON.stringify(state)]);
  for (const [i, player] of players.entries()) await client.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3)', [id, player, i]);
  await client.query('insert into dartflow_private.platform_match_links(match_id,entity_id,fixture_id) values($1,$2,$3)', [id, row.id, fixtureId]);
  return id;
}

export async function syncCompetitionRoom(client:Client,row:EntityRow,user:string,status:'active'|'waitlisted'|'pending'|'left'):Promise<void>{
 if(typeof row.state.roomId!=='string')return;const room=await entity(client,row.state.roomId),current=await member(client,room.id,user);
 if(room.owner_id===user||current?.status==='banned')return;
 if(status==='active'){if(current?.status!=='active')await addMember(client,room.id,user,current?.role??'member','invited',current?.attributes??{});}
 else if(current)await client.query("update dartflow_private.platform_members set status='left' where entity_id=$1 and user_id=$2",[room.id,user]);
}
