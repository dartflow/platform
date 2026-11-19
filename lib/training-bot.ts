import type {Game} from './types';
import {dartValue, evaluateX01Visit} from './x01-rules';
import {finishRoutes} from './play-rules';

/** The simulated opponent commits actual legal darts, not a fabricated visit total. */
export function generateBotDartHits(game: Game, average: number, roll: (maximum: number) => number): string[] {
  const remaining = game.remaining[game.turn], opened = game.opened?.[game.turn] ?? game.inRule !== 'double';
  if (opened && remaining <= 170 && roll(100) < Math.min(80, average)) {
    const finish = finishRoutes(remaining, 3, game.outRule ?? 'double', 1)[0];
    if (finish) return finish;
  }
  const target = Math.max(0, Math.min(180, average + roll(49) - 24)), hits: string[] = [];
  const options = ['MISS', ...Array.from({length: 20}, (_, i) => i + 1).flatMap(n => [`S${n}`, `D${n}`, `T${n}`]), 'SB', 'DB'];
  for (let dart = 0; dart < 3; dart++) {
    const prior = hits.length ? evaluateX01Visit({remaining, opened, outRule: game.outRule, hits}) : {points: 0, opened};
    const desired = Math.max(0, (target - prior.points) / (3 - dart));
    let hit: string;
    if (!prior.opened) {
      const segment = roll(100) < Math.max(15, Math.min(85, average)) ? 'D' : 'S';
      hit = `${segment}${Math.max(1, Math.min(20, Math.round(desired / (segment === 'D' ? 2 : 1))))}`;
    } else {
      hit = options.filter(value => evaluateX01Visit({remaining, opened, outRule: game.outRule, hits: [...hits, value]}).endReason !== 'bust')
        .sort((a, b) => Math.abs(dartValue(a) - desired) - Math.abs(dartValue(b) - desired))[0] ?? 'MISS';
    }
    hits.push(hit);
    if (evaluateX01Visit({remaining, opened, outRule: game.outRule, hits}).endReason !== 'turn') break;
  }
  return hits;
}
