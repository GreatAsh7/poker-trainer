/**
 * Headless simulator. Measures the Expert bot under the conditions the app plays:
 * opponent stats are reset every match (default every 50 hands), several stack depths,
 * heads-up and 6-max.
 *
 * - Heads-up, duplicate format: every deck is played twice with the seats swapped.
 * - 6-max ring, duplicate format: every deck is played six times, rotating the seating so
 *   each bot gets every seat's cards once. One Expert, TAG, LAG, nit, station and a second TAG.
 * Reports bb/100 with 95% confidence intervals. Any illegal bot action fails the run.
 *
 *   npm run sim                        # full run (20,000 hands per heads-up row; NOTES uses --hands 60000)
 *   npm run sim -- --hands 4000        # quicker
 *   npm run sim -- --reset 0           # never reset reads (one long session)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mulberry32, shuffledDeck, type Rng } from '../src/engine/cards';
import { applyAction, startHand, validateAction, type Action, type HandState } from '../src/engine/game';
import { publicHand, viewFor, type PlayerView } from '../src/engine/view';
import { decide } from '../src/bots/strategy';
import { PERSONALITIES } from '../src/bots/personalities';
import { randomLegal, callingStation, maniac } from '../src/bots/baselines';
import { addHand, toModel, type PlayerStats } from '../src/bots/stats';

type BotId = 'expert' | 'tag' | 'lag' | 'nit' | 'station' | 'random' | 'callstation' | 'maniac' | 'threebettor' | 'jammer';
const LABEL: Record<BotId, string> = {
  expert: 'Expert', tag: 'Solid (TAG)', lag: 'Aggressive (LAG)', nit: 'Tight-passive (nit)', station: 'Calling station',
  random: 'Baseline: random legal', callstation: 'Baseline: always call', maniac: 'Baseline: always raise',
  threebettor: 'Exploit: TAG that 3-bets every open', jammer: 'Exploit: shove every hand',
};
const BB = 2;

let illegal = 0;
/** dev experiments: EXPERT_PATCH='{"balanced":false}' npm run sim */
const EXPERT_PATCH = process.env.EXPERT_PATCH ? (JSON.parse(process.env.EXPERT_PATCH) as Record<string, unknown>) : null;

function act(bot: BotId, v: PlayerView, stats: Record<string, PlayerStats>, rng: Rng): Action {
  const la = v.legal!;
  switch (bot) {
    case 'random':
      return randomLegal(v, rng);
    case 'callstation':
      return callingStation(v);
    case 'maniac':
      return maniac(v);
    case 'jammer':
      if (v.street === 'preflop') return la.raiseType ? { type: la.raiseType, amount: la.maxTo } : la.canCall ? { type: 'call' } : { type: 'check' };
      return la.canCheck ? { type: 'check' } : { type: 'call' };
    case 'threebettor': {
      const raises = v.actions.filter((a) => a.type === 'raise' || a.type === 'bet').length;
      if (v.street === 'preflop' && raises === 1 && la.raiseType)
        return { type: la.raiseType, amount: Math.min(la.maxTo, Math.max(la.minTo, v.currentBet * 3)) };
      return act('tag', v, stats, rng);
    }
    default: {
      const models: Record<string, ReturnType<typeof toModel>> = {};
      for (const p of v.players) if (p.pi !== v.me) models[p.id] = toModel(stats[p.id], v.players.length);
      const persona = bot === 'expert' && EXPERT_PATCH ? { ...PERSONALITIES.expert, ...EXPERT_PATCH } : PERSONALITIES[bot as 'expert'];
      return decide({ view: v, persona, models, rng }).action;
    }
  }
}

function playHand(bots: BotId[], ids: string[], stack: number, deck: number[], stats: Record<string, PlayerStats>, rng: Rng): HandState {
  let h = startHand({
    handId: 1,
    config: { smallBlind: 1, bigBlind: BB },
    players: bots.map((_, i) => ({ id: ids[i], name: ids[i], seat: i, stack })),
    buttonPi: 0,
    deck,
  });
  let guard = 0;
  while (!h.finished) {
    const pi = h.toAct;
    const a = act(bots[pi], viewFor(h, pi), stats, rng);
    if (validateAction(h, a)) {
      illegal++;
      throw new Error(`illegal action by ${bots[pi]}: ${JSON.stringify(a)}`);
    }
    h = applyAction(h, a);
    if (++guard > 400) throw new Error('hand did not finish');
  }
  addHand(stats, publicHand(h, -1));
  return h;
}

/** Duplicate heads-up: Expert's net chips per deck pair. */
function headsUp(opp: BotId, pairs: number, seed: number, stackBB: number, reset: number): number[] {
  const rng = mulberry32(seed);
  let stats: Record<string, PlayerStats> = {};
  const out: number[] = [];
  const stack = stackBB * BB;
  for (let i = 0; i < pairs; i++) {
    if (reset > 0 && (2 * i) % reset === 0) stats = {};
    const deck = shuffledDeck(rng);
    const h1 = playHand(['expert', opp], ['A', 'B'], stack, [...deck], stats, rng);
    const h2 = playHand([opp, 'expert'], ['B', 'A'], stack, [...deck], stats, rng);
    out.push(h1.players[0].stack - stack + (h2.players[1].stack - stack));
  }
  return out;
}

const MIXED: BotId[] = ['expert', 'tag', 'lag', 'nit', 'station', 'tag'];
const MIXED_IDS = ['Expert', 'TAG-1', 'LAG', 'Nit', 'Station', 'TAG-2'];

/**
 * Duplicate 6-max ring: per deck, each bot's net over the six rotations.
 * lineup 'mixed' = one of each; otherwise one Expert against five copies of that bot.
 */
function ring(lineup: string, decks: number, seed: number, stackBB: number, reset: number): number[][] {
  const RING: BotId[] = lineup === 'mixed' ? MIXED : ['expert', ...Array(5).fill(lineup as BotId)];
  const RING_IDS = lineup === 'mixed' ? MIXED_IDS : ['Expert', ...[1, 2, 3, 4, 5].map((k) => `${lineup}-${k}`)];
  const rng = mulberry32(seed);
  let stats: Record<string, PlayerStats> = {};
  const stack = stackBB * BB;
  const out: number[][] = [];
  let played = 0;
  for (let d = 0; d < decks; d++) {
    const deck = shuffledDeck(rng);
    const net = RING.map(() => 0);
    for (let rot = 0; rot < 6; rot++) {
      if (reset > 0 && played % reset === 0) stats = {};
      played++;
      const order = RING.map((_, i) => (i + rot) % 6); // seat i gets bot order[i]
      const h = playHand(order.map((k) => RING[k]), order.map((k) => RING_IDS[k]), stack, [...deck], stats, rng);
      h.players.forEach((p, i) => (net[order[i]] += p.stack - stack));
    }
    out.push(net);
  }
  return out;
}

function ci(xs: number[], perUnitHands: number) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const k = 100 / perUnitHands / BB;
  return { mean: mean * k, half: (1.96 * sd * k) / Math.sqrt(n), n };
}

// ------------------------------------------------------------------ CLI / workers
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

if (args[0] === '--worker') {
  const [, kind, opp, n, seed, stackBB, reset] = args;
  if (kind === 'hu') process.stdout.write(JSON.stringify(headsUp(opp as BotId, +n, +seed, +stackBB, +reset)));
  else process.stdout.write(JSON.stringify(ring(opp, +n, +seed, +stackBB, +reset)));
  process.exit(0);
}

function run(kind: 'hu' | 'ring', opp: string, n: number, seed: number, stackBB: number, reset: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const self = fileURLToPath(import.meta.url);
    const p = spawn(process.execPath, ['--import', 'tsx', self, '--worker', kind, opp, String(n), String(seed), String(stackBB), String(reset)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf)) : reject(new Error(`${kind} ${opp} ${stackBB}BB failed (exit ${code})`))));
  });
}

const fmt = (x: { mean: number; half: number }) => `${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(1)} ± ${x.half.toFixed(1)}`;

async function main() {
  const hands = getArg('--hands', 20000);
  const reset = getArg('--reset', 50);
  const chunks = getArg('--chunks', 4);
  const t0 = Date.now();
  const rows: { opp: BotId; stack: number }[] = [
    ...(['tag', 'lag', 'nit', 'station', 'threebettor', 'jammer', 'random', 'callstation', 'maniac'] as BotId[]).map((opp) => ({ opp, stack: 100 })),
    ...(['tag', 'lag', 'nit', 'station', 'jammer'] as BotId[]).map((opp) => ({ opp, stack: 40 })),
    ...(['tag', 'lag', 'nit', 'station', 'jammer', 'threebettor'] as BotId[]).map((opp) => ({ opp, stack: 20 })),
    ...(['tag', 'lag', 'nit', 'station', 'jammer'] as BotId[]).map((opp) => ({ opp, stack: 10 })),
  ];
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null; // e.g. 100:tag,20:lag,ring
  const sel = only ? rows.filter((r) => only.includes(`${r.stack}:${r.opp}`)) : [...rows];
  rows.length = 0;
  rows.push(...sel);
  const skipRing = !!only && !only.includes('mixed');
  const pairsPer = Math.ceil(hands / 2 / chunks);
  const huJobs = rows.map(async (r, ri) => {
    const parts = (await Promise.all(Array.from({ length: chunks }, (_, c) => run('hu', r.opp, pairsPer, 7919 * (ri + 1) + c, r.stack, reset)))) as number[][];
    return { ...r, res: ci(parts.flat(), 2) };
  });
  // 6-max: one Expert vs five copies of each personality (the Expert's own result is its edge)
  const ringRowsSpec: { opp: BotId; stack: number }[] = [
    ...(['tag', 'lag', 'nit', 'station'] as BotId[]).map((opp) => ({ opp, stack: 100 })),
    ...(['tag', 'lag', 'nit', 'station'] as BotId[]).map((opp) => ({ opp, stack: 40 })),
    ...(['tag', 'lag', 'nit', 'station', 'jammer'] as BotId[]).map((opp) => ({ opp, stack: 20 })),
    ...(['tag', 'nit'] as BotId[]).map((opp) => ({ opp, stack: 200 })),
    ...(['tag', 'lag', 'nit'] as BotId[]).map((opp) => ({ opp, stack: 12 })),
  ].filter((r) => !only || only.includes(`ring${r.stack}:${r.opp}`));
  const decksPer = Math.ceil((hands * 2) / 6 / chunks);
  const vsJobs = ringRowsSpec.map(async (r, oi) => {
    // deep stacks swing more: 200 BB rows get 2.5x the hands for a comparable confidence interval
    const decks = r.stack >= 200 ? Math.ceil(decksPer * 2.5) : decksPer;
    const parts = (await Promise.all(Array.from({ length: chunks }, (_, c) => run('ring', r.opp, decks, 31337 * (oi + 1) + c, r.stack, reset)))) as number[][][];
    return { opp: r.opp, stack: r.stack, res: ci(parts.flat().map((d) => d[0]), 6), hands: parts.flat().length * 6 };
  });
  const ringJob = (async () => {
    if (skipRing) return [] as number[][];
    const parts = (await Promise.all(Array.from({ length: chunks * 2 }, (_, c) => run('ring', 'mixed', Math.ceil(decksPer / 2), 104729 + c, 100, reset)))) as number[][][];
    return parts.flat();
  })();
  const [hu, vs, ringRows] = await Promise.all([Promise.all(huJobs), Promise.all(vsJobs), ringJob]);

  console.log(`Expert vs each opponent — heads-up, duplicate (every deck played twice with seats swapped).`);
  console.log(`Opponent reads reset every ${reset || '∞'} hands (like a new match in the app). ${hands.toLocaleString()} hands per row.\n`);
  console.log('Stack  Opponent'.padEnd(46) + 'Expert bb/100 (95% CI)    Result');
  let allWin = true;
  for (const r of hu) {
    const win = r.res.mean - r.res.half > 0;
    if (!win) allWin = false;
    console.log(`${String(r.stack).padStart(3)} BB  ${LABEL[r.opp]}`.padEnd(46) + fmt(r.res).padEnd(26) + (win ? 'Expert wins' : 'NOT significant'));
  }
  if (vs.length) {
    console.log(`\n6-max: one Expert against five copies of each bot (duplicate, seats rotated), ${vs[0].hands.toLocaleString()} hands per row (2.5x at 200 BB).`);
    console.log('Stack  Opponents'.padEnd(46) + 'Expert bb/100 (95% CI)    Result');
    for (const r of vs) {
      const win = r.res.mean - r.res.half > 0;
      if (!win) allWin = false;
      console.log(`${String(r.stack).padStart(3)} BB  5 × ${LABEL[r.opp]}`.padEnd(46) + fmt(r.res).padEnd(26) + (win ? 'Expert wins' : 'NOT significant'));
    }
  }
  // mixed ring (information: who profits most from the weak players)
  if (!ringRows.length) {
    console.log(`
Illegal bot actions: none (any illegal action aborts the run)`);
    return;
  }
  const per = MIXED_IDS.map((_, k) => ci(ringRows.map((d) => d[k]), 6));
  console.log(`\nFor information — mixed 6-max table (one of each), 100 BB, duplicate, ${(ringRows.length * 6).toLocaleString()} hands:`);
  console.log('Bot'.padEnd(12) + 'bb/100 (95% CI)');
  MIXED_IDS.forEach((id, k) => console.log(id.padEnd(12) + fmt(per[k])));
  console.log(`\nIllegal bot actions: none (any illegal action aborts the run)`);
  console.log(allWin ? 'PASS: Expert beats every opponent with 95% confidence in every row.' : 'FAIL: at least one row is not a significant Expert win.');
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!allWin) process.exitCode = 1;
}

void main();
