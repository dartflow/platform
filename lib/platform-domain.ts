import { randomInt, randomUUID } from 'node:crypto';
import { DomainError, newGame, scoreGame, validateSettings } from './domain';
import type { Fixture, PlatformState } from './platform-types';
import type { Game } from './types';
import {advanceTournamentFixtures,doubleEliminationFixtures,swissRoundFixtures,swissRoundLimit} from './tournament-formats';
import {poolProof,poolStandings,tournamentFixtureReleased} from './tournament-pools';

export function roundRobin(players: string[], phase: 'pool' | 'league' = 'league', pool?: string): Fixture[] {
  if (players.length < 2 || new Set(players).size !== players.length || players.length > 128) throw new DomainError('invalid_players', 'Kies twee tot 128 unieke spelers.');
  const rotation: (string | null)[] = [...players];
  if (rotation.length % 2) rotation.push(null);
  const fixtures: Fixture[] = [];
  for (let round = 1; round < rotation.length; round++) {
    for (let index = 0; index < rotation.length / 2; index++) {
      const pair = [rotation[index], rotation[rotation.length - 1 - index]];
      if (pair.every(Boolean)) fixtures.push({ id: randomUUID(), players: pair, round, phase, ...(pool ? { pool } : {}), status: 'scheduled' });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  return fixtures;
}
export function knockout(players: string[],options:{seeded?:boolean;bronze?:boolean}={}): Fixture[] {
  if (players.length < 2 || players.length > 128 || new Set(players).size !== players.length) throw new DomainError('invalid_players', 'Kies twee tot 128 unieke spelers.');
  let size = 2;
  while (size < players.length) size *= 2;
  // Separate byes across pairs so every bye has one real participant.
  const slots: (string | null)[] = [];
  const byes = size - players.length;
  let cursor = 0;
  if(options.seeded){let seeds=[1,2];while(seeds.length<size){const n=seeds.length*2;seeds=seeds.flatMap(seed=>[seed,n+1-seed]);}slots.push(...seeds.map(seed=>players[seed-1]??null));}
  else for (let pair = 0; pair < size / 2; pair++) slots.push(players[cursor++], pair < byes ? null : players[cursor++]);
  const fixtures: Fixture[] = [];
  let sources: { fixtureId: string }[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const id = randomUUID(), pair = slots.slice(i, i + 2), bye = pair.includes(null);
    fixtures.push({ id, players: pair, round: 1, phase: 'knockout', status: bye ? 'bye' : 'scheduled', ...(bye ? { winnerId: pair.find(Boolean)! } : {}) });
    sources.push({ fixtureId: id });
  }
  let round = 2;
  while (sources.length > 1) {
    const next: { fixtureId: string }[] = [];
    for (let i = 0; i < sources.length; i += 2) {
      const id = randomUUID();
      fixtures.push({ id, players: [null, null], round, phase: 'knockout', status: 'scheduled', sources: sources.slice(i, i + 2) });
      next.push({ fixtureId: id });
    }
    sources = next; round++;
  }
  if(options.bronze&&size>=4){const semifinals=fixtures.filter(f=>f.round===round-2);fixtures.push({id:randomUUID(),phase:'knockout',round:round-1,purpose:'bronze',players:[null,null],status:'scheduled',sources:semifinals.map(f=>({fixtureId:f.id,outcome:'loser'}))});}
  advanceFixtures(fixtures);
  return fixtures;
}
export function standings(fixtures: Fixture[], players: string[]) {
  const rows = players.map(id => ({ id, played: 0, won: 0, drawn: 0, points: 0, legsFor: 0, legsAgainst: 0 }));
  for (const fixture of fixtures.filter(f => f.status === 'confirmed')) {
    fixture.players.forEach((id, i) => {
      const row = rows.find(r => r.id === id);
      if (!row) return;
      row.played++; row.legsFor += fixture.score?.[i] ?? 0; row.legsAgainst += fixture.score?.[1 - i] ?? 0;
      if (fixture.winnerId === id) { row.won++; row.points += 3; }
      if (fixture.winnerId === null) { row.drawn++; row.points++; }
    });
  }
  return rows.sort((a, b) => b.points - a.points || (b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst) || b.legsFor - a.legsFor || a.id.localeCompare(b.id));
}
export function advanceFixtures(fixtures: Fixture[]): void {
  advanceTournamentFixtures(fixtures);
  for (const fixture of fixtures) {
    if (!fixture.sources || fixture.matchId || fixture.sources.every(source=>source.fixtureId)) continue;
    fixture.players = fixture.sources.map(source => {
      if (source.fixtureId) return fixtures.find(f => f.id === source.fixtureId && ['confirmed', 'bye'].includes(f.status))?.winnerId ?? null;
      const pool = fixtures.filter(f => f.pool === source.pool && f.phase === 'pool');
      if(!tournamentFixtureReleased(fixture))return null;
      if (!pool.length || pool.some(f => f.status !== 'confirmed')) return null;
      const players = [...new Set(pool.flatMap(f => f.players).filter((p): p is string => p !== null))];
      if(source.resolvedPlayerId)return source.poolProof===poolProof(pool)?source.resolvedPlayerId:null;
      if(!source.criteria)return standings(pool,players)[(source.position??1)-1]?.id??null;
      const row=poolStandings(pool,players,source.criteria)[(source.position ?? 1) - 1];
      return row&&!row.shared?row.id:null;
    });
  }
  advanceTournamentFixtures(fixtures);
}
export function tournamentFixtures(players: string[], format: string, requestedPools = 2,options:{swissRounds?:number;seeded?:boolean;bronze?:boolean}={}): Fixture[] {
  if(format==='double-elimination-reset'||format==='double-elimination-single')return doubleEliminationFixtures(players,format==='double-elimination-reset');
  if(format==='swiss'){swissRoundLimit(players.length,options.swissRounds);return swissRoundFixtures(players,[],1);}
  if (format === 'knockout') return knockout(players,options);
  if (format === 'round-robin') return roundRobin(players);
  if (format !== 'pools-knockout') throw new DomainError('invalid_format', 'Kies round-robin, knockout of pools-knockout.');
  if (players.length < 2 || players.length > 128) throw new DomainError('invalid_players', 'Kies twee tot 128 spelers.');
  const count = [8, 4, 2, 1].find(n => n <= requestedPools && n * 2 <= players.length) ?? 1;
  const pools = Array.from({ length: count }, (_, i) => players.filter((_, index) => index % count === i));
  const fixtures = pools.flatMap((p, i) => roundRobin(p, 'pool', String.fromCharCode(65 + i)));
  let sources: { fixtureId?: string; pool?: string; position?: number }[] = [];
  if (count === 1) sources = [{ pool: 'A', position: 1 }, { pool: 'A', position: 2 }];
  else {const opposite:typeof sources=[];for (let i = 0; i < count; i += 2) {
    const a = String.fromCharCode(65 + i), b = String.fromCharCode(66 + i);
    sources.push({ pool: a, position: 1 }, { pool: b, position: 2 });opposite.push({ pool: b, position: 1 }, { pool: a, position: 2 });
  }sources.push(...opposite);}
  let round = 1;
  while (sources.length > 1) {
    const next: typeof sources = [];
    for (let i = 0; i < sources.length; i += 2) {
      const id = randomUUID();
      fixtures.push({ id, players: [null, null], round, phase: 'knockout', status: 'scheduled', sources: sources.slice(i, i + 2) });
      next.push({ fixtureId: id });
    }
    sources = next; round++;
  }
  if(options.bronze){const last=Math.max(...fixtures.filter(f=>f.phase==='knockout').map(f=>f.round)),semis=fixtures.filter(f=>f.phase==='knockout'&&f.round===last-1);if(semis.length===2)fixtures.push({id:randomUUID(),phase:'knockout',round:last,purpose:'bronze',players:[null,null],status:'scheduled',sources:semis.map(f=>({fixtureId:f.id,outcome:'loser'}))});}
  return fixtures;
}
export function newTraining(id: string, actor: string, input: Record<string, unknown>): PlatformState {
  if(input.focus!==undefined&&!['first9','checkout'].includes(String(input.focus)))throw new DomainError('invalid_focus','Kies First 9 of uitgooien.');
  const mode = input.mode === 'doubles' ? 'around' : input.mode === 'challenge' ? '170' : input.mode;
  if(input.focus==='first9'&&(mode!=='solo'||Number(input.startScore??501)!==501)||input.focus==='checkout'&&mode!=='170')throw new DomainError('invalid_focus','Deze instellingen horen niet bij de gekozen oefening.');
  if (!['solo', 'bot', 'around', '170'].includes(String(mode))) throw new DomainError('invalid_mode', 'Kies solo, Dartbot, doubles of de 170-challenge.');
  const settings = validateSettings({ ...input, startScore: Number(input.startScore ?? 501) as 301 | 501 | 701, bestOfLegs: mode === 'bot' ? Number(input.bestOfLegs ?? 3) : 1 });
  if((mode==='bot'||mode==='around'||mode==='170')&&(settings.discipline==='cricket'||settings.inRule==='double'||settings.outRule&&settings.outRule!=='double'||settings.sideStartScores))throw new DomainError('training_rules_unavailable','Gebruik voor deze optionele spelregels solo training of een partij met een andere speler.');
  const game = newGame(id, [actor, 'Dartbot'], settings);
  if (mode === '170') { game.startScore = 170; game.remaining = [170, 170]; }
  const botAverage = Number(input.botAverage ?? 50);
  if (!Number.isInteger(botAverage) || botAverage < 20 || botAverage > 120) throw new DomainError('invalid_bot', 'Kies een Dartbot-gemiddelde tussen 20 en 120.');
  return { name: input.focus==='first9'?'First 9':mode === 'bot' ? 'Dartbot' : mode === 'around' ? 'Doubles around the board' : mode === '170' ? '170-challenge' : settings.discipline==='cricket'?'Solo Cricket':`Solo ${settings.startScore}`, mode: mode as PlatformState['mode'], completed: false, game, rounds: [], undo: [], botAverage,...(input.focus?{focus:input.focus}:{}) };
}
function botVisit(game: Game, average: number): Game {
  const left = game.remaining[game.turn];
  if (left <= 170 && randomInt(100) < Math.min(80, average)) {
    for (let count = 1; count <= 3; count++) { try { return scoreGame(game, left, count, true); } catch { /* Try a legal finish. */ } }
  }
  const target = Math.max(0, Math.min(180, average + randomInt(-24, 25)));
  for (let score = target; score >= 0; score--) {
    try { return scoreGame(game, score, 3, false); } catch { /* Invalid scores or an unconfirmed finish become a lower legal visit. */ }
  }
  return scoreGame(game, 0, 3, false);
}
export function trainingAction(source: PlatformState, action: Record<string, unknown>): PlatformState {
  const state = structuredClone(source), type = String(action.type);
  if (type === 'training.finish') { state.completed = true; return state; }
  if (type === 'training.undo') {
    if (state.mode === 'around') { if (!state.rounds?.length) throw new DomainError('no_undo', 'Er is geen doel om terug te draaien.'); state.rounds.pop(); state.completed = false; return state; }
    if (!state.undo?.length) throw new DomainError('no_undo', 'Er is geen beurt om terug te draaien.');
    state.game = state.undo.pop(); state.completed = false; return state;
  }
  if (state.completed) throw new DomainError('training_finished', 'Deze training is afgerond.');
  if (state.mode === 'around') {
    const hits = Number(action.hits);
    if (!Number.isInteger(hits) || hits < 0 || hits > 3) throw new DomainError('invalid_hits', 'Kies nul tot drie rake darts.');
    state.rounds ??= []; state.rounds.push(hits); state.completed = state.rounds.length >= 21; return state;
  }
  const game = state.game!;
  if(typeof action.score!=='number')throw new DomainError('invalid_score','Geef een numerieke beurtscore op.');
  const count = Number(action.darts ?? 3);
  if (state.mode === '170' && game.stats[0].darts + count > 9) throw new DomainError('darts_exhausted', 'De 170-challenge heeft maximaal negen darts.');
  state.undo ??= []; state.undo.push(structuredClone(game));
  if (state.undo.length > 300) state.undo.shift();
  if (state.mode !== 'bot') game.turn = 0;
  state.game = scoreGame(game, Number(action.score), count, action.doubleConfirmed === true,action.doubleAttempts as number|null|undefined,action.dartHits as string[]|undefined,action.bust===true);
  if (state.mode === 'bot') {
    // The simulated opponent is server-side and remains part of training only.
    let guard = 0;
    while (state.game.status === 'live' && state.game.turn === 1 && guard++ < 2) state.game = botVisit(state.game, state.botAverage ?? 50);
  } else state.game.turn = 0;
  state.completed = state.game.status === 'finished' || (state.mode === '170' && state.game.stats[0].darts >= 9);
  if(state.focus==='first9'&&state.game.stats[0].darts>=9)state.completed=true;
  return state;
}
