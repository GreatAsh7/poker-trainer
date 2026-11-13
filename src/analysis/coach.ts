/**
 * End-of-match coaching report. Works only from public hand histories (the hero's cards,
 * the board, and cards that were shown), so advice is about decisions, not results.
 */
import { cardsToString, type Card } from '../engine/cards';
import type { Action, HandState } from '../engine/game';
import { evaluate } from '../engine/evaluator';
import { positionOf, type Position } from '../engine/position';
import { computeStats, rate, aggressionFactor, toModel, type PlayerStats, type OpponentModel, type Counter } from '../bots/stats';
import { decisionsOf } from './replay';
import { analyzeDecision, type DecisionAnalysis } from './decision';

// ------------------------------------------------------------------------- types

export type MistakeKind =
  | 'call-no-odds' | 'fold-with-odds' | 'missed-value' | 'bad-bluff' | 'overplayed' | 'missed-raise' | 'sizing' | 'passive-allin';
export type GoodKind = 'good-fold' | 'good-call' | 'good-value' | 'good-bluff';

export interface DecisionNote {
  handId: number;
  street: DecisionAnalysis['street'];
  position: Position;
  hole: Card[];
  board: Card[];
  pot: number;
  toCall: number;
  need: number;
  equity: number;
  villainName: string;
  heroLabel: string;
  bestLabel: string;
  evLoss: number;
  heroEV: number;
  bestEV: number;
  kind: MistakeKind | GoodKind | null;
  /** plain-language explanation with the numbers */
  text: string;
  options: { label: string; ev: number }[];
  handName: string;
  expertAction: string;
}

export interface StatRow {
  key: string;
  label: string;
  value: number;
  n: number;
  ref: [number, number];
  /** 'pct' values are 0..1; 'ratio' values are plain numbers */
  unit: 'pct' | 'ratio';
  verdict: 'low' | 'ok' | 'high' | 'sample';
  text: string;
}

export interface KeyHand {
  handId: number;
  title: string;
  hole: Card[];
  board: Card[];
  position: Position;
  net: number;
  situation: string;
  did: string;
  better: string;
  /** one explanation per costly decision in the hand, each with its numbers */
  why: string[];
  evLossBB: number;
}

export interface Tip {
  title: string;
  text: string;
}

export interface MatchReport {
  version: 1;
  id: string;
  date: string;
  settings: { players: number; startingBB: number; hands: number; difficulty: string };
  bigBlind: number;
  hands: number;
  net: number;
  netBB: number;
  bb100: number;
  biggestWon: { handId: number; net: number; hole: Card[] }[];
  biggestLost: { handId: number; net: number; hole: Card[] }[];
  allIn: { count: number; evNet: number; actualNet: number; luck: number };
  stats: StatRow[];
  byPosition: { pos: Position; hands: number; vpip: number; pfr: number; refOpen: string }[];
  keyHands: KeyHand[];
  wellPlayed: Tip[];
  strategies: Tip[];
  grade: string;
  evLossBB100: number;
  mistakesCount: number;
  summary: string;
  focus: string[];
  /** every analysed decision, by hand (for the per-hand review) */
  decisions: Record<number, DecisionNote[]>;
}

// ------------------------------------------------------------------------- helpers

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const chips = (x: number) => `${Math.round(x)}`;
const bbs = (x: number, bb: number) => {
  const v = x / bb;
  return `${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)} BB`;
};
const actionLabel = (a: Action) =>
  a.type === 'bet' ? `bet ${a.amount}` : a.type === 'raise' ? `raise to ${a.amount}` : a.type;

function mixText(d: DecisionAnalysis): string {
  const m = d.villainMix;
  if (!m) return `about ${pct(d.villainRangePct)} of starting hands`;
  const parts = [
    m.strong > 0.02 ? `${pct(m.strong)} two pair or better` : '',
    m.pair > 0.02 ? `${pct(m.pair)} one pair` : '',
    m.draw > 0.02 ? `${pct(m.draw)} draws` : '',
    m.air > 0.02 ? `${pct(m.air)} nothing` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function streetName(s: string) {
  return s === 'preflop' ? 'preflop' : `on the ${s}`;
}

/** Classify a decision and write the explanation. */
function classify(d: DecisionAnalysis): { kind: DecisionNote['kind']; text: string } {
  const bb = d.bigBlind;
  const hero = d.heroAction.type;
  const best = d.best.kind;
  const lossBB = d.evLoss / bb;
  const villain = d.villainName || 'your opponent';
  const where = streetName(d.street);
  const range = mixText(d);
  const sameKind = hero === best;
  const threshold = Math.max(1.5, (0.08 * d.pot) / bb);
  const opt = (k: string) => d.options.find((o) => o.kind === k);
  const lines: string[] = [];

  if (!sameKind && lossBB >= threshold) {
    if (hero === 'call' && best === 'fold') {
      lines.push(
        `You called ${d.toCall} into a pot of ${d.pot} ${where}. That price needs ${pct(d.need)} equity, but your ${d.handName} had about ${pct(d.equity)} against ${villain}'s likely range (${range}).`,
        `On average the call loses about ${chips(-opt('call')!.ev)} chips (${bbs(-opt('call')!.ev, bb)}); folding loses nothing more.`,
      );
      return { kind: 'call-no-odds', text: lines.join(' ') };
    }
    if (hero === 'fold' && (best === 'call' || best === 'raise')) {
      lines.push(
        `You folded ${where} when calling ${d.toCall} into ${d.pot} needed only ${pct(d.need)} equity (pot odds ${((1 - d.need) / d.need).toFixed(1)} : 1).`,
        (() => {
          const call = opt('call');
          const head = `Your ${d.handName} had about ${pct(d.equity)} against ${villain}'s likely range (${range}), so`;
          if (call && call.ev > 0)
            return `${head} a call was worth about +${chips(call.ev)} chips (${bbs(call.ev, bb)})${best !== 'call' ? `, and ${d.best.label.toLowerCase()} about +${chips(d.best.ev)}` : ''}.`;
          return `${head} ${d.best.label.toLowerCase()} was worth about +${chips(d.best.ev)} chips (${bbs(d.best.ev, bb)}).`;
        })(),
      );
      return { kind: 'fold-with-odds', text: lines.join(' ') };
    }
    if (hero === 'check' && (best === 'bet' || best === 'raise') && d.equity >= 0.55) {
      const o = d.best;
      lines.push(
        `You checked ${where} with ${d.handName} (about ${pct(d.equity)} against ${villain}'s range: ${range}).`,
        `${o.label} would be called often enough by worse hands${o.foldPct !== undefined ? ` (everyone folds about ${pct(o.foldPct)} of the time; when called you have ${pct(o.eqWhenCalled ?? 0)})` : ''}, earning about ${chips(d.evLoss)} chips (${bbs(d.evLoss, bb)}) more than checking.`,
      );
      return { kind: d.equity >= 0.5 ? 'missed-value' : 'missed-value', text: lines.join(' ') };
    }
    if ((hero === 'bet' || hero === 'raise') && (best === 'check' || best === 'fold' || best === 'call')) {
      const mine = d.options.find((o) => o.kind === hero && o.to === d.heroAction.amount);
      if (d.equity < 0.4) {
        lines.push(
          `You ${actionLabel(d.heroAction)} ${where} with ${d.handName} (about ${pct(d.equity)} against ${villain}'s range: ${range}).`,
          mine?.foldPct !== undefined
            ? `As a bluff it needs folds, but ${villain}'s range only folds about ${pct(mine.foldPct)} of the time to that size, and when called you have ${pct(mine.eqWhenCalled ?? 0)}.`
            : '',
          `${d.best.label} was about ${chips(d.evLoss)} chips (${bbs(d.evLoss, bb)}) better.`,
        );
        return { kind: 'bad-bluff', text: lines.filter(Boolean).join(' ') };
      }
      lines.push(
        `You ${actionLabel(d.heroAction)} ${where} with ${d.handName} (${pct(d.equity)} against ${villain}'s range: ${range}).`,
        `Worse hands mostly fold to that and better hands continue${mine?.eqWhenCalled !== undefined ? ` (when called you have only ${pct(mine.eqWhenCalled)})` : ''}; ${d.best.label.toLowerCase()} was about ${chips(d.evLoss)} chips (${bbs(d.evLoss, bb)}) better.`,
      );
      return { kind: 'overplayed', text: lines.join(' ') };
    }
    if (hero === 'call' && (best === 'raise' || best === 'bet') && d.equity >= 0.72) {
      lines.push(
        `You called ${where} with ${d.handName}, which had about ${pct(d.equity)} against ${villain}'s range (${range}).`,
        `${d.best.label} builds the pot while you are ahead and earns about ${chips(d.evLoss)} chips (${bbs(d.evLoss, bb)}) more.`,
      );
      return { kind: 'missed-raise', text: lines.join(' ') };
    }
  }
  if (sameKind && (hero === 'bet' || hero === 'raise') && lossBB >= threshold && d.best.to !== d.heroAction.amount) {
    lines.push(
      `Betting was right ${where}, but the size cost value: ${d.best.label.toLowerCase()} rates about ${chips(d.evLoss)} chips (${bbs(d.evLoss, bb)}) better than your ${actionLabel(d.heroAction)} against ${villain}'s range (${range}).`,
    );
    return { kind: 'sizing', text: lines.join(' ') };
  }
  // good decisions: chosen option clearly better than the alternatives
  const others = d.options.filter((o) => o.kind !== hero);
  if (sameKind && others.length) {
    const second = others.reduce((a, b) => (b.ev > a.ev ? b : a), others[0]);
    const margin = d.best.ev - second.ev;
    if (margin / bb >= Math.max(2, (0.1 * d.pot) / bb)) {
      if (hero === 'fold') {
        const call = opt('call');
        return {
          kind: 'good-fold',
          text: `Good fold ${where}: calling ${d.toCall} needed ${pct(d.need)} equity and your ${d.handName} had only about ${pct(d.equity)} against ${villain}'s range (${range}). The call would have lost about ${chips(-(call?.ev ?? 0))} chips.`,
        };
      }
      if (hero === 'call')
        return {
          kind: 'good-call',
          text: `Good call ${where}: you needed ${pct(d.need)} and had about ${pct(d.equity)} with ${d.handName} against ${villain}'s range (${range}), worth about +${chips(d.heroEV)} chips compared with folding.`,
        };
      if (hero === 'bet' || hero === 'raise')
        return {
          kind: d.equity >= 0.5 ? 'good-value' : 'good-bluff',
          text:
            d.equity >= 0.5
              ? `Good value ${hero} ${where}: ${d.handName} had about ${pct(d.equity)} against ${villain}'s range, and betting earned about ${chips(margin)} chips more than ${second.label.toLowerCase()}.`
              : `Good bluff ${where}: with ${d.handName} (${pct(d.equity)}) a bet makes ${villain}'s range fold often enough to be worth about ${chips(margin)} chips more than ${second.label.toLowerCase()}.`,
        };
    }
  }
  return { kind: null, text: '' };
}

// reference ranges (low, high) by table size
function refs(players: number) {
  if (players <= 2)
    return { vpip: [0.55, 0.8], pfr: [0.4, 0.65], threeBet: [0.12, 0.22], foldTo3Bet: [0.35, 0.55], cbet: [0.55, 0.8], foldToCbet: [0.3, 0.5], af: [2, 4], wtsd: [0.28, 0.4] } as const;
  if (players <= 4)
    return { vpip: [0.28, 0.4], pfr: [0.22, 0.32], threeBet: [0.08, 0.14], foldTo3Bet: [0.4, 0.6], cbet: [0.55, 0.75], foldToCbet: [0.35, 0.55], af: [2, 4], wtsd: [0.25, 0.35] } as const;
  return { vpip: [0.2, 0.28], pfr: [0.16, 0.23], threeBet: [0.06, 0.11], foldTo3Bet: [0.4, 0.6], cbet: [0.55, 0.75], foldToCbet: [0.35, 0.55], af: [2, 4], wtsd: [0.24, 0.32] } as const;
}

const STAT_TEXT: Record<string, { label: string; low: string; high: string; ok: string; min: number }> = {
  vpip: {
    label: 'VPIP (hands played)', min: 15,
    low: 'You played fewer hands than a solid player. You can open more from late position (cutoff, button).',
    high: 'You played too many hands. Weak offsuit hands and small suited hands from early position lose money over time.',
    ok: 'You played a sensible number of hands.',
  },
  pfr: {
    label: 'PFR (preflop raises)', min: 15,
    low: 'You raised preflop too rarely. Entering pots by raising wins the blinds and gives you the initiative.',
    high: 'You raised preflop very often; make sure your raises are balanced with strong hands.',
    ok: 'Your preflop raising frequency is in a good range.',
  },
  threeBet: {
    label: '3-bet', min: 10,
    low: 'You rarely re-raised preflop. Re-raise your strongest hands (and a few suited aces as bluffs) instead of only calling.',
    high: 'You re-raised preflop a lot; against tight openers this gets expensive.',
    ok: 'Your 3-bet frequency is balanced.',
  },
  foldTo3Bet: {
    label: 'Fold to 3-bet', min: 5,
    low: 'You rarely folded to re-raises; continue only with hands that play well against a strong range.',
    high: 'You folded to re-raises too often; opponents can re-raise you light. Defend more with good hands.',
    ok: 'You defended against 3-bets reasonably.',
  },
  cbet: {
    label: 'C-bet (flop bet after raising preflop)', min: 5,
    low: 'You often checked the flop after raising preflop. A small continuation bet wins many pots on dry boards.',
    high: 'You continuation-bet almost every flop; check more on boards that favour the caller (connected, middle cards).',
    ok: 'Your continuation-bet frequency is good.',
  },
  foldToCbet: {
    label: 'Fold to c-bet', min: 5,
    low: 'You rarely folded to flop bets; calling with nothing just delays the loss.',
    high: 'You folded to flop bets too often; opponents can bet any two cards against you. Defend with pairs, draws and good overcards.',
    ok: 'You defended against continuation bets sensibly.',
  },
  af: {
    label: 'Aggression factor (bets+raises ÷ calls)', min: 10,
    low: 'You called much more than you bet or raised. Betting your strong hands and draws wins more than calling.',
    high: 'You were very aggressive after the flop; make sure your bets are a mix of value and well-chosen bluffs.',
    ok: 'Your postflop aggression is balanced.',
  },
  wtsd: {
    label: 'Went to showdown (after seeing the flop)', min: 10,
    low: 'You rarely reached showdown; you may be folding too much on later streets.',
    high: 'You went to showdown often; some of those calls with weak hands cost money.',
    ok: 'Your showdown frequency is healthy.',
  },
};

function statRow(key: string, value: number, n: number, ref: readonly [number, number], unit: 'pct' | 'ratio'): StatRow {
  const t = STAT_TEXT[key];
  const fmt = (x: number) => (unit === 'pct' ? pct(x) : x.toFixed(1));
  let verdict: StatRow['verdict'];
  let text: string;
  if (n < t.min || isNaN(value)) {
    verdict = 'sample';
    text = n === 0
      ? `No chances to measure this in this match (a solid player: ${fmt(ref[0])}–${fmt(ref[1])}).`
      : `Only ${n} ${n === 1 ? 'chance' : 'chances'} this match, too few to judge (a solid player: ${fmt(ref[0])}–${fmt(ref[1])}).`;
  } else if (value < ref[0]) {
    verdict = 'low';
    text = `${fmt(value)} is below the ${fmt(ref[0])}–${fmt(ref[1])} range of a solid player. ${t.low}`;
  } else if (value > ref[1]) {
    verdict = 'high';
    text = `${fmt(value)} is above the ${fmt(ref[0])}–${fmt(ref[1])} range of a solid player. ${t.high}`;
  } else {
    verdict = 'ok';
    text = `${fmt(value)} is inside the ${fmt(ref[0])}–${fmt(ref[1])} range. ${t.ok}`;
  }
  return { key, label: t.label, value, n, ref: [ref[0], ref[1]], unit, verdict, text };
}

/** Hero equity on a given board vs tabled opponent hands (exact enumeration of runouts). */
function allInEquity(hero: Card[], opps: Card[][], board: Card[]): number {
  const dead = new Set([...hero, ...opps.flat(), ...board]);
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
  const need = 5 - board.length;
  let score = 0;
  let n = 0;
  const run = (start: number, picked: Card[]) => {
    if (picked.length === need) {
      const b = [...board, ...picked];
      const me = evaluate([...hero, ...b]);
      let best = 0;
      let ties = 0;
      for (const o of opps) {
        const v = evaluate([...o, ...b]);
        if (v > best) best = v;
      }
      if (me > best) score += 1;
      else if (me === best) {
        for (const o of opps) if (evaluate([...o, ...b]) === me) ties++;
        score += 1 / (ties + 1);
      }
      n++;
      return;
    }
    for (let i = start; i < deck.length; i++) run(i + 1, [...picked, deck[i]]);
  };
  run(0, []);
  return n ? score / n : 0;
}

// ------------------------------------------------------------------------- main

export interface ReportInput {
  hands: readonly HandState[]; // public histories, finished
  heroId: string;
  settings: MatchReport['settings'];
  /** progress callback (0..1) */
  onProgress?: (p: number) => void;
}

export function buildReport(inp: ReportInput): MatchReport {
  const { hands, heroId } = inp;
  const bb = hands[0]?.config.bigBlind ?? 2;
  const nets: { handId: number; net: number; hole: Card[] }[] = [];
  const decisions: Record<number, DecisionNote[]> = {};
  const analyses: { d: DecisionAnalysis; note: DecisionNote }[] = [];
  let allInCount = 0;
  let allInEV = 0;
  let allInActual = 0;
  // opponents' stats as the match went on (only hands before each decision are known)
  const running: HandState[] = [];
  let openLimps = 0;
  let loosOpens = 0;
  let missedOpens = 0;
  const btnOpen: Counter = { n: 0, opp: 0 };

  hands.forEach((h, hi) => {
    inp.onProgress?.(hi / Math.max(1, hands.length));
    const pi = h.players.findIndex((p) => p.id === heroId);
    if (pi < 0) return;
    const p = h.players[pi];
    const net = h.won[pi] - p.totalBet;
    nets.push({ handId: h.handId, net, hole: p.hole });
    const models: Record<string, OpponentModel> = {};
    const st = computeStats(running);
    for (const q of h.players) if (q.id !== heroId) models[q.id] = toModel(st[q.id]);

    // all-in luck: heads-up all-ins before the river with both hands tabled
    if (h.runout && h.showdown) {
      const live = h.players.map((q, i) => ({ q, i })).filter(({ q }) => !q.folded);
      if (live.length === 2 && live.every(({ q }) => q.hole.length === 2) && live.some(({ i }) => i === pi)) {
        // board when betting closed = cards dealt before the first run-out street
        const first = h.events.findIndex((e) => e.kind === 'reveal');
        const board: Card[] = [];
        for (const e of h.events.slice(0, first)) if (e.kind === 'street') board.push(...e.cards);
        const opp = live.find(({ i }) => i !== pi)!.q;
        const eq = allInEquity(p.hole, [opp.hole], board);
        const contested = Math.min(p.totalBet, opp.totalBet);
        const dead = h.players.reduce((a, q) => a + (q.folded ? q.totalBet : 0), 0);
        const pot = 2 * contested + dead;
        const ev = eq * pot - contested;
        allInCount++;
        allInEV += ev;
        allInActual += net;
      }
    }

    // decisions
    const notes: DecisionNote[] = [];
    for (const dp of decisionsOf(h, pi)) {
      const d = analyzeDecision(dp.view, dp.action, dp.actionIndex, models, h.handId * 31 + dp.actionIndex);
      // preflop habits
      if (d.street === 'preflop' && d.openChart) {
        if (dp.action.type === 'call') openLimps++;
        if ((dp.action.type === 'raise' || dp.action.type === 'bet') && d.openChart.inRange === 0) loosOpens++;
        if (dp.action.type === 'fold' && d.openChart.inRange >= 0.99) missedOpens++;
        if (d.position === 'BTN') {
          btnOpen.opp++;
          if (dp.action.type === 'raise') btnOpen.n++;
        }
      }
      const note = toNote(d, dp.action, h.handId);
      notes.push(note);
      analyses.push({ d, note });
    }
    decisions[h.handId] = notes;
    running.push(h);
  });

  const nHands = nets.length;
  const net = nets.reduce((a, b) => a + b.net, 0);
  const sorted = [...nets].sort((a, b) => b.net - a.net);
  const stats = computeStats(hands);
  const hs: PlayerStats | undefined = stats[heroId];
  const np = Math.round(hands.reduce((a, h) => a + h.players.length, 0) / Math.max(1, hands.length));
  const R = refs(np);
  const statRows: StatRow[] = hs
    ? [
        statRow('vpip', rate(hs.vpip), hs.vpip.opp, R.vpip, 'pct'),
        statRow('pfr', rate(hs.pfr), hs.pfr.opp, R.pfr, 'pct'),
        statRow('threeBet', rate(hs.threeBet), hs.threeBet.opp, R.threeBet, 'pct'),
        statRow('foldTo3Bet', rate(hs.foldTo3Bet), hs.foldTo3Bet.opp, R.foldTo3Bet, 'pct'),
        statRow('cbet', rate(hs.cbet), hs.cbet.opp, R.cbet, 'pct'),
        statRow('foldToCbet', rate(hs.foldToCbet), hs.foldToCbet.opp, R.foldToCbet, 'pct'),
        statRow('af', aggressionFactor(hs), hs.postBets + hs.postCalls, R.af, 'ratio'),
        statRow('wtsd', rate(hs.wtsd), hs.wtsd.opp, R.wtsd, 'pct'),
      ]
    : [];
  const OPEN_REF: Record<Position, string> = { UTG: '15–18%', HJ: '19–23%', CO: '25–30%', BTN: '40–50%', SB: '35–45%', BB: 'defend 35–50% vs a steal' };
  const byPosition = (['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Position[])
    .map((pos) => {
      const b = hs?.byPosition[pos];
      return b ? { pos, hands: b.hands, vpip: b.vpip / b.hands, pfr: b.pfr / b.hands, refOpen: OPEN_REF[pos] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // mistakes and key hands
  const mistakes = analyses.filter((a) => a.note.kind && !a.note.kind.startsWith('good'));
  const goods = analyses.filter((a) => a.note.kind && a.note.kind.startsWith('good'));
  const lossTotal = mistakes.reduce((a, m) => a + m.note.evLoss, 0);
  const evLossBB100 = nHands ? (lossTotal / bb / nHands) * 100 : 0;
  const byHand = new Map<number, typeof mistakes>();
  for (const m of mistakes) byHand.set(m.note.handId, [...(byHand.get(m.note.handId) ?? []), m]);
  const keyHands: KeyHand[] = [...byHand.entries()]
    .map(([handId, ms]) => ({ handId, ms, loss: ms.reduce((a, m) => a + m.note.evLoss, 0) }))
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 6)
    .map(({ handId, ms, loss }) => {
      const h = hands.find((x) => x.handId === handId)!;
      const pi = h.players.findIndex((p) => p.id === heroId);
      const worst = ms.reduce((a, b) => (b.note.evLoss > a.note.evLoss ? b : a));
      return {
        handId,
        title: KIND_TITLE[worst.note.kind as MistakeKind],
        hole: h.players[pi].hole,
        board: h.board,
        position: positionOf(h.players.length, h.buttonPi, pi),
        net: h.won[pi] - h.players[pi].totalBet,
        situation: situation(h, pi, worst.d),
        did: `You ${worst.note.heroLabel} ${streetName(worst.note.street)}.`,
        better: `A strong player would ${worst.note.bestLabel.toLowerCase()}.`,
        why: ms.map((m) => `${m.note.street[0].toUpperCase()}${m.note.street.slice(1)}: ${m.note.text}`),
        evLossBB: loss / bb,
      };
    });

  const wellPlayed: Tip[] = goods
    .sort((a, b) => b.note.heroEV - b.note.bestEV - (a.note.heroEV - a.note.bestEV) || b.note.pot - a.note.pot)
    .slice(0, 4)
    .map((g) => ({ title: `Hand ${g.note.handId}: ${GOOD_TITLE[g.note.kind as GoodKind]}`, text: g.note.text }));
  for (const s of statRows) if (s.verdict === 'ok' && wellPlayed.length < 6) wellPlayed.push({ title: s.label, text: s.text });

  // strategies: exploits of the bots' observed tendencies and hero habits
  const strategies: Tip[] = [];
  const exploits: Tip[] = [];
  for (const [id, s] of Object.entries(stats)) {
    if (id === heroId) continue;
    const name = hands.find((h) => h.players.some((p) => p.id === id))!.players.find((p) => p.id === id)!.name;
    if (s.foldToCbet.opp >= 4 && rate(s.foldToCbet) >= 0.6)
      exploits.push({ title: `C-bet more against ${name}`, text: `${name} folded to ${pct(rate(s.foldToCbet))} of flop continuation bets (${s.foldToCbet.n} of ${s.foldToCbet.opp}). A small bet (about ⅓ pot) only needs to work 25% of the time to profit, so bet the flop with almost any hand after raising preflop.` });
    if (s.wtsd.opp >= 6 && rate(s.wtsd) >= 0.45)
      exploits.push({ title: `Value bet thinner against ${name}`, text: `${name} went to showdown ${pct(rate(s.wtsd))} of the time after seeing a flop (${s.wtsd.n} of ${s.wtsd.opp}). Bet top pair and even second pair for value on every street, and don't bluff: they won't fold.` });
    if (s.vpip.opp >= 15 && rate(s.vpip) <= 0.16)
      exploits.push({ title: `Respect ${name}'s raises, steal their blinds`, text: `${name} played only ${pct(rate(s.vpip))} of hands. When they raise or re-raise they usually have a strong hand, so fold medium pairs and weak aces; but raise their blinds often, since they defend rarely.` });
    if (s.threeBet.opp >= 8 && rate(s.threeBet) >= 0.12)
      exploits.push({ title: `Fight back against ${name}'s re-raises`, text: `${name} 3-bet ${pct(rate(s.threeBet))} of the time (${s.threeBet.n} of ${s.threeBet.opp}), far above the usual 6–10%. Call more of their re-raises with good hands like suited broadways and pairs, and 4-bet your premiums.` });
    if (s.foldTo3Bet.opp >= 4 && rate(s.foldTo3Bet) >= 0.7)
      exploits.push({ title: `Re-raise ${name} light`, text: `${name} folded to ${pct(rate(s.foldTo3Bet))} of re-raises (${s.foldTo3Bet.n} of ${s.foldTo3Bet.opp}). A 3-bet to about 3× their open wins the pot immediately most of the time, so 3-bet them with suited aces and suited connectors too.` });
  }
  if (btnOpen.opp >= 3 && btnOpen.n / btnOpen.opp < 0.35)
    strategies.push({ title: 'Steal more from the button', text: `When it was folded to you on the button you raised ${btnOpen.n} of ${btnOpen.opp} times (${pct(btnOpen.n / btnOpen.opp)}). Strong players open 40–50% there: you act last after the flop, and only the blinds are left to beat.` });
  if (openLimps >= 2)
    strategies.push({ title: 'Raise instead of limping', text: `You limped (just called the big blind) first in ${openLimps} times. Raising to about 2.5 BB wins the blinds outright some of the time and gives you the lead; if a hand is not good enough to raise, fold it.` });
  const drawFolds = mistakes.filter((m) => m.note.kind === 'fold-with-odds' && /draw|gutshot/.test(m.note.handName));
  if (drawFolds.length)
    strategies.push({ title: 'Use pot odds on draws', text: `You folded ${drawFolds.length} draw${drawFolds.length > 1 ? 's' : ''} that had the right price. A flush draw has about 35% equity on the flop and 19% on the turn: call when the pot odds ask for less than that.` });
  const valueMisses = mistakes.filter((m) => m.note.kind === 'missed-value');
  if (valueMisses.length >= 2)
    strategies.push({ title: 'Bet your strong hands', text: `${valueMisses.length} times you checked a hand that was ahead of your opponent's range. Betting gets value from worse hands and protects your equity; checking gives free cards.` });

  // grade + focus
  const grade = evLossBB100 < 6 ? 'A' : evLossBB100 < 14 ? 'B' : evLossBB100 < 28 ? 'C' : evLossBB100 < 50 ? 'D' : 'F';
  const byKind = new Map<string, number>();
  for (const m of mistakes) byKind.set(m.note.kind!, (byKind.get(m.note.kind!) ?? 0) + m.note.evLoss);
  const focus: string[] = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${FOCUS_TEXT[k as MistakeKind]} (cost about ${bbs(v, bb)} this match).`);
  const leak = statRows.find((s) => s.verdict === 'high' || s.verdict === 'low');
  if (leak && focus.length < 3) focus.push(`${leak.label}: ${leak.text}`);
  if (loosOpens >= 3 && focus.length < 3) focus.push(`Tighten your opening ranges: ${loosOpens} of your opens were hands outside a standard chart for that position.`);
  if (missedOpens >= 3 && focus.length < 3) focus.push(`Open more hands: ${missedOpens} times you folded a hand that is a standard open from that position.`);
  if (!focus.length) focus.push('Keep doing what you did: no costly patterns showed up. Try the Expert table next for a tougher test.');

  const luck = allInActual - allInEV;
  const summary =
    `${net >= 0 ? 'You won' : 'You lost'} ${bbs(Math.abs(net), bb)} over ${nHands} hands (${((net / bb / Math.max(1, nHands)) * 100).toFixed(1).replace('-', '−')} BB per 100 hands). ` +
    `The analysis found ${mistakes.length} costly decision${mistakes.length === 1 ? '' : 's'} worth about ${bbs(lossTotal, bb)} in total (${evLossBB100.toFixed(1)} BB per 100 hands)` +
    (allInCount
      ? Math.abs(luck) < bb / 2
        ? ', and your all-ins came out almost exactly as expected.'
        : `, and in all-ins you ran ${luck >= 0 ? 'above' : 'below'} expectation by ${bbs(Math.abs(luck), bb)}.`
      : '.') +
    (nHands < 20 ? ` With only ${nHands} hands, treat the numbers as a rough guide.` : '');

  return {
    version: 1,
    id: `${Date.now().toString(36)}`,
    date: new Date().toISOString(),
    settings: inp.settings,
    bigBlind: bb,
    hands: nHands,
    net,
    netBB: net / bb,
    bb100: nHands ? (net / bb / nHands) * 100 : 0,
    biggestWon: sorted.filter((x) => x.net > 0).slice(0, 3),
    biggestLost: [...sorted].reverse().filter((x) => x.net < 0).slice(0, 3),
    allIn: { count: allInCount, evNet: allInEV, actualNet: allInActual, luck },
    stats: statRows,
    byPosition,
    keyHands,
    wellPlayed,
    // the player's own habits first, then exploits of the bots' tendencies
    strategies: [...strategies, ...exploits].slice(0, 5),
    grade,
    evLossBB100,
    mistakesCount: mistakes.length,
    summary,
    focus: focus.slice(0, 3),
    decisions,
  };
}

const KIND_TITLE: Record<MistakeKind, string> = {
  'call-no-odds': 'Called without the right price',
  'fold-with-odds': 'Folded when the price was right',
  'missed-value': 'Missed a value bet',
  'bad-bluff': 'Bluff that could not work',
  overplayed: 'Overplayed a medium hand',
  'missed-raise': 'Should have raised for value',
  sizing: 'Bet size cost value',
  'passive-allin': 'Passive with a big hand',
};
const GOOD_TITLE: Record<GoodKind, string> = {
  'good-fold': 'disciplined fold',
  'good-call': 'well-priced call',
  'good-value': 'good value bet',
  'good-bluff': 'well-chosen bluff',
};
const FOCUS_TEXT: Record<MistakeKind, string> = {
  'call-no-odds': 'Before calling, compare your equity with the pot odds shown above the action buttons; fold when you are short',
  'fold-with-odds': 'Call when the pot odds are good: compare your equity with the % shown above the buttons before folding',
  'missed-value': 'Bet your strong hands for value instead of checking',
  'bad-bluff': 'Bluff only when your opponent can fold: not into players who call a lot or with no equity',
  overplayed: 'Bet/raise medium hands less: they mostly get called by better hands',
  'missed-raise': 'Raise your very strong hands instead of just calling',
  sizing: 'Choose bet sizes deliberately: bigger with strong hands on wet boards, smaller on dry boards',
  'passive-allin': 'Get your chips in with your strongest hands',
};

function toNote(d: DecisionAnalysis, action: Action, handId: number): DecisionNote {
  const c = classify(d);
  return {
    handId,
    street: d.street,
    position: d.position,
    hole: d.hole,
    board: d.board,
    pot: d.pot,
    toCall: d.toCall,
    need: d.need,
    equity: d.equity,
    villainName: d.villainName,
    heroLabel: actionLabel(action),
    bestLabel: d.best.label,
    evLoss: d.evLoss,
    heroEV: d.heroEV,
    bestEV: d.best.ev,
    kind: c.kind,
    text: c.text,
    options: d.options.map((o) => ({ label: o.label, ev: o.ev })),
    handName: d.handName,
    expertAction: actionLabel(d.expert.action),
  };
}

/** Coach's notes for one hand (per-hand review), using opponents' stats from earlier hands. */
export function reviewHand(h: HandState, heroId: string, earlier: readonly HandState[]): DecisionNote[] {
  const pi = h.players.findIndex((p) => p.id === heroId);
  if (pi < 0) return [];
  const st = computeStats(earlier);
  const models: Record<string, OpponentModel> = {};
  for (const q of h.players) if (q.id !== heroId) models[q.id] = toModel(st[q.id]);
  return decisionsOf(h, pi).map((dp) =>
    toNote(analyzeDecision(dp.view, dp.action, dp.actionIndex, models, h.handId * 31 + dp.actionIndex), dp.action, h.handId),
  );
}

function situation(h: HandState, pi: number, d: DecisionAnalysis): string {
  const p = h.players[pi];
  const pos = positionOf(h.players.length, h.buttonPi, pi);
  const pre = h.actions.filter((a) => a.street === 'preflop');
  const opener = pre.find((a) => a.type === 'raise');
  const bb = h.config.bigBlind;
  let s = `You were in the ${pos} with ${cardsToString(p.hole)} and ${Math.round(p.startStack / bb)} BB. `;
  if (opener) {
    const who = opener.pi === pi ? 'You' : h.players[opener.pi].name;
    s += `${who} opened to ${opener.to}${pre.filter((a) => a.type === 'raise').length > 1 ? ' and there was a re-raise' : ''}. `;
  } else s += 'Nobody raised preflop. ';
  if (d.board.length) s += `Board when you acted: ${cardsToString(d.board)}. Pot ${d.pot}${d.toCall ? `, ${d.toCall} to call` : ''}.`;
  else s += `Pot ${d.pot}${d.toCall ? `, ${d.toCall} to call` : ''}.`;
  return s;
}
