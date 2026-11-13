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
  RFI, THREE_BET, CALL_IP, CALL_BB, CALL_SB, VS_3BET, VS_4BET, VS_5BET, ISO, chart, scaleRange, topRange,
  type OpenerGroup, type Pos,
} from './preflopCharts';
import { boardTable } from './strength';
import { POPULATION, type OpponentModel } from './stats';

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
  const loose = clamp(model.vpip / POPULATION.vpip, 0.5, 3);
  const aggro = clamp(model.pfr / POPULATION.pfr, 0.4, 3);
  let raises = 0;
  let limps = 0;
  let openerPos: Pos | null = null;
  for (const a of view.actions) {
    if (a.street !== 'preflop') break;
    if (a.pi === pi) {
      const isRaise = a.type === 'raise' || a.type === 'bet';
      if (isRaise) {
        if (raises === 0) {
          const base = limps > 0 || pos === 'BB' ? chart(ISO) : chart(RFI[pos as Exclude<Pos, 'BB'>]);
          intersect(r, scaleRange(base, aggro));
        } else if (raises === 1) {
          const tb = clamp(model.threeBet / POPULATION.threeBet, 0.4, 4);
          intersect(r, scaleRange(chart(THREE_BET[openerGroup(openerPos ?? 'CO')]), tb));
        }
        else if (raises === 2) intersect(r, scaleRange(chart(VS_3BET.fourBet), Math.sqrt(aggro)));
        else intersect(r, chart(VS_4BET.jam));
        if (a.allIn && raises === 0) {
          // open-shove: use a push range proportional to stack depth
          const bb = view.config.bigBlind;
          const depth = Math.max(1, a.to / bb);
          intersect(r, topRange(clamp(0.9 / Math.sqrt(depth), 0.08, 0.7) * Math.sqrt(aggro)));
        }
      } else if (a.type === 'call') {
        if (raises === 0) {
          // limp: mostly medium hands, strong hands would usually raise
          const lr = topRange(clamp(model.vpip * 1.3, 0.15, 0.85));
          const strong = topRange(0.04);
          for (let i = 0; i < NUM_COMBOS; i++) lr[i] *= strong[i] ? 0.35 : 1;
          intersect(r, lr);
          limps++;
        } else if (raises === 1) {
          const g = openerGroup(openerPos ?? 'CO');
          const base = pos === 'BB' ? CALL_BB[g] : pos === 'SB' ? CALL_SB : CALL_IP[g] || CALL_IP.late;
          intersect(r, scaleRange(chart(base), loose));
        } else if (raises === 2) intersect(r, scaleRange(chart(VS_3BET.callIP), Math.sqrt(loose)));
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
  // Big blind who checked their option: remove most strong hands (would have raised)
  return r;
}

/** Likelihood that a combo with strength s / draw d takes `type` facing this situation. */
function likelihood(
  rec: ActionRecord,
  s: number,
  d: number,
  street: Street,
  model: OpponentModel,
): number {
  const river = street === 'river';
  // how often air keeps betting on this street (conditional barrel rate), scaled by observed aggression
  const aggRatio = clamp(model.aggFreq / POPULATION.aggFreq, 0.3, 2);
  const shown = clamp(model.bluffRate / POPULATION.bluffRate, 0.4, 2.5);
  const base = street === 'flop' ? 0.4 : street === 'turn' ? 0.25 : 0.16;
  const bluffiness = clamp(base * aggRatio * (street === 'flop' ? 1 : shown), 0.03, 0.8);
  const stickiness = clamp(0.06 + 0.6 * (model.wtsd - 0.25), 0.03, 0.45);
  switch (rec.type) {
    case 'bet':
    case 'raise': {
      const raise = rec.type === 'raise';
      const frac = rec.potBefore > 0 ? rec.added / rec.potBefore : 1;
      const big = frac > 0.8 || rec.allIn;
      let value: number;
      if (raise) value = s >= 0.9 ? 1 : s >= 0.78 ? 0.55 : s >= 0.6 ? 0.18 : 0.05;
      else value = s >= 0.85 ? 1 : s >= 0.7 ? (big ? 0.55 : 0.8) : s >= 0.55 ? (big ? 0.2 : 0.45) : s >= 0.4 ? 0.2 : 0.08;
      const semi = river ? 0 : d >= 1 ? (raise ? 0.4 : 0.6) : d >= 0.5 ? (raise ? 0.15 : 0.3) : 0;
      const bluff = raise ? bluffiness * 0.35 : bluffiness;

      return Math.max(value, semi, bluff);
    }
    case 'call': {
      if (s >= 0.92) return 0.55;
      if (s >= 0.5) return 1;
      if (!river && d >= 1) return 0.9;
      if (!river && d >= 0.5) return 0.45;
      if (s >= 0.3) return 0.3 + stickiness;
      return stickiness;
    }
    case 'check':
      return s >= 0.9 ? 0.4 : s >= 0.75 ? 0.7 : 1;
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
export function estimateRange(view: PlayerView, pi: number, model: OpponentModel = POPULATION): Range {
  let r = preflopRange(view, pi, model);
  for (const a of view.actions) {
    if (a.pi !== pi || a.street === 'preflop') continue;
    const b = boardAt(view.board, a.street);
    if (b.length < 3) continue;
    const t = boardTable(b);
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (r[i] <= 0) continue;
      const s = t.strength[i];
      if (s < 0) {
        r[i] = 0;
        continue;
      }
      r[i] *= likelihood(a, s, t.draw[i], a.street, model);
    }
  }
  r = removeDead(r, [...view.hole, ...view.board]);
  return r;
}
