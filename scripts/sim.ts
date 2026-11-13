/**
 * Headless simulator: measures the Expert bot against every other personality and the
 * baseline bots, heads-up, in duplicate format (every deck is played twice with seats
 * swapped, which cancels most card luck). Reports bb/100 with a 95% confidence interval.
 *
 *   npm run sim                      # 20,000 hands per matchup (all matchups in parallel)
 *   npm run sim -- --hands 4000      # quicker
 *   npm run sim -- --ring 20000      # also a 6-max ring game with one of each
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mulberry32, shuffledDeck, type Rng } from '../src/engine/cards';
import { applyAction, startHand, validateAction, legalActions, type Action, type HandState } from '../src/engine/game';
import { publicHand, viewFor, type PlayerView } from '../src/engine/view';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { randomLegal, callingStation, maniac } from '../src/bots/baselines';
import { addHand, toModel, type PlayerStats } from '../src/bots/stats';

type BotId = 'expert' | 'tag' | 'lag' | 'nit' | 'station' | 'random' | 'callstation' | 'maniac';
const LABEL: Record<BotId, string> = {
  expert: 'Expert', tag: 'Solid (TAG)', lag: 'Aggressive (LAG)', nit: 'Tight-passive (nit)', station: 'Calling station (personality)',
  random: 'Baseline: random legal', callstation: 'Baseline: always call', maniac: 'Baseline: always raise (maniac)',
};

const BB = 2;
const STACK = 200; // 100 BB

function act(bot: BotId, v: PlayerView, stats: Record<string, PlayerStats>, rng: Rng, iters?: number): Action {
  switch (bot) {
    case 'random': return randomLegal(v, rng);
    case 'callstation': return callingStation(v);
    case 'maniac': return maniac(v);
    default: {
      const models: Record<string, ReturnType<typeof toModel>> = {};
      for (const p of v.players) if (p.pi !== v.me) models[p.id] = toModel(stats[p.id]);
      return decide({ view: v, persona: PERSONALITIES[bot], models, rng, iters }).action;
    }
  }
}

function playHand(bots: BotId[], ids: string[], buttonPi: number, deck: number[], stats: Record<string, PlayerStats>, rng: Rng, iters?: number): HandState {
  let h = startHand({
    handId: 1,
    config: { smallBlind: 1, bigBlind: BB },
    players: bots.map((_, i) => ({ id: ids[i], name: ids[i], seat: i, stack: STACK })),
    buttonPi,
    deck,
  });
  let guard = 0;
  while (!h.finished) {
    const pi = h.toAct;
    let a = act(bots[pi], viewFor(h, pi), stats, rng, iters);
    if (validateAction(h, a)) {
      const la = legalActions(h)!;
      a = la.canCheck ? { type: 'check' } : { type: 'fold' };
    }
    h = applyAction(h, a);
    if (++guard > 400) throw new Error('hand did not finish');
  }
  addHand(stats, publicHand(h, -1));
  return h;
}

/** Duplicate heads-up match: returns Expert's net chips per deck-pair. */
function headsUp(a: BotId, b: BotId, pairs: number, seed: number, iters?: number): number[] {
  const rng = mulberry32(seed);
  const stats: Record<string, PlayerStats> = {};
  const out: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const deck = shuffledDeck(rng);
    // hand 1: A on the button; hand 2: same cards, B on the button (seats swapped)
    const h1 = playHand([a, b], ['A', 'B'], 0, [...deck], stats, rng, iters);
    const h2 = playHand([b, a], ['B', 'A'], 0, [...deck], stats, rng, iters);
    const net1 = h1.players[0].stack - STACK;
    const net2 = h2.players[1].stack - STACK;
    out.push(net1 + net2);
  }
  return out;
}

function summarize(perPair: number[]) {
  const n = perPair.length;
  const mean = perPair.reduce((x, y) => x + y, 0) / n;
  const varr = perPair.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(varr / n);
  // per hand = per pair / 2; bb/100 = per hand / BB * 100
  const k = 100 / 2 / BB;
  return { hands: n * 2, bb100: mean * k, ci: 1.96 * se * k };
}

// ------------------------------------------------------------------ CLI / workers

const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

if (args[0] === '--worker') {
  const [, a, b, pairs, seed, iters] = args;
  const res = headsUp(a as BotId, b as BotId, Number(pairs), Number(seed), iters !== 'x' ? Number(iters) : undefined);
  process.stdout.write(JSON.stringify(summarize(res)));
  process.exit(0);
}

function runWorker(a: BotId, b: BotId, pairs: number, seed: number, iters?: number): Promise<{ hands: number; bb100: number; ci: number }> {
  return new Promise((resolve, reject) => {
    const self = fileURLToPath(import.meta.url);
    const p = spawn(process.execPath, ['--import', 'tsx', self, '--worker', a, b, String(pairs), String(seed), iters ? String(iters) : 'x'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf)) : reject(new Error(`${a} vs ${b} failed (${code})`))));
  });
}

async function main() {
  const hands = getArg('--hands', 20000);
  const iters = getArg('--iters', 0) || undefined;
  const chunks = getArg('--chunks', 4); // split each matchup across processes
  const opponents: BotId[] = ['tag', 'lag', 'nit', 'station', 'random', 'callstation', 'maniac'];
  const pairsPer = Math.ceil(hands / 2 / chunks);
  const t0 = Date.now();
  console.log(`Expert vs each opponent, heads-up, duplicate format, 100 BB stacks, ${hands.toLocaleString()} hands per matchup`);
  const jobs = opponents.map(async (o, oi) => {
    const parts = await Promise.all(
      Array.from({ length: chunks }, (_, c) => runWorker('expert', o, pairsPer, 1000 * (oi + 1) + c, iters)),
    );
    // combine chunk summaries (equal sizes): mean of means, CI / sqrt(chunks)
    const bb100 = parts.reduce((x, p) => x + p.bb100, 0) / parts.length;
    const ci = Math.sqrt(parts.reduce((x, p) => x + p.ci * p.ci, 0)) / parts.length;
    return { o, hands: parts.reduce((x, p) => x + p.hands, 0), bb100, ci };
  });
  const rows = await Promise.all(jobs);
  console.log('');
  console.log('Opponent'.padEnd(34) + 'Hands'.padStart(8) + '   Expert bb/100 (95% CI)        Result');
  let allWin = true;
  for (const r of rows) {
    const lo = r.bb100 - r.ci;
    const hi = r.bb100 + r.ci;
    const win = lo > 0;
    if (!win) allWin = false;
    console.log(
      LABEL[r.o].padEnd(34) +
        r.hands.toLocaleString().padStart(8) +
        `   ${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(1)} ± ${r.ci.toFixed(1)}  [${lo.toFixed(1)}, ${hi.toFixed(1)}]`.padEnd(32) +
        (win ? 'Expert wins' : 'not significant'),
    );
  }
  console.log('');
  console.log(allWin ? 'Expert beats every opponent with 95% confidence.' : 'WARNING: Expert did not beat every opponent with 95% confidence.');
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

void main();
