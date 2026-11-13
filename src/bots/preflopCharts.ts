/**
 * Preflop charts for a solid 6-max, 100 BB strategy (approximating common solver outputs).
 * Frequencies with "@" are mixed strategies. Personalities widen or tighten these.
 */
import { parseRange, type Range, CLASS_NAMES, CLASS_COMBOS, NUM_COMBOS, emptyRange } from './combos';
import data from './data/preflop169.json';

export type Pos = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

/** Raise-first-in (open) ranges. */
export const RFI: Record<Exclude<Pos, 'BB'>, string> = {
  UTG: '55+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo@50',
  HJ: '33+, A2s+, K7s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 76s, 65s, A9o+, KTo+, QTo+, JTo',
  CO: '22+, A2s+, K4s+, Q7s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A7o+, A5o, KTo+, QTo+, JTo, T9o@50',
  BTN: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o@50',
  SB: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A4o+, K9o+, Q9o+, J9o+, T9o',
};

export type OpenerGroup = 'early' | 'late' | 'sb';

/** 3-bet ranges by opener group (value + bluffs). */
export const THREE_BET: Record<OpenerGroup, string> = {
  early: 'QQ+, AKs, AKo, AQs@40, A5s@60, A4s@40, KQs@25',
  late: 'TT+, AQs+, AKo, AJs@60, KQs@50, AQo@60, A5s, A4s, A3s@50, K9s@30, 76s@30, 65s@30',
  sb: 'TT+, AJs+, KQs, AQo+, A5s@60, A4s@60, A3s@40, K9s@50, Q9s@40, J9s@40, T8s@40, 76s@40, KJo@40',
};

/** Flat-call ranges when in position (not the big blind). */
export const CALL_IP: Record<OpenerGroup, string> = {
  early: 'JJ-22, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo@60',
  late: 'TT-22, AJs-A9s, KTs+, QTs+, J9s+, T9s, 98s, 87s, 76s, AJo, KQo',
  sb: '',
};

/** Big blind defence (calls) by opener group. */
export const CALL_BB: Record<OpenerGroup, string> = {
  early: '22-JJ, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, ATo+, KJo+, QJo',
  late: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o',
  sb: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K5o+, Q7o+, J8o+, T8o+, 97o+, 87o, 76o',
};

/** Small blind flats rarely; mostly 3-bet or fold. */
export const CALL_SB = '99-22@50, AJs, ATs@50, KQs@50, QJs@50, JTs@50';

/** After we open and face a 3-bet. */
export const VS_3BET = {
  fourBet: 'QQ+, AKs, AKo, A5s@50, A4s@25',
  fourBetVsLate: 'JJ+, AKs, AKo, AQs@50, A5s@60, A4s@40',
  callIP: 'JJ-77, AQs, AJs, ATs@50, KQs, KJs@50, QJs, JTs, T9s@50, AQo@50',
  callOOP: 'JJ-99, AQs, AJs@50, KQs, AQo@30',
};

/** Facing a 4-bet after we 3-bet: jam or call. */
export const VS_4BET = { jam: 'QQ+, AKs, AKo', call: 'JJ@50, AQs@30' };

/** Facing a 5-bet / all-in after a 4-bet. */
export const VS_5BET = 'QQ+, AKs, AKo@80';

/** Isolation raise over limpers (in addition to the strong part of RFI). */
export const ISO = '66+, A8s+, KTs+, QTs+, JTs, ATo+, KJo+';

// ---------------------------------------------------------------- strength ranking

type Pre = Record<string, { eq1: number; eq3: number }>;
const PRE = data as Pre;

/** Playability score used to order hands when widening/tightening ranges. */
export const CLASS_SCORE = CLASS_NAMES.map((n) => PRE[n].eq1 + 0.9 * PRE[n].eq3);

/** classes ordered best → worst */
export const CLASS_ORDER = CLASS_NAMES.map((_, i) => i).sort((a, b) => CLASS_SCORE[b] - CLASS_SCORE[a]);

/** percentile (0 = best, 1 = worst) of each class by cumulative combos */
export const CLASS_PERCENTILE = new Float64Array(CLASS_NAMES.length);
{
  let acc = 0;
  for (const ci of CLASS_ORDER) {
    const n = CLASS_COMBOS[ci].length;
    CLASS_PERCENTILE[ci] = (acc + n / 2) / NUM_COMBOS;
    acc += n;
  }
}

/** Equity vs one random hand, by class name. */
export const eqVsRandom = (cls: string) => PRE[cls].eq1;

/** The top `pct` of hands by ranking (0..1). */
export function topRange(pct: number): Range {
  const r = emptyRange();
  let acc = 0;
  for (const ci of CLASS_ORDER) {
    if (acc >= pct * NUM_COMBOS) break;
    for (const k of CLASS_COMBOS[ci]) r[k] = 1;
    acc += CLASS_COMBOS[ci].length;
  }
  return r;
}

/**
 * Widen (mult > 1) or tighten (mult < 1) a range by ranking: add the best hands not
 * yet included, or remove the worst included ones, until the size is mult × original.
 */
export function scaleRange(base: Range, mult: number): Range {
  if (mult === 1) return base;
  const r = new Float64Array(base);
  let size = 0;
  for (let i = 0; i < NUM_COMBOS; i++) size += r[i];
  const target = Math.min(NUM_COMBOS, size * mult);
  if (mult > 1) {
    for (const ci of CLASS_ORDER) {
      if (size >= target) break;
      for (const k of CLASS_COMBOS[ci]) {
        size += 1 - r[k];
        r[k] = 1;
      }
    }
  } else {
    for (let j = CLASS_ORDER.length - 1; j >= 0 && size > target; j--) {
      for (const k of CLASS_COMBOS[CLASS_ORDER[j]]) {
        size -= r[k];
        r[k] = 0;
      }
    }
  }
  return r;
}

const cache = new Map<string, Range>();
export function chart(spec: string): Range {
  let r = cache.get(spec);
  if (!r) {
    r = parseRange(spec);
    cache.set(spec, r);
  }
  return r;
}
