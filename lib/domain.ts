import type { Game, MatchAction, MatchState, MatchView, Settings } from './types';

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const fail = (message: string, code = 'invalid_action', status = 400): never => { throw new DomainError(code, message, status); };
const clone = <T>(value: T): T => structuredClone(value);
const fields = Array.from({ length: 20 }, (_, index) => 20 - index);
const darts = [...fields.map(n => ({ score: n * 3, label: `T${n}` })), { score: 50, label: 'Bull' }, ...fields.map(n => ({ score: n * 2, label: `D${n}` })), { score: 25, label: '25' }, ...fields.map(n => ({ score: n, label: `${n}` })), { score: 0, label: 'Mis' }];
const doubles = [...fields.map(n => ({ score: n * 2, label: `D${n}` })), { score: 50, label: 'Bull' }];
const possible = [new Set([0])];
for (let count = 1; count <= 3; count++) possible.push(new Set([...possible[count - 1]].flatMap(a => darts.map(b => a + b.score))));
function finishRoute(score: number, count: number): string[] | null {
  if (score < 2 || score > 170 || count < 1 || count > 3) return null;
  if (count === 1) { const dart = doubles.find(d => d.score === score); return dart ? [dart.label] : null; }
  for (const dart of darts) { const route = finishRoute(score - dart.score, count - 1); if (route) return [dart.label, ...route]; }
  return null;
}
export function checkout(score: number): string | null {
  for (let count = 1; count <= 3; count++) { const route = finishRoute(score, count); if (route) return route.join(' · '); }
  return null;
}
export function validateSettings(input: Partial<Settings> = {}): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Ongeldige partijinstellingen.');
  const value: Settings = { startScore: input.startScore ?? 501, bestOfLegs: input.bestOfLegs ?? 3, bestOfSets: input.bestOfSets ?? 1, ...(input.legLimit !== undefined ? { legLimit: input.legLimit } : {}) };
  if (![301, 501, 701].includes(value.startScore) || ![1, 3, 5, 7, 9].includes(value.bestOfLegs) || ![1, 3, 5].includes(value.bestOfSets) || (value.legLimit !== undefined && (value.legLimit !== 8 || value.bestOfSets !== 1))) fail('Kies 301, 501 of 701 en een geldige best-of. Vaste acht legs ondersteunt één set.');
  return value;
}
export function newGame(id: string, players: string[], settings: Settings, starter = 0): Game {
  return { id, players, startScore: settings.startScore, bestOf: settings.bestOfLegs, ...(settings.legLimit ? { legLimit: settings.legLimit } : {}), legs: [0, 0], remaining: [settings.startScore, settings.startScore], turn: starter, legStarter: starter, status: 'live', visits: [], history: [], stats: [0, 1].map(() => ({ darts: 0, total: 0, oneEighties: 0, highestFinish: 0, legsWon: 0 })) };
}
export function scoreGame(source: Game, score: number, count = 3, doubleConfirmed = false): Game {
  if (source.status !== 'live') fail('Deze set is afgelopen.');
  if (!Number.isInteger(count) || count < 1 || count > 3 || !Number.isInteger(score) || score < 0 || score > 180 || !possible[count]?.has(score)) fail('Deze score is niet mogelijk met het gekozen aantal darts.');
  const player = source.turn, before = source.remaining[player], left = before - score;
  const bust = left < 0 || left === 1, legWon = left === 0;
  if (legWon && !finishRoute(score, count)) fail('Deze finish is niet mogelijk met dubbel uit.');
  if (legWon && !doubleConfirmed) fail('Bevestig de beslissende dubbel.', 'needs_double', 422);
  if (doubleConfirmed && !legWon) fail('De finish is gewijzigd. Controleer de actuele stand.');
  const next = clone(source);
  const { history, ...snapshot } = clone(source);
  void history;
  next.history.push(snapshot);
  next.stats[player].darts += count;
  next.stats[player].total += bust ? 0 : score;
  if (score === 180 && !bust) next.stats[player].oneEighties++;
  next.remaining[player] = bust ? before : left;
  next.visits.push({ player: source.players[player], playerIndex: player, score, darts: count, remainingBefore: before, remainingAfter: next.remaining[player], bust, leg: source.legs[0] + source.legs[1] + 1, checkout: legWon });
  if (!legWon) { next.turn = 1 - player; return next; }
  next.legs[player]++;
  next.stats[player].legsWon = (next.stats[player].legsWon ?? 0) + 1;
  next.stats[player].highestFinish = Math.max(next.stats[player].highestFinish, score);
  if (next.legLimit ? next.legs[0] + next.legs[1] >= next.legLimit : next.legs[player] >= Math.ceil(next.bestOf / 2)) {
    next.status = 'finished';
    next.winner = next.legLimit && next.legs[0] === next.legs[1] ? null : next.players[next.legs[0] > next.legs[1] ? 0 : 1];
    next.draw = next.winner === null;
  } else { next.remaining = [next.startScore, next.startScore]; next.turn = (next.legStarter + next.legs[0] + next.legs[1]) % 2; }
  return next;
}
export function setScore(match: MatchState): number[] {
  return [0, 1].map(index => [...match.previousSets, match.game].filter(game => game.status === 'finished' && game.winner === match.players[index].id).length);
}
export function applyMatchAction(source: MatchState, actorId: string, isOrganizer: boolean, action: MatchAction): MatchState {
  const next = clone(source), index = source.players.findIndex(p => p.id === actorId);
  const participant = () => { if (index < 0) fail('Alleen de toegewezen spelers kunnen dit doen.', 'forbidden', 403); };
  const manager = () => { if (!isOrganizer) fail('Alleen de wedstrijdleiding kan dit doen.', 'forbidden', 403); };
  switch (action.type) {
    case 'call': manager(); if (source.status !== 'planned' && source.status !== 'called') fail('Deze partij kan niet worden opgeroepen.'); next.boardId = action.boardId; next.status = 'called'; break;
    case 'accept': participant(); if (source.status !== 'called' && source.status !== 'ready') fail('Deze partij wacht niet op akkoord.'); next.accepted[index] = true; if (next.accepted.every(Boolean)) next.status = 'ready'; break;
    case 'start': if (!isOrganizer) participant(); if (source.status !== 'ready' || !source.accepted.every(Boolean)) fail('Beide spelers moeten eerst akkoord geven.'); next.status = 'live'; break;
    case 'take-over': participant(); if (source.status !== 'live') fail('Alleen tijdens een lopende partij.'); next.writerId = actorId; break;
    case 'score': participant(); if (source.status !== 'live' || source.writerId !== actorId) fail('Alleen de huidige schrijver mag scoren.', 'not_writer', 403);
      next.game = scoreGame(source.game, action.score, action.darts ?? 3, action.doubleConfirmed === true);
      if (next.game.status === 'finished') {
        const winner = setScore(next).findIndex(value => value >= Math.ceil(source.settings.bestOfSets / 2));
        if (winner >= 0 || source.settings.legLimit) { next.status = 'result'; next.winnerId = winner >= 0 ? next.players[winner].id : next.game.winner ?? null; next.resultRevision = source.revision + 1; }
        else { next.previousSets.push(next.game); next.game = newGame(next.id, next.players.map(p => p.id), next.settings, next.previousSets.length % 2); }
      }
      break;
    case 'undo': participant(); if (source.writerId !== actorId || !['live', 'result'].includes(source.status) || source.confirmations.some(Boolean) || source.resultPublished) fail('Alleen de schrijver kan een onbevestigde beurt terugdraaien.', 'forbidden', 403);
      if (!next.game.history.length && next.previousSets.length) next.game = next.previousSets.pop()!;
      if (!next.game.history.length) fail('Er is geen beurt om terug te draaien.');
      next.game = { ...clone(next.game.history.at(-1)!), history: clone(next.game.history.slice(0, -1)) };
      next.winnerId = null; next.resultRevision = null; next.status = 'live'; break;
    case 'confirm': participant(); if (source.status !== 'result' && source.status !== 'confirmed') fail('Er is geen uitslag om te bevestigen.'); next.confirmations[index] = true; if (next.confirmations.every(Boolean)) { next.status = 'confirmed'; next.resultPublished = true; } break;
    case 'dispute': participant(); if (source.status !== 'result' || source.resultPublished) fail('Deze uitslag kan niet meer worden betwist.'); if (typeof action.reason !== 'string' || !action.reason.trim()) fail('Vul een reden in.'); next.dispute = action.reason.trim().slice(0, 1000); next.status = 'disputed'; break;
    case 'resolve': manager(); if (source.status !== 'disputed' || typeof action.reason !== 'string' || !action.reason.trim() || !['resume', 'accept'].includes(action.decision)) fail('Kies een beslissing en motiveer deze.'); next.dispute = null; next.confirmations = [false, false]; next.status = 'result';
      if (action.decision === 'resume') { if (!next.game.history.length) fail('Er is geen laatste beurt om te herstellen.'); next.game = { ...clone(next.game.history.at(-1)!), history: clone(next.game.history.slice(0, -1)) }; next.status = 'live'; next.winnerId = null; next.resultRevision = null; } break;
    case 'release': manager(); if (source.status !== 'confirmed') fail('Beide spelers moeten eerst de uitslag bevestigen.'); next.boardId = null; break;
    case 'recover': manager(); if (!source.resultPublished || !source.confirmations.every(Boolean)) fail('Alleen een bevestigde uitslag kan worden herverwerkt.'); break;
    default: fail('Onbekende partijactie.');
  }
  next.revision++;
  return next;
}
export function matchView(match: MatchState, actorId: string, isOrganizer: boolean): MatchView {
  const { game, previousSets, ...base } = match;
  const participant = match.players.some(p => p.id === actorId), ownIndex = match.players.findIndex(p => p.id === actorId);
  return { ...base, remaining: game.remaining, legs: game.legs, sets: setScore(match), turn: game.turn, checkout: match.status === 'live' ? checkout(game.remaining[game.turn]) : null,
    visits: [...previousSets, game].flatMap(g => g.visits), stats: [0, 1].map(index => { const stats = [...previousSets, game].reduce((a, g) => ({ total: a.total + g.stats[index].total, darts: a.darts + g.stats[index].darts, oneEighties: a.oneEighties + g.stats[index].oneEighties, highestFinish: Math.max(a.highestFinish, g.stats[index].highestFinish) }), { total: 0, darts: 0, oneEighties: 0, highestFinish: 0 }); return { ...stats, average: stats.darts ? Math.round(stats.total * 30 / stats.darts) / 10 : 0 }; }),
    legNumber: game.legs[0] + game.legs[1] + (game.status === 'finished' ? 0 : 1), setNumber: previousSets.length + 1,
    permissions: { canManage: isOrganizer, canScore: participant && match.writerId === actorId && match.status === 'live', canAccept: participant && ['called', 'ready'].includes(match.status) && !match.accepted[ownIndex], canConfirm: participant && match.status === 'result' && !match.confirmations[ownIndex], canTakeOver: participant && match.status === 'live' && match.writerId !== actorId, canUndo: participant && match.writerId === actorId && ['live', 'result'].includes(match.status) && !match.confirmations.some(Boolean) && game.history.length + previousSets.length > 0 }
  };
}
