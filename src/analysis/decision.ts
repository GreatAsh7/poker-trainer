/**
 * Analyse one of the hero's decisions using only information available at the time:
 * equity against each opponent's estimated range, pot odds, and an EV model for folding,
 * checking, calling, betting/raising and (preflop) opening, 3-betting and shoving.
 *
 * EV figures are "from this decision onwards", in chips, relative to folding (= 0).
 * They are estimates: equity is a Monte Carlo average against a range, and future betting
 * is approximated with an equity-realisation factor.
 */
import { mulberry32, type Card } from '../engine/cards';
import type { Action } from '../engine/game';
import type { PlayerView } from '../engine/view';
import { positionOf, hasPositionOn, type Position } from '../engine/position';
import { describeHandDetailed, evaluate, categoryOf } from '../engine/evaluator';
import { estimateRange } from '../bots/rangeModel';
import { equityVsRanges } from '../bots/equity';
import { boardTable, drawScore } from '../bots/strength';
import { COMBO_CARDS, COMBO_CLASS, NUM_COMBOS, className, comboIndex, type Range } from '../bots/combos';
import { CLASS_PERCENTILE, RFI, chart } from '../bots/preflopCharts';
import { CLASS_INDEX } from '../bots/combos';
import { POPULATION, populationFor, type OpponentModel } from '../bots/stats';
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
  strong: number; // two pair or better (using a hole card)
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
  /** chips you can win before your decision (other players' chips capped at your stack) */
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
  /** the hero was the last aggressor on the previous street (c-bet spots) */
  hadInitiative: boolean;
  /** first voluntary action preflop with nobody in yet */
  unopened: boolean;
  bigBlind: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function mixOf(r: Range, board: Card[]): RangeMix | null {
  if (board.length < 3) return null;
  const mix = { strong: 0, pair: 0, draw: 0, air: 0 };
  let tot = 0;
  const cards: Card[] = [0, 0, ...board];
  const t = boardTable(board);
  const boardVal = board.length >= 5 ? evaluate(board) : -1;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = r[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    cards[0] = a;
    cards[1] = b;
    const val = evaluate(cards);
    let cat: number = categoryOf(val);
    if (board.length >= 5 && val === boardVal) cat = 0; // plays the board: no hand of their own
    tot += w;
    if (cat >= 2) mix.strong += w;
    else if (cat === 1) mix.pair += w;
    else if (board.length < 5 && t.draw[i] >= 1) mix.draw += w;
    else mix.air += w;
  }
  if (tot <= 0) return null;
  return { strong: mix.strong / tot, pair: mix.pair / tot, draw: mix.draw / tot, air: mix.air / tot };
}

/** Top `share` of a range by preflop ranking. */
function topOf(r: Range, share: number): Range {
  const order: number[] = [];
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++)
    if (r[i] > 0) {
      order.push(i);
      total += r[i];
    }
  order.sort((a, b) => CLASS_PERCENTILE[COMBO_CLASS[a]] - CLASS_PERCENTILE[COMBO_CLASS[b]]);
  const out = new Float64Array(NUM_COMBOS);
  let acc = 0;
  for (const i of order) {
    if (acc >= share * total) break;
    out[i] = r[i];
    acc += r[i];
  }
  return out;
}

/**
 * Share of a range that continues facing a bet that adds `add` into `pot`, and the
 * continuing range.
 * - Preflop, a player who has not acted yet defends by position (big blind widest);
 *   a player who already raised continues with the top part of their range by price.
 * - Postflop, players continue with the top part of their own range, close to minimum
 *   defence (1 − 1.6 × price), wider if they have already bet this street, and adjusted by
 *   how often they actually folded to bets this match.
 */
function continuing(
  r: Range,
  board: Card[],
  add: number,
  pot: number,
  m: OpponentModel,
  opts: { actedPreflop?: boolean; pos?: Position; aggressor?: boolean } = {},
): { share: number; range: Range } {
  const price = add / (pot + 2 * add);
  if (board.length < 3) {
    let share: number;
    if (!opts.actedPreflop) {
      // defending against an open from behind: big blind widest, then small blind
      const base = opts.pos === 'BB' ? 0.38 : opts.pos === 'SB' ? 0.16 : 0.1;
      share = base * Math.sqrt(clamp(0.27 / Math.max(price, 0.05), 0.3, 3)) * clamp(m.vpip / POPULATION.vpip, 0.6, 2.2);
    } else {
      share = clamp(0.1 + 1.6 * (0.6 - price), 0.12, 0.85) * clamp((1 - m.foldTo3Bet) / (1 - POPULATION.foldTo3Bet), 0.6, 1.8);
    }
    share = clamp(share, 0.04, 0.95);
    return { share, range: topOf(opts.actedPreflop ? r : r, share) };
  }
  const t = boardTable(board);
  const sticky = clamp((1 - m.foldToBet) / (1 - POPULATION.foldToBet), 0.5, 2.4) * clamp(m.wtsd / POPULATION.wtsd, 0.7, 1.8);
  let F = clamp(1 - 1.6 * price, 0.2, 0.9) * Math.sqrt(sticky);
  if (opts.aggressor) F *= 1.35; // they bet or raised this street: they rarely give up to a raise
  F = clamp(F, 0.1, 0.97);
  // rank their combos by made strength plus draws, keep the top F of the weight
  const order: number[] = [];
  let tot = 0;
  for (let i = 0; i < NUM_COMBOS; i++)
    if (r[i] > 0 && t.strength[i] >= 0) {
      order.push(i);
      tot += r[i];
    }
  const score = (i: number) => t.strength[i] + (board.length < 5 ? 0.15 * t.draw[i] : 0);
  order.sort((a, b) => score(b) - score(a));
  const out = new Float64Array(NUM_COMBOS);
  let acc = 0;
  for (const i of order) {
    if (acc >= F * tot) break;
    out[i] = r[i];
    acc += r[i];
  }
  return { share: tot > 0 ? acc / tot : 0, range: out };
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
  const street = view.street;
  const river = street === 'river';
  // preflop, players who have not acted yet are not opponents yet
  const acted = (pi: number) =>
    view.actions.some((a) => a.street === 'preflop' && a.pi === pi && (a.type === 'call' || a.type === 'raise' || a.type === 'bet'));
  const opps = street === 'preflop' && live.some((p) => acted(p.pi)) ? live.filter((p) => acted(p.pi)) : live;
  const behind = street === 'preflop' ? live.filter((p) => !view.actions.some((a) => a.street === 'preflop' && a.pi === p.pi)) : [];
  const villain =
    view.lastAggressor >= 0 && view.lastAggressor !== view.me && !view.players[view.lastAggressor].folded
      ? view.players[view.lastAggressor]
      : opps[0] ?? live[0];
  const mOf = (id: string): OpponentModel => models[id] ?? { ...POPULATION, ...populationFor(np) };
  const ranges = opps.map((p) => estimateRange(view, p.pi, mOf(p.id)));
  const vRange = ranges[opps.indexOf(villain)] ?? ranges[0];
  let equity = equityVsRanges(view.hole, view.board, ranges, street === 'preflop' ? 1500 : 2000, rng).equity;
  if (street === 'preflop' && behind.length && opps.length) equity *= Math.pow(0.95, behind.length);

  // ---- pot you can win: other players' chips above your total commitment are not yours to win
  const callAmt = la.callAmount;
  const capped = (cap: number) => view.players.reduce((s, p) => s + (p.pi === view.me ? 0 : Math.min(p.totalBet, cap)), 0);
  const potNow = capped(me.totalBet + callAmt) + me.totalBet;
  const toCall = la.toCall;
  const need = toCall > 0 ? callAmt / (potNow + callAmt) : 0;
  const inPosition = live.every((p) => hasPositionOn(np, view.buttonPi, view.me, p.pi));
  const allOppsAllIn = opps.length > 0 && opps.every((p) => p.allIn) && behind.length === 0;
  const callEndsBetting = la.callIsAllIn || allOppsAllIn;
  const heroDraw = view.board.length >= 3 && view.board.length < 5 ? drawScore(view.hole, view.board) : 0;
  const effBehind = Math.min(me.stack - callAmt, Math.max(0, ...opps.map((p) => p.stack)));

  /** share of equity a hand wins when there is betting to come */
  const realize = (eq: number): number => {
    if (river || callEndsBetting) return 1;
    let r = street === 'preflop' ? (inPosition ? 0.88 : 0.72) : inPosition ? 0.95 : 0.85;
    if (street === 'preflop' && !callEndsBetting) {
      // weak starting hands win far less than their raw equity after the flop
      const pctl = CLASS_PERCENTILE[CLASS_INDEX.get(className(view.hole[0], view.hole[1]))!];
      r *= pctl < 0.1 ? 1.08 : pctl < 0.3 ? 1 : pctl < 0.5 ? 0.88 : 0.72;
    }
    if (eq >= 0.7) r = 1; // strong hands win at least their share
    else if (heroDraw >= 1 && street !== 'preflop') {
      // draws earn extra when they hit, but only with chips left to win
      const spr = effBehind / Math.max(1, potNow + callAmt);
      r = clamp(0.92 + 0.08 * Math.min(1, spr / 2), 0.9, 1.08) + (spr >= 2 ? 0.08 : 0);
    } else if (eq < 0.4) r -= 0.08;
    return r;
  };

  const options: OptionEV[] = [];
  const vm = mOf(villain?.id ?? '');
  if (la.canFold) options.push({ kind: 'fold', ev: 0, label: 'Fold' });
  if (la.canCheck) {
    // checking keeps a strong hand's value: opponents bet into it some of the time
    const pBet = clamp(0.35 * (vm.aggFreq / POPULATION.aggFreq), 0.1, 0.7);
    // ...but only if someone is still to act after you on this street
    const closesAction = live.every((p) => view.actions.some((a) => a.street === street && a.pi === p.pi));
    const extra = equity > 0.5 && !closesAction ? pBet * 0.6 * potNow * (2 * equity - 1) : 0;
    options.push({ kind: 'check', ev: equity * potNow * realize(equity) + extra, label: 'Check' });
  }
  if (la.canCall) {
    // strong hands that just call still win more money on later streets
    const future = equity >= 0.7 && !river && !callEndsBetting ? (2 * equity - 1) * 0.5 * Math.min(effBehind, potNow + callAmt) * 0.5 : 0;
    options.push({ kind: 'call', ev: equity * (potNow + callAmt) * realize(equity) - callAmt + future, label: `Call ${callAmt}` });
  }

  // ---- bets / raises
  const sizes: { to: number; label: string }[] = [];
  const unopened = street === 'preflop' && !view.actions.some((a) => a.type !== 'fold');
  const myTotal = me.totalBet + me.stack;
  if (la.raiseType) {
    if (street === 'preflop') {
      const raises = view.actions.filter((a) => a.type === 'raise' || a.type === 'bet').length;
      const limps = view.actions.filter((a) => a.type === 'call').length;
      const target = raises === 0 ? (limps ? 3 + limps : 2.5) * bb : view.currentBet * (inPosition ? 3 : 3.8);
      const lbl = raises === 0 ? (limps ? 'isolation raise' : 'open') : raises === 1 ? '3-bet' : '4-bet';
      if (target >= la.minTo && target < la.maxTo * 0.75) sizes.push({ to: Math.round(target), label: lbl });
      if (myTotal / bb <= 30 || la.raiseAllInOnly) sizes.push({ to: la.maxTo, label: 'all-in' });
    } else {
      const potAfterCall = potNow + toCall;
      for (const [f, lbl] of [[0.33, '⅓ pot'], [0.5, '½ pot'], [0.75, '¾ pot'], [1, 'pot']] as const) {
        const to = Math.round(view.currentBet + f * potAfterCall);
        if (to >= la.minTo && to <= la.maxTo) sizes.push({ to, label: lbl });
      }
      if (la.maxTo - me.streetBet <= 2.5 * potAfterCall) sizes.push({ to: la.maxTo, label: 'all-in' });
    }
    if (heroAction.type === la.raiseType && heroAction.amount && !sizes.some((s) => s.to === heroAction.amount))
      sizes.push({ to: heroAction.amount, label: heroAction.amount === la.maxTo ? 'all-in' : 'your size' });
  }
  const facingRaise = street !== 'preflop' && view.actions.some((a) => a.street === street && a.pi === view.me && (a.type === 'bet' || a.type === 'raise'));
  const seenTo = new Set<number>();
  for (const s of sizes) {
    if (seenTo.has(s.to)) continue;
    seenTo.add(s.to);
    const add = s.to - me.streetBet;
    let allFold = 1;
    const contRanges: Range[] = [];
    const shares: number[] = [];
    // preflop: players still to act may wake up too
    const responders = street === 'preflop' ? [...live.filter((p) => acted(p.pi)), ...behind] : opps;
    for (const p of responders) {
      const k = opps.indexOf(p);
      const base = k >= 0 ? ranges[k] : estimateRange(view, p.pi, mOf(p.id));
      const aggressor = view.actions.some((a) => a.street === street && a.pi === p.pi && (a.type === 'bet' || a.type === 'raise'));
      const c = continuing(base, view.board, add, potNow, mOf(p.id), {
        actedPreflop: street !== 'preflop' || acted(p.pi),
        pos: positionOf(np, view.buttonPi, p.pi),
        aggressor: aggressor || facingRaise,
      });
      allFold *= 1 - c.share;
      contRanges.push(c.range);
      shares.push(c.share);
    }
    // when called: equity against the likely caller(s) — multiway postflop, the most frequent caller preflop
    let eqCalled: number;
    let callers: typeof responders;
    if (street === 'preflop') {
      const k = shares.indexOf(Math.max(...shares));
      eqCalled = equityVsRanges(view.hole, view.board, [contRanges[k]], 700, rng).equity;
      callers = [responders[k]];
    } else {
      eqCalled = equityVsRanges(view.hole, view.board, contRanges, 700, rng).equity;
      callers = responders;
    }
    const villainAdd = callers.reduce((sum, q) => sum + Math.max(0, Math.min(s.to, q.streetBet + q.stack) - q.streetBet), 0);
    const allIn = s.to === la.maxTo;
    const rCalled = allIn || river ? 1 : realize(eqCalled);
    const evCalled = eqCalled * (potNow + add + villainAdd) * rCalled - add;
    let ev = allFold * potNow + (1 - allFold) * evCalled;
    // Preflop raises that are not all-in also get re-raised: part of each continuing range
    // 3-bets (or 4-bets), and then only strong hands can continue — the rest lose the raise.
    if (street === 'preflop' && !allIn) {
      let pReraise = 0;
      responders.forEach((p, k) => {
        const share3 = positionOf(np, view.buttonPi, p.pi) === 'BB' ? 0.3 : 0.45;
        pReraise += shares[k] * share3;
      });
      pReraise = Math.min(pReraise, 1 - allFold);
      const pCall = 1 - allFold - pReraise;
      const strong = CLASS_PERCENTILE[CLASS_INDEX.get(className(view.hole[0], view.hole[1]))!] < 0.06;
      const vsReraise = strong ? evCalled * 1.3 : -add;
      ev = allFold * potNow + pCall * evCalled + pReraise * vsReraise;
    }
    options.push({
      kind: la.raiseType!,
      to: s.to,
      ev,
      label: allIn ? `All-in (${s.to})` : `${la.raiseType === 'bet' ? 'Bet' : 'Raise to'} ${s.to} (${s.label})`,
      foldPct: allFold,
      eqWhenCalled: eqCalled,
    });
  }

  // EV of what the hero actually did
  const pick = (k: OptionEV['kind'], to?: number) => options.find((o) => o.kind === k && (to === undefined || o.to === to));
  const heroEV =
    heroAction.type === 'bet' || heroAction.type === 'raise'
      ? (pick(heroAction.type, heroAction.amount) ?? { ev: NaN }).ev
      : (pick(heroAction.type) ?? { ev: 0 }).ev;
  const comparable = options.filter((o) => !isNaN(o.ev));
  const best = comparable.reduce((a, b) => (b.ev > a.ev ? b : a), comparable[0]);
  const evLoss = isNaN(heroEV) ? 0 : Math.max(0, best.ev - heroEV);

  const ex = decide({ view, persona: PERSONALITIES.expert, models, rng: mulberry32(seed + 7) });

  const cls = className(view.hole[0], view.hole[1]);
  const pos = positionOf(np, view.buttonPi, view.me);
  let openChart: DecisionAnalysis['openChart'];
  if (unopened && pos !== 'BB') {
    const r = chart(RFI[pos === 'SB' ? 'SB' : pos]);
    let size = 0;
    for (let i = 0; i < NUM_COMBOS; i++) size += r[i];
    openChart = { inRange: r[comboIndex(view.hole[0], view.hole[1])], rangePct: size / NUM_COMBOS };
  }
  let vSize = 0;
  for (let i = 0; i < NUM_COMBOS; i++) vSize += vRange ? vRange[i] : 0;

  // hand name: only what your own cards add
  let made = cls;
  if (view.board.length >= 3) {
    const v = evaluate([...view.hole, ...view.board]);
    const boardOnly = view.board.length === 5 ? evaluate(view.board) : -1;
    const boardCat = categoryOf(evaluate(view.board));
    if (v === boardOnly) made = `only the board (${describeHandDetailed(v)})`;
    else if (categoryOf(v) === 1 && boardCat === 1) made = `${cls}, no pair of your own (the pair is on the board)`;
    else made = describeHandDetailed(v);
  }
  const handName =
    heroDraw >= 1.5 ? `${made} with a combo draw` : heroDraw >= 1 ? `${made} with a draw` : heroDraw >= 0.5 ? `${made} with a gutshot` : made;

  // did the hero have the initiative coming into this street?
  const order = ['preflop', 'flop', 'turn', 'river'];
  let initiative = -1;
  for (let k = order.indexOf(street) - 1; k >= 0 && initiative < 0; k--) {
    const acts = view.actions.filter((a) => a.street === order[k] && (a.type === 'bet' || a.type === 'raise'));
    if (acts.length) initiative = acts[acts.length - 1].pi;
  }

  return {
    handId: view.handId,
    actionIndex,
    street,
    position: pos,
    inPosition,
    hole: view.hole,
    board: view.board,
    pot: potNow,
    toCall: callAmt,
    need,
    equity,
    nOpp: opps.length,
    villainId: villain?.id ?? '',
    villainName: villain?.name ?? '',
    villainMix: vRange ? mixOf(vRange, view.board) : null,
    villainRangePct: vSize / NUM_COMBOS,
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
    hadInitiative: initiative === view.me,
    unopened,
    bigBlind: bb,
  };
}
