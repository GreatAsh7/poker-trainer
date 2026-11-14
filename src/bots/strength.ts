/**
 * Per-board hand-strength tables: for every combo, how strong its made hand is relative
 * to all other combos on this board, and what draws it has. Used to narrow ranges from
 * actions and to classify our own hand.
 */
import { type Card, rankOf, suitOf } from '../engine/cards';
import { evaluate, categoryOf, Category } from '../engine/evaluator';
import { COMBO_CARDS, NUM_COMBOS } from './combos';

export interface BoardTable {
  key: string;
  /** made-hand percentile among live combos (0 = worst, 1 = best); -1 if blocked by the board */
  strength: Float32Array;
  /** draw score: 0 none, 0.5 gutshot / backdoor-ish, 1 flush draw or open-ended, 1.5 combo draw */
  draw: Float32Array;
  /** raw evaluator value per combo */
  value: Int32Array;
}

/** Outs-style draw detection for a 2-card hand on a 3- or 4-card board. */
export function drawScore(hole: readonly Card[], board: readonly Card[]): number {
  if (board.length >= 5 || board.length < 3) return 0;
  const cards = [...hole, ...board];
  const v = evaluate(cards);
  const cat = categoryOf(v);
  if (cat >= Category.Straight) return 0; // already made a straight or better
  // flush draw: 4 of a suit including at least one hole card
  let fd = false;
  for (let s = 0; s < 4; s++) {
    let n = 0;
    let holeN = 0;
    for (const c of cards) if (suitOf(c) === s) n++;
    for (const c of hole) if (suitOf(c) === s) holeN++;
    if (n === 4 && holeN > 0) fd = true;
  }
  // straight draw: count ranks that would complete a straight using a hole card
  let mask = 0;
  for (const c of cards) mask |= 1 << rankOf(c);
  let holeMask = 0;
  for (const c of hole) holeMask |= 1 << rankOf(c);
  let boardMask = 0;
  for (const c of board) boardMask |= 1 << rankOf(c);
  const holeOnly = holeMask & ~boardMask;
  let outsRanks = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const m = mask | (1 << r);
    // a hole card must supply a rank the board lacks (board-only straights are not draws)
    if (makesStraightUsing(m, holeOnly)) outsRanks++;
  }
  const sd = outsRanks >= 2 ? 1 : outsRanks === 1 ? 0.5 : 0;
  if (fd && sd > 0) return 1.5;
  if (fd) return 1;
  return sd;
}

function makesStraightUsing(mask: number, needMask: number): boolean {
  const windows: number[] = [];
  for (let top = 12; top >= 4; top--) windows.push(0x1f << (top - 4));
  windows.push(0x100f);
  for (const w of windows) if ((mask & w) === w && (w & needMask) !== 0) return true;
  return false;
}

const cache = new Map<string, BoardTable>();

export function boardTable(board: readonly Card[]): BoardTable {
  const key = [...board].sort((a, b) => a - b).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const dead = new Uint8Array(52);
  for (const c of board) dead[c] = 1;
  const value = new Int32Array(NUM_COMBOS).fill(-1);
  const draw = new Float32Array(NUM_COMBOS);
  const cards: Card[] = [0, 0, ...board];
  const live: number[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBO_CARDS[i];
    if (dead[a] || dead[b]) continue;
    cards[0] = a;
    cards[1] = b;
    value[i] = evaluate(cards);
    live.push(i);
  }
  if (board.length < 5)
    for (const i of live) draw[i] = drawScore(COMBO_CARDS[i], board);
  const boardCat = evaluate(board) >> 20;
  // percentile of made-hand value among live combos
  const sorted = live.map((i) => value[i]).sort((x, y) => x - y);
  const strength = new Float32Array(NUM_COMBOS).fill(-1);
  for (const i of live) {
    const v = value[i];
    // midpoint rank of ties
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < v) lo = m + 1;
      else hi = m;
    }
    const first = lo;
    hi = sorted.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] <= v) lo = m + 1;
      else hi = m;
    }
    strength[i] = (first + lo) / 2 / sorted.length;
    // no hand of its own (high card, or only the pair/trips already on the board): it is air,
    // however many even weaker combos there are
    if ((v >> 20) <= boardCat) strength[i] = Math.min(strength[i], 0.3);
  }
  const t: BoardTable = { key, strength, draw, value };
  if (cache.size > 64) cache.clear();
  cache.set(key, t);
  return t;
}

/** Board texture summary used for sizing and c-bet frequency. */
export interface Texture {
  /** 0 (dry, e.g. K72 rainbow) .. 1 (very wet, e.g. 9h8h7c) */
  wetness: number;
  paired: boolean;
  monotone: boolean;
  highCard: number;
}

export function texture(board: readonly Card[]): Texture {
  const suits = [0, 0, 0, 0];
  const ranks = board.map(rankOf).sort((a, b) => b - a);
  for (const c of board) suits[suitOf(c)]++;
  const maxSuit = Math.max(...suits);
  const paired = new Set(ranks).size < ranks.length;
  let connected = 0;
  const uniq = [...new Set(ranks)];
  for (let i = 0; i < uniq.length; i++)
    for (let j = i + 1; j < uniq.length; j++) if (Math.abs(uniq[i] - uniq[j]) <= 4) connected++;
  const pairs = (uniq.length * (uniq.length - 1)) / 2 || 1;
  let wet = 0;
  wet += maxSuit >= 3 ? 0.45 : maxSuit === 2 ? 0.25 : 0;
  wet += 0.45 * (connected / pairs);
  if (paired) wet -= 0.15;
  return { wetness: Math.max(0, Math.min(1, wet)), paired, monotone: maxSuit >= 3, highCard: ranks[0] ?? 0 };
}
