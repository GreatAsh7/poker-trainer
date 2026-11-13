/**
 * Dev diagnostic: one Expert vs five copies of a bot (6-max), reads reset every 50 hands.
 * Prints the Expert's result split by its preflop role and by how hands ended, plus its most
 * frequent decision reasons. Usage: npx tsx scripts/diag6.ts lag 20000 80
 */
import { mulberry32, shuffledDeck } from '../src/engine/cards';
import { applyAction, startHand } from '../src/engine/game';
import { publicHand, viewFor } from '../src/engine/view';
import { positionOf } from '../src/engine/position';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { addHand, toModel, type PlayerStats } from '../src/bots/stats';

const [opp = 'lag', nStr = '20000', stackStr = '80'] = process.argv.slice(2);
const N = Number(nStr);
const STACK = Number(stackStr);
const rng = mulberry32(17);
let stats: Record<string, PlayerStats> = {};
const role: Record<string, number> = {};
const ending: Record<string, number> = {};
const reasons: Record<string, [number, number]> = {};
let total = 0;
for (let i = 0; i < N; i++) {
  if (i % 50 === 0) stats = {};
  const seat = i % 6;
  const ids = Array.from({ length: 6 }, (_, k) => (k === seat ? 'E' : `${opp}${k}`));
  let h = startHand({ handId: i, config: { smallBlind: 1, bigBlind: 2 }, players: ids.map((id, k) => ({ id, name: id, seat: k, stack: STACK })), buttonPi: 0, deck: shuffledDeck(rng) });
  const mine: string[] = [];
  while (!h.finished) {
    const pi = h.toAct;
    const v = viewFor(h, pi);
    const models: Record<string, ReturnType<typeof toModel>> = {};
    for (const p of v.players) if (p.pi !== pi) models[p.id] = toModel(stats[p.id], v.players.length);
    const d = decide({ view: v, persona: PERSONALITIES[pi === seat ? 'expert' : (opp as 'tag')], models, rng });
    if (pi === seat) mine.push(`${h.street} ${(d.reason ?? '').replace(/[\d.]+%?/g, '#').replace(/\(.*?\)/g, '').slice(0, 55)}`);
    h = applyAction(h, d.action);
  }
  addHand(stats, publicHand(h, -1));
  const net = (h.players[seat].stack - STACK) / 2;
  total += net;
  const pre = h.actions.filter((a) => a.street === 'preflop' && a.pi === seat && a.type !== 'check');
  const r = `${positionOf(6, 0, seat)} ${pre.map((a) => a.type).join('-') || 'walk'}`;
  role[r] = (role[r] ?? 0) + net;
  const e = h.players[seat].folded ? `folded on ${h.actions.find((a) => a.pi === seat && a.type === 'fold')!.street}` : h.showdown ? 'showdown' : 'won uncontested';
  ending[e] = (ending[e] ?? 0) + net;
  for (const m of new Set(mine)) {
    const x = (reasons[m] ??= [0, 0]);
    x[0]++;
    x[1] += net;
  }
}
const per = (x: number) => ((x / N) * 100).toFixed(1);
console.log(`Expert vs 5 × ${opp}, ${STACK / 2} BB: ${per(total)} bb/100`);
console.log('by ending:', Object.entries(ending).map(([k, v]) => `${k} ${per(v)}`).join(' | '));
console.log('by role (bb/100 contribution):');
for (const [k, v] of Object.entries(role).sort((a, b) => a[1] - b[1]).slice(0, 12)) console.log(`  ${per(v).padStart(7)}  ${k}`);
console.log('hands containing decision (count, avg bb per hand):');
for (const [k, [n, v]] of Object.entries(reasons).filter(([k]) => !process.env.GREP || k.includes(process.env.GREP)).sort((a, b) => a[1][1] - b[1][1]).slice(0, 14)) console.log(`  ${String(n).padStart(6)} ${(v / n).toFixed(2).padStart(7)}  ${k}`);
