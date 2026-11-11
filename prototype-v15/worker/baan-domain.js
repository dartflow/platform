import { applyScore, checkout, createMatch, undo } from '../public/scoring.js';

const allowedLegs = [1, 3, 5, 7, 9];
const allowedSets = [1, 3, 5];
const waitMs = 5 * 60_000;
const resultMs = 40_000;
const inactiveMs = 4 * 60 * 60_000;
const historyLimit = 30;
const undoLimit = 30;
const recentVisitLimit = 80;
const playerIndex = (match, actor) => actor ? match.players.findIndex(player => player.id === actor.id) : -1;
const clean = (value, limit) => Array.from(String(value ?? '').trim()).slice(0, limit).join('');
const isolated = id => /^demo-[a-z0-9]{12,32}$/.test(id);
const playerNameKey = value => clean(value, 48).normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
const scheduledScan = (state, match) => match.mode === 'scheduled' && match.scheduledOpponent && isolated(state.id);

export function createBoard(id) {
  const number = String(id).match(/(?:^|-)\d{1,2}(?=-|$)/)?.[0].replace('-', '') || '2';
  return { id, title: `Baan ${number}`, venue: 'Duindorp SV', status: 'idle', match: null, history: [] };
}

function resetBoard(state) {
  return { ...state, status: 'idle', match: null };
}

function currentBoard(state, now) {
  const match = state.match;
  if (!match) return state;
  const idleFor = now - match.updatedAt;
  if (state.status === 'waiting' && idleFor >= waitMs) return resetBoard(state);
  if (state.status === 'result' && idleFor >= (match.mode === 'scheduled' && !match.resultPublished ? waitMs : resultMs)) return resetBoard(state);
  if (state.status === 'live' && idleFor >= inactiveMs) return resetBoard(state);
  return state;
}

function matchSettings(values) {
  const settings = {
    startScore: Number(values.startScore ?? 501),
    bestOfLegs: Number(values.bestOfLegs ?? 3),
    bestOfSets: Number(values.bestOfSets ?? 1),
  };
  if (![301, 501, 701].includes(settings.startScore)
    || !allowedLegs.includes(settings.bestOfLegs)
    || !allowedSets.includes(settings.bestOfSets)) return null;
  return settings;
}

function newSet(match, starter = 0) {
  const ids = match.players.map(player => player.id);
  const players = ids.length === 1 ? [...ids, 'practice-unused'] : ids;
  return createMatch({
    id: match.id,
    players,
    startScore: match.settings.startScore,
    bestOf: match.settings.bestOfLegs,
    turn: starter,
  });
}

function createGame(state, actor, command, mode, now) {
  const settings = matchSettings(command.settings || command);
  if (!settings) return { state, error: 'Kies een geldig starttotaal en een oneven best-of voor sets en legs.' };
  const solo = mode === 'practice';
  const match = {
    id: clean(command.matchId ?? command.id, 100) || crypto.randomUUID(),
    mode,
    players: [{ id: actor.id, name: clean(actor.name, 48) }],
    writerId: actor.id,
    writerChangedAt: now,
    writerChanges: [],
    settings,
    inviteToken: mode === 'remote' || mode === 'scheduled'
      ? clean(command.inviteToken, 128) || crypto.randomUUID()
      : null,
    scheduledLabel: mode === 'scheduled' ? clean(command.label || command.name, 65) || 'Clubwedstrijd' : null,
    scheduledOpponent: mode === 'scheduled' ? clean(command.opponent, 48) : null,
    accepted: [true, false],
    confirmations: [false, false],
    game: null,
    previousSets: [],
    createdAt: now,
    updatedAt: now,
    startedAt: solo ? now : null,
    finishedAt: null,
    winnerId: null,
    resultPublished: false,
  };
  if (solo) match.game = newSet(match);
  const board = mode === 'scheduled' && isolated(state.id) ? {
    ...state,
    title: clean(command.boardTitle, 32) || state.title,
    venue: clean(command.venue, 60) || state.venue,
  } : state;
  return { state: { ...board, match, status: solo ? 'live' : 'waiting' }, message: solo ? 'Oefenpartij gestart.' : 'De baan wacht op je tegenstander.' };
}

function keepRecentVisits(game) {
  const { visits, ...snapshot } = game.history.at(-1);
  game.history[game.history.length - 1] = snapshot;
  game.history = game.history.slice(-undoLimit);
  game.visits = game.visits.slice(-recentVisitLimit);
}

function restorePreviousVisit(game) {
  const snapshot = game.history.at(-1);
  if (!snapshot.visits) snapshot.visits = game.visits.slice(0, -1);
  return undo(game);
}

function setScore(match) {
  return [0, 1].map(index => match.previousSets.filter(game => game.winner === game.players[index]).length
    + (match.game?.status === 'finished' && match.game.winner === match.game.players[index] ? 1 : 0));
}

function cumulativeStats(match) {
  const games = match.game ? [...match.previousSets, match.game] : [];
  return match.players.map((_, index) => {
    const totals = { total: 0, darts: 0, highestFinish: 0, oneEighties: 0 };
    for (const game of games) {
      const stats = game.stats[index];
      totals.total += stats.total;
      totals.darts += stats.darts;
      totals.highestFinish = Math.max(totals.highestFinish, stats.highestFinish);
      totals.oneEighties += stats.oneEighties;
    }
    return { ...totals, average: totals.darts ? Math.round(totals.total * 30 / totals.darts) / 10 : 0 };
  });
}

function summarize(match) {
  return {
    id: match.id,
    mode: match.mode,
    players: match.players,
    settings: match.settings,
    sets: setScore(match).slice(0, match.players.length),
    legs: match.game.legs.slice(0, match.players.length),
    stats: cumulativeStats(match),
    winnerId: match.winnerId,
    finishedAt: match.finishedAt,
    scheduledLabel: match.scheduledLabel,
    resultPublished: match.resultPublished,
  };
}

function recordResult(state, match) {
  state.history = [summarize(match), ...state.history.filter(result => result.id !== match.id)].slice(0, historyLimit);
}

function successful(state, message) {
  return { state, message };
}

export function applyBoard(source, actor, command, now = Date.now()) {
  const current = currentBoard(source, now);
  const invalid = error => ({ state: source, error });
  if (!actor?.id) return invalid('Meld je eerst aan voor deze actie.');
  if (command.type === 'start' || command.type === 'prepare') {
    if (current.status !== 'idle') return invalid('Op deze baan staat al een wedstrijd klaar.');
    const mode = command.type === 'prepare' ? 'scheduled' : command.mode;
    if (!['practice', 'local', 'remote', 'scheduled'].includes(mode)) return invalid('Kies een spelvorm.');
    return createGame(current, actor, command, mode, now);
  }
  const match = current.match;
  if (!match) return invalid('Op deze baan staat geen wedstrijd klaar.');
  if (command.matchId && command.matchId !== match.id) return invalid('Deze wedstrijd is inmiddels gewisseld.');
  const index = playerIndex(match, actor);
  const state = structuredClone(current);
  const next = state.match;
  switch (command.type) {
    case 'join': {
      if (index >= 0) return successful(source, 'Je bent al gekoppeld aan deze partij.');
      if (state.status !== 'waiting' || next.players.length >= 2) return invalid('Deze partij heeft geen vrije spelersplek.');
      if (next.scheduledOpponent && playerNameKey(next.scheduledOpponent) !== playerNameKey(actor.name)) {
        return invalid(`Deze partij staat klaar voor ${next.scheduledOpponent}.`);
      }
      if (next.inviteToken && !scheduledScan(state, next) && command.inviteToken !== next.inviteToken) {
        return invalid('Open de persoonlijke wedstrijdlink om mee te doen.');
      }
      next.players.push({ id: actor.id, name: clean(actor.name, 48) });
      next.updatedAt = now;
      return successful(state, 'Je bent gekoppeld. Bevestig de spelregels om te starten.');
    }
    case 'accept':
    case 'confirm': {
      if (index < 0) return invalid('Alleen deelnemers kunnen bevestigen.');
      if (state.status === 'result' && next.mode === 'scheduled') {
        if (next.confirmations[index]) return successful(source, 'Je hebt deze uitslag al bevestigd.');
        next.confirmations[index] = true;
        next.updatedAt = now;
        if (next.confirmations.every(Boolean)) {
          next.resultPublished = true;
          recordResult(state, next);
          return successful(state, 'Uitslag door beide spelers bevestigd.');
        }
        return successful(state, 'Jouw bevestiging is opgeslagen.');
      }
      if (state.status !== 'waiting' || command.type === 'confirm') return invalid('Deze partij wacht niet op een akkoord.');
      if (next.players.length < 2) return invalid('De tweede speler moet eerst deelnemen.');
      next.accepted[index] = true;
      next.updatedAt = now;
      if (next.accepted.every(Boolean)) {
        next.game = newSet(next);
        next.startedAt = now;
        state.status = 'live';
        return successful(state, 'Partij gestart. Speler 1 voert de scores in.');
      }
      return successful(state, 'Akkoord opgeslagen.');
    }
    case 'take-over': {
      if (state.status !== 'live' || index < 0) return invalid('Alleen deelnemers aan de lopende partij kunnen de invoer overnemen.');
      if (next.writerId === actor.id) return successful(source, 'Jij hebt de invoer al.');
      next.writerChanges.push({ from: next.writerId, to: actor.id, at: now });
      next.writerChanges = next.writerChanges.slice(-25);
      next.writerId = actor.id;
      next.writerChangedAt = now;
      next.updatedAt = now;
      return successful(state, 'Jij hebt de score-invoer overgenomen.');
    }
    case 'score': {
      if (state.status !== 'live' || index < 0 || next.writerId !== actor.id) return invalid('De actieve schrijver voert de score in.');
      const score = Number(command.score);
      const darts = Number(command.darts ?? 3);
      if (command.score === '' || command.score == null || !Number.isInteger(score) || ![1, 2, 3].includes(darts)) {
        return invalid('Vul een score en een geldig aantal darts in.');
      }
      const doubleConfirmed = command.doubleConfirmed === true;
      if (doubleConfirmed && score !== next.game.remaining[next.game.turn]) return invalid('De finish is gewijzigd. Controleer de actuele stand.');
      const scored = applyScore(next.game, score, { darts, doubleConfirmed });
      if (scored.needsDouble) return { state: source, needsDouble: true, message: 'Bevestig de beslissende dubbel.' };
      if (scored.error) return invalid(scored.error);
      next.game = scored.match;
      keepRecentVisits(next.game);
      next.updatedAt = now;
      if (next.game.status !== 'finished') {
        if (next.mode === 'practice') next.game.turn = 0;
        return successful(state, 'Beurt verwerkt.');
      }
      const scores = setScore(next);
      const winnerIndex = scores.findIndex(value => value >= Math.ceil(next.settings.bestOfSets / 2));
      if (winnerIndex >= 0) {
        next.winnerId = next.players[winnerIndex].id;
        next.finishedAt = now;
        next.resultPublished = next.mode !== 'scheduled';
        state.status = 'result';
        if (next.resultPublished) recordResult(state, next);
        return successful(state, 'Partij afgerond.');
      }
      next.previousSets.push(next.game);
      next.game = newSet(next, next.mode === 'practice' ? 0 : next.previousSets.length % 2);
      return successful(state, 'Set afgerond. De volgende set is begonnen.');
    }
    case 'undo': {
      const resultOpen = state.status === 'result' && !next.resultPublished && !next.confirmations.some(Boolean);
      if (index < 0 || next.writerId !== actor.id || (state.status !== 'live' && !resultOpen)) {
        return invalid('Alleen de actieve schrijver kan een onbevestigde beurt terugdraaien.');
      }
      if (!next.game.history.length && next.previousSets.length) next.game = next.previousSets.pop();
      if (!next.game.history.length) return invalid('Er is nog geen beurt om terug te draaien.');
      next.game = restorePreviousVisit(next.game);
      next.finishedAt = null;
      next.winnerId = null;
      next.resultPublished = false;
      next.updatedAt = now;
      state.status = 'live';
      state.history = state.history.filter(result => result.id !== next.id);
      return successful(state, 'Laatste beurt hersteld.');
    }
    case 'cancel': {
      if (index < 0 || (state.status !== 'waiting' && state.status !== 'live')) return invalid('Je kunt deze partij niet afbreken.');
      if (state.status === 'live' && next.writerId !== actor.id) return invalid('Vraag de actieve schrijver om de partij af te breken.');
      if (state.status === 'waiting' && index === 1) {
        next.players.pop();
        next.accepted[1] = false;
        next.updatedAt = now;
        return successful(state, 'Je hebt de wachtende partij verlaten.');
      }
      return successful(resetBoard(state), 'Partij afgebroken. De baan is weer vrij.');
    }
    case 'release': {
      if (state.status !== 'result' || index < 0) return invalid('Alleen deelnemers kunnen een afgeronde partij sluiten.');
      if (next.mode === 'scheduled' && !next.resultPublished) return invalid('Bevestig de uitslag eerst samen.');
      return successful(resetBoard(state), 'De baan is weer vrij.');
    }
    default:
      return invalid('Deze actie is niet beschikbaar.');
  }
}

export function boardView(source, actor, now = Date.now()) {
  const { id, title, venue, status, match } = currentBoard(source, now);
  const history = actor ? source.history.filter(result => result.players.some(player => player.id === actor.id)) : [];
  const officialResult = source.history.find(result => result.mode === 'scheduled' && result.resultPublished) || null;
  if (!match) return { id, title, venue, status, match: null, history, officialResult };
  const index = playerIndex(match, actor);
  const game = match.game;
  const turn = game?.turn ?? 0;
  const remaining = match.players.map((_, player) => game?.remaining[player] ?? match.settings.startScore);
  const visits = game ? [...match.previousSets, game].flatMap(set => set.visits).slice(-18) : [];
  const completedLegs = game ? game.legs[0] + game.legs[1] : 0;
  const legNumber = game?.status === 'finished' ? completedLegs : completedLegs + 1;
  const currentLegVisits = game?.visits.filter(visit => visit.leg === legNumber) || [];
  return {
    id, title, venue, status, history, officialResult,
    match: {
      id: match.id, mode: match.mode, status, players: match.players, writerId: match.writerId,
      writerChangedAt: match.writerChangedAt,
      settings: match.settings, remaining, legs: match.players.map((_, player) => game?.legs[player] ?? 0),
      sets: setScore(match).slice(0, match.players.length), turn,
      checkout: status === 'live' ? checkout(remaining[turn]) || null : null,
      stats: cumulativeStats(match), visits, lastVisit: visits.at(-1) || null,
      legNumber, setNumber: match.previousSets.length + 1, currentLegVisits,
      winnerId: match.winnerId, accepted: match.accepted, confirmations: match.confirmations,
      createdAt: match.createdAt, startedAt: match.startedAt, updatedAt: match.updatedAt, finishedAt: match.finishedAt,
      scheduledLabel: match.scheduledLabel, scheduledOpponent: match.scheduledOpponent,
      resultPublished: match.resultPublished, inviteRequired: Boolean(match.inviteToken && !scheduledScan(source, match)),
      ...(index === 0 && match.inviteToken && status === 'waiting' ? { inviteToken: match.inviteToken } : {}),
    },
  };
}
