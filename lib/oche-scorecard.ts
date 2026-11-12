import type {MatchView, Visit} from './types';
import type {OcheScoreEvent} from './oche-visual';

/** This projection is shared by the read-only display and the player's score view. */
export type OcheScorecardMatch = Pick<MatchView, 'id'|'revision'|'status'|'players'|'remaining'|'legs'|'sets'|'turn'|'visits'|'settings'> & {
  legNumber?: number;
  setNumber?: number;
  currentLegVisits?: Visit[];
  currentLegStartScore?: number;
};
export type OcheScorecardCell = {visit: Visit | null; latest: boolean};
export type OcheScorecardRow = {index: number; cells: OcheScorecardCell[]};
export type OcheScorecard = {
  legKey: string;
  legNumber: number;
  setNumber: number;
  startScore: number;
  rows: OcheScorecardRow[];
  columns: Visit[][];
  visitCount: number;
  filledRows: number;
  lastVisit: Visit | null;
  lastEvent: Pick<OcheScoreEvent,'id'|'revision'|'kind'> | null;
};
const finished = (status: string) => ['result','confirmed','disputed'].includes(status);

/** currentLegVisits is canonical; legacy snapshots retain the old current-leg fallback. */
export function buildOcheScorecard(match: OcheScorecardMatch, sessionKey?: string, events: OcheScoreEvent[] = []): OcheScorecard {
  const legNumber = match.legNumber ?? Math.max(1, (match.legs[0] || 0) + (match.legs[1] || 0) + (finished(match.status) ? 0 : 1));
  const setNumber = match.setNumber ?? Math.max(1, match.sets.reduce((sum, value) => sum + value, 0) + 1);
  const visits = match.currentLegVisits ?? match.visits.filter(visit => visit.leg === legNumber);
  const columns = match.players.map((_, playerIndex) => visits.filter(visit => visit.playerIndex === playerIndex));
  const filledRows = Math.max(0, ...columns.map(column => column.length));
  const rows = Array.from({length: Math.max(5, filledRows)}, (_, index) => ({
    index,
    cells: columns.map(column => ({visit: column[index] ?? null, latest: Boolean(column[index] && index === column.length - 1)})),
  }));
  const lastEvent = events.reduce<OcheScoreEvent | null>((last, event) => !last || event.revision >= last.revision ? event : last, null);
  return {
    legKey: `${sessionKey ?? match.id}:${setNumber}:${legNumber}`,
    legNumber, setNumber, startScore: match.currentLegStartScore ?? match.settings.startScore,
    rows, columns, filledRows, visitCount: columns.reduce((sum, column) => sum + column.length, 0),
    lastVisit: visits.at(-1) ?? null,
    lastEvent: lastEvent ? {id: lastEvent.id, revision: lastEvent.revision, kind: lastEvent.kind} : null,
  };
}

/** A polling revision, an undo or a reconnect never forcibly scrolls old rows. */
export function ocheScorecardScroll(previous: OcheScorecard | null, next: OcheScorecard, connected = true): 'reset'|'keep'|'reveal' {
  if (!previous || previous.legKey !== next.legKey) return 'reset';
  if (!connected || next.lastEvent?.kind === 'undo') return 'keep';
  if (next.lastEvent?.kind === 'score' && next.lastEvent.id !== previous.lastEvent?.id && next.lastEvent.revision > (previous.lastEvent?.revision ?? -1)) return 'reveal';
  return next.visitCount > previous.visitCount ? 'reveal' : 'keep';
}

/** Two initials for a multi-word name; the first two letters for a single username. */
export function ochePlayerInitials(name: string): string {
  const words=name.trim().split(/\s+/).filter(Boolean);
  return (words.length>1 ? words.slice(0,2).map(word=>Array.from(word)[0]).join('') : Array.from(words[0]??'').slice(0,2).join('')).toUpperCase();
}
