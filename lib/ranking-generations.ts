import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError } from './domain';
import type { RankingPolicy } from './ranking-service-types';

export const NATIONAL_RATING_ID = '10000000-0000-4000-8000-000000000001';
export const NATIONAL_CIRCUIT_ID = '10000000-0000-4000-8000-000000000002';
export type RankingListRecord = { id: string; scope: 'national' | 'club'; kind: 'rating' | 'circuit'; club_id: string | null; name: string; policy_version: number; next_sequence: string; active_generation: string | null; closes_at: Date | null; policy: RankingPolicy };
export type RankingSourceData = {
  players: string[]; winnerId?: string; resultRevision?: number; playedAt: string;dependencyCorrectionId?:string;seasonConfirmationWithdrawn?:string;
  place?: number; points?: number; starters?: number; eligible?: boolean; played?: boolean; disqualified?: boolean;
};
type Source = { id: string; sequence: string; source_kind: 'match' | 'event'; match_id: string | null; entity_id: string | null; revision: number; verdict: 'valid' | 'void'; data: RankingSourceData; policy: RankingPolicy };

export async function rankingList(client: Pick<PoolClient, 'query'>, listId: string, lock = false): Promise<RankingListRecord> {
  const row = (await client.query<RankingListRecord>(`select l.*,p.policy from dartflow_private.ranking_lists l join dartflow_private.ranking_list_policies p on p.list_id=l.id and p.version=l.policy_version where l.id=$1${lock ? ' for update of l' : ''}`, [listId])).rows[0];
  if (!row) throw new DomainError('ranking_not_found', 'Deze ranglijst bestaat niet.', 404);
  return row;
}

/** All locks for a multi-destination transaction use this same stable UUID order. */
export async function lockRankingLists(client: PoolClient, listIds: string[]): Promise<RankingListRecord[]> {
  const lists: RankingListRecord[] = [];
  for (const id of [...new Set(listIds)].sort()) lists.push(await rankingList(client, id, true));
  return lists;
}

export async function appendRankingSource(client: PoolClient, list: RankingListRecord, source: { kind: 'match' | 'event'; key: string; matchId?: string; entityId?: string; declarationId?: string; policyVersion: number; data: RankingSourceData; actorId?: string; reason: string;replaceExistingEvent?:boolean;reactivateExistingMatch?:boolean }): Promise<{ sourceId: string; changed: boolean }> {
  const prior = (await client.query<{ id: string; revision: number; verdict: string; data: RankingSourceData }>(`select s.id,r.revision,r.verdict,r.data from dartflow_private.ranking_sources s join lateral(select *from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true where s.list_id=$1 and s.source_kind=$2 and s.source_key=$3`, [list.id, source.kind, source.key])).rows[0];
  if (prior) {
    if (source.kind==='event'?!source.replaceExistingEvent:prior.data.resultRevision === source.data.resultRevision&&!(source.reactivateExistingMatch&&prior.verdict==='void'&&prior.data.seasonConfirmationWithdrawn)) return { sourceId: prior.id, changed: false };
    source.data={...source.data,playedAt:prior.data.playedAt};
    if(source.kind==='event'&&prior.verdict==='valid'&&JSON.stringify([prior.data.players,prior.data.place,prior.data.starters,prior.data.played,prior.data.eligible,prior.data.points,prior.data.disqualified])===JSON.stringify([source.data.players,source.data.place,source.data.starters,source.data.played,source.data.eligible,source.data.points,source.data.disqualified]))return{sourceId:prior.id,changed:false};
    await client.query('insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,$2,\'valid\',$3,$4,$5)', [prior.id, prior.revision + 1, JSON.stringify(source.data), source.actorId ?? null, source.reason]);
    return { sourceId: prior.id, changed: true };
  }
  const id = randomUUID(), sequence = (await client.query<{ next_sequence: string }>('update dartflow_private.ranking_lists set next_sequence=next_sequence+1 where id=$1 returning next_sequence', [list.id])).rows[0].next_sequence;
  await client.query(`insert into dartflow_private.ranking_sources(id,list_id,source_kind,source_key,match_id,entity_id,declaration_id,policy_version,sequence)values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, list.id, source.kind, source.key, source.matchId ?? null, source.entityId ?? null, source.declarationId ?? null, source.policyVersion, sequence]);
  await client.query("insert into dartflow_private.ranking_source_revisions(source_id,revision,verdict,data,actor_id,reason)values($1,1,'valid',$2,$3,$4)", [id, JSON.stringify(source.data), source.actorId ?? null, source.reason]);
  return { sourceId: id, changed: true };
}

export async function rebuildRankingGeneration(client: PoolClient, list: RankingListRecord): Promise<{ generation: string; previousGeneration: string | null; affectedPlayers: number }> {
  const sources = (await client.query<Source>(`select s.id,s.sequence,s.source_kind,s.match_id,s.entity_id,r.revision,r.verdict,r.data,p.policy from dartflow_private.ranking_sources s
    join lateral(select revision,verdict,data from dartflow_private.ranking_source_revisions where source_id=s.id order by revision desc limit 1)r on true
    join dartflow_private.ranking_list_policies p on p.list_id=s.list_id and p.version=s.policy_version where s.list_id=$1 order by s.sequence,s.id`, [list.id])).rows;
  type Account = { playerId: string; rating: number; played: number; opponents: Set<string>; last: string | null; points: number; results: { sourceId: string; points: number; place: number; sequence: number; counting?: boolean }[] };
  const accounts = new Map<string, Account>();
  const get = (id: string): Account => {
    const prior = accounts.get(id); if (prior) return prior;
    const row: Account = { playerId: id, rating: list.policy.initialRating, played: 0, opponents: new Set(), last: null, points: 0, results: [] };
    accounts.set(id, row); return row;
  };
  const bookings: { sourceId: string; revision: number; playerId: string; before: number; after: number; delta: number; points: number; place: number | null; at: string }[] = [];
  for (const source of sources) {
    if (source.verdict !== 'valid') continue;
    if (list.kind === 'rating') {
      const [aId, bId] = source.data.players;
      if (!aId || !bId || aId === bId || source.data.players.length !== 2 || !source.data.players.includes(source.data.winnerId!)) throw new DomainError('ranking_source_invalid', 'Een ratingbron bevat geen besliste single.', 409);
      const a = get(aId), b = get(bId), before: [number, number] = [a.rating, b.rating];
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400)), delta = source.policy.k * (Number(source.data.winnerId === aId) - expected);
      a.rating += delta; b.rating -= delta;
      for (const [index, account] of [a, b].entries()) {
        account.played++; account.opponents.add(index ? aId : bId); account.last = source.data.playedAt;
        bookings.push({ sourceId: source.id, revision: source.revision, playerId: account.playerId, before: before[index], after: account.rating, delta: index ? -delta : delta, points: 0, place: null, at: source.data.playedAt });
      }
    } else {
      if (!source.data.eligible || !source.data.played || source.data.disqualified) continue;
      const account = get(source.data.players[0]);
      account.played++; account.last = source.data.playedAt;
      account.results.push({ sourceId: source.id, points: source.data.points ?? 0, place: source.data.place!, sequence: Number(source.sequence) });
      bookings.push({ sourceId: source.id, revision: source.revision, playerId: account.playerId, before: 0, after: 0, delta: 0, points: source.data.points ?? 0, place: source.data.place ?? null, at: source.data.playedAt });
    }
  }
  for (const account of accounts.values()) {
    if (list.kind !== 'circuit') continue;
    account.results.sort((a, b) => b.points - a.points || a.sequence - b.sequence);
    account.results.forEach((result, index) => { result.counting = index < list.policy.bestResults; });
    account.points = account.results.filter(result => result.counting).reduce((total, result) => total + result.points, 0);
    account.rating = account.points;
  }
  const generation = randomUUID();
  const digest = createHash('sha256').update(JSON.stringify(sources.map(source => [source.id, source.revision, source.verdict, source.data, source.policy.version]))).digest('hex');
  await client.query('insert into dartflow_private.ranking_generations(id,list_id,previous_generation,source_count,source_hash)values($1,$2,$3,$4,$5)', [generation, list.id, list.active_generation, sources.length, digest]);
  if (accounts.size) await client.query(`insert into dartflow_private.ranking_generation_accounts(generation_id,player_id,rating,played,unique_opponents,last_played_at,points,results)
    select $1,r."playerId",r.rating,r.played,r.opponents,r.last,r.points,r.results from jsonb_to_recordset($2::jsonb)r("playerId" uuid,rating double precision,played integer,opponents integer,last timestamptz,points integer,results jsonb)`, [generation, JSON.stringify([...accounts.values()].map(account => ({ ...account, opponents: account.opponents.size })))]);
  if (bookings.length) await client.query(`insert into dartflow_private.ranking_generation_bookings(generation_id,source_id,source_revision,player_id,before_rating,after_rating,delta,points,place,recorded_at)
    select $1,r."sourceId",r.revision,r."playerId",r.before,r.after,r.delta,r.points,r.place,r.at from jsonb_to_recordset($2::jsonb)r("sourceId" uuid,revision integer,"playerId" uuid,before double precision,after double precision,delta double precision,points integer,place integer,at timestamptz)`, [generation, JSON.stringify(bookings)]);
  // Readers only follow this pointer; no half-built pair or partial replay becomes visible.
  await client.query('update dartflow_private.ranking_lists set active_generation=$2 where id=$1', [list.id, generation]);
  return { generation, previousGeneration: list.active_generation, affectedPlayers: accounts.size };
}

export async function postFreeRankingSource(client: PoolClient, state: { id: string; players: { id: string }[]; winnerId: string | null; resultRevision: number | null }): Promise<{ sequence: number; before: [number, number]; after: [number, number]; deltas: [number, number] }> {
  const list = await rankingList(client, NATIONAL_RATING_ID, true);
  const playedAt = (await client.query<{ now: Date }>('select clock_timestamp() as now')).rows[0].now.toISOString();
  const source = await appendRankingSource(client, list, { kind: 'match', key: state.id, matchId: state.id, policyVersion: 1, data: { players: state.players.map(player => player.id), winnerId: state.winnerId!, resultRevision: state.resultRevision!, playedAt }, reason: 'Wederzijds bevestigde vrije rankingpartij' });
  if (source.changed) await rebuildRankingGeneration(client, list);
  const sourceRow = (await client.query<{ sequence: string }>('select sequence from dartflow_private.ranking_sources where id=$1', [source.sourceId])).rows[0];
  const rows = (await client.query<{ player_id: string; before_rating: number; after_rating: number; delta: number }>(`select b.player_id,b.before_rating,b.after_rating,b.delta from dartflow_private.ranking_generation_bookings b join dartflow_private.ranking_lists l on l.active_generation=b.generation_id where l.id=$1 and b.source_id=$2`, [list.id, source.sourceId])).rows;
  const before = state.players.map(player => Number(rows.find(row => row.player_id === player.id)!.before_rating)) as [number, number];
  const after = state.players.map(player => Number(rows.find(row => row.player_id === player.id)!.after_rating)) as [number, number];
  const deltas = state.players.map(player => Number(rows.find(row => row.player_id === player.id)!.delta)) as [number, number];
  return { sequence: Number(sourceRow.sequence), before, after, deltas };
}
