import { applyScore, createMatch, undo } from './scoring.js';

const ACTIVE = new Set(['called', 'playing']);
const UNRESOLVED = new Set(['pending', 'disputed']);
const DEFAULTS = {
  capacity: 12, eligibility: 'all', inviteCode: 'PUIN-OPEN', signupOpen: true,
  callSeconds: 120, restSeconds: 90, cooldownSeconds: 30, requireWriter: true,
  autoSchedule: false, bestOf: 5, startScore: 501, averageMinutes: 9, deadlineAt: null,
};
const NAMES = [
  'Rick van Dijk', 'Mike de Bruin', 'Jan Vermeer', 'Kevin Smit', 'Dennis Bakker',
  'Tom Visser', 'Sven Jansen', 'Peter de Vries', 'Danny Goldenbelt', 'Jeroen Peters',
  'Mark Bos', 'Robin Vos', 'Patrick Meijer', 'Stefan Mulder',
];
const findPlayer = (state, id) => state.players.find(player => player.id === Number(id));
const findBoard = (state, id) => state.boards.find(board => board.id === String(id));
const findMatch = (state, id) => state.matches.find(match => match.id === String(id));
const displayName = (state, id) => findPlayer(state, id)?.name || 'Onbekende speler';
const confirmedPlayers = state => state.players.filter(player => player.signup === 'confirmed');
const firstTo = bestOf => Math.floor(bestOf / 2) + 1;
const frozenTime = (state, now) => state.pausedAt ?? now;
const hasStarted = state => state.matches.some(match => match.status !== 'waiting');
const normalizedName = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function note(state, at, type, message, detail = {}) {
  state.sequence = (state.sequence || 0) + 1;
  state.log.unshift({ id: state.sequence, at, type, message, ...detail });
  state.log = state.log.slice(0, 160);
}

function newPlayer(id, name, clubIds, signup, now) {
  return {
    id, name, clubIds, signup, registeredAt: now, checkedIn: false, available: false,
    readyAt: null, restUntil: 0, holdUntil: 0, needsReady: false,
  };
}

function newMatch(id, phase, players, round, details = {}) {
  return {
    id, phase, players, round, poolId: null, status: 'waiting',
    boardId: null, lastBoardId: null, writerId: null, callUntil: null,
    accepted: [false, false], confirmations: [false, false], score: null,
    winnerId: null, game: null, history: [], calls: 0, ...details,
  };
}

function matchNote(state, match, at, type, message, detail = {}) {
  match.history.push({ at, type, message, ...detail });
  note(state, at, type, message, { matchId: match.id, ...detail });
}

function phaseName(count) {
  if (count === 1) return 'Finale';
  if (count === 2) return 'Halve finale';
  if (count === 4) return 'Kwartfinale';
  return 'Achtste finale';
}

function buildSchedule(state, requestedPools) {
  const players = confirmedPlayers(state);
  assert(players.length >= 2, 'Meld minimaal twee spelers aan om poules te maken.');
  const poolCount = [8, 4, 2, 1].find(count => count <= requestedPools && count * 2 <= players.length);
  state.poolCount = requestedPools;
  state.pools = Array.from({ length: poolCount }, (_, index) => {
    const id = String.fromCharCode(65 + index);
    return { id, name: `Poule ${id}`, playerIds: [] };
  });
  players.forEach((player, index) => state.pools[index % poolCount].playerIds.push(player.id));
  const matches = [];
  for (const pool of state.pools) {
    const rotation = [...pool.playerIds];
    if (rotation.length % 2) rotation.push(null);
    for (let round = 0; round < rotation.length - 1; round++) {
      for (let index = 0; index < rotation.length / 2; index++) {
        const pair = [rotation[index], rotation[rotation.length - 1 - index]];
        if (pair.every(Boolean)) {
          const [a, b] = [...pair].sort((left, right) => left - right);
          matches.push(newMatch(`P-${pool.id}-${a}-${b}`, 'pool', [a, b], round + 1, { poolId: pool.id, label: pool.name }));
        }
      }
      rotation.splice(1, 0, rotation.pop());
    }
  }
  const placements = [];
  if (state.pools.length === 1) {
    placements.push({ poolId: state.pools[0].id, position: 1 }, { poolId: state.pools[0].id, position: 2 });
  } else {
    for (let index = 0; index < state.pools.length; index += 2) {
      const a = state.pools[index].id;
      const b = state.pools[index + 1].id;
      placements.push({ poolId: a, position: 1 }, { poolId: b, position: 2 }, { poolId: b, position: 1 }, { poolId: a, position: 2 });
    }
  }
  let round = 1;
  let sources = placements;
  while (sources.length > 1) {
    const next = [];
    for (let index = 0; index < sources.length / 2; index++) {
      const id = `K-${round}-${index + 1}`;
      matches.push(newMatch(id, 'knockout', [null, null], round, {
        label: phaseName(sources.length / 2), sources: sources.slice(index * 2, index * 2 + 2),
      }));
      next.push({ matchId: id });
    }
    sources = next;
    round++;
  }
  state.matches = matches;
  for (const board of state.boards) {
    if (board.reservedForMatchId && !findMatch(state, board.reservedForMatchId)) {
      board.reservedForMatchId = null;
      board.reserved = false;
      board.reservationReason = '';
    }
  }
  state.stage = 'pools';
  state.championId = null;
}

export function createVenueEvent(options = {}, now = Date.now()) {
  const settings = { ...DEFAULTS, ...options.settings };
  return {
    id: options.id ?? 1, name: options.name || 'Puinruimers Open', clubId: Object.hasOwn(options, 'clubId') ? options.clubId : 701,
    stage: 'registration', pausedAt: null, championId: null, poolCount: 4, settings,
    players: [], pools: [], matches: [], sequence: 0, log: [], createdAt: now,
    boards: Array.from({ length: 4 }, (_, index) => ({
      id: `B${index + 1}`, name: `Bord ${index + 1}`, camera: index === 0,
      blocked: false, reserved: false, reservedForMatchId: null, reservationReason: '', matchId: null,
    })),
  };
}

export function venueBaanQuery(state, match, venue) {
  const room = match.realtimeRoom;
  return {
    scheduled: '1', name: `${state.name} · ${match.label || 'Toernooipartij'}`,
    first: room.players[0], opponent: room.players[1], startScore: String(room.startScore),
    bestOfLegs: String(room.bestOfLegs), boardTitle: findBoard(state, match.boardId)?.name || '', venue,
  };
}

export function createVenueDemo(now = Date.now()) {
  const state = createVenueEvent({ settings: { deadlineAt: now + 120 * 60_000 } }, now - 50 * 60_000);
  state.players = NAMES.map((name, index) => {
    const id = index + 1;
    const signup = index < state.settings.capacity ? 'confirmed' : 'waitlisted';
    const player = newPlayer(id, name, id <= 9 ? [701] : [703], signup, now - (30 - index) * 60_000);
    if (signup === 'confirmed' && id !== 11) {
      player.checkedIn = true;
      player.available = id !== 10;
      player.readyAt = now - (15 - index) * 60_000;
    }
    return player;
  });
  // Seed familiar pairs and a live finish without inventing throw statistics.
  const order = [1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9, 12];
  state.players.sort((a, b) => (order.indexOf(a.id) < 0 ? 99 + a.id : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 + b.id : order.indexOf(b.id)));
  buildSchedule(state, 4);
  state.players.sort((a, b) => a.id - b.id);
  const live = findMatch(state, 'P-A-1-2');
  const board = findBoard(state, 'B1');
  Object.assign(live, {
    status: 'playing', boardId: board.id, lastBoardId: board.id, writerId: 3,
    accepted: [true, true], startedAt: now - 8 * 60_000, calledAt: now - 9 * 60_000,
    game: createMatch({ id: live.id, players: live.players, bestOf: 5, remaining: [40, 44], legs: [2, 1], turn: 0 }),
  });
  board.matchId = live.id;
  const finished = findMatch(state, 'P-B-4-5');
  Object.assign(finished, {
    status: 'confirmed', score: [3, 1], winnerId: 4, confirmations: [true, true],
    startedAt: now - 22 * 60_000, finishedAt: now - 12 * 60_000,
    confirmedAt: now - 12 * 60_000, lastBoardId: 'B2', confirmedBy: 'players',
  });
  Object.assign(findBoard(state, 'B4'), { reserved: true, reservationReason: 'Gereserveerd voor de finale' });
  note(state, now - 12 * 60_000, 'confirmed', 'Poule B: Kevin wint met 3–1 van Dennis.', { matchId: finished.id });
  note(state, now - 8 * 60_000, 'started', 'Rick en Mike spelen op Bord 1. Jan schrijft.', { matchId: live.id, boardId: 'B1' });
  note(state, now, 'ready', 'Bord 2 en Bord 3 zijn vrij. Er staan partijen klaar voor de volgende oproep.');
  return state;
}

export function venueStandings(state, poolId) {
  const pool = state.pools.find(candidate => candidate.id === String(poolId));
  if (!pool) return [];
  const rows = pool.playerIds.map(id => ({
    id, playerId: id, name: displayName(state, id), played: 0, won: 0, drawn: 0, lost: 0,
    legsFor: 0, legsAgainst: 0, difference: 0, points: 0,
  }));
  for (const match of state.matches) {
    if (match.poolId !== pool.id || match.status !== 'confirmed' || !match.score) continue;
    for (let index = 0; index < 2; index++) {
      const row = rows.find(player => player.id === match.players[index]);
      if (!row) continue;
      const scored = match.score[index];
      const conceded = match.score[1 - index];
      row.played++;
      row.legsFor += scored;
      row.legsAgainst += conceded;
      row.difference = row.legsFor - row.legsAgainst;
      if (scored > conceded) { row.won++; row.points += 2; }
      else if (scored === conceded) { row.drawn++; row.points++; }
      else row.lost++;
    }
  }
  return rows
    .sort((a, b) => b.points - a.points || b.difference - a.difference || b.legsFor - a.legsFor || a.id - b.id)
    .map((row, index) => ({ ...row, position: index + 1 }));
}

function occupiedIds(state) {
  const ids = new Set();
  for (const match of state.matches) {
    if (!ACTIVE.has(match.status) && !UNRESOLVED.has(match.status)) continue;
    match.players.filter(Boolean).forEach(id => ids.add(id));
    if (ACTIVE.has(match.status) && match.writerId) ids.add(match.writerId);
  }
  return ids;
}

function unavailable(player, busy, now) {
  if (!player || player.signup !== 'confirmed') return 'staat niet op de deelnemerslijst';
  if (!player.checkedIn) return 'is nog niet ingecheckt';
  if (busy.has(player.id)) return 'speelt, schrijft of bevestigt nog een uitslag';
  if (player.holdUntil > now) return 'heeft nog afkoeltijd na een oproep';
  if (player.needsReady) return 'moet zich opnieuw gereed melden';
  if (player.restUntil > now) return 'heeft nog verplichte rust';
  if (!player.available) return 'is met pauze';
  return '';
}

export function venueEligible(state, matchOrId, now = Date.now(), options = {}) {
  const match = typeof matchOrId === 'object' ? matchOrId : findMatch(state, matchOrId);
  const no = reason => ({ eligible: false, reason, writerId: null, readySince: null });
  if (!match || match.status !== 'waiting') return no('Deze partij staat niet in de wachtrij.');
  if (match.players.some(id => !id) || match.players[0] === match.players[1]) return no('Wacht op de deelnemers uit de vorige ronde.');
  const busy = occupiedIds(state);
  const players = match.players.map(id => findPlayer(state, id));
  for (let index = 0; index < players.length; index++) {
    const reason = unavailable(players[index], busy, now);
    if (reason) return no(`${displayName(state, match.players[index])} ${reason}.`);
  }
  let writer = null;
  if (options.writerId) {
    writer = findPlayer(state, options.writerId);
    if (!writer || match.players.includes(writer.id)) return no('Kies een schrijver buiten deze partij.');
    const reason = unavailable(writer, busy, now);
    if (reason) return no(`${writer.name} ${reason}.`);
  } else if (state.settings.requireWriter) {
    writer = state.players.filter(player => !match.players.includes(player.id) && !unavailable(player, busy, now))
      .sort((a, b) => (a.lastWrittenAt || 0) - (b.lastWrittenAt || 0) || a.id - b.id)[0];
    if (!writer) return no('Er is geen schrijver beschikbaar.');
  }
  const readySince = Math.max(...players.map(player => Math.max(player.readyAt ?? now, player.restUntil || 0, player.holdUntil || 0)));
  return { eligible: true, reason: '', writerId: writer?.id ?? null, readySince };
}

function rankedReady(state, now) {
  const poolProgress = new Map(state.pools.map(pool => {
    const matches = state.matches.filter(match => match.poolId === pool.id);
    const finished = matches.filter(match => match.status === 'confirmed').length;
    const occupied = matches.filter(match => ACTIVE.has(match.status)).length;
    return [pool.id, matches.length ? (finished + occupied * 0.5) / matches.length : 0];
  }));
  return state.matches.map(match => ({ match, eligibility: venueEligible(state, match, now) }))
    .filter(entry => entry.eligibility.eligible)
    .sort((a, b) => {
      if (a.match.phase !== b.match.phase) return a.match.phase === 'pool' ? -1 : 1;
      return (poolProgress.get(a.match.poolId) || 0) - (poolProgress.get(b.match.poolId) || 0)
        || a.eligibility.readySince - b.eligibility.readySince
        || a.match.round - b.match.round || a.match.id.localeCompare(b.match.id);
    });
}

function reservedBoardFor(state, matchId) {
  return state.boards.find(board => board.reservedForMatchId === matchId);
}

function callMatch(state, match, board, writerId, now) {
  assert(state.pausedAt == null, 'De oproepen zijn gepauzeerd. Hervat de regie om een partij op te roepen.');
  assert(board && !board.blocked && !board.matchId, 'Dit bord is bezet of buiten gebruik.');
  assert(!board.reservedForMatchId || board.reservedForMatchId === match?.id, 'Dit bord is gereserveerd voor een andere partij.');
  const dedicatedBoard = reservedBoardFor(state, match?.id);
  assert(!dedicatedBoard || dedicatedBoard.id === board.id, `Deze partij is gereserveerd voor ${dedicatedBoard?.name}.`);
  const eligibility = venueEligible(state, match, now, { writerId });
  assert(eligibility.eligible, eligibility.reason);
  Object.assign(match, {
    status: 'called', boardId: board.id, lastBoardId: board.id, writerId: eligibility.writerId,
    calledAt: now, callUntil: now + state.settings.callSeconds * 1_000,
    accepted: [false, false], calls: (match.calls || 0) + 1,
  });
  board.matchId = match.id;
  const writerText = match.writerId ? ` ${displayName(state, match.writerId)} schrijft.` : '';
  matchNote(state, match, now, 'called', `${board.name}: ${match.players.map(id => displayName(state, id)).join(' tegen ')}.${writerText}`, { boardId: board.id, writerId: match.writerId });
}

function schedule(state, now) {
  const assigned = [];
  if (state.pausedAt != null) return assigned;
  for (const board of state.boards) {
    if (board.blocked || board.matchId || (board.reserved && !board.reservedForMatchId)) continue;
    const next = rankedReady(state, now).find(entry => {
      const reservedBoard = reservedBoardFor(state, entry.match.id);
      return (!board.reservedForMatchId || entry.match.id === board.reservedForMatchId)
        && (!reservedBoard || reservedBoard.id === board.id);
    });
    if (!next) continue;
    callMatch(state, next.match, board, next.eligibility.writerId, now);
    assigned.push({ matchId: next.match.id, boardId: board.id, writerId: next.match.writerId });
  }
  return assigned;
}

function releaseBoard(state, match, finished = false) {
  const board = findBoard(state, match.boardId);
  if (board?.matchId === match.id) board.matchId = null;
  const dedicatedBoard = finished ? reservedBoardFor(state, match.id) : null;
  if (dedicatedBoard) {
    dedicatedBoard.reserved = false;
    dedicatedBoard.reservedForMatchId = null;
    dedicatedBoard.reservationReason = '';
  }
  match.boardId = null;
  match.callUntil = null;
  match.writerId = null;
}

function requeue(state, match, now, message, absentId = null) {
  const missing = absentId == null ? match.players.filter((_, index) => !match.accepted[index]) : [absentId];
  for (const id of missing) {
    const player = findPlayer(state, id);
    player.available = false;
    player.needsReady = true;
    player.holdUntil = now + state.settings.cooldownSeconds * 1_000;
  }
  releaseBoard(state, match);
  match.status = 'waiting';
  match.accepted = [false, false];
  matchNote(state, match, now, 'requeued', message, { absentIds: missing });
}

function expireCalls(state, now) {
  if (state.pausedAt != null) return 0;
  let expired = 0;
  for (const match of state.matches) {
    if (match.status !== 'called' || match.callUntil > now) continue;
    requeue(state, match, now, 'Oproep verlopen. Bord vrijgegeven; afwezige spelers moeten zich opnieuw gereed melden.');
    expired++;
  }
  return expired;
}

function advance(state, now) {
  if (!state.pools.length || state.matches.some(match => match.phase === 'pool' && match.status !== 'confirmed')) return;
  if (state.stage === 'pools') {
    state.stage = 'knockout';
    note(state, now, 'stage', 'Alle pouleuitslagen zijn bevestigd. De knock-out is ingevuld.');
  }
  const knockout = state.matches.filter(match => match.phase === 'knockout');
  for (const match of knockout) {
    if (match.status !== 'waiting' || match.players.every(Boolean)) continue;
    if (match.sources.some(source => source.matchId && findMatch(state, source.matchId)?.status !== 'confirmed')) continue;
    match.players = match.sources.map(source => source.poolId
      ? venueStandings(state, source.poolId)[source.position - 1]?.id ?? null
      : findMatch(state, source.matchId)?.winnerId ?? null);
    if (!match.players.every(Boolean)) {
      Object.assign(match, { status: 'confirmed', winnerId: match.players.find(Boolean) || null, confirmedAt: now, bye: true });
    }
  }
  const final = knockout.at(-1);
  if (final?.status === 'confirmed' && state.stage !== 'finished') {
    state.stage = 'finished';
    state.championId = final.winnerId;
    note(state, now, 'champion', final.winnerId ? `${displayName(state, final.winnerId)} wint ${state.name}.` : `${state.name} is afgesloten.`);
  }
}

function finishOnBoard(state, match, score, now, resultSource) {
  const writer = findPlayer(state, match.writerId);
  if (writer) writer.lastWrittenAt = now;
  releaseBoard(state, match, true);
  for (const id of match.players) {
    const player = findPlayer(state, id);
    if (player) player.restUntil = Math.max(player.restUntil || 0, now + state.settings.restSeconds * 1_000);
  }
  Object.assign(match, {
    status: 'pending', score: [...score], winnerId: null, finishedAt: now,
    confirmations: [false, false], resultSource,
  });
  if (match.game) {
    match.game = { ...match.game, history: [] };
    if (resultSource !== 'scoring') {
      Object.assign(match.game, { status: 'finished', legs: [...score], winner: score[0] === score[1] ? null : match.players[score[0] > score[1] ? 0 : 1] });
    }
  }
  matchNote(state, match, now, 'pending', `Uitslag ${score.join('–')} ingevoerd. Het bord is vrij.`, { boardId: match.lastBoardId });
}

function confirmResult(state, match, now, confirmedBy) {
  match.status = 'confirmed';
  match.confirmedBy = confirmedBy;
  match.confirmedAt = now;
  match.winnerId = match.score[0] === match.score[1] ? null : match.players[match.score[0] > match.score[1] ? 0 : 1];
  matchNote(state, match, now, 'confirmed', `Uitslag ${match.score.join('–')} bevestigd${confirmedBy === 'organizer' ? ' door de organisator' : ''}.`);
  advance(state, now);
}

function validFinalScore(state, match, score) {
  assert(Array.isArray(score) && score.length === 2 && score.every(value => Number.isInteger(value) && value >= 0), 'Voer twee geldige legscores in.');
  const target = firstTo(match.game?.bestOf || match.bestOf || state.settings.bestOf);
  const fixed = match.game?.legLimit;
  if (fixed) assert(score[0] + score[1] === fixed, `De uitslag moet uit ${fixed} legs bestaan.`);
  else assert(Math.max(...score) === target && Math.min(...score) < target, `De winnaar moet precies ${target} legs hebben.`);
  assert(match.phase === 'pool' || score[0] !== score[1], 'Een knock-outpartij kan niet gelijk eindigen.');
  return score;
}

function eligibilityAllowed(state, clubIds, inviteCode) {
  if (state.settings.eligibility === 'club') return clubIds.includes(state.clubId);
  if (state.settings.eligibility === 'invite') return String(inviteCode ?? '').trim().toUpperCase() === state.settings.inviteCode.toUpperCase();
  return true;
}

function refreshPrepared(state) {
  if (state.stage !== 'pools' || hasStarted(state)) return;
  if (confirmedPlayers(state).length < 2) {
    state.stage = 'registration';
    state.pools = [];
    state.matches = [];
  } else buildSchedule(state, state.poolCount);
}

function promote(state, now) {
  if (hasStarted(state)) return 0;
  const queue = state.players.filter(player => player.signup === 'waitlisted').sort((a, b) => a.registeredAt - b.registeredAt || a.id - b.id);
  const slots = Math.max(0, state.settings.capacity - confirmedPlayers(state).length);
  queue.slice(0, slots).forEach(player => {
    player.signup = 'confirmed';
    note(state, now, 'promoted', `${player.name} is doorgeschoven vanaf de wachtlijst.`, { playerId: player.id });
  });
  return Math.min(queue.length, slots);
}

function applySettings(state, values, now) {
  const next = { ...state.settings };
  const limits = { capacity: [2, 64], callSeconds: [15, 600], restSeconds: [0, 1_200], cooldownSeconds: [0, 600], averageMinutes: [1, 120] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Object.hasOwn(values, key)) continue;
    const number = Number(values[key]);
    assert(Number.isInteger(number) && number >= min && number <= max, `${key} moet tussen ${min} en ${max} liggen.`);
    next[key] = number;
  }
  assert(next.capacity >= confirmedPlayers(state).length, 'De capaciteit kan niet lager zijn dan het aantal bevestigde deelnemers.');
  if (Object.hasOwn(values, 'eligibility')) {
    assert(['club', 'invite', 'all'].includes(values.eligibility), 'Kies een geldige inschrijftoegang.');
    assert(values.eligibility !== 'club' || state.clubId != null, 'Kies een clubomgeving voor een besloten clubevenement.');
    next.eligibility = values.eligibility;
  }
  if (Object.hasOwn(values, 'inviteCode')) next.inviteCode = String(values.inviteCode).trim().slice(0, 32);
  assert(next.eligibility !== 'invite' || next.inviteCode.length >= 3, 'Kies een uitnodigingscode van minstens drie tekens.');
  for (const key of ['signupOpen', 'requireWriter', 'autoSchedule']) {
    if (Object.hasOwn(values, key)) next[key] = Boolean(values[key]);
  }
  if (Object.hasOwn(values, 'bestOf')) {
    const bestOf = Number(values.bestOf);
    assert(Number.isInteger(bestOf) && bestOf >= 1 && bestOf <= 19 && bestOf % 2 === 1, 'Kies een oneven best-of tussen 1 en 19.');
    next.bestOf = bestOf;
  }
  if (Object.hasOwn(values, 'startScore')) {
    assert([301, 501, 701].includes(Number(values.startScore)), 'Kies 301, 501 of 701.');
    next.startScore = Number(values.startScore);
  }
  if (Object.hasOwn(values, 'deadlineAt')) {
    const deadline = typeof values.deadlineAt === 'number' ? values.deadlineAt : Date.parse(values.deadlineAt);
    assert(!values.deadlineAt || Number.isFinite(deadline), 'Voer een geldige geplande eindtijd in.');
    next.deadlineAt = values.deadlineAt ? deadline : null;
  }
  state.settings = next;
  if (promote(state, now)) refreshPrepared(state);
  note(state, now, 'settings', 'De zaalinstellingen zijn bijgewerkt.');
}

function signup(state, values, now) {
  assert(state.settings.signupOpen && state.stage !== 'finished', 'De inschrijving is gesloten.');
  const id = Number(values.id ?? values.playerId);
  assert(Number.isInteger(id) && id > 0, 'Kies een geldige speler.');
  const name = String(values.name ?? '').trim().slice(0, 75);
  assert(name.length >= 2, 'Voer een spelersnaam in.');
  const clubIds = Array.isArray(values.clubIds) ? [...new Set(values.clubIds.map(Number).filter(Number.isInteger))] : [];
  assert(eligibilityAllowed(state, clubIds, values.inviteCode), state.settings.eligibility === 'club' ? 'Deze inschrijving is voor leden van de organiserende club.' : 'De uitnodigingscode klopt niet.');
  const old = findPlayer(state, id);
  assert(!old || old.signup === 'withdrawn', 'Deze speler staat al op de deelnemerslijst of wachtlijst.');
  const confirmed = confirmedPlayers(state).length < state.settings.capacity && !hasStarted(state);
  const player = newPlayer(id, name, clubIds, confirmed ? 'confirmed' : 'waitlisted', now);
  if (old) Object.assign(old, player);
  else state.players.push(player);
  if (confirmed) refreshPrepared(state);
  const message = confirmed ? `${name} is ingeschreven.` : `${name} staat op de wachtlijst.`;
  note(state, now, 'signup', message, { playerId: id });
  return message;
}

function withdraw(state, player, now) {
  assert(player && player.signup !== 'withdrawn', 'Deze speler heeft geen actieve inschrijving.');
  assert(!state.matches.some(match => ACTIVE.has(match.status) && match.writerId === player.id), 'Deze speler schrijft nog op een bord.');
  const playerMatches = state.matches.filter(match => match.players.includes(player.id));
  assert(!playerMatches.some(match => match.status !== 'waiting'), 'Deze speler heeft al een oproep of uitslag. Handel de partij af via de zaalregie.');
  const vacated = player.signup === 'confirmed';
  Object.assign(player, { signup: 'withdrawn', checkedIn: false, available: false });
  note(state, now, 'withdrawn', `${player.name} is afgemeld.`, { playerId: player.id });
  if (!vacated) return `${player.name} is van de wachtlijst verwijderd.`;
  if (!hasStarted(state)) {
    promote(state, now);
    refreshPrepared(state);
    return `${player.name} is afgemeld. De wachtlijst is bijgewerkt.`;
  }
  const pool = state.pools.find(item => item.playerIds.includes(player.id));
  assert(state.stage === 'pools' && pool, 'Deze deelnemerslijst is vastgezet voor de knock-out.');
  const replacement = state.players.filter(item => item.signup === 'waitlisted')
    .sort((a, b) => a.registeredAt - b.registeredAt || a.id - b.id)[0];
  if (replacement) {
    replacement.signup = 'confirmed';
    pool.playerIds = pool.playerIds.map(id => id === player.id ? replacement.id : id);
    for (const match of playerMatches) match.players = match.players.map(id => id === player.id ? replacement.id : id);
    note(state, now, 'promoted', `${replacement.name} neemt de vrijgekomen plek in ${pool.name} over.`, { playerId: replacement.id });
  } else {
    pool.playerIds = pool.playerIds.filter(id => id !== player.id);
    state.matches = state.matches.filter(match => !match.players.includes(player.id));
    advance(state, now);
  }
  return `${player.name} is afgemeld. ${pool.name} is bijgewerkt.`;
}

function applyCommand(state, action, values, now) {
  const match = findMatch(state, values.matchId);
  const player = findPlayer(state, values.playerId ?? values.id);
  const board = findBoard(state, values.boardId);
  const ok = message => ({ message });
  if (match?.realtimeRoom && ['score', 'undo', 'finalize', 'dispute', 'forfeit'].includes(action)) {
    throw new Error('Deze partij wordt op de gekoppelde live baan geschreven.');
  }
  switch (action) {
    case 'settings':
      applySettings(state, values, now);
      return ok('Instellingen opgeslagen.');
    case 'prepare': {
      assert(!hasStarted(state), 'Het schema ligt vast zodra een wedstrijd is opgeroepen of gespeeld.');
      const requested = Number(values.poolCount ?? state.poolCount ?? 4);
      assert([1, 2, 4, 8].includes(requested), 'Kies 1, 2, 4 of 8 poules.');
      buildSchedule(state, requested);
      note(state, now, 'prepared', `${state.pools.length} poules ingedeeld met ${confirmedPlayers(state).length} spelers.`);
      return ok('De poules en het knock-outschema zijn klaargezet.');
    }
    case 'signup':
      return ok(signup(state, values, now));
    case 'withdraw':
      return ok(withdraw(state, player, now));
    case 'checkin':
      assert(player?.signup === 'confirmed', 'Alleen bevestigde deelnemers kunnen inchecken.');
      if (player.checkedIn) return ok(`${player.name} is al ingecheckt.`);
      Object.assign(player, { checkedIn: true, available: true, readyAt: now });
      note(state, now, 'checkin', `${player.name} is ingecheckt en beschikbaar.`, { playerId: player.id });
      return ok(`${player.name} is ingecheckt.`);
    case 'ready':
      assert(player?.signup === 'confirmed' && player.checkedIn, 'Check eerst in als bevestigde deelnemer.');
      assert(player.holdUntil <= now, 'Wacht tot de afkoeltijd na de gemiste oproep voorbij is.');
      if (!player.available || player.needsReady) {
        Object.assign(player, { available: true, readyAt: now, needsReady: false });
        note(state, now, 'ready', `${player.name} is weer beschikbaar.`, { playerId: player.id });
      }
      return ok(`${player.name} staat klaar voor de volgende partij.`);
    case 'break':
      assert(player?.signup === 'confirmed' && player.checkedIn, 'Check eerst in als bevestigde deelnemer.');
      assert(!state.matches.some(item => ACTIVE.has(item.status) && (item.players.includes(player.id) || item.writerId === player.id)), 'Rond de lopende oproep of bordtaak af voordat je pauzeert.');
      player.available = false;
      note(state, now, 'break', `${player.name} neemt pauze.`, { playerId: player.id });
      return ok(`${player.name} is met pauze.`);
    case 'board': {
      assert(board, 'Dit bord bestaat niet.');
      assert(!(values.blocked && board.matchId), 'Rond de lopende partij of oproep af voordat je dit bord blokkeert.');
      if (Object.hasOwn(values, 'blocked')) board.blocked = Boolean(values.blocked);
      if (Object.hasOwn(values, 'camera')) board.camera = Boolean(values.camera);
      if (Object.hasOwn(values, 'reserved')) board.reserved = Boolean(values.reserved);
      if (Object.hasOwn(values, 'reservationReason')) board.reservationReason = String(values.reservationReason).trim().slice(0, 120);
      if (Object.hasOwn(values, 'reservedForMatchId')) {
        const reserved = values.reservedForMatchId ? findMatch(state, values.reservedForMatchId) : null;
        assert(!values.reservedForMatchId || (reserved && ['waiting', 'called', 'playing'].includes(reserved.status)), 'Kies een nog openstaande partij voor de reservering.');
        const otherBoard = reserved ? reservedBoardFor(state, reserved.id) : null;
        assert(!otherBoard || otherBoard.id === board.id, 'Deze partij heeft al een gereserveerd bord.');
        assert(!reserved?.boardId || reserved.boardId === board.id, 'Deze partij is al op een ander bord opgeroepen.');
        board.reservedForMatchId = reserved?.id ?? null;
        if (reserved) board.reserved = true;
      }
      if (!board.reserved) { board.reservedForMatchId = null; board.reservationReason = ''; }
      note(state, now, 'board', `${board.name} bijgewerkt${board.blocked ? ' en buiten gebruik gezet' : board.reserved ? ' en gereserveerd' : ''}.`, { boardId: board.id });
      return ok(`${board.name} bijgewerkt.`);
    }
    case 'auto':
      state.settings.autoSchedule = Boolean(values.enabled);
      note(state, now, 'auto', `Automatische bordregie ${state.settings.autoSchedule ? 'ingeschakeld' : 'uitgeschakeld'}.`);
      return ok(`Automatische bordregie ${state.settings.autoSchedule ? 'aan' : 'uit'}.`);
    case 'pause-calls': {
      if (values.paused && state.pausedAt == null) {
        state.pausedAt = now;
        note(state, now, 'pause', 'Oproepen gepauzeerd. Lopende wedstrijden blijven speelbaar.');
      } else if (!values.paused && state.pausedAt != null) {
        const elapsed = Math.max(0, now - state.pausedAt);
        for (const item of state.matches) if (item.status === 'called') item.callUntil += elapsed;
        state.pausedAt = null;
        note(state, now, 'resume', 'Oproepen hervat met de resterende bevestigingstijd.');
      }
      return ok(state.pausedAt == null ? 'Oproepen hervat.' : 'Oproepen gepauzeerd.');
    }
    case 'assign':
      assert(match, 'Deze partij bestaat niet.');
      callMatch(state, match, board, values.writerId, now);
      return { message: `Partij opgeroepen op ${board.name}.`, assigned: [{ matchId: match.id, boardId: board.id, writerId: match.writerId }] };
    case 'link-baan': {
      assert(match && ['called', 'playing'].includes(match.status) && findBoard(state, match.boardId)?.matchId === match.id, 'Roep de partij eerst op bij een bord.');
      if (match.realtimeRoom?.id === values.roomId) return ok('De live baan is al gekoppeld.');
      assert(!match.realtimeRoom, 'Deze partij heeft al een live baan.');
      assert(!(match.game?.visits?.length || match.game?.legs?.some(Boolean)), 'Koppel de live baan vóór de eerste beurt.');
      assert(/^demo-[a-z0-9]{12,32}$/.test(values.roomId || ''), 'De live baan is ongeldig.');
      const startScore = match.game?.startScore || state.settings.startScore;
      const bestOfLegs = match.game?.bestOf || match.bestOf || state.settings.bestOf;
      const players = match.players.map(id => Array.from(displayName(state, id).normalize('NFKC').trim().replace(/\s+/g, ' ')).slice(0, 32).join(''));
      assert(normalizedName(players[0]) !== normalizedName(players[1]), 'De twee spelers hebben verschillende schermnamen nodig.');
      assert([301, 501, 701].includes(startScore) && [1, 3, 5, 7, 9].includes(bestOfLegs), 'Kies 301, 501 of 701 en een best-of-format tot en met 9 legs voor de live baan.');
      match.realtimeRoom = { id: values.roomId, players, startScore, bestOfLegs };
      Object.assign(match, { status: 'playing', startedAt: match.startedAt ?? now, callUntil: null, writerId: null });
      match.game ??= createMatch({ id: match.id, players: match.players, startScore, bestOf: bestOfLegs, board: Number(match.boardId.slice(1)) });
      matchNote(state, match, now, 'baan-linked', 'Live baan gekoppeld. De twee spelers schrijven op hun eigen telefoons.', { roomId: values.roomId });
      return ok('Live baan gekoppeld. Open het 9:16-scherm voor de spelers.');
    }
    case 'unlink-baan': {
      assert(match?.realtimeRoom, 'Deze partij heeft geen live baan.');
      const roomId = match.realtimeRoom.id;
      releaseBoard(state, match);
      delete match.realtimeRoom;
      Object.assign(match, { status: 'waiting', accepted: [false, false], startedAt: null, game: null });
      matchNote(state, match, now, 'baan-unlinked', 'Live baan losgekoppeld. De partij staat opnieuw in de wachtrij.', { roomId });
      return ok('Live baan losgekoppeld. De partij kan opnieuw worden opgeroepen.');
    }
    case 'import-baan': {
      const result = values.result;
      if (match?.realtimeResult?.roomId === values.roomId && match.realtimeResult.matchId === result?.id) {
        return ok('Deze live uitslag is al verwerkt.');
      }
      const room = match?.realtimeRoom;
      assert(room && room.id === values.roomId && match.status === 'playing', 'Deze live uitslag hoort niet bij de actieve partij.');
      assert(result?.id && result.mode === 'scheduled' && result.resultPublished === true, 'Wacht tot beide spelers de uitslag op hun telefoon hebben bevestigd.');
      assert(result.players?.length === 2 && room.players.every((name, index) => normalizedName(name) === normalizedName(result.players[index]?.name)), 'De namen op de live baan komen niet overeen met deze partij.');
      const settings = result.settings;
      assert(settings?.startScore === room.startScore && settings.bestOfLegs === room.bestOfLegs && settings.bestOfSets === 1, 'De spelregels op de live baan komen niet overeen met deze partij.');
      const score = validFinalScore(state, match, result.legs);
      assert(result.winnerId === result.players[score[0] > score[1] ? 0 : 1]?.id, 'De winnaar op de live baan komt niet overeen met de legstand.');
      finishOnBoard(state, match, score, now, 'baanmodus');
      match.confirmations = [true, true];
      match.realtimeResult = { roomId: room.id, matchId: result.id };
      delete match.realtimeRoom;
      confirmResult(state, match, now, 'baanmodus');
      return ok('Live uitslag bevestigd en verwerkt in de stand.');
    }
    case 'accept': {
      assert(match?.status === 'called', 'Er is geen actieve oproep voor deze partij.');
      const index = match.players.indexOf(player?.id);
      assert(index >= 0, 'Alleen de twee opgeroepen spelers kunnen bevestigen.');
      assert(match.callUntil > frozenTime(state, now), 'Deze oproep is verlopen. Meld je opnieuw gereed.');
      if (!match.accepted[index]) {
        match.accepted[index] = true;
        matchNote(state, match, now, 'accepted', `${player.name} bevestigt de oproep.`, { playerId: player.id, boardId: match.boardId });
      }
      if (!match.accepted.every(Boolean)) return ok('Oproep bevestigd. Wacht op de andere speler.');
      const occupiedBoard = findBoard(state, match.boardId);
      assert(occupiedBoard?.matchId === match.id, 'De partij heeft geen geldig bord meer.');
      match.status = 'playing';
      match.startedAt = now;
      match.callUntil = null;
      match.game = createMatch({ id: match.id, players: match.players, startScore: state.settings.startScore, bestOf: match.bestOf || state.settings.bestOf, board: Number(occupiedBoard.id.slice(1)) });
      matchNote(state, match, now, 'started', `De partij is gestart op ${occupiedBoard.name}.`, { boardId: occupiedBoard.id });
      return ok('Beide spelers zijn aanwezig. De partij is gestart.');
    }
    case 'cancel-call': {
      assert(match?.status === 'called', 'Er is geen oproep om terug te zetten.');
      assert(values.playerId == null || match.players.includes(player?.id), 'Kies een speler uit deze partij.');
      requeue(state, match, now, 'Oproep ingetrokken. Het bord is vrijgegeven.', player?.id ?? null);
      return ok('Partij terug in de wachtrij.');
    }
    case 'score': {
      assert(match?.status === 'playing' && match.game, 'Deze partij is nog niet gestart of al afgerond.');
      assert(values.score !== '' && values.score != null, 'Voer een score in.');
      const result = applyScore(match.game, Number(values.score), { darts: Number(values.darts ?? 3), doubleConfirmed: Boolean(values.doubleConfirmed) });
      assert(!result.error, result.error);
      if (result.needsDouble) return { needsDouble: true, message: 'Bevestig dat de laatste dart een dubbel was.' };
      match.game = result.match;
      if (match.game.status === 'finished') {
        finishOnBoard(state, match, match.game.legs, now, 'scoring');
        return ok('Partij afgelopen. Beide spelers kunnen de uitslag bevestigen.');
      }
      return ok(result.bust ? 'Bust. De vorige score blijft staan.' : result.legWon ? 'Leg gewonnen.' : 'Score opgeslagen.');
    }
    case 'undo':
      assert(match?.status === 'playing' && match.game?.history?.length, 'Er is geen speelbeurt om terug te draaien.');
      match.game = undo(match.game);
      matchNote(state, match, now, 'undo', 'De laatste beurt is teruggedraaid.');
      return ok('Laatste beurt teruggedraaid.');
    case 'finalize':
      assert(match?.status === 'playing', 'Alleen een lopende partij kan worden afgerond.');
      finishOnBoard(state, match, validFinalScore(state, match, values.score), now, 'manual');
      return ok('Uitslag ingevoerd. Het bord is vrij en beide spelers kunnen bevestigen.');
    case 'confirm': {
      assert(match && match.players.includes(player?.id), 'Alleen deelnemers aan deze partij kunnen de uitslag bevestigen.');
      if (match.status === 'confirmed') return ok('Deze uitslag is al bevestigd.');
      assert(match.status === 'pending' && match.score, 'Deze uitslag wacht niet op spelersbevestiging.');
      const index = match.players.indexOf(player.id);
      if (!match.confirmations[index]) {
        match.confirmations[index] = true;
        matchNote(state, match, now, 'confirmation', `${player.name} bevestigt ${match.score.join('–')}.`, { playerId: player.id });
      }
      if (match.confirmations.every(Boolean)) {
        confirmResult(state, match, now, 'players');
        return ok('Uitslag bevestigd en verwerkt in de stand.');
      }
      return ok('Bevestiging opgeslagen. Wacht op de andere speler.');
    }
    case 'dispute': {
      assert(match && ['playing', 'pending'].includes(match.status), 'Deze partij kan niet meer worden betwist.');
      assert(values.playerId == null || match.players.includes(player?.id), 'Alleen een deelnemer kan deze partij betwisten.');
      const reason = String(values.reason ?? '').trim().slice(0, 400);
      assert(reason.length >= 3, 'Beschrijf kort waarom de uitslag wordt betwist.');
      if (match.status === 'playing') finishOnBoard(state, match, match.game?.legs || [0, 0], now, 'dispute');
      match.status = 'disputed';
      match.dispute = { reason, at: now, playerId: player?.id ?? null };
      matchNote(state, match, now, 'disputed', 'Uitslag betwist. De organisator behandelt deze partij.', { reason });
      return ok('Geschil aangemaakt. Het bord blijft beschikbaar.');
    }
    case 'resolve': {
      assert(match && UNRESOLVED.has(match.status), 'Deze partij wacht niet op een beslissing.');
      match.score = [...validFinalScore(state, match, values.score)];
      if (match.game) match.game = { ...match.game, status: 'finished', legs: [...match.score], winner: match.score[0] === match.score[1] ? null : match.players[match.score[0] > match.score[1] ? 0 : 1] };
      match.resolution = { at: now, reason: String(values.reason || 'Uitslag gecontroleerd').trim().slice(0, 400) };
      confirmResult(state, match, now, 'organizer');
      return ok('De organisator heeft de uitslag vastgesteld.');
    }
    case 'forfeit': {
      assert(match && ['waiting', 'called', 'playing'].includes(match.status) && match.players.every(Boolean), 'Deze partij is niet beschikbaar voor een no-showbeslissing.');
      const index = match.players.indexOf(player?.id);
      assert(index >= 0, 'Kies de afwezige deelnemer.');
      const reason = String(values.reason || 'Afwezig bij partij').trim().slice(0, 400);
      const target = match.game?.legLimit || firstTo(match.game?.bestOf || match.bestOf || state.settings.bestOf);
      finishOnBoard(state, match, index === 0 ? [0, target] : [target, 0], now, 'forfeit');
      match.resolution = { at: now, reason, absentPlayerId: player.id };
      confirmResult(state, match, now, 'organizer');
      return ok('No-showbeslissing vastgelegd en uitslag verwerkt.');
    }
    default:
      throw new Error('Onbekende zaalactie.');
  }
}

export function venueAction(original, action, values = {}, now = Date.now()) {
  try {
    assert(original && typeof original === 'object', 'Open eerst een zaaltoernooi.');
    if (action === 'new-event') {
      const name = String(values.name ?? '').trim().slice(0, 80);
      assert(name.length >= 2, 'Voer een toernooinaam in.');
      const state = createVenueEvent({ id: values.id ?? original.id, name, clubId: Object.hasOwn(values, 'clubId') ? values.clubId : original.clubId }, now);
      applySettings(state, values.settings || values, now);
      return { state, message: `${name} staat open voor inschrijving.` };
    }
    const state = structuredClone(original);
    const expired = expireCalls(state, now);
    if (action === 'tick' || action === 'schedule') {
      const assigned = action === 'schedule' || state.settings.autoSchedule ? schedule(state, now) : [];
      if (!expired && !assigned.length) return { state: original, assigned, message: action === 'schedule' ? 'Er staat geen nieuwe partij klaar voor een vrij bord.' : undefined };
      return { state, assigned, message: assigned.length ? `${assigned.length} ${assigned.length === 1 ? 'partij opgeroepen' : 'partijen opgeroepen'}.` : 'Verlopen oproepen zijn teruggezet.' };
    }
    const result = applyCommand(state, action, values, now);
    if (result.needsDouble) return { state: original, ...result };
    const additional = state.settings.autoSchedule ? schedule(state, now) : [];
    return { state, ...result, assigned: [...(result.assigned || []), ...additional] };
  } catch (error) {
    return { state: original, error: error.message || 'De zaalactie is niet gelukt.' };
  }
}

export function venueSnapshot(state, now = Date.now()) {
  const boards = state.boards.map(board => {
    const match = findMatch(state, board.matchId) || null;
    const status = match?.status || (board.blocked ? 'blocked' : board.reserved ? 'reserved' : 'free');
    return { ...board, match, status, secondsRemaining: match?.status === 'called' ? Math.max(0, Math.ceil((match.callUntil - frozenTime(state, now)) / 1_000)) : null };
  });
  const readyMatches = rankedReady(state, now).map(({ match, eligibility }) => ({ ...match, writerId: eligibility.writerId, readySince: eligibility.readySince }));
  const busy = occupiedIds(state);
  const counts = {
    registered: confirmedPlayers(state).length,
    waitlisted: state.players.filter(player => player.signup === 'waitlisted').length,
    checkedIn: state.players.filter(player => player.checkedIn && player.signup === 'confirmed').length,
    available: state.players.filter(player => !unavailable(player, busy, now)).length,
    ready: readyMatches.length,
    readyMatches: readyMatches.length,
    freeBoards: boards.filter(board => board.status === 'free').length,
    reservedBoards: boards.filter(board => board.status === 'reserved').length,
    called: state.matches.filter(match => match.status === 'called').length,
    playing: state.matches.filter(match => match.status === 'playing').length,
    pending: state.matches.filter(match => match.status === 'pending').length,
    disputed: state.matches.filter(match => match.status === 'disputed').length,
    finished: state.matches.filter(match => match.status === 'confirmed').length,
    totalMatches: state.matches.length,
  };
  counts.confirmed = counts.finished;
  const realDurations = state.matches.filter(match => match.startedAt != null && match.finishedAt > match.startedAt && match.status === 'confirmed').map(match => (match.finishedAt - match.startedAt) / 60_000).sort((a, b) => a - b);
  const minutes = realDurations.length ? realDurations[Math.floor(realDurations.length / 2)] : state.settings.averageMinutes;
  const working = boards.filter(board => !board.blocked && (!board.reserved || board.match)).length;
  const poolWork = state.matches.filter(match => match.phase === 'pool' && !['confirmed', 'pending', 'disputed'].includes(match.status)).length;
  const knockoutWork = state.matches.filter(match => match.phase === 'knockout' && !['confirmed', 'pending', 'disputed'].includes(match.status));
  const rounds = new Set(knockoutWork.map(match => match.round)).size;
  const estimateMinutes = working ? Math.ceil((poolWork / working + Math.max(knockoutWork.length / working, rounds)) * minutes) : null;
  const finishEstimateAt = state.stage === 'finished' ? state.matches.at(-1)?.confirmedAt ?? now : state.stage === 'registration' || estimateMinutes == null ? null : now + estimateMinutes * 60_000;
  let warning = '';
  if (state.pausedAt != null) warning = 'Oproepen zijn gepauzeerd.';
  else if (!working && state.stage !== 'finished') warning = 'Geen bruikbare borden voor automatische bordregie.';
  else if (counts.disputed) warning = `${counts.disputed} betwiste ${counts.disputed === 1 ? 'uitslag wacht' : 'uitslagen wachten'} op de organisator.`;
  else if (state.settings.deadlineAt && finishEstimateAt > state.settings.deadlineAt) warning = `Verwachte uitloop van ${Math.ceil((finishEstimateAt - state.settings.deadlineAt) / 60_000)} minuten.`;
  return { boards, readyMatches, counts, averageMinutes: minutes, estimateMinutes, finishEstimateAt, warning, paused: state.pausedAt != null };
}
