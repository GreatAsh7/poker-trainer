/**
 * Starting-hand combos and ranges.
 * - 1326 two-card combos, indexed by comboIndex(a, b).
 * - 169 hand classes ("AA", "AKs", "AKo", ...), indexed 0..168.
 * - A Range is a weight per combo (0..1).
 */
import { type Card, RANK_CHARS, rankOf, suitOf, makeCard } from '../engine/cards';

export const NUM_COMBOS = 1326;
export type Range = Float64Array;

/** combo index for two distinct cards (order-independent) */
const IDX = new Int16Array(52 * 52).fill(-1);
export const COMBO_CARDS: [Card, Card][] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++) {
    IDX[a * 52 + b] = COMBO_CARDS.length;
    IDX[b * 52 + a] = COMBO_CARDS.length;
    COMBO_CARDS.push([a, b]);
  }

export const comboIndex = (a: Card, b: Card): number => IDX[a * 52 + b];

// ---------------------------------------------------------------- classes

/** class name for two cards, e.g. "AKs", "T9o", "77" */
export function className(a: Card, b: Card): string {
  const r1 = Math.max(rankOf(a), rankOf(b));
  const r2 = Math.min(rankOf(a), rankOf(b));
  if (r1 === r2) return RANK_CHARS[r1] + RANK_CHARS[r2];
  return RANK_CHARS[r1] + RANK_CHARS[r2] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

export const CLASS_NAMES: string[] = [];
for (let r1 = 12; r1 >= 0; r1--)
  for (let r2 = 12; r2 >= 0; r2--) {
    if (r1 === r2) CLASS_NAMES.push(RANK_CHARS[r1] + RANK_CHARS[r2]);
    else if (r1 > r2) {
      CLASS_NAMES.push(RANK_CHARS[r1] + RANK_CHARS[r2] + 's');
      CLASS_NAMES.push(RANK_CHARS[r1] + RANK_CHARS[r2] + 'o');
    }
  }
export const CLASS_INDEX = new Map(CLASS_NAMES.map((n, i) => [n, i]));

/** class index for each combo */
export const COMBO_CLASS = new Int16Array(NUM_COMBOS);
/** combos belonging to each class */
export const CLASS_COMBOS: number[][] = CLASS_NAMES.map(() => []);
COMBO_CARDS.forEach(([a, b], i) => {
  const ci = CLASS_INDEX.get(className(a, b))!;
  COMBO_CLASS[i] = ci;
  CLASS_COMBOS[ci].push(i);
});

export const classComboCount = (name: string) => (name.length === 2 ? 6 : name.endsWith('s') ? 4 : 12);

// ---------------------------------------------------------------- range parsing

const R = (ch: string) => {
  const r = RANK_CHARS.indexOf(ch.toUpperCase());
  if (r < 0) throw new Error(`bad rank ${ch}`);
  return r;
};
const nm = (r1: number, r2: number, suf: string) => (r1 === r2 ? RANK_CHARS[r1] + RANK_CHARS[r2] : RANK_CHARS[r1] + RANK_CHARS[r2] + suf);

/**
 * Parse standard range notation into class names:
 * "TT+", "22-55", "A2s+", "KTo+", "AK" (both), "AKs", "76s-54s", "QJo".
 */
export function parseRangeClasses(spec: string): string[] {
  const out = new Set<string>();
  for (const raw of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const plus = raw.endsWith('+');
    const tok = plus ? raw.slice(0, -1) : raw;
    if (tok.includes('-')) {
      const [a, b] = tok.split('-');
      const suf = a.length === 3 ? a[2] : '';
      const hiA = R(a[0]), loA = R(a[1]), hiB = R(b[0]), loB = R(b[1]);
      if (hiA === loA) {
        // pairs range
        for (let r = Math.min(hiA, hiB); r <= Math.max(hiA, hiB); r++) out.add(nm(r, r, ''));
      } else if (hiA === hiB) {
        for (let r = Math.min(loA, loB); r <= Math.max(loA, loB); r++) addSuited(out, hiA, r, suf);
      } else {
        // connectors: 76s-54s keeps the gap
        const gap = hiA - loA;
        for (let h = Math.min(hiA, hiB); h <= Math.max(hiA, hiB); h++) addSuited(out, h, h - gap, suf);
      }
      continue;
    }
    const r1 = R(tok[0]);
    const r2 = R(tok[1]);
    const suf = tok.length === 3 ? tok[2] : '';
    if (r1 === r2) {
      if (plus) for (let r = r1; r <= 12; r++) out.add(nm(r, r, ''));
      else out.add(nm(r1, r1, ''));
    } else {
      const hi = Math.max(r1, r2);
      const lo = Math.min(r1, r2);
      if (plus) for (let r = lo; r < hi; r++) addSuited(out, hi, r, suf);
      else addSuited(out, hi, lo, suf);
    }
  }
  return [...out];
}

function addSuited(out: Set<string>, hi: number, lo: number, suf: string) {
  if (lo < 0 || lo >= hi) return;
  if (suf === 's' || suf === '') out.add(nm(hi, lo, 's'));
  if (suf === 'o' || suf === '') out.add(nm(hi, lo, 'o'));
}

export function emptyRange(): Range {
  return new Float64Array(NUM_COMBOS);
}

export function fullRange(): Range {
  return new Float64Array(NUM_COMBOS).fill(1);
}

export function rangeFromClasses(classes: Iterable<string>, weight = 1, into = emptyRange()): Range {
  for (const c of classes) {
    const ci = CLASS_INDEX.get(c);
    if (ci === undefined) throw new Error(`bad class ${c}`);
    for (const k of CLASS_COMBOS[ci]) into[k] = Math.max(into[k], weight);
  }
  return into;
}

/** Parse a range; tokens may carry a frequency, e.g. "A5s@60" = 60% of the time. */
export function parseRange(spec: string): Range {
  const r = emptyRange();
  for (const tok of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [hands, freq] = tok.split('@');
    rangeFromClasses(parseRangeClasses(hands), freq ? Number(freq) / 100 : 1, r);
  }
  return r;
}

/** share of all 1326 combos (weighted) */
export function rangeSize(r: Range): number {
  let s = 0;
  for (let i = 0; i < NUM_COMBOS; i++) s += r[i];
  return s / NUM_COMBOS;
}

/** zero out combos that use any of the dead cards */
export function removeDead(r: Range, dead: readonly Card[]): Range {
  const out = new Float64Array(r);
  for (const c of dead)
    for (let o = 0; o < 52; o++) if (o !== c) out[comboIndex(c, o)] = 0;
  return out;
}

export const cardOf = makeCard;
