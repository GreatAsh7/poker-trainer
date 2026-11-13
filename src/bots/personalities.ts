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
}

export const PERSONALITIES: Record<Exclude<BotStyle, 'placeholder'>, Personality> = {
  expert: {
    style: 'expert', label: 'Expert', blurb: 'Balanced, solver-style ranges and sizings; adapts to your tendencies.',
    rfiMult: 1, callMult: 1, threeBetMult: 1.1, limpLoose: 0, aggression: 1.05, bluff: 1, callMargin: 0,
    valueShift: 0, cbet: 1, adapts: true, iters: 1200, sizingVariety: true,
  },
  tag: {
    style: 'tag', label: 'Solid (TAG)', blurb: 'Tight-aggressive regular: good ranges, bets for value, gives up a bit too easily.',
    rfiMult: 0.95, callMult: 0.9, threeBetMult: 0.9, limpLoose: 0, aggression: 1, bluff: 0.7, callMargin: 0.04,
    valueShift: 0.02, cbet: 1.05, adapts: false, iters: 700, sizingVariety: true,
  },
  lag: {
    style: 'lag', label: 'Aggressive (LAG)', blurb: 'Loose-aggressive: plays many hands, 3-bets and bluffs a lot.',
    rfiMult: 1.5, callMult: 1.25, threeBetMult: 2, limpLoose: 0, aggression: 1.35, bluff: 1.7, callMargin: -0.02,
    valueShift: -0.02, cbet: 1.3, adapts: false, iters: 700, sizingVariety: true,
  },
  nit: {
    style: 'nit', label: 'Tight-passive', blurb: 'Plays few hands, rarely bluffs, folds to pressure unless strong.',
    rfiMult: 0.55, callMult: 0.75, threeBetMult: 0.45, limpLoose: 0, aggression: 0.6, bluff: 0.2, callMargin: 0.1,
    valueShift: 0.06, cbet: 0.6, adapts: false, iters: 600, sizingVariety: false,
  },
  station: {
    style: 'station', label: 'Calling station', blurb: 'Loose-passive: limps and calls too much, seldom raises or folds.',
    rfiMult: 0.35, callMult: 2.4, threeBetMult: 0.35, limpLoose: 0.55, aggression: 0.45, bluff: 0.12, callMargin: -0.16,
    valueShift: 0.08, cbet: 0.5, adapts: false, iters: 600, sizingVariety: false,
  },
};
