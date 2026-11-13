/** Baseline opponents for measuring strength in simulation. */
import type { Action } from '../engine/game';
import type { PlayerView } from '../engine/view';
import type { Rng } from '../engine/cards';

/** Picks uniformly among legal action types; random legal raise size. */
export function randomLegal(v: PlayerView, rng: Rng): Action {
  const la = v.legal!;
  const opts: Action[] = [];
  if (la.canFold) opts.push({ type: 'fold' });
  opts.push(la.canCall ? { type: 'call' } : { type: 'check' });
  if (la.raiseType) opts.push({ type: la.raiseType, amount: la.minTo + Math.floor(rng() * (la.maxTo - la.minTo + 1)) });
  return opts[Math.floor(rng() * opts.length)];
}

/** Never folds, never raises. */
export function callingStation(v: PlayerView): Action {
  const la = v.legal!;
  return la.canCall ? { type: 'call' } : { type: 'check' };
}

/** Raises pot whenever it can, otherwise calls. */
export function maniac(v: PlayerView): Action {
  const la = v.legal!;
  if (la.raiseType) {
    const to = Math.max(la.minTo, Math.min(la.maxTo, v.currentBet + v.pot + la.toCall));
    return { type: la.raiseType, amount: to };
  }
  return la.canCall ? { type: 'call' } : { type: 'check' };
}
