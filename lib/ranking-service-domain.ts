import { DomainError } from './domain';
import type { Fixture } from './platform-types';
import type { RankingPolicy, RankingRule } from './ranking-service-types';
import type { Settings } from './types';

export const defaultRankingPolicy = (version: string, season = '2026-2027'): RankingPolicy => ({ version, discipline: 'x01', startScore: 501, bestOfLegs: [5, 7, 9, 11, 13, 15, 17, 19], initialRating: 1500, k: 32, placementMatches: 10, placementOpponents: 5, activeDays: 90, season, eventCount: 8, bestResults: 5, minimumStarters: 16, allowGuests: false });

export function parseRankingPolicy(input: unknown, version: string): RankingPolicy {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const result = defaultRankingPolicy(version);
  if(value.discipline!==undefined){if(!['x01','cricket'].includes(String(value.discipline)))throw new DomainError('invalid_ranking_policy','Kies X01 of een afzonderlijke Cricket-reeks.');result.discipline=value.discipline as RankingPolicy['discipline'];}
  if(value.cricketMode!==undefined){if(!['standard','no-score'].includes(String(value.cricketMode)))throw new DomainError('invalid_ranking_policy','Kies standaard Cricket of no score.');result.cricketMode=value.cricketMode as RankingPolicy['cricketMode'];}
  for (const [key, min, max] of [['k', 1, 128], ['placementMatches', 1, 100], ['placementOpponents', 1, 100], ['activeDays', 1, 730], ['eventCount', 1, 64], ['bestResults', 1, 64], ['minimumStarters', 2, 256]] as const) {
    if (value[key] === undefined) continue;
    const number = value[key];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) throw new DomainError('invalid_ranking_policy', `Kies een geldige waarde voor ${key}.`);
    result[key] = number;
  }
  if (value.startScore !== undefined) {
    if (![301, 501, 701].includes(Number(value.startScore))) throw new DomainError('invalid_ranking_policy', 'Kies 301, 501 of 701.');
    result.startScore = Number(value.startScore) as RankingPolicy['startScore'];
  }
  if (value.bestOfLegs !== undefined) {
    if (!Array.isArray(value.bestOfLegs) || !value.bestOfLegs.length || value.bestOfLegs.some(n => !Number.isInteger(n) || n < 1 || n > 19 || n % 2 !== 1)) throw new DomainError('invalid_ranking_policy', 'Kies geldige oneven best-of-profielen.');
    result.bestOfLegs = [...new Set(value.bestOfLegs as number[])].sort((a, b) => a - b);
  }
  if (value.season !== undefined) {
    if (typeof value.season !== 'string' || !value.season.trim() || value.season.length > 80) throw new DomainError('invalid_ranking_policy', 'Geef het circuitseizoen een naam.');
    result.season = value.season.trim();
  }
  if (value.allowGuests !== undefined) {
    if (typeof value.allowGuests !== 'boolean') throw new DomainError('invalid_ranking_policy', 'Kies het gastbeleid.');
    result.allowGuests = value.allowGuests;
  }
  if (result.bestResults > result.eventCount || result.placementOpponents > result.placementMatches) throw new DomainError('invalid_ranking_policy', 'Beste resultaten en unieke tegenstanders mogen het aangekondigde totaal niet overschrijden.');
  return result;
}

export function publishedRatingFormat(settings: Settings, policy: RankingPolicy): boolean {
  const rules = settings as Settings & { inRule?: string; outRule?: string; sideStartScores?: number[];discipline?:string;cricketMode?:string };
  if((rules.discipline??'x01')!==policy.discipline)return false;
  if(policy.discipline==='cricket')return settings.bestOfSets===1&&settings.legLimit===undefined&&policy.bestOfLegs.includes(settings.bestOfLegs)&&(rules.cricketMode??'standard')===(policy.cricketMode??'standard')&&!rules.sideStartScores;
  return settings.startScore === policy.startScore && settings.bestOfSets === 1 && settings.legLimit === undefined && policy.bestOfLegs.includes(settings.bestOfLegs) && rules.inRule!=='double' && (!rules.outRule || rules.outRule === 'double') && !rules.sideStartScores;
}

export function parseRankingRules(value: unknown): RankingRule[] {
  if (value === undefined) return [{ enabled: true }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 512) throw new DomainError('invalid_ranking_rules', 'Publiceer één of meer concrete bestemmingsregels.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.enabled !== 'boolean') throw new DomainError('invalid_ranking_rules', 'Een bestemmingsregel mist de toelating.');
    if (item.phase !== undefined && !['pool', 'knockout', 'league','winners','losers','final','reset','swiss'].includes(item.phase)) throw new DomainError('invalid_ranking_rules', 'Kies een herkenbare fase.');
    if (item.round !== undefined && (!Number.isSafeInteger(item.round) || item.round < 1)) throw new DomainError('invalid_ranking_rules', 'Kies een geldige ronde.');
    if (item.fixtureId !== undefined && (typeof item.fixtureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.fixtureId))) throw new DomainError('invalid_ranking_rules', 'Kies een geldig schemavak.');
    return { enabled: item.enabled, ...(item.phase ? { phase: item.phase } : {}), ...(item.round ? { round: item.round } : {}), ...(item.fixtureId ? { fixtureId: item.fixtureId } : {}) };
  });
}

export function effectiveRankingRule(rules: RankingRule[], fixture: Pick<Fixture, 'id' | 'phase' | 'round'>): boolean {
  const matched = rules.filter(rule => (!rule.phase || rule.phase === fixture.phase) && (!rule.round || rule.round === fixture.round) && (!rule.fixtureId || rule.fixtureId === fixture.id));
  if (!matched.length) return false;
  const specificity = (rule: RankingRule) => rule.fixtureId ? 3 : rule.round ? 2 : rule.phase ? 1 : 0;
  const highest = Math.max(...matched.map(specificity));
  const winners = matched.filter(rule => specificity(rule) === highest);
  if (winners.some(rule => rule.enabled !== winners[0].enabled)) throw new DomainError('ranking_rule_conflict', 'Gelijkwaardige bestemmingsregels spreken elkaar tegen. Los het conflict op vóór publicatie.', 409);
  return winners[0].enabled;
}

export function circuitPoints(starters: number, place: number, played: boolean, complete: boolean, disqualified: boolean, minimumStarters = 16): number {
  if (!Number.isInteger(starters) || !Number.isInteger(place) || place < 1 || starters < minimumStarters || !played || !complete || disqualified) return 0;
  const index = place === 1 ? 0 : place === 2 ? 1 : place <= 4 ? 2 : place <= 8 ? 3 : place <= 16 ? 4 : place <= 32 ? 5 : 6;
  return (starters >= 32 ? [15, 10, 7, 5, 3, 1, 0] : [10, 7, 5, 3, 1, 0, 0])[index];
}

/** Canonical main-bracket places use real entrants; byes do not manufacture losses. */
export function knockoutPlacements(fixtures: Fixture[]): { playerId: string; place: number }[] {
  if (!fixtures.length || fixtures.some(fixture => !['confirmed', 'bye'].includes(fixture.status))) throw new DomainError('ranking_event_incomplete', 'Rond alle partijen en bezwaren af vóór de circuiteindstand.', 409);
  const main = fixtures.filter(fixture => fixture.phase === 'knockout');
  if (!main.length) throw new DomainError('ranking_classification_required', 'Dit evenement heeft geen definitief hoofdknock-outschema voor circuitplaatsen.', 409);
  const players = new Set(main.flatMap(fixture => fixture.players.filter((id): id is string => id !== null)));
  const rounds = [...new Set(main.map(fixture => fixture.round))].sort((a, b) => a - b);
  const places: { playerId: string; place: number }[] = [];
  let eliminated = 0;
  for (const round of rounds) {
    const losers = main.filter(fixture => fixture.round === round && fixture.status === 'confirmed').map(fixture => {
      if (!fixture.winnerId || !fixture.players.includes(fixture.winnerId)) throw new DomainError('ranking_event_incomplete', 'Een knock-outpartij mist een definitieve winnaar.', 409);
      return fixture.players.find(id => id && id !== fixture.winnerId)!;
    });
    eliminated += losers.length;
    for (const playerId of losers) places.push({ playerId, place: players.size - eliminated + 1 });
  }
  const final = main.filter(fixture => fixture.round === rounds.at(-1));
  if (final.length !== 1 || !final[0].winnerId || eliminated !== players.size - 1) throw new DomainError('ranking_classification_required', 'Het hoofdknock-outschema levert nog geen eenduidige volledige eindstand.', 409);
  places.push({ playerId: final[0].winnerId, place: 1 });
  if (new Set(places.map(place => place.playerId)).size !== places.length) throw new DomainError('ranking_classification_required', 'Een deelnemer heeft meerdere eindplaatsen in het hoofdknock-outschema.', 409);
  return places;
}
