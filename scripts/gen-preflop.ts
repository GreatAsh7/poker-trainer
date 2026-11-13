/**
 * Offline: equity of each of the 169 starting-hand classes vs 1 and vs 3 random hands.
 * Writes src/bots/data/preflop169.json. Run: npx tsx scripts/gen-preflop.ts
 */
import { writeFileSync } from 'node:fs';
import { CLASS_NAMES, CLASS_COMBOS, COMBO_CARDS } from '../src/bots/combos';
import { evaluate } from '../src/engine/evaluator';
import { mulberry32 } from '../src/engine/cards';

const rng = mulberry32(12345);
const N = 30000;
function eqVs(hole: number[], opps: number): number {
  let score = 0;
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!hole.includes(c)) deck.push(c);
  const need = 5 + 2 * opps;
  const seven = new Array(7);
  for (let t = 0; t < N; t++) {
    // partial shuffle
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const x = deck[i]; deck[i] = deck[j]; deck[j] = x;
    }
    seven[0] = hole[0]; seven[1] = hole[1];
    for (let i = 0; i < 5; i++) seven[2 + i] = deck[i];
    const me = evaluate(seven);
    let best = 0, ties = 0, lost = false;
    for (let o = 0; o < opps; o++) {
      seven[0] = deck[5 + 2 * o]; seven[1] = deck[6 + 2 * o];
      const v = evaluate(seven);
      if (v > me) { lost = true; break; }
      if (v === me) ties++;
      best = Math.max(best, v);
    }
    if (!lost) score += 1 / (ties + 1);
  }
  return score / N;
}
const out: Record<string, { eq1: number; eq3: number }> = {};
for (let i = 0; i < CLASS_NAMES.length; i++) {
  const [a, b] = COMBO_CARDS[CLASS_COMBOS[i][0]];
  out[CLASS_NAMES[i]] = { eq1: +eqVs([a, b], 1).toFixed(4), eq3: +eqVs([a, b], 3).toFixed(4) };
}
writeFileSync('src/bots/data/preflop169.json', JSON.stringify(out, null, 0));
console.log('AA', out.AA, '72o', out['72o'], 'KQs', out.KQs, '76s', out['76s']);
