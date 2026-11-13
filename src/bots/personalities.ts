import type { BotStyle } from './types';

/**
 * One strategy core, tuned by these knobs. "Expert" is the strongest balanced setting and
 * the only one that adapts to opponents' observed tendencies.
 */
export interface Personality {
  style: BotStyle;
  label: string;
  /** plain-language description for the HUD tooltip and setup screen */
  blurb: string;
  /** open-raise range size multiplier */
  rfiMult: number;
  /** flat-call range size multiplier */
  callMult: number;
  /** 3-bet / 4-bet range size multiplier */
  threeBetMult: number;
  /** probability of limping instead of folding a hand outside the open range (stations) */
  limpLoose: number;
  /** postflop aggression multiplier (value betting thinner, raising more) */
  aggression: number;
  /** bluff / semi-bluff frequency multiplier */
  bluff: number;
  /** extra equity required to call (positive = folds more, negative = calls light) */
  callMargin: number;
  /** extra equity required to value bet (negative = bets thinner) */
  valueShift: number;
  /** c-bet frequency multiplier */
  cbet: number;
  /** adapts to opponents' observed stats */
  adapts: boolean;
  /** Monte Carlo iterations for equity */
  iters: number;
  /** varies bet sizes by texture/street (otherwise uses a fixed size) */
  sizingVariety: boolean;
  /**
   * Balanced play: mixes river sizes independently of hand strength, checks to the
   * preflop raiser with most of its range, and defends against 3-bets in proportion to
   * how wide it opened.
   */
  balanced: boolean;
  /** how precisely it narrows opponents' ranges from their postflop actions (1 = full) */
  rangeReading: number;
  /** share of its own opening range it continues with against a 3-bet, relative to a balanced player (0 = use charts only) */
  defend3Bet: number;
}

export const PERSONALITIES: Record<Exclude<BotStyle, 'placeholder'>, Personality> = {
  expert: {
    style: 'expert', label: 'Expert', blurb: 'Balanced, solver-style ranges and sizings; adapts to your tendencies.',
    rfiMult: 1, callMult: 1, threeBetMult: 1.1, limpLoose: 0, aggression: 1.05, bluff: 1, callMargin: 0,
    valueShift: 0, cbet: 1, adapts: true, iters: 1200, sizingVariety: true, balanced: true, defend3Bet: 1, rangeReading: 1,
  },
  tag: {
    style: 'tag', label: 'Solid (TAG)', blurb: 'Tight-aggressive regular: good ranges, bets for value, gives up a bit too easily.',
    rfiMult: 0.95, callMult: 0.9, threeBetMult: 0.9, limpLoose: 0, aggression: 1, bluff: 0.5, callMargin: 0.1,
    valueShift: 0.04, cbet: 1.05, adapts: false, iters: 700, sizingVariety: true, balanced: false, defend3Bet: 0.55, rangeReading: 0.5,
  },
  lag: {
    style: 'lag', label: 'Aggressive (LAG)', blurb: 'Loose-aggressive: plays many hands, 3-bets and bluffs a lot, and calls too light.',
    rfiMult: 1.5, callMult: 1.25, threeBetMult: 2, limpLoose: 0, aggression: 1.35, bluff: 1.9, callMargin: -0.05,
    valueShift: -0.02, cbet: 1.3, adapts: false, iters: 700, sizingVariety: true, balanced: false, defend3Bet: 0.85, rangeReading: 0.4,
  },
  nit: {
    style: 'nit', label: 'Tight-passive', blurb: 'Plays few hands, rarely bluffs, folds to pressure unless strong.',
    rfiMult: 0.55, callMult: 0.75, threeBetMult: 0.45, limpLoose: 0, aggression: 0.6, bluff: 0.2, callMargin: 0.1,
    valueShift: 0.06, cbet: 0.6, adapts: false, iters: 600, sizingVariety: false, balanced: false, defend3Bet: 0.4, rangeReading: 0.4,
  },
  station: {
    style: 'station', label: 'Calling station', blurb: 'Loose-passive: limps and calls too much, seldom raises or folds.',
    rfiMult: 0.35, callMult: 2.4, threeBetMult: 0.35, limpLoose: 0.55, aggression: 0.45, bluff: 0.12, callMargin: -0.16,
    valueShift: 0.08, cbet: 0.5, adapts: false, iters: 600, sizingVariety: false, balanced: false, defend3Bet: 0, rangeReading: 0.15,
  },
};
