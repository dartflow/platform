import { NATIONAL_RATING_POLICY as policy } from './ranking-policy';
import type { RankingRow } from './ranking-types';
import type { Settings } from './types';

const day = 86_400_000;

/** Store the unrounded pair together; presentation rounding never enters the calculation. */
export function calculateElo(a: number, b: number, aWon: boolean): { after: [number, number]; deltas: [number, number] } {
  if (!Number.isFinite(a) || !Number.isFinite(b) || typeof aWon !== 'boolean') throw new TypeError('Invalid rating result.');
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  const delta = policy.k * (Number(aWon) - expected);
  return { after: [a + delta, b - delta], deltas: [delta, -delta] };
}

/** A replay uses the durable server sequence, including opponents after a corrected result. */
export function replayRatings(results: { sequence: number; players: [string, string]; winnerId: string }[]): Record<string, number> {
  const ratings: Record<string, number> = Object.create(null);
  const sequences = new Set<number>();
  for (const result of [...results].sort((a, b) => a.sequence - b.sequence)) {
    const [a, b] = result.players;
    if (!Number.isSafeInteger(result.sequence) || result.sequence < 1 || sequences.has(result.sequence) || a === b || !result.players.includes(result.winnerId)) throw new TypeError('Invalid rating source.');
    sequences.add(result.sequence);
    const { after } = calculateElo(ratings[a] ?? policy.initialRating, ratings[b] ?? policy.initialRating, result.winnerId === a);
    [ratings[a], ratings[b]] = after;
  }
  return ratings;
}

export function roundRating(value: number, decimals = 0): number {
  const scale = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * scale) / scale;
}

export function nationalRatingFormat(settings: Settings): boolean {
  const rules=settings as Settings&{inRule?:string;outRule?:string;sideStartScores?:number[];discipline?:string};
  return (rules.discipline??'x01')==='x01'&&settings.startScore === 501 && settings.bestOfSets === 1 && settings.legLimit === undefined && !settings.legWinByTwo && !settings.setWinByTwo && [5, 7, 9, 11, 13, 15, 17, 19].includes(settings.bestOfLegs)&&rules.inRule!=='double'&&(!rules.outRule||rules.outRule==='double')&&!rules.sideStartScores;
}

export function ratingActive(lastPlayedAt: string | null, now: number,activeDays:number=policy.activeDays): boolean {
  return lastPlayedAt !== null && now < Date.parse(lastPlayedAt) + activeDays * day;
}

export function freeMatchCapacity(starts: number[], now: number): boolean {
  return starts.filter(start => start > now - policy.windowDays * day && start <= now).length < policy.freeMatchesPerWindow;
}

/** The ID only stabilizes equal rows; it never gives a sporting advantage. */
export function rankRatingRows(rows: Omit<RankingRow, 'position' | 'displayRating' | 'provisional' | 'active'>[], now: number,parameters:{placementMatches:number;placementOpponents:number;activeDays:number}=policy): RankingRow[] {
  const ranked: RankingRow[] = rows.map(row => ({ ...row, position: null, displayRating: roundRating(row.rating), provisional: row.played < parameters.placementMatches || row.uniqueOpponents < parameters.placementOpponents, active: ratingActive(row.lastPlayedAt, now,parameters.activeDays) }));
  ranked.sort((a, b) => Number(a.provisional || !a.active) - Number(b.provisional || !b.active) || b.rating - a.rating || a.playerId.localeCompare(b.playerId));
  let placed = 0;
  let previousRating: number | null = null;
  let previousPosition = 0;
  for (const row of ranked) {
    if (row.provisional || !row.active) continue;
    placed++;
    row.position = previousRating === row.rating ? previousPosition : placed;
    previousRating = row.rating;
    previousPosition = row.position;
  }
  return ranked;
}
