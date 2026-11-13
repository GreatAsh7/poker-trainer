import { type Card, RANK_NAMES, RANK_PLURALS } from './cards';

/**
 * Hand values are integers; larger is better. Layout:
 *   category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
 * where r1..r5 are the ranks (0..12) that decide ties, most significant first.
 */
export enum Category {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

const pack = (cat: number, r: number[]): number =>
  (cat << 20) | ((r[0] ?? 0) << 16) | ((r[1] ?? 0) << 12) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 4) | (r[4] ?? 0);

/** Highest straight in a 13-bit rank mask; returns top rank or -1. Handles the wheel (A-2-3-4-5). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const m = 0x1f << (top - 4);
    if ((mask & m) === m) return top;
  }
  if ((mask & 0x100f) === 0x100f) return 3; // 5-high wheel
  return -1;
}

function topRanks(mask: number, n: number, exclude = 0): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r) && !(exclude & (1 << r))) out.push(r);
  return out;
}

// scratch buffers (evaluator is hot in Monte Carlo)
const counts = new Int32Array(13);
const suitCounts = new Int32Array(4);
const suitMasks = new Int32Array(4);

/** Evaluate the best 5-card hand from 5..7 cards. */
export function evaluate(cards: readonly Card[]): number {
  counts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    counts[r]++;
    suitCounts[s]++;
    suitMasks[s] |= 1 << r;
    mask |= 1 << r;
  }
  // flush / straight flush
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const fm = suitMasks[flushSuit];
    const sf = straightTop(fm);
    if (sf >= 0) return pack(Category.StraightFlush, [sf]);
  }
  let quad = -1;
  let trips1 = -1;
  let trips2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trips1 < 0) trips1 = r;
      else if (trips2 < 0) trips2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }
  if (quad >= 0) return pack(Category.Quads, [quad, topRanks(mask, 1, 1 << quad)[0]]);
  if (trips1 >= 0) {
    const pr = Math.max(trips2, pair1);
    if (pr >= 0) return pack(Category.FullHouse, [trips1, pr]);
  }
  if (flushSuit >= 0) return pack(Category.Flush, topRanks(suitMasks[flushSuit], 5));
  const st = straightTop(mask);
  if (st >= 0) return pack(Category.Straight, [st]);
  if (trips1 >= 0) return pack(Category.Trips, [trips1, ...topRanks(mask, 2, 1 << trips1)]);
  if (pair1 >= 0 && pair2 >= 0)
    return pack(Category.TwoPair, [pair1, pair2, topRanks(mask, 1, (1 << pair1) | (1 << pair2))[0]]);
  if (pair1 >= 0) return pack(Category.Pair, [pair1, ...topRanks(mask, 3, 1 << pair1)]);
  return pack(Category.HighCard, topRanks(mask, 5));
}

export const categoryOf = (value: number): Category => (value >> 20) as Category;

function nib(value: number, i: number): number {
  return (value >> (16 - 4 * i)) & 15;
}

/** Plain-language hand name, e.g. "Full house, Kings full of Sevens". */
export function describeHand(value: number): string {
  const cat = categoryOf(value);
  const r = [0, 1, 2, 3, 4].map((i) => nib(value, i));
  switch (cat) {
    case Category.StraightFlush:
      return r[0] === 12 ? 'Royal flush' : `Straight flush, ${RANK_NAMES[r[0]]} high`;
    case Category.Quads:
      return `Four of a kind, ${RANK_PLURALS[r[0]]}`;
    case Category.FullHouse:
      return `Full house, ${RANK_PLURALS[r[0]]} full of ${RANK_PLURALS[r[1]]}`;
    case Category.Flush:
      return `Flush, ${RANK_NAMES[r[0]]} high`;
    case Category.Straight:
      return `Straight, ${RANK_NAMES[r[0]]} high`;
    case Category.Trips:
      return `Three of a kind, ${RANK_PLURALS[r[0]]}`;
    case Category.TwoPair:
      return `Two pair, ${RANK_PLURALS[r[0]]} and ${RANK_PLURALS[r[1]]}`;
    case Category.Pair:
      return `Pair of ${RANK_PLURALS[r[0]]}`;
    default:
      return `${RANK_NAMES[r[0]]} high`;
  }
}

/** Which of the given cards make up the best 5-card hand (for highlighting at showdown). */
export function bestFive(cards: readonly Card[]): Card[] {
  const target = evaluate(cards);
  const n = cards.length;
  if (n <= 5) return [...cards];
  // try all 5-card subsets (max 21)
  const idx = [0, 1, 2, 3, 4];
  const pick = (): Card[] => idx.map((i) => cards[i]);
  for (;;) {
    const sub = pick();
    if (evaluate(sub) === target) return sub;
    let k = 4;
    while (k >= 0 && idx[k] === n - 5 + k) k--;
    if (k < 0) break;
    idx[k]++;
    for (let j = k + 1; j < 5; j++) idx[j] = idx[j - 1] + 1;
  }
  return [...cards].slice(0, 5);
}
