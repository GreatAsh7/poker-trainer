/**
 * Player statistics from public hand histories (actions only, no hidden cards).
 * Shared by the bots (adaptation), the HUD and the coaching report.
 */
import type { HandState } from '../engine/game';
import { positionOf, type Position } from '../engine/position';
import { boardTable } from './strength';
import { comboIndex } from './combos';

export interface Counter {
  n: number; // times it happened
  opp: number; // opportunities
}

export interface PlayerStats {
  hands: number;
  vpip: Counter;
  pfr: Counter;
  threeBet: Counter;
  foldTo3Bet: Counter;
  /** limped (called the big blind first in) */
  limp: Counter;
  cbet: Counter;
  foldToCbet: Counter;
  /** postflop bets + raises, calls and folds */
  postBets: number;
  postCalls: number;
  postFolds: number;
  /** postflop raises made when facing a bet */
  postRaisesFacing: number;
  /** saw the flop → went to showdown */
  wtsd: Counter;
  /** won at showdown when there */
  wsd: Counter;
  /** river bets/raises that were shown down (opp) and how many were weak hands (n = bluffs) */
  riverBluff: Counter;
  byPosition: Partial<Record<Position, { hands: number; vpip: number; pfr: number }>>;
}

const c = (): Counter => ({ n: 0, opp: 0 });

export function emptyStats(): PlayerStats {
  return {
    hands: 0, vpip: c(), pfr: c(), threeBet: c(), foldTo3Bet: c(), limp: c(), cbet: c(), foldToCbet: c(),
    postBets: 0, postCalls: 0, postFolds: 0, postRaisesFacing: 0, wtsd: c(), wsd: c(), riverBluff: c(), byPosition: {},
  };
}

/** Add one finished hand to the stats of every player in it (mutates `all`). */
export function addHand(all: Record<string, PlayerStats>, h: HandState): void {
  const np = h.players.length;
  const pre = h.actions.filter((a) => a.street === 'preflop');
  const flop = h.actions.filter((a) => a.street === 'flop');
  let pfa = -1; // preflop aggressor = last preflop raiser
  for (const a of pre) if (a.type === 'raise' || a.type === 'bet') pfa = a.pi;
  const sawFlop = new Set<number>();
  if (h.board.length >= 3)
    h.players.forEach((_, pi) => {
      if (!pre.some((a) => a.pi === pi && a.type === 'fold')) sawFlop.add(pi);
    });

  h.players.forEach((p, pi) => {
    const st = (all[p.id] ??= emptyStats());
    st.hands++;
    const pos = positionOf(np, h.buttonPi, pi);
    const bp = (st.byPosition[pos] ??= { hands: 0, vpip: 0, pfr: 0 });
    bp.hands++;
    const mine = pre.filter((a) => a.pi === pi);
    const vpip = mine.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet');
    const pfr = mine.some((a) => a.type === 'raise' || a.type === 'bet');
    // a walk (everyone folds to the big blind) is not a decision
    if (mine.length > 0) {
      st.vpip.opp++;
      st.pfr.opp++;
      if (vpip) {
        st.vpip.n++;
        bp.vpip++;
      }
      if (pfr) {
        st.pfr.n++;
        bp.pfr++;
      }
    }
    let raises = 0;
    let first = true;
    let opened = false;
    let faced3 = false;
    for (const a of pre) {
      if (a.pi === pi) {
        if (first) {
          if (raises === 0) {
            st.limp.opp++;
            if (a.type === 'call') st.limp.n++;
          }
          if (raises === 1) {
            st.threeBet.opp++;
            if (a.type === 'raise') st.threeBet.n++;
          }
          first = false;
        } else if (faced3) {
          st.foldTo3Bet.opp++;
          if (a.type === 'fold') st.foldTo3Bet.n++;
          faced3 = false;
        }
        if ((a.type === 'raise' || a.type === 'bet') && raises === 0) opened = true;
      }
      if (a.type === 'raise' || a.type === 'bet') {
        raises++;
        if (a.pi !== pi && opened && raises === 2) faced3 = true;
      }
    }
    // c-bet: the preflop aggressor gets to bet the flop before anyone else has bet
    if (pfa === pi && sawFlop.has(pi)) {
      const firstBet = flop.findIndex((a) => a.type === 'bet');
      const myFirst = flop.findIndex((a) => a.pi === pi);
      if (myFirst >= 0 && (firstBet < 0 || firstBet >= myFirst)) {
        st.cbet.opp++;
        if (flop[myFirst].type === 'bet') st.cbet.n++;
      }
    }
    // fold to c-bet: faced the preflop aggressor's flop bet (the first bet of the flop)
    if (pfa >= 0 && pfa !== pi && sawFlop.has(pi)) {
      const firstBet = flop.findIndex((a) => a.type === 'bet');
      if (firstBet >= 0 && flop[firstBet].pi === pfa) {
        const resp = flop.slice(firstBet + 1).find((a) => a.pi === pi);
        if (resp) {
          st.foldToCbet.opp++;
          if (resp.type === 'fold') st.foldToCbet.n++;
        }
      }
    }
    for (const a of h.actions) {
      if (a.pi !== pi || a.street === 'preflop') continue;
      if (a.type === 'bet' || a.type === 'raise') st.postBets++;
      else if (a.type === 'call') st.postCalls++;
      else if (a.type === 'fold') st.postFolds++;
      if (a.type === 'raise') st.postRaisesFacing++;
    }
    // river aggression that reached showdown with cards shown: was it a bluff?
    if (h.showdown && h.board.length === 5 && p.hole.length === 2 && h.shown.includes(pi)) {
      const riverAgg = h.actions.some((a) => a.pi === pi && a.street === 'river' && (a.type === 'bet' || a.type === 'raise'));
      if (riverAgg) {
        st.riverBluff.opp++;
        const s = boardTable(h.board).strength[comboIndex(p.hole[0], p.hole[1])];
        if (s < 0.45) st.riverBluff.n++;
      }
    }
    if (sawFlop.has(pi)) {
      st.wtsd.opp++;
      if (h.showdown && !p.folded) {
        st.wtsd.n++;
        st.wsd.opp++;
        if (h.won[pi] > 0) st.wsd.n++;
      }
    }
  });
}

export function computeStats(history: readonly HandState[]): Record<string, PlayerStats> {
  const all: Record<string, PlayerStats> = {};
  for (const h of history) addHand(all, h);
  return all;
}

export const rate = (x: Counter) => (x.opp > 0 ? x.n / x.opp : NaN);

/** Rate shrunk towards a prior (Bayesian average) so small samples don't swing wildly. */
export const shrunk = (x: Counter, prior: number, weight = 12) => (x.n + prior * weight) / (x.opp + weight);

/** Postflop aggression factor: (bets + raises) / calls. */
export const aggressionFactor = (s: PlayerStats) =>
  s.postCalls > 0 ? s.postBets / s.postCalls : s.postBets > 0 ? Infinity : NaN;

/** Compact opponent model sent to bots. */
export interface OpponentModel {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  foldTo3Bet: number;
  foldToCbet: number;
  /** postflop aggression frequency: (bets+raises) / (bets+raises+calls+folds) */
  aggFreq: number;
  /** postflop: share of the time they fold when facing a bet or raise */
  foldToBet: number;
  wtsd: number;
  /** share of river bets shown down that were bluffs (weak hands) */
  bluffRate: number;
}

export const POPULATION: OpponentModel = {
  hands: 0, vpip: 0.25, pfr: 0.19, threeBet: 0.07, foldTo3Bet: 0.55, foldToCbet: 0.45, aggFreq: 0.5, wtsd: 0.3, bluffRate: 0.25, foldToBet: 0.4,
};

export function toModel(s: PlayerStats | undefined): OpponentModel {
  if (!s) return { ...POPULATION };
  const P = POPULATION;
  const postTotal = s.postBets + s.postCalls + s.postFolds;
  return {
    hands: s.hands,
    vpip: shrunk(s.vpip, P.vpip, 25),
    pfr: shrunk(s.pfr, P.pfr, 25),
    threeBet: shrunk(s.threeBet, P.threeBet, 25),
    foldTo3Bet: shrunk(s.foldTo3Bet, P.foldTo3Bet, 20),
    foldToCbet: shrunk(s.foldToCbet, P.foldToCbet, 15),
    aggFreq: (s.postBets + P.aggFreq * 30) / (postTotal + 30),
    wtsd: shrunk(s.wtsd, P.wtsd, 20),
    bluffRate: shrunk(s.riverBluff, P.bluffRate, 12),
    foldToBet: (s.postFolds + P.foldToBet * 20) / (s.postFolds + s.postCalls + s.postRaisesFacing + 20),
  };
}
