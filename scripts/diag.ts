/**
 * Dev diagnostic: play a heads-up duplicate match and print both players' stats and where
 * the chips went. Usage: npx tsx scripts/diag.ts expert lag 3000
 */
import { mulberry32, shuffledDeck } from '../src/engine/cards';
import { applyAction, startHand, type HandState } from '../src/engine/game';
import { publicHand, viewFor } from '../src/engine/view';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { addHand, toModel, rate, aggressionFactor, type PlayerStats } from '../src/bots/stats';
import type { BotStyle } from '../src/bots/types';

const [a, b, nStr, stackStr, resetStr] = process.argv.slice(2);
const STACK = Number(stackStr ?? 200);
const RESET = Number(resetStr ?? 0);
const N = Number(nStr ?? 2000);
const rng = mulberry32(7);
let stats: Record<string, PlayerStats> = {};
const allStats: Record<string, PlayerStats> = {};
const net: Record<string, Record<string, number>> = { A: {}, B: {} };
const reasons: Record<string, Record<string, number>> = { A: {}, B: {} };

function play(bots: string[], ids: string[], deck: number[]): HandState {
  let h = startHand({ handId: 1, config: { smallBlind: 1, bigBlind: 2 }, players: ids.map((id, i) => ({ id, name: id, seat: i, stack: STACK })), buttonPi: 0, deck });
  while (!h.finished) {
    const pi = h.toAct;
    const v = viewFor(h, pi);
    const models: Record<string, ReturnType<typeof toModel>> = {};
    for (const p of v.players) if (p.pi !== pi) models[p.id] = toModel(stats[p.id]);
    const d = decide({ view: v, persona: PERSONALITIES[bots[pi] as Exclude<BotStyle, 'placeholder'>], models, rng });
    const key = `${h.street} ${d.reason?.replace(/[\d.]+%?/g, '#').slice(0, 60)}`;
    reasons[ids[pi]][key] = (reasons[ids[pi]][key] ?? 0) + 1;
    h = applyAction(h, d.action);
  }
  addHand(stats, publicHand(h, -1));
  addHand(allStats, publicHand(h, -1));
  // net by last street reached
  h.players.forEach((p) => {
    const k = h.showdown ? 'showdown' : `won/lost before showdown on ${h.street}`;
    net[p.id][k] = (net[p.id][k] ?? 0) + (p.stack - STACK);
  });
  return h;
}

for (let i = 0; i < N; i++) {
  if (RESET && (2 * i) % RESET === 0) stats = {};
  const deck = shuffledDeck(rng);
  play([a, b], ['A', 'B'], [...deck]);
  play([b, a], ['B', 'A'], [...deck]);
}
for (const id of ['A', 'B']) {
  const s = allStats[id];
  const pc = (x: number) => (isNaN(x) ? '—' : (x * 100).toFixed(0) + '%');
  console.log(`${id} (${id === 'A' ? a : b}): VPIP ${pc(rate(s.vpip))} PFR ${pc(rate(s.pfr))} 3bet ${pc(rate(s.threeBet))} foldTo3bet ${pc(rate(s.foldTo3Bet))} limp ${pc(rate(s.limp))} cbet ${pc(rate(s.cbet))} foldToCbet ${pc(rate(s.foldToCbet))} AF ${aggressionFactor(s).toFixed(2)} WTSD ${pc(rate(s.wtsd))} W$SD ${pc(rate(s.wsd))}`);
  console.log('   model', JSON.stringify(toModel(s), (_k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  const total = Object.values(net[id]).reduce((x, y) => x + y, 0);
  console.log(`   net ${(total / 2 / (2 * N) * 100).toFixed(1)} bb/100;`, Object.entries(net[id]).map(([k, v]) => `${k}: ${(v / 2 / (2 * N) * 100).toFixed(1)}`).join(' | '));
  const top = Object.entries(reasons[id]).sort((x, y) => y[1] - x[1]).slice(0, 14);
  for (const [k, v] of top) console.log(`     ${v.toString().padStart(6)}  ${k}`);
}
