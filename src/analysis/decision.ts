/**
 * Analyse one of the hero's decisions using only information available at the time:
 * equity against each opponent's estimated range, pot odds, and a simple EV model for
 * folding, checking, calling and betting/raising. Pure TypeScript.
 *
 * EV figures are "from this decision onwards", in chips, relative to folding (= 0).
 * They are estimates: the equity is a Monte Carlo average against a range, and future
 * betting is approximated by an equity-realisation factor.
 */
import { mulberry32, type Card } from '../engine/cards';
import type { Action } from '../engine/game';
import type { PlayerView } from '../engine/view';
import { positionOf, hasPositionOn, type Position } from '../engine/position';
import { describeHandDetailed, evaluate } from '../engine/evaluator';
import { estimateRange } from '../bots/rangeModel';
import { equityVsRanges } from '../bots/equity';
import { boardTable, drawScore } from '../bots/strength';
import { COMBO_CARDS, NUM_COMBOS, className, comboIndex, type Range } from '../bots/combos';
import { CLASS_PERCENTILE, RFI, chart } from '../bots/preflopCharts';
import { CLASS_INDEX } from '../bots/combos';
import { POPULATION, type OpponentModel } from '../bots/stats';
import { decide } from '../bots/strategy';
import { PERSONALITIES } from '../bots/personalities';

export interface OptionEV {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** raise-to amount for bet/raise */
  to?: number;
  ev: number;
  label: string;
  /** for bets: share of the time everyone folds */
  foldPct?: number;
  /** for bets: equity when called */
  eqWhenCalled?: number;
}

export interface RangeMix {
  strong: number; // two pair or better
  pair: number; // one pair
  draw: number; // draws without a pair
  air: number;
}

export interface DecisionAnalysis {
  handId: number;
  actionIndex: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  position: Position;
  inPosition: boolean;
  hole: Card[];
  board: Card[];
  /** all chips in the middle before the decision */
  pot: number;
  toCall: number;
  /** equity needed to call */
  need: number;
  equity: number;
  nOpp: number;
  /** main opponent (bettor or first live) */
  villainId: string;
  villainName: string;
  villainMix: RangeMix | null;
  /** villain range size as share of all hands (preflop) */
  villainRangePct: number;
  handName: string;
  /** hand class like "AKs" and its preflop percentile (0 = best) */
  handClass: string;
  handPercentile: number;
  heroAction: Action;
  options: OptionEV[];
  heroEV: number;
  best: OptionEV;
  evLoss: number;
  expert: { action: Action; reason: string };
  /** open-raise chart check for unopened preflop pots */
  openChart?: { inRange: number; rangePct: number };
  bigBlind: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function mixOf(r: Range, board: Card[]): RangeMix | null {
  if (board.length < 3) return null;
  const mix = { strong: 0, pair: 0, draw: 0, air: 0 };
  let tot = 0;
  const cards: Card[] = [0, 0, ...board];
  const t = boardTable(board);
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    cards[0] = a;
    cards[1] = b;
    const cat = evaluate(cards) >> 20;
    tot += w;
    if (cat >= 2) mix.strong += w;
    else if (cat === 1) mix.pair += w;
    else if (board.length < 5 && t.draw[i] >= 1) mix.draw += w;
    else mix.air += w;
  }
  if (tot <= 0) return null;
  return { strong: mix.strong / tot, pair: mix.pair / tot, draw: mix.draw / tot, air: mix.air / tot };
}

/** Share of a range that continues facing a bet of `frac` × pot, and the continuing range. */
function continuing(r: Range, board: Card[], frac: number): { share: number; range: Range } {
  const out = new Float64Array(NUM_COMBOS);
  if (board.length < 3) {
    // preflop: continue with the top part of the range
    return { share: 0.5, range: r };
  }
  const t = boardTable(board);
  const thr = 0.45 + 0.18 * clamp(frac, 0.25, 1.5);
  let tot = 0;
  let cont = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    tot += w;
    const s = t.strength[i];
    const d = board.length < 5 ? t.draw[i] : 0;
    const p = s >= thr ? 1 : d >= 1 ? 0.85 : d >= 0.5 && frac < 0.6 ? 0.4 : s >= thr - 0.15 ? 0.35 : 0.05;
    out[i] = w * p;
    cont += w * p;
  }
  return { share: tot > 0 ? cont / tot : 0, range: out };
}

export function analyzeDecision(
  view: PlayerView,
  heroAction: Action,
  actionIndex: number,
  models: Record<string, OpponentModel>,
  seed = 1,
): DecisionAnalysis {
  const rng = mulberry32(seed);
  const la = view.legal!;
  const np = view.players.length;
  const me = view.players[view.me];
  const bb = view.config.bigBlind;
  const live = view.players.filter((p) => !p.folded && p.pi !== view.me);
  const villain = view.lastAggressor >= 0 && view.lastAggressor !== view.me && !view.players[view.lastAggressor].folded
    ? view.players[view.lastAggressor]
    : live[0];
  const ranges = live.map((p) => estimateRange(view, p.pi, models[p.id] ?? POPULATION));
  const vRange = ranges[live.indexOf(villain)] ?? ranges[0];
  const iters = view.street === 'preflop' ? 1500 : 2000;
  const equity = equityVsRanges(view.hole, view.board, ranges, iters, rng).equity;
  const pot = view.pot;
  const toCall = la.toCall;
  const callAmt = la.callAmount;
  const need = toCall > 0 ? callAmt / (pot + callAmt) : 0;
  const inPosition = live.every((p) => hasPositionOn(np, view.buttonPi, view.me, p.pi));
  const street = view.street;
  const river = street === 'river';
  // equity realisation: share of raw equity a hand actually wins when there is betting to come
  const realize = river || la.callIsAllIn ? 1 : street === 'preflop' ? (inPosition ? 0.88 : 0.72) : inPosition ? 0.95 : 0.85;

  const options: OptionEV[] = [];
  if (la.canFold) options.push({ kind: 'fold', ev: 0, label: 'Fold' });
  if (la.canCheck) options.push({ kind: 'check', ev: equity * pot * realize, label: 'Check' });
  if (la.canCall) options.push({ kind: 'call', ev: equity * (pot + callAmt) * realize - callAmt, label: `Call ${callAmt}` });

  // bets / raises (postflop; preflop only all-in decisions are modelled)
  const sizes: { to: number; label: string }[] = [];
  if (la.raiseType && street !== 'preflop') {
    const potAfterCall = pot + toCall;
    for (const [f, lbl] of [[0.5, '½ pot'], [0.75, '¾ pot'], [1, 'pot']] as const) {
      const to = Math.round(view.currentBet + f * potAfterCall);
      if (to >= la.minTo && to <= la.maxTo) sizes.push({ to, label: lbl });
    }
    if (heroAction.type === la.raiseType && heroAction.amount) sizes.push({ to: heroAction.amount, label: 'your size' });
    sizes.push({ to: la.maxTo, label: 'all-in' });
  } else if (la.raiseType && heroAction.type === la.raiseType && heroAction.amount === la.maxTo) {
    sizes.push({ to: la.maxTo, label: 'all-in' });
  }
  const seen = new Set<number>();
  for (const s of sizes) {
    if (seen.has(s.to)) continue;
    seen.add(s.to);
    const add = s.to - me.streetBet;
    const frac = add / Math.max(1, pot);
    // everyone must fold for the bet to win immediately
    let allFold = 1;
    const contRanges: Range[] = [];
    for (let k = 0; k < live.length; k++) {
      const c = continuing(ranges[k], view.board, frac);
      allFold *= 1 - c.share;
      contRanges.push(c.range);
    }
    const eqCalled = equityVsRanges(view.hole, view.board, contRanges, 800, rng).equity;
    // when called: villain adds (to − their street bet); assume one caller
    const villainAdd = Math.max(0, s.to - (villain?.streetBet ?? 0));
    const r2 = s.to === la.maxTo || river ? 1 : realize;
    const evCalled = eqCalled * (pot + add + villainAdd) * r2 - add;
    const ev = allFold * pot + (1 - allFold) * evCalled;
    options.push({
      kind: la.raiseType!,
      to: s.to,
      ev,
      label: `${la.raiseType === 'bet' ? 'Bet' : 'Raise to'} ${s.to} (${s.label})`,
      foldPct: allFold,
      eqWhenCalled: eqCalled,
    });
  }

  // EV of what the hero actually did
  let heroEV: number;
  const pick = (k: OptionEV['kind'], to?: number) =>
    options.find((o) => o.kind === k && (to === undefined || o.to === to));
  if (heroAction.type === 'bet' || heroAction.type === 'raise') heroEV = (pick(heroAction.type, heroAction.amount) ?? { ev: NaN }).ev;
  else heroEV = (pick(heroAction.type) ?? { ev: 0 }).ev;
  const comparable = options.filter((o) => !isNaN(o.ev));
  const best = comparable.reduce((a, b) => (b.ev > a.ev ? b : a), comparable[0]);
  const evLoss = isNaN(heroEV) ? 0 : Math.max(0, best.ev - heroEV);

  // what the Expert bot would do in the hero's seat
  const ex = decide({ view, persona: PERSONALITIES.expert, models, rng: mulberry32(seed + 7) });

  const cls = className(view.hole[0], view.hole[1]);
  const pos = positionOf(np, view.buttonPi, view.me);
  let openChart: DecisionAnalysis['openChart'];
  const unopened = street === 'preflop' && !view.actions.some((a) => a.type !== 'fold');
  if (unopened && pos !== 'BB') {
    const r = chart(RFI[pos === 'SB' ? 'SB' : pos]);
    let size = 0;
    for (let i = 0; i < NUM_COMBOS; i++) size += r[i];
    openChart = { inRange: r[comboIndex(view.hole[0], view.hole[1])], rangePct: size / NUM_COMBOS };
  }
  let vSize = 0;
  let vTot = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    vSize += vRange[i];
    vTot += 1;
  }
  const made = view.board.length >= 3 ? describeHandDetailed(evaluate([...view.hole, ...view.board])) : cls;
  const dr = view.board.length >= 3 && view.board.length < 5 ? drawScore(view.hole, view.board) : 0;
  const handName = dr >= 1.5 ? `${made} with a combo draw` : dr >= 1 ? `${made} with a draw` : dr >= 0.5 ? `${made} with a gutshot` : made;

  return {
    handId: view.handId,
    actionIndex,
    street,
    position: pos,
    inPosition,
    hole: view.hole,
    board: view.board,
    pot,
    toCall: callAmt,
    need,
    equity,
    nOpp: live.length,
    villainId: villain?.id ?? '',
    villainName: villain?.name ?? '',
    villainMix: mixOf(vRange, view.board),
    villainRangePct: vSize / vTot,
    handName,
    handClass: cls,
    handPercentile: CLASS_PERCENTILE[CLASS_INDEX.get(cls)!],
    heroAction,
    options,
    heroEV,
    best,
    evLoss,
    expert: { action: ex.action, reason: ex.reason ?? '' },
    openChart,
    bigBlind: bb,
  };
}
