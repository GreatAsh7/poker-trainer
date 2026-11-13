/**
 * 6-max ring game: one Expert, TAG, LAG, nit, station and a second Expert, rotating seats.
 * Prints each bot's bb/100 (95% CI), its stats (personalities should look distinct),
 * open-raise frequency by position, and decision times.
 *   npx tsx scripts/ring.ts [hands=6000]
 */
import { mulberry32, shuffledDeck } from '../src/engine/cards';
import { applyAction, startHand, validateAction, legalActions } from '../src/engine/game';
import { publicHand, viewFor } from '../src/engine/view';
import { positionOf } from '../src/engine/position';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { addHand, toModel, rate, aggressionFactor, type PlayerStats } from '../src/bots/stats';
import type { BotStyle } from '../src/bots/types';

const N = Number(process.argv[2] ?? 6000);
type S = Exclude<BotStyle, 'placeholder'>;
const lineup: { id: string; style: S }[] = [
  { id: 'Expert-1', style: 'expert' }, { id: 'TAG', style: 'tag' }, { id: 'LAG', style: 'lag' },
  { id: 'Nit', style: 'nit' }, { id: 'Station', style: 'station' }, { id: 'Expert-2', style: 'expert' },
];
const rng = mulberry32(99);
const stats: Record<string, PlayerStats> = {};
const results: Record<string, number[]> = {};
const opens: Record<string, Record<string, [number, number]>> = {};
const times: number[] = [];
const RESET = Number(process.argv[3] ?? 50);
const roleNet: Record<string, Record<string, number>> = {};
let statsLive: Record<string, PlayerStats> = {};
for (let hnd = 0; hnd < N; hnd++) {
  if (RESET && hnd % RESET === 0) statsLive = {};
  // rotate seating so everyone plays every position against everyone
  const order = lineup.map((_, i) => lineup[(i + hnd) % 6]);
  let h = startHand({
    handId: hnd, config: { smallBlind: 1, bigBlind: 2 },
    players: order.map((p, i) => ({ id: p.id, name: p.id, seat: i, stack: 200 })),
    buttonPi: 0, deck: shuffledDeck(rng),
  });
  const unopened = new Set<number>();
  while (!h.finished) {
    const pi = h.toAct;
    const v = viewFor(h, pi);
    const models: Record<string, ReturnType<typeof toModel>> = {};
    for (const p of v.players) if (p.pi !== pi) models[p.id] = toModel(statsLive[p.id], v.players.length);
    const t0 = performance.now();
    const d = decide({ view: v, persona: PERSONALITIES[order[pi].style], models, rng });
    times.push(performance.now() - t0);
    // open-raise opportunity: preflop, nobody has entered yet
    if (h.street === 'preflop' && !h.actions.some((a) => a.type !== 'fold') && !unopened.has(pi)) {
      unopened.add(pi);
      const pos = positionOf(6, h.buttonPi, pi);
      const o = ((opens[order[pi].id] ??= {})[pos] ??= [0, 0]);
      o[1]++;
      if (d.action.type === 'raise') o[0]++;
    }
    let a = d.action;
    if (validateAction(h, a)) {
      console.error('illegal bot action', order[pi].id, a, d.reason);
      const la = legalActions(h)!;
      a = la.canCheck ? { type: 'check' } : { type: 'fold' };
    }
    h = applyAction(h, a);
  }
  addHand(stats, publicHand(h, -1));
  addHand(statsLive, publicHand(h, -1));
  h.players.forEach((p, pi) => {
    const pre = h.actions.filter((a) => a.street === 'preflop');
    const raisesBefore = (k: number) => pre.slice(0, k).filter((a) => a.type === 'raise').length;
    let role = 'folded/walk';
    pre.forEach((a, k) => { if (a.pi === pi && a.type !== 'fold' && a.type !== 'check') role = (a.type === 'raise' ? ['open', '3bet', '4bet+', '4bet+'][Math.min(3, raisesBefore(k))] : ['limp', 'call open', 'call 3bet', 'call 4bet+'][Math.min(3, raisesBefore(k))]); });
    const pos = positionOf(6, h.buttonPi, pi);
    const key = `${role}`;
    const r = (roleNet[p.id] ??= {});
    r[key] = (r[key] ?? 0) + (p.stack - 200) / 2;
    r['pos ' + pos] = (r['pos ' + pos] ?? 0) + (p.stack - 200) / 2;
  });
  h.players.forEach((p) => (results[p.id] ??= []).push((p.stack - 200) / 2));
}
const pc = (x: number) => (isNaN(x) ? '  —' : `${(x * 100).toFixed(0)}%`.padStart(4));
console.log(`6-max ring, ${N.toLocaleString()} hands, 100 BB stacks (reset every hand)\n`);
console.log('Bot        bb/100 (95% CI)       VPIP PFR  3bet F3b  Cbet FCb  AF    WTSD  Opens UTG/HJ/CO/BTN/SB');
for (const { id } of lineup) {
  const r = results[id];
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  const s = stats[id];
  const op = ['UTG', 'HJ', 'CO', 'BTN', 'SB'].map((p) => {
    const o = opens[id]?.[p];
    return o ? `${Math.round((100 * o[0]) / o[1])}` : '—';
  });
  console.log(
    `${id.padEnd(10)} ${(mean * 100 >= 0 ? '+' : '') + (mean * 100).toFixed(1)} ± ${(1.96 * sd / Math.sqrt(r.length) * 100).toFixed(1)}`.padEnd(32) +
      `${pc(rate(s.vpip))} ${pc(rate(s.pfr))} ${pc(rate(s.threeBet))} ${pc(rate(s.foldTo3Bet))} ${pc(rate(s.cbet))} ${pc(rate(s.foldToCbet))} ${aggressionFactor(s).toFixed(2).padStart(5)} ${pc(rate(s.wtsd))}  ${op.join('/')}`,
  );
}
times.sort((a, b) => a - b);
console.log(`\nDecision time: median ${times[times.length >> 1].toFixed(1)} ms, p99 ${times[Math.floor(times.length * 0.99)].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms over ${times.length.toLocaleString()} decisions`);

for (const id of ['Expert-1', 'TAG', 'Nit']) console.log(id, Object.entries(roleNet[id]).map(([k, v]) => `${k}: ${(v / N * 100).toFixed(1)}`).join(' | '));
