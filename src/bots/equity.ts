/**
 * Equity of a hand against weighted opponent ranges.
 * - River, one opponent: exact (enumerate the range).
 * - Otherwise: Monte Carlo — sample each opponent's combo from its weighted range
 *   (rejecting card conflicts) and the remaining board.
 */
import type { Card, Rng } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { COMBO_CARDS, NUM_COMBOS, type Range } from './combos';

interface Sampler {
  idx: Int32Array;
  cum: Float64Array;
  total: number;
}

function buildSampler(r: Range, dead: Uint8Array): Sampler {
  const idx: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead[a] || dead[b]) continue;
    total += w;
    idx.push(i);
    cum.push(total);
  }
  return { idx: Int32Array.from(idx), cum: Float64Array.from(cum), total };
}

function sample(s: Sampler, rng: Rng): number {
  const x = rng() * s.total;
  let lo = 0;
  let hi = s.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cum[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return s.idx[lo];
}

export interface EquityResult {
  /** share of the pot won on average (ties split) */
  equity: number;
  /** number of samples / combos evaluated */
  n: number;
}

const seven: Card[] = new Array(7).fill(0);

/** Exact equity on the river vs one weighted range. */
function riverExact(hole: Card[], board: Card[], r: Range, dead: Uint8Array): EquityResult {
  for (let i = 0; i < 5; i++) seven[2 + i] = board[i];
  seven[0] = hole[0];
  seven[1] = hole[1];
  const me = evaluate(seven);
  let won = 0;
  let tot = 0;
  let n = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    if (dead[a] || dead[b]) continue;
    seven[0] = a;
    seven[1] = b;
    const v = evaluate(seven);
    tot += w;
    n++;
    if (me > v) won += w;
    else if (me === v) won += w / 2;
  }
  return { equity: tot > 0 ? won / tot : 1, n };
}

export function equityVsRanges(
  hole: Card[],
  board: Card[],
  ranges: Range[],
  iterations: number,
  rng: Rng,
): EquityResult {
  if (ranges.length === 0) return { equity: 1, n: 0 };
  const dead = new Uint8Array(52);
  for (const c of hole) dead[c] = 1;
  for (const c of board) dead[c] = 1;
  if (board.length === 5 && ranges.length === 1) return riverExact(hole, board, ranges[0], dead);

  const samplers = ranges.map((r) => buildSampler(r, dead));
  // an empty range (all combos blocked) means the estimate failed: fall back to random hands
  for (let k = 0; k < samplers.length; k++) if (samplers[k].total <= 0) samplers[k] = buildSampler(new Float64Array(NUM_COMBOS).fill(1), dead);

  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const opp = new Int32Array(ranges.length);
  let score = 0;
  let n = 0;
  for (let t = 0; t < iterations; t++) {
    used.fill(0);
    let ok = true;
    for (let k = 0; k < samplers.length; k++) {
      let tries = 0;
      let ci = -1;
      while (tries++ < 20) {
        ci = sample(samplers[k], rng);
        const [a, b] = COMBO_CARDS[ci];
        if (!used[a] && !used[b]) {
          used[a] = 1;
          used[b] = 1;
          break;
        }
        ci = -1;
      }
      if (ci < 0) {
        ok = false;
        break;
      }
      opp[k] = ci;
    }
    if (!ok) continue;
    // complete the board
    for (let i = 0; i < board.length; i++) seven[2 + i] = board[i];
    let filled = 0;
    let guard = 0;
    while (filled < need && guard++ < 200) {
      const c = deck[Math.floor(rng() * deck.length)];
      if (used[c]) continue;
      used[c] = 1;
      seven[2 + board.length + filled++] = c;
    }
    seven[0] = hole[0];
    seven[1] = hole[1];
    const me = evaluate(seven);
    let ties = 0;
    let lost = false;
    for (let k = 0; k < samplers.length; k++) {
      const [a, b] = COMBO_CARDS[opp[k]];
      seven[0] = a;
      seven[1] = b;
      const v = evaluate(seven);
      if (v > me) {
        lost = true;
        break;
      }
      if (v === me) ties++;
    }
    n++;
    if (!lost) score += 1 / (ties + 1);
  }
  return { equity: n > 0 ? score / n : 0.5, n };
}
