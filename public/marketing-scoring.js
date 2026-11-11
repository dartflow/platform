// Browser-local, immutable x01 scoring. A visit is committed only after validation.
const clone = value => JSON.parse(JSON.stringify(value));
const fields = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const scoringDarts = [
  ...fields.map(n => ({ score: n * 3, label: `T${n}` })),
  { score: 50, label: 'Bull' },
  ...fields.map(n => ({ score: n * 2, label: `D${n}` })),
  { score: 25, label: '25' },
  ...fields.map(n => ({ score: n, label: `${n}` })),
  { score: 0, label: 'Mis' },
];
const doubles = [...fields.map(n => ({ score: n * 2, label: `D${n}` })), { score: 50, label: 'Bull' }];
const possible = [new Set([0])];
for (let count = 1; count <= 3; count++) {
  const sums = new Set();
  for (const a of possible[count - 1]) for (const b of scoringDarts) sums.add(a + b.score);
  possible.push(sums);
}

function finishRoute(score, darts) {
  if (!Number.isInteger(score) || score < 2 || score > 170 || darts < 1 || darts > 3) return null;
  if (darts === 1) return doubles.find(d => d.score === score)?.label ? [doubles.find(d => d.score === score).label] : null;
  for (const first of scoringDarts) {
    const rest = score - first.score;
    if (rest < 2) continue;
    const route = finishRoute(rest, darts - 1);
    if (route) return [first.label, ...route];
  }
  return null;
}

export function checkout(score) {
  for (let darts = 1; darts <= 3; darts++) {
    const route = finishRoute(score, darts);
    if (route) return route.join(' · ');
  }
  return null;
}

export function createMatch({ id, players, startScore = 501, bestOf = 5, legLimit = null, mode = 'Op locatie', board = 1, legs = [0, 0], remaining, turn = 0 }) {
  if (!Array.isArray(players) || players.length !== 2) throw new Error('Een wedstrijd heeft twee spelers nodig.');
  if (!Number.isInteger(startScore) || startScore < 2) throw new Error('Ongeldige startscore.');
  const fixedLegs = legLimit !== null;
  if (fixedLegs && (!Number.isInteger(legLimit) || legLimit < 1)) throw new Error('Het vaste aantal legs moet een positief heel getal zijn.');
  if (!fixedLegs && (!Number.isInteger(bestOf) || bestOf < 1 || bestOf % 2 !== 1)) throw new Error('Best of moet een positief oneven getal zijn.');
  if (!Array.isArray(legs) || legs.length !== 2 || legs.some(n => !Number.isInteger(n) || n < 0)) throw new Error('Ongeldige legstand.');
  const playedLegs = legs[0] + legs[1];
  if (fixedLegs && playedLegs > legLimit) throw new Error('De legstand overschrijdt het vaste aantal legs.');
  if (![0, 1].includes(turn)) throw new Error('Ongeldige beurt.');
  const finished = fixedLegs && playedLegs === legLimit;
  const winner = finished ? (legs[0] === legs[1] ? null : players[legs[0] > legs[1] ? 0 : 1]) : undefined;
  return {
    id, players: [...players], startScore, bestOf, ...(fixedLegs ? { legLimit } : {}), mode, board,
    legs: [...legs], remaining: remaining ? [...remaining] : [startScore, startScore],
    turn, legStarter: (turn + playedLegs) % 2, status: finished ? 'finished' : 'live', history: [], visits: [],
    stats: legs.map(legsWon => ({ darts: 0, total: 0, oneEighties: 0, highestFinish: 0, legsWon })),
    ...(finished ? { winner, draw: winner === null } : {}),
  };
}

export function applyScore(match, score, { darts = 3, doubleConfirmed = false } = {}) {
  const fail = error => ({ match, error });
  if (match.status !== 'live') return fail('Deze wedstrijd is afgelopen.');
  if (!Number.isInteger(darts) || darts < 1 || darts > 3) return fail('Kies 1, 2 of 3 gegooide darts.');
  if (!Number.isInteger(score) || score < 0 || score > 180) return fail('Voer een heel getal van 0 t/m 180 in.');
  if (!possible[darts].has(score)) return fail(`Deze score is niet mogelijk met ${darts} dart${darts === 1 ? '' : 's'}.`);
  const player = match.turn;
  const before = match.remaining[player];
  const left = before - score;
  const bust = left < 0 || left === 1;
  const legWon = left === 0;
  if (legWon && !finishRoute(score, darts)) return fail('Deze finish is niet mogelijk met het gekozen aantal darts en dubbel uit.');
  if (legWon && !doubleConfirmed) return { match, needsDouble: true };

  const next = clone(match);
  const { history, ...snapshot } = clone(match);
  next.history = [...history, snapshot];
  next.stats[player].darts += darts;
  next.stats[player].total += bust ? 0 : score;
  if (score === 180 && !bust) next.stats[player].oneEighties += 1;
  next.remaining[player] = bust ? before : left;
  next.visits.push({
    player: next.players[player], playerIndex: player, score, darts,
    remainingBefore: before, remainingAfter: next.remaining[player], bust,
    leg: match.legs[0] + match.legs[1] + 1, checkout: legWon,
  });
  let winner;
  if (legWon) {
    next.legs[player] += 1;
    next.stats[player].legsWon += 1;
    next.stats[player].highestFinish = Math.max(next.stats[player].highestFinish, score);
    const fixedLegs = Number.isInteger(next.legLimit) && next.legLimit > 0;
    const matchFinished = fixedLegs
      ? next.legs[0] + next.legs[1] >= next.legLimit
      : next.legs[player] >= Math.floor(next.bestOf / 2) + 1;
    if (matchFinished) {
      next.status = 'finished';
      winner = fixedLegs
        ? (next.legs[0] === next.legs[1] ? null : next.players[next.legs[0] > next.legs[1] ? 0 : 1])
        : next.players[player];
      next.winner = winner;
      if (fixedLegs) next.draw = winner === null;
    } else {
      next.remaining = [next.startScore, next.startScore];
      // Alternate the opening player for each leg, including pre-seeded leg totals.
      next.turn = (next.legStarter + next.legs[0] + next.legs[1]) % 2;
    }
  } else next.turn = 1 - player;
  return { match: next, bust, legWon, ...(winner !== undefined ? { winner, ...(winner === null ? { draw: true } : {}) } : {}) };
}

export function undo(match) {
  if (!match.history?.length) return match;
  const previous = clone(match.history[match.history.length - 1]);
  return { ...previous, history: clone(match.history.slice(0, -1)) };
}
