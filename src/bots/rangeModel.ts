/**
 * Estimate each opponent's range from public information only (their actions), then
 * narrow it street by street. Uses the opponent's observed stats so loose players get
 * wider ranges and aggressive players are given more bluffs.
 */
import type { Card } from '../engine/cards';
import type { ActionRecord, Street } from '../engine/game';
import type { PlayerView } from '../engine/view';
import { positionOf } from '../engine/position';
import { NUM_COMBOS, type Range, removeDead } from './combos';
import {
  RFI, THREE_BET, CALL_IP, CALL_BB, CALL_SB, VS_3BET, VS_4BET, VS_5BET, ISO, chart, scaleRange, topRange, pushPct,
  type OpenerGroup, type Pos,
} from './preflopCharts';
import { boardTable } from './strength';
import { POPULATION, populationFor, type OpponentModel } from './stats';

export const openerGroup = (p: Pos): OpenerGroup => (p === 'UTG' || p === 'HJ' ? 'early' : p === 'SB' ? 'sb' : 'late');

/** Multiply weights of r by a chart, keeping a small floor so off-chart hands stay possible. */
function intersect(r: Range, c: Range, floor = 0.012): void {
  for (let i = 0; i < NUM_COMBOS; i++) r[i] *= floor + (1 - floor) * c[i];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Preflop range implied by one player's preflop actions. */
export function preflopRange(view: PlayerView, pi: number, model: OpponentModel = POPULATION): Range {
  const np = view.players.length;
  const pos = positionOf(np, view.buttonPi, pi) as Pos;
  const r = new Float64Array(NUM_COMBOS).fill(1);
  const pop = populationFor(np);
  const loose = clamp(model.vpip / pop.vpip, 0.5, 4);
  const aggro = clamp(model.pfr / pop.pfr, 0.4, 6);
  const tbRatio = clamp(model.threeBet / pop.threeBet, 0.4, 10);
  // Very loose players play almost any two: off-chart hands keep real weight for them.
  // (how far above the typical frequency for this table size they are, from 0 to 1)
  const excess = (x: number, typical: number) => (x - typical) / Math.max(0.05, 1 - typical);
  const looseFloor = clamp((excess(model.vpip, pop.vpip) - 0.15) * 1.4, 0.012, 0.85);
  const raiseFloor = clamp((excess(model.pfr, pop.pfr) - 0.15) * 1.4, 0.012, 0.85);
  const threeBetFloor = clamp((excess(model.threeBet, pop.threeBet) - 0.1) * 1.6, 0.012, 0.8);
  const hu = np === 2;
  const bb = view.config.bigBlind;
  let raises = 0;
  let limps = 0;
  let openerPos: Pos | null = null;
  for (const a of view.actions) {
    if (a.street !== 'preflop') break;
    if (a.pi === pi) {
      const isRaise = a.type === 'raise' || a.type === 'bet';
      const depth = Math.max(1, a.to / bb);
      if (isRaise && a.allIn && depth <= 30) {
        // shoves at short stacks: position- and depth-based push ranges, not opening charts
        const share = raises === 0 ? pushPct(pos, depth, hu) * Math.sqrt(aggro) : clamp(0.1 * Math.pow(20 / depth, 0.8), 0.04, 0.6) * Math.sqrt(tbRatio);
        intersect(r, topRange(clamp(share, 0.04, 1)), raises === 0 ? raiseFloor : threeBetFloor);
      } else if (isRaise) {
        if (raises === 0) {
          const base = limps > 0 || pos === 'BB' ? chart(ISO) : chart(RFI[pos as Exclude<Pos, 'BB'>]);
          intersect(r, scaleRange(base, aggro * (hu ? 1.7 : 1)), raiseFloor);
        } else if (raises === 1) {
          intersect(r, scaleRange(chart(THREE_BET[openerGroup(openerPos ?? 'CO')]), tbRatio * (hu ? 1.5 : 1)), threeBetFloor);
        } else if (raises === 2) intersect(r, scaleRange(chart(VS_3BET.fourBet), Math.sqrt(aggro * tbRatio)), threeBetFloor * 0.5);
        else intersect(r, chart(VS_4BET.jam), threeBetFloor * 0.3);
      } else if (a.type === 'call') {
        if (raises === 0) {
          // limp: mostly medium hands, strong hands would usually raise
          const lr = topRange(clamp(model.vpip * 1.3, 0.15, 0.85));
          const strong = topRange(0.04);
          for (let i = 0; i < NUM_COMBOS; i++) lr[i] *= strong[i] ? 0.35 : 1;
          intersect(r, lr, looseFloor);
          limps++;
        } else if (raises === 1) {
          const g = openerGroup(openerPos ?? 'CO');
          const base = pos === 'BB' ? CALL_BB[g] : pos === 'SB' ? CALL_SB : CALL_IP[g] || CALL_IP.late;
          intersect(r, scaleRange(chart(base), loose * (hu ? 1.3 : 1)), looseFloor);
        } else if (raises === 2) intersect(r, scaleRange(chart(VS_3BET.callIP), Math.sqrt(loose) * (hu ? 1.8 : 1)), looseFloor * 0.5);
        else if (raises === 3) intersect(r, chart(VS_4BET.call + ', ' + VS_4BET.jam));
        else intersect(r, chart(VS_5BET));
      }
      // checks (big blind option) and folds carry no range information here
    }
    if (a.type === 'raise' || a.type === 'bet') {
      if (raises === 0) openerPos = positionOf(np, view.buttonPi, a.pi) as Pos;
      raises++;
    } else if (a.type === 'call' && raises === 0) {
      if (a.pi !== pi) limps++;
    }
  }
  // Big blind who only checked their option: most strong hands would have raised
  const mine = view.actions.filter((a) => a.street === 'preflop' && a.pi === pi);
  if (pos === 'BB' && mine.length > 0 && mine.every((a) => a.type === 'check')) {
    const strong = topRange(0.1);
    for (let i = 0; i < NUM_COMBOS; i++) if (strong[i]) r[i] *= 0.3;
  }
  return r;
}

/** Likelihood that a combo with strength s / draw d takes `type` facing this situation. */
function likelihood(
  rec: ActionRecord,
  s: number,
  d: number,
  street: Street,
  model: OpponentModel,
  /** typical VPIP for this table size (heads-up players play far more hands) */
  typicalVpip = POPULATION.vpip,
): number {
  const river = street === 'river';
  // how often air keeps betting on this street (conditional barrel rate), scaled by observed aggression
  const aggRatio = clamp(model.aggFreq / POPULATION.aggFreq, 0.3, 2);
  const shown = clamp(model.bluffRate / POPULATION.bluffRate, 0.4, 2.5);
  const base = street === 'flop' ? 0.4 : street === 'turn' ? 0.25 : 0.16;
  // tight players (low VPIP, which is known after a few hands) bet mostly for value
  const tight = clamp(model.vpip / typicalVpip, 0.45, 1.3);
  const bluffiness = clamp(base * aggRatio * tight * (street === 'flop' ? 1 : shown), 0.03, 0.8);
  const stickiness = clamp(0.06 + 0.6 * (model.wtsd - 0.25), 0.03, 0.45);
  switch (rec.type) {
    case 'bet':
    case 'raise': {
      const raise = rec.type === 'raise';
      const frac = rec.potBefore > 0 ? rec.added / rec.potBefore : 1;
      const big = frac > 0.8 || rec.allIn;
      let value: number;
      if (raise) {
        // raises are value-heavy, river raises most of all
        value = river
          ? s >= 0.96 ? 1 : s >= 0.9 ? 0.15 : s >= 0.8 ? 0.04 : 0.02
          : s >= 0.94 ? 1 : s >= 0.85 ? 0.4 : s >= 0.7 ? 0.12 : 0.04;
        if (s < 0.94) value = Math.min(1, value * clamp(aggRatio * Math.sqrt(tight), 0.5, 1.4));
      } else {
        value = s >= 0.85 ? 1 : s >= 0.7 ? (big ? 0.55 : 0.8) : s >= 0.55 ? (big ? 0.2 : 0.45) : s >= 0.4 ? 0.2 : 0.08;
        // aggressive players also bet their medium hands more often (not only bluffs)
        if (s < 0.85) value = Math.min(1, value * clamp(aggRatio * Math.sqrt(tight), 0.4, 1.8));
      }
      const semi = river ? 0 : d >= 1 ? (raise ? 0.4 : 0.6) : d >= 0.5 ? (raise ? 0.15 : 0.3) : 0;
      const bluff = raise ? bluffiness * 0.35 : bluffiness;

      return Math.max(value, semi, bluff);
    }
    case 'call': {
      // passive players just call with their monsters instead of raising
      if (s >= 0.92) return clamp(1.15 - model.aggFreq * 1.2, 0.55, 1);
      if (s >= 0.5) return 1;
      if (!river && d >= 1) return 0.9;
      if (!river && d >= 0.5) return 0.45;
      if (s >= 0.3) return 0.3 + stickiness;
      return stickiness;
    }
    case 'check': {
      // passive players check strong hands far more often than aggressive ones
      const slow = clamp(1.2 - model.aggFreq * 1.6, 0.4, 1);
      return s >= 0.9 ? slow : s >= 0.75 ? Math.max(0.7, slow) : 1;
    }
    default:
      return 1;
  }
}

/** Board as it was on a given street. */
function boardAt(board: readonly Card[], street: Street): Card[] {
  const n = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
  return board.slice(0, n);
}

/** Full range estimate for opponent `pi`: preflop range narrowed by every postflop action. */
/**
 * @param reading how strongly postflop actions narrow the range (1 = full hand reading,
 *   0 = ignore postflop actions). Simpler bot personalities read hands less precisely.
 */
export function estimateRange(view: PlayerView, pi: number, model: OpponentModel = POPULATION, reading = 1): Range {
  let r = preflopRange(view, pi, model);
  const np = view.players.length;
  const typicalVpip = populationFor(np).vpip;
  for (const a of view.actions) {
    if (a.pi !== pi || a.street === 'preflop') continue;
    const b = boardAt(view.board, a.street);
    if (b.length < 3 || reading <= 0) continue;
    const t = boardTable(b);
    const checkRaise = a.type === 'raise' && view.actions.some((x) => x.pi === pi && x.street === a.street && x.type === 'check');
    const checksFirst = a.type === 'check' && view.actions.find((x) => x.street === a.street) === a;
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (r[i] <= 0) continue;
      const s = t.strength[i];
      if (s < 0) {
        r[i] = 0;
        continue;
      }
      let l = likelihood(a, s, t.draw[i], a.street, model, typicalVpip);
      // a check-raise is stronger still than a raise
      if (checkRaise && s < 0.96) l *= a.street === 'river' ? 0.2 : 0.4;
      // checking first (to the player with the betting lead) is what nearly every hand does
      if (checksFirst) l = 1;
      r[i] *= reading === 1 ? l : Math.pow(l, reading);
    }
  }
  r = removeDead(r, [...view.hole, ...view.board]);
  return r;
}
