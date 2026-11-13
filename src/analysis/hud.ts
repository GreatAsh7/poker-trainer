/** Basic HUD statistics computed from public hand histories (actions only). */
import type { HandState } from '../engine/game';

export interface HudStats {
  hands: number;
  vpip: number; // count
  pfr: number; // count
}

export function hudStats(history: readonly HandState[]): Record<string, HudStats> {
  const out: Record<string, HudStats> = {};
  for (const h of history) {
    h.players.forEach((p, pi) => {
      const st = (out[p.id] ??= { hands: 0, vpip: 0, pfr: 0 });
      st.hands++;
      const pre = h.actions.filter((a) => a.pi === pi && a.street === 'preflop');
      if (pre.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet')) st.vpip++;
      if (pre.some((a) => a.type === 'raise' || a.type === 'bet')) st.pfr++;
    });
  }
  return out;
}

export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '—');
