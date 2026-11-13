/**
 * Dev tool: play a match where the hero is a scripted "learner" with known leaks, then build
 * the coaching report and print it. Usage: npx tsx scripts/report-demo.ts [hands=60] [leak=mixed]
 * Leaks: calls too much on the river, folds draws to flop bets, limps, never c-bets,
 * bluffs the station.
 */
import { mulberry32 } from '../src/engine/cards';
import { applyAction, legalActions, type Action, type HandState } from '../src/engine/game';
import { createMatch, dealNextHand, recordHand, settleBetweenHands } from '../src/engine/match';
import { publicHand, viewFor, type PlayerView } from '../src/engine/view';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { addHand, toModel, type PlayerStats } from '../src/bots/stats';
import { buildReport } from '../src/analysis/coach';
import { drawScore } from '../src/bots/strength';
import { evaluate } from '../src/engine/evaluator';
import type { BotStyle } from '../src/bots/types';

const N = Number(process.argv[2] ?? 60);
const rng = mulberry32(Number(process.argv[3] ?? 5));
const bots: BotStyle[] = ['tag', 'lag', 'expert', 'nit', 'station'];

function learner(v: PlayerView): Action {
  const la = v.legal!;
  const cat = v.board.length ? evaluate([...v.hole, ...v.board]) >> 20 : -1;
  if (v.street === 'preflop') {
    if (la.toCall <= v.config.bigBlind && la.canCall) return { type: 'call' }; // limps
    if (la.canCheck) return { type: 'check' };
    return rng() < 0.45 ? { type: 'call' } : { type: 'fold' };
  }
  if (la.toCall > 0) {
    if (v.street === 'river') return { type: 'call' }; // calls every river bet
    if (drawScore(v.hole, v.board) >= 1 && v.street === 'flop') return { type: 'fold' }; // folds draws
    return cat >= 1 ? { type: 'call' } : { type: 'fold' };
  }
  // never c-bets; checks strong hands; bluffs the station on the river
  const station = v.players.find((p) => !p.folded && p.id === 'b4');
  if (v.street === 'river' && station && cat <= 0 && la.raiseType) return { type: la.raiseType, amount: Math.min(la.maxTo, Math.max(la.minTo, Math.round(v.pot))) };
  return { type: 'check' };
}

let m = createMatch({ smallBlind: 1, bigBlind: 2 }, 200, [
  { id: 'you', name: 'You', autoRebuy: true },
  ...bots.map((_b, i) => ({ id: `b${i}`, name: ['Mara', 'Dex', 'Ivo', 'Lena', 'Rook'][i], autoRebuy: true })),
]);
const stats: Record<string, PlayerStats> = {};
const hands: HandState[] = [];
for (let i = 0; i < N; i++) {
  m = settleBetweenHands(m);
  const d = dealNextHand(m, rng);
  m = d.match;
  let h = d.hand;
  while (!h.finished) {
    const pi = h.toAct;
    const v = viewFor(h, pi);
    let a: Action;
    if (h.players[pi].id === 'you') a = learner(v);
    else {
      const models: Record<string, ReturnType<typeof toModel>> = {};
      for (const p of v.players) if (p.pi !== pi) models[p.id] = toModel(stats[p.id], v.players.length);
      a = decide({ view: v, persona: PERSONALITIES[bots[Number(h.players[pi].id.slice(1))] as Exclude<BotStyle, 'placeholder'>], models, rng }).action;
    }
    if (!legalActions(h)) break;
    h = applyAction(h, a);
  }
  m = recordHand(m, h).match;
  const pub = publicHand(h, h.players.findIndex((p) => p.id === 'you'));
  addHand(stats, publicHand(h, -1));
  hands.push(pub);
}
const t0 = Date.now();
const r = buildReport({ hands, heroId: 'you', settings: { players: 6, startingBB: 100, hands: N, difficulty: 'mixed' } });
const ms = Date.now() - t0;
const { decisions, ...rest } = r;
console.log(JSON.stringify(rest, null, 1));
const all = Object.values(decisions).flat();
console.log(`\n${all.length} decisions analysed in ${ms} ms; kinds:`, all.reduce((acc: Record<string, number>, d) => ((acc[d.kind ?? 'none'] = (acc[d.kind ?? 'none'] ?? 0) + 1), acc), {}));
