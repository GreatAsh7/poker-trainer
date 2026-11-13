/**
 * Milestone-2 placeholder bot: plays a simple, sane hand-strength strategy so the table is
 * playable before the real strategy core lands. Replaced by the strategic bots in milestone 3.
 */
import { rankOf, suitOf, mulberry32 } from '../engine/cards';
import { evaluate, categoryOf } from '../engine/evaluator';
import type { Action } from '../engine/game';
import type { Bot, BotDecisionRequest, BotDecision } from './types';

function preflopScore(a: number, b: number): number {
  const r1 = Math.max(rankOf(a), rankOf(b));
  const r2 = Math.min(rankOf(a), rankOf(b));
  let s = r1 + r2 / 2;
  if (r1 === r2) s += 10 + r1;
  if (suitOf(a) === suitOf(b)) s += 2;
  if (r1 - r2 === 1) s += 1;
  return s; // ~1.5 (32o) .. 34 (AA)
}

export const placeholderBot: Bot = {
  decide({ view, seed }: BotDecisionRequest): BotDecision {
    const rng = mulberry32(seed);
    const la = view.legal!;
    const pot = view.pot;
    const call: Action = la.canCall ? { type: 'call' } : { type: 'check' };
    const fold: Action = la.canFold ? { type: 'fold' } : { type: 'check' };
    const raise = (frac: number): Action | null => {
      if (!la.raiseType) return null;
      const target = view.currentBet + Math.round((pot + la.toCall) * frac);
      const amt = Math.max(la.minTo, Math.min(la.maxTo, target));
      return { type: la.raiseType, amount: amt };
    };
    let strength: number;
    if (view.street === 'preflop') {
      strength = preflopScore(view.hole[0], view.hole[1]) / 34;
    } else {
      const cat = categoryOf(evaluate([...view.hole, ...view.board]));
      strength = [0.2, 0.5, 0.72, 0.82, 0.88, 0.9, 0.95, 0.99, 1][cat];
    }
    const potOdds = la.toCall > 0 ? la.toCall / (pot + la.toCall) : 0;
    const r = rng();
    if (strength > 0.7 && r < 0.7) return { action: raise(0.66) ?? call, reason: 'strong' };
    if (strength > 0.45 || (la.toCall === 0 && r < 0.2)) {
      if (la.toCall === 0 && r < 0.35) return { action: raise(0.5) ?? call, reason: 'probe' };
      return { action: strength > potOdds + 0.15 ? call : fold, reason: 'medium' };
    }
    return { action: la.toCall === 0 ? call : r < 0.1 ? call : fold, reason: 'weak' };
  },
};
