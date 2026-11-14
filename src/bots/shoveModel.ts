/**
 * How opponents respond to an all-in: each calls with the hands whose equity against the
 * shover's range beats the price they are getting. Equity of every starting hand against
 * "the top X% of hands" is computed once per X (Monte Carlo) and cached.
 */
import { mulberry32 } from '../engine/cards';
import { CLASS_COMBOS, CLASS_NAMES, COMBO_CARDS, COMBO_CLASS, NUM_COMBOS, type Range } from './combos';
import { topRange } from './preflopCharts';
import { equityVsRanges } from './equity';

const cache = new Map<number, Float64Array>();

/** Equity of each of the 169 classes against the top `share` of hands (bucketed to 2.5%). */
export function classEquityVsTop(share: number): Float64Array {
  const bucket = Math.max(1, Math.min(40, Math.round(share * 40)));
  let t = cache.get(bucket);
  if (t) return t;
  t = new Float64Array(CLASS_NAMES.length);
  const villain = topRange(bucket / 40);
  const rng = mulberry32(1000 + bucket);
  for (let ci = 0; ci < CLASS_NAMES.length; ci++) {
    const [a, b] = COMBO_CARDS[CLASS_COMBOS[ci][0]];
    t[ci] = equityVsRanges([a, b], [], [villain], 300, rng).equity;
  }
  cache.set(bucket, t);
  return t;
}

/**
 * The part of `r` that calls an all-in from a range of size `shoveShare`, when calling
 * needs `need` equity. `looseness` > 1 calls a bit lighter (stations), < 1 tighter.
 */
export function callingRange(r: Range, shoveShare: number, need: number, looseness = 1): { share: number; range: Range } {
  const eq = classEquityVsTop(shoveShare);
  const thr = need - 0.06 * (looseness - 1);
  const out = new Float64Array(NUM_COMBOS);
  let tot = 0;
  let call = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    tot += w;
    if (eq[COMBO_CLASS[i]] >= thr) {
      out[i] = w;
      call += w;
    }
  }
  return { share: tot > 0 ? call / tot : 0, range: out };
}
