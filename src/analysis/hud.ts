/** HUD numbers from public hand histories. Walks are not counted as preflop decisions. */
import type { HandState } from '../engine/game';
import { computeStats } from '../bots/stats';

export interface HudStats {
  /** preflop decisions (hands minus walks) */
  hands: number;
  vpip: number; // count
  pfr: number; // count
}

export function hudStats(history: readonly HandState[]): Record<string, HudStats> {
  const all = computeStats(history);
  const out: Record<string, HudStats> = {};
  for (const [id, s] of Object.entries(all)) out[id] = { hands: s.vpip.opp, vpip: s.vpip.n, pfr: s.pfr.n };
  return out;
}

export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '—');
