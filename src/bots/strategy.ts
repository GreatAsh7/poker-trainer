/**
 * The strategy core shared by all personalities.
 *
 * Preflop: position-based charts (open / 3-bet / call / 4-bet), push-fold when short.
 * Postflop: equity against each opponent's estimated range (narrowed from their actions),
 * compared with pot odds; bet sizing from board texture, street and SPR; value bets,
 * semi-bluffs with draws and bluffs at controlled frequencies; adapts to opponents' stats.
 *
 * Bots only ever see a PlayerView (no hidden cards).
 */
import { type Rng } from '../engine/cards';
import type { Action, LegalActions } from '../engine/game';
import type { PlayerView } from '../engine/view';
import { positionOf, hasPositionOn } from '../engine/position';
import { className, comboIndex, type Range } from './combos';
import {
  RFI, THREE_BET, CALL_IP, CALL_BB, CALL_SB, VS_3BET, VS_4BET, VS_5BET, ISO, chart, scaleRange, CLASS_PERCENTILE,
  type Pos,
} from './preflopCharts';
import { CLASS_INDEX, COMBO_CLASS } from './combos';
import { estimateRange, openerGroup } from './rangeModel';
import { equityVsRanges } from './equity';
import { callingRange } from './shoveModel';
import { boardTable, texture } from './strength';
import { POPULATION, populationFor, toModel, type OpponentModel } from './stats';
import type { Personality } from './personalities';
import type { BotDecision } from './types';

export interface StrategyInput {
  view: PlayerView;
  persona: Personality;
  /** opponent models keyed by player id (public stats) */
  models: Record<string, OpponentModel>;
  rng: Rng;
  /** override Monte Carlo iterations (simulator speed) */
  iters?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface Ctx {
  v: PlayerView;
  la: LegalActions;
  p: Personality;
  rng: Rng;
  bb: number;
  me: number;
  pot: number;
  toCall: number;
  myStack: number;
  effStack: number;
  live: number[];
  /** preflop: live opponents who have called or raised (the ones we actually play against) */
  voluntary: number[];
  /** preflop: live opponents who have not acted yet (they may still wake up with a hand) */
  behind: number[];
  models: Record<string, OpponentModel>;
  iters: number;
}

const fold = (c: Ctx): Action => (c.la.canFold ? { type: 'fold' } : { type: 'check' });
const checkOrCall = (c: Ctx): Action => (c.la.canCall ? { type: 'call' } : { type: 'check' });

/** Bet/raise to `to`, snapping to all-in when little would be left behind. */
function raiseTo(c: Ctx, to: number): Action {
  const la = c.la;
  if (!la.raiseType) return checkOrCall(c);
  let amt = Math.round(to);
  const remaining = la.maxTo - amt;
  if (remaining < Math.max(c.pot * 0.25, 3 * c.bb)) amt = la.maxTo;
  amt = clamp(amt, la.minTo, la.maxTo);
  return { type: la.raiseType, amount: amt };
}

function model(c: Ctx, pi: number): OpponentModel {
  if (!c.p.adapts) return POPULATION;
  return c.models[c.v.players[pi].id] ?? toModel(undefined, c.v.players.length);
}

/** weight (0..1) of our hand in a range */
function weightIn(c: Ctx, r: Range): number {
  return r[comboIndex(c.v.hole[0], c.v.hole[1])];
}
const inRange = (c: Ctx, r: Range) => c.rng() < weightIn(c, r);

export function decide(inp: StrategyInput): BotDecision {
  const v = inp.view;
  const la = v.legal!;
  const me = v.players[v.me];
  const live = v.players.filter((p) => !p.folded && p.pi !== v.me).map((p) => p.pi);
  const oppMaxBehind = Math.max(0, ...live.map((pi) => v.players[pi].stack + v.players[pi].streetBet));
  const c: Ctx = {
    v,
    la,
    p: inp.persona,
    rng: inp.rng,
    bb: v.config.bigBlind,
    me: v.me,
    pot: v.pot,
    toCall: la.toCall,
    myStack: me.stack,
    effStack: Math.min(me.stack + me.streetBet, oppMaxBehind),
    live,
    voluntary: live.filter((pi) => v.actions.some((a) => a.street === 'preflop' && a.pi === pi && (a.type === 'call' || a.type === 'raise' || a.type === 'bet'))),
    behind: live.filter((pi) => !v.actions.some((a) => a.street === 'preflop' && a.pi === pi)),
    models: inp.models,
    iters: inp.iters ?? inp.persona.iters,
  };
  return v.street === 'preflop' ? preflop(c) : postflop(c);
}

// =====================================================================================
// preflop

function chartPos(pos: Pos): Exclude<Pos, 'BB'> {
  if (pos === 'BB') return 'SB';
  return pos;
}

function preflop(c: Ctx): BotDecision {
  const v = c.v;
  const np = v.players.length;
  const pos = positionOf(np, v.buttonPi, c.me) as Pos;
  const cls = className(v.hole[0], v.hole[1]);
  const pct = CLASS_PERCENTILE[CLASS_INDEX.get(cls)!];
  const effBB = c.effStack / c.bb;
  let raises = 0;
  let limpers = 0;
  let callersAfterRaise = 0;
  let openerPi = -1;
  let lastRaiser = -1;
  let lastRaiseTo = c.bb;
  let iRaised = false;
  for (const a of v.actions) {
    if (a.type === 'raise' || a.type === 'bet') {
      if (raises === 0) openerPi = a.pi;
      raises++;
      lastRaiser = a.pi;
      lastRaiseTo = a.to;
      callersAfterRaise = 0;
      if (a.pi === c.me) iRaised = true;
    } else if (a.type === 'call') {
      if (raises === 0) limpers++;
      else callersAfterRaise++;
    }
  }
  const p = c.p;
  const hu = np === 2;
  const ip = lastRaiser >= 0 ? hasPositionOn(np, v.buttonPi, c.me, lastRaiser) : pos === 'BTN';

  // ---------- short stacks: push / fold
  if (effBB <= 13) {
    if (raises === 0 && limpers === 0) {
      const base: Record<Pos, number> = { UTG: 0.13, HJ: 0.17, CO: 0.24, BTN: 0.38, SB: hu ? 0.62 : 0.5, BB: 0.5 };
      const pushPct = clamp(base[pos] * Math.pow(10 / Math.max(effBB, 2), 0.75) * Math.sqrt(p.rfiMult), 0.05, 0.95);
      if (pct <= pushPct * (p.balanced ? 0.6 : 1)) return { action: raiseTo(c, c.la.maxTo), reason: `short stack (${effBB.toFixed(0)} BB): shove top ${(pushPct * 100).toFixed(0)}%` };
      if (p.balanced && pct <= Math.min(0.95, pushPct * 1.6)) {
        const d = openShove(c, pushPct);
        if (d) return d;
      }
      if (p.limpLoose > 0 && c.rng() < p.limpLoose && pct < 0.6) return { action: checkOrCall(c), reason: 'station limp' };
      return { action: c.la.canCheck ? { type: 'check' } : fold(c), reason: 'short stack: fold' };
    }
    if (p.balanced && raises === 0 && limpers > 0) {
      // limped pot: isolation-shove for fold equity, otherwise check the option or fold
      const isoShare = clamp(0.3 * Math.pow(10 / Math.max(effBB, 2), 0.7) * (hu ? 1.4 : 1), 0.1, 0.7);
      if (pct <= isoShare * 1.6) {
        const d = openShove(c, isoShare);
        if (d) return d;
      }
      return { action: c.la.canCheck ? { type: 'check' } : fold(c), reason: 'short stack: no profitable shove over the limp' };
    }
    const opener = lastRaiser >= 0 ? v.players[lastRaiser] : null;
    if (p.balanced && opener && !opener.allIn && raises <= 2 && callersAfterRaise === 0 && limpers === 0 && c.voluntary.length === 1 && c.la.raiseType) {
      const d = resteal(c, lastRaiser);
      if (d) return d;
    }
    // flat-calling off a short stack realises little equity: demand a better price
    return equityDecision(c, `short stack (${effBB.toFixed(0)} BB) facing action`, true, p.balanced && opener && !opener.allIn ? 0.7 : 1);
  }

  // ---------- unopened
  if (raises === 0 && limpers === 0) {
    if (pos === 'BB') return { action: { type: 'check' }, reason: 'walk' };
    const base = chart(RFI[chartPos(pos)]);
    let mult = p.rfiMult * (hu ? 1.7 : np <= 3 && pos !== 'SB' ? 1.25 : 1);
    if (p.adapts && (pos === 'CO' || pos === 'BTN' || pos === 'SB') && c.behind.length) {
      // steal more from tight players still to act, less from loose ones
      const avgVpip = c.behind.reduce((s, pi) => s + model(c, pi).vpip, 0) / c.behind.length;
      mult *= clamp(Math.sqrt(populationFor(np).vpip / avgVpip), 0.85, 1.5);
    }
    if (inRange(c, scaleRange(base, mult))) {
      const size = pos === 'SB' && !hu ? 3 : hu ? 2.5 : effBB < 40 ? 2.2 : 2.5;
      return { action: raiseTo(c, size * c.bb), reason: `open ${pos} (top ${(pct * 100).toFixed(0)}%)` };
    }
    if (p.limpLoose > 0 && c.rng() < p.limpLoose && pct < 0.55) return { action: checkOrCall(c), reason: 'loose limp' };
    return { action: fold(c), reason: `fold ${cls} ${pos}` };
  }

  // ---------- limped pot
  if (raises === 0) {
    const iso = scaleRange(chart(ISO), p.rfiMult * (adaptLimpers(c) ? 1.4 : 1));
    if (inRange(c, iso) && p.style !== 'station') {
      const size = (pos === 'BB' || pos === 'SB' ? 4 : 3.5) + limpers;
      return { action: raiseTo(c, size * c.bb), reason: `isolate ${limpers} limper(s)` };
    }
    if (p.style === 'station' && pct < 0.05) return { action: raiseTo(c, (4 + limpers) * c.bb), reason: 'station raises a monster' };
    if (c.la.canCheck) return { action: { type: 'check' }, reason: 'check option' };
    // over-limp with hands that play well multiway, or complete from the SB
    const limpRange = pos === 'SB' ? scaleRange(chart(CALL_BB.late), 0.6) : chart('22-99, A2s-A9s, K9s+, QTs+, J9s+, T9s, 98s, 87s, 76s, 65s');
    if (inRange(c, scaleRange(limpRange, p.callMult)) || (p.limpLoose > 0 && pct < 0.55)) return { action: { type: 'call' }, reason: 'over-limp' };
    return { action: fold(c), reason: 'fold to limps' };
  }

  // ---------- short stacks: re-shove over a raise when the fold equity makes it profitable
  if (p.balanced && effBB <= 30 && raises >= 1 && raises <= 2 && callersAfterRaise === 0 && limpers === 0 && c.voluntary.length === 1 && c.la.raiseType && lastRaiser >= 0) {
    const d = resteal(c, lastRaiser);
    if (d) return d;
  }

  // ---------- facing an all-in (or a raise we cannot re-raise): pure price decision
  if (raises >= 1 && (!c.la.raiseType || (lastRaiser >= 0 && lastRaiser !== c.me && v.players[lastRaiser].allIn))) {
    return equityDecision(c, 'facing an all-in', false);
  }

  // ---------- facing exactly one raise
  if (raises === 1 && !iRaised) {
    const openerPos = positionOf(np, v.buttonPi, openerPi) as Pos;
    const g = hu ? 'sb' : openerGroup(openerPos);
    const openSizeBB = lastRaiseTo / c.bb;
    const oppModel = model(c, openerPi);
    // exploit: widen 3-bets against players who open too much (adaptive bots only)
    const steal = p.adapts ? clamp(Math.sqrt(oppModel.pfr / populationFor(np).pfr), 0.8, 1.6) : 1;
    const squeeze = callersAfterRaise > 0 ? 0.75 : 1;
    const shortMult = p.balanced && effBB <= 30 ? 1.6 : 1;
    const threeBet = scaleRange(chart(THREE_BET[g]), p.threeBetMult * steal * squeeze * shortMult);
    // exploit players who fold too often to 3-bets: re-raise light (adaptive bots, heads-up pots)
    let exploit3 = 0;
    if (p.adapts && callersAfterRaise === 0 && c.voluntary.length === 1 && oppModel.hands >= 8) {
      // tight players fold more to re-raises; VPIP converges much faster than fold-to-3-bet
      const fromVpip = clamp(0.55 + (populationFor(np).vpip - oppModel.vpip) * 1.4, 0.3, 0.85);
      const f = (oppModel.hands >= 30 ? 0.5 * oppModel.foldTo3Bet + 0.5 * fromVpip : fromVpip) * Math.pow(0.9, c.behind.length);
      const to3 = lastRaiseTo * (ip ? 3 : 3.8);
      const risk = to3 - v.players[c.me].streetBet;
      // EV of a pure bluff, assuming we lose ~60% of our risk on average when called
      const ev = f * c.pot - (1 - f) * risk * 0.6;
      if (ev > 0) exploit3 = clamp(ev / c.pot, 0, 1);
    }
    if (inRange(c, threeBet) || (exploit3 > 0 && c.rng() < exploit3 && pct < 0.85)) {
      const mult = ip ? 3 : 3.8;
      const to = lastRaiseTo * mult + callersAfterRaise * lastRaiseTo;
      return { action: commitRaise(c, to, effBB), reason: `3-bet vs ${openerPos} open (${g})` };
    }
    let callChart = pos === 'BB' ? CALL_BB[g] : pos === 'SB' ? CALL_SB : CALL_IP[g] || CALL_IP.late;
    if (hu && pos === 'BB') callChart = CALL_BB.sb;
    let mult = p.callMult * (openSizeBB > 4 ? 0.65 : openSizeBB > 3 ? 0.85 : 1) * (callersAfterRaise > 0 ? 0.85 : 1);
    if (hu && pos === 'BB') mult *= 1.2;
    // don't flat if the call is a big part of our stack: decide on equity instead
    if (c.toCall > c.myStack * 0.35) return equityDecision(c, 'large raise relative to stack', true);
    if (inRange(c, scaleRange(chart(callChart), mult))) return { action: { type: 'call' }, reason: `call ${openerPos} open` };
    if (p.adapts && (pos === 'BB' || ip) && callersAfterRaise === 0) {
      const d = preflopDefend(c, ip ? 0.95 : effBB <= 30 ? 0.7 : 0.82, 'vs open');
      if (d) return d;
    }
    return { action: fold(c), reason: `fold ${cls} vs ${openerPos} open` };
  }

  // ---------- facing a 3-bet after opening
  if (raises === 2 && iRaised) {
    const tbPos = positionOf(np, v.buttonPi, lastRaiser) as Pos;
    const late = tbPos === 'BTN' || tbPos === 'CO' || tbPos === 'SB' || tbPos === 'BB' || hu;
    const fourBet = scaleRange(chart(late ? VS_3BET.fourBetVsLate : VS_3BET.fourBet), p.threeBetMult);
    if (inRange(c, fourBet)) {
      const to = lastRaiseTo * 2.3;
      return { action: to > c.myStack * 0.4 + c.v.players[c.me].streetBet ? raiseTo(c, c.la.maxTo) : commitRaise(c, to, effBB), reason: '4-bet' };
    }
    if (c.toCall > c.myStack * 0.35) return equityDecision(c, 'facing a big 3-bet', true);
    if (p.defend3Bet > 0) {
      // Continue with the top part of the range we actually opened, so 3-bet bluffs are not
      // automatically profitable. Bigger 3-bets are defended a little less.
      const openR = scaleRange(chart(RFI[chartPos(pos)]), p.rfiMult * (hu ? 1.7 : np <= 3 && pos !== 'SB' ? 1.25 : 1));
      const rank = rankInRange(c, openR);
      const sizeX = lastRaiseTo / Math.max(1, v.players[c.me].streetBet);
      let cont = (hu ? 0.58 : ip ? 0.46 : 0.38) * p.defend3Bet * (sizeX > 4 ? 0.8 : 1);
      if (p.adapts) cont *= foldTo3BetAdjust(c, lastRaiser);
      if (rank <= cont * 0.3)
        return { action: raiseTo(c, lastRaiseTo * 2.3 > c.myStack * 0.4 ? c.la.maxTo : lastRaiseTo * 2.3), reason: `4-bet: top ${(rank * 100).toFixed(0)}% of my opening range` };
      if (rank <= cont) return { action: { type: 'call' }, reason: `call 3-bet: hand is in the top ${(rank * 100).toFixed(0)}% of my opening range (defend ${(cont * 100).toFixed(0)}%)` };
    }
    const callR = scaleRange(chart(ip ? VS_3BET.callIP : VS_3BET.callOOP), p.callMult * (p.adapts ? foldTo3BetAdjust(c, lastRaiser) : 1));
    if (inRange(c, callR)) return { action: { type: 'call' }, reason: 'call 3-bet' };
    if (p.adapts) {
      const d = preflopDefend(c, ip ? 0.85 : 0.7, 'vs 3-bet');
      if (d) return d;
    }
    return { action: fold(c), reason: 'fold to 3-bet' };
  }

  // ---------- facing a 4-bet after 3-betting, or cold 3-bets / 4-bets
  if (raises === 3 && iRaised) {
    if (inRange(c, chart(VS_4BET.jam))) return { action: raiseTo(c, c.la.maxTo), reason: '5-bet jam' };
    if (inRange(c, chart(VS_4BET.call))) return { action: { type: 'call' }, reason: 'call 4-bet' };
    return equityDecision(c, 'facing a 4-bet', true);
  }
  if (raises >= 2 && !iRaised) {
    if (inRange(c, chart(raises === 2 ? 'QQ+, AKs, AKo' : 'KK+'))) return { action: raiseTo(c, raises === 2 ? lastRaiseTo * 2.3 : c.la.maxTo), reason: 'cold re-raise' };
    if (raises === 2 && ip && inRange(c, chart('JJ-TT, AQs@50, AKo@50'))) return { action: { type: 'call' }, reason: 'cold call 3-bet' };
    if (c.toCall <= c.pot * 0.2) return equityDecision(c, 'cheap call', true);
    return { action: fold(c), reason: 'fold to re-raise' };
  }
  // 5-bet+ or anything else
  if (inRange(c, chart(VS_5BET))) return { action: c.la.raiseType ? raiseTo(c, c.la.maxTo) : checkOrCall(c), reason: 'premium vs re-raise' };
  return equityDecision(c, 'deep re-raise war', true);
}

/**
 * Range-aware preflop defence (Expert): call when our equity against the raiser's
 * estimated range, discounted for how much of it we can realise (position), beats the price.
 */
function preflopDefend(c: Ctx, realize: number, why: string): BotDecision | null {
  if (c.voluntary.length !== 1) return null;
  const eq = equityVsRanges(c.v.hole, c.v.board, oppRanges(c), 500, c.rng).equity;
  const need = c.toCall / (c.pot + c.toCall);
  if (eq * realize >= need)
    return { action: { type: 'call' }, reason: `defend ${why}: equity ${(eq * 100).toFixed(0)}% × ${realize} realised ≥ ${(need * 100).toFixed(0)}% needed` };
  return null;
}

/**
 * Re-shove over a raise: the raiser (and anyone still to act) calls with the hands that have
 * the equity to call our re-shove range at the price they get. Shove when that beats both
 * folding and flat-calling.
 */
function resteal(c: Ctx, villain: number): BotDecision | null {
  const v = c.v;
  const np = v.players.length;
  const me = v.players[c.me];
  const vp = v.players[villain];
  const myTotal = me.stack + me.streetBet;
  const villainTotal = vp.stack + vp.streetBet;
  const risk = Math.min(myTotal, villainTotal);
  const effBB = c.effStack / c.bb;
  // how wide our re-shoves are (roughly): what the raiser calls against
  const shoveShare = clamp(0.18 * Math.pow(20 / Math.max(effBB, 4), 0.9) * (np === 2 ? 1.6 : 1), 0.08, 0.6);
  // only hands inside that range are candidates, so the fold equity we assume stays honest
  const myPct = CLASS_PERCENTILE[CLASS_INDEX.get(className(v.hole[0], v.hole[1]))!];
  if (myPct > shoveShare * 1.15) return null;
  const r = estimateRange(v, villain, model(c, villain));
  const theirNeed = (risk - vp.streetBet) / Math.max(1, c.pot - me.streetBet - vp.streetBet + 2 * risk);
  const vm = model(c, villain);
  const looseness = clamp(vm.vpip / populationFor(np).vpip, 0.7, 2);
  const caller = callingRange(r, shoveShare, theirNeed, looseness);
  // players still to act wake up with a calling hand now and then
  let behindFold = 1;
  for (const pi of c.behind) {
    const q = v.players[pi];
    const qRisk = Math.min(myTotal, q.stack + q.streetBet);
    const qNeed = (qRisk - q.streetBet) / Math.max(1, c.pot + 2 * qRisk);
    behindFold *= 1 - callingRange(new Float64Array(r.length).fill(1), shoveShare, qNeed, clamp(model(c, pi).vpip / populationFor(np).vpip, 0.7, 2)).share;
  }
  const f = (1 - caller.share) * behindFold;
  if (caller.share <= 0) return { action: raiseTo(c, c.la.maxTo), reason: 're-shove: their range cannot call' };
  const eqCalled = equityVsRanges(v.hole, v.board, [caller.range], 500, c.rng).equity;
  const dead = c.pot - me.streetBet - vp.streetBet;
  const potIfCalled = dead + 2 * risk;
  const evShove = f * c.pot + (1 - f) * (eqCalled * potIfCalled - (risk - me.streetBet));
  // compare with calling (rough: equity vs their whole range, realised out of position)
  const eqAll = equityVsRanges(v.hole, v.board, [r], 400, c.rng).equity;
  const ipVs = hasPositionOn(np, v.buttonPi, c.me, villain);
  const realizeCall = ipVs ? 0.85 : effBB <= 25 ? 0.65 : 0.78;
  const evCall = c.la.canCall ? eqAll * realizeCall * (c.pot + c.toCall) - c.toCall : 0;
  if (evShove > Math.max(0, evCall) + 0.3 * c.bb)
    return {
      action: raiseTo(c, c.la.maxTo),
      reason: `re-shove: they fold about ${Math.round(f * 100)}%, ${Math.round(eqCalled * 100)}% equity when called → EV ${(evShove / c.bb).toFixed(1)} BB`,
    };
  return null;
}

/**
 * Open-shove (or isolation-shove over limpers) from expected value: every live opponent calls
 * with the hands that beat the price against our shoving range; otherwise we win the pot.
 */
function openShove(c: Ctx, shoveShare: number): BotDecision | null {
  const v = c.v;
  const np = v.players.length;
  const me = v.players[c.me];
  const myTotal = me.stack + me.streetBet;
  const pop = populationFor(np);
  let pNoCall = 1;
  let best: { share: number; range: Range } | null = null;
  const responders = [...c.voluntary, ...c.behind];
  if (!responders.length) return null;
  for (const pi of responders) {
    const q = v.players[pi];
    const risk = Math.min(myTotal, q.stack + q.streetBet);
    const need = (risk - q.streetBet) / Math.max(1, c.pot + 2 * risk - me.streetBet - q.streetBet);
    const m = model(c, pi);
    const r = c.voluntary.includes(pi) ? estimateRange(v, pi, m) : new Float64Array(1326).fill(1);
    const res = callingRange(r, shoveShare, need, clamp(m.vpip / pop.vpip, 0.7, 2));
    pNoCall *= 1 - res.share;
    if (!best || res.share > best.share) best = res;
  }
  if (!best || best.share <= 0) return { action: raiseTo(c, c.la.maxTo), reason: 'shove: nobody can call' };
  const eqCalled = equityVsRanges(v.hole, v.board, [best.range], 500, c.rng).equity;
  const risk = me.stack;
  const ev = pNoCall * c.pot + (1 - pNoCall) * (eqCalled * (c.pot + 2 * risk - me.streetBet) - risk);
  if (ev > 0.1 * c.bb)
    return {
      action: raiseTo(c, c.la.maxTo),
      reason: `shove: called about ${Math.round((1 - pNoCall) * 100)}%, ${Math.round(eqCalled * 100)}% equity when called → EV ${(ev / c.bb).toFixed(1)} BB`,
    };
  return null;
}

/** Share of a range (by weight) made of hands ranked better than ours preflop (0 = best). */
function rankInRange(c: Ctx, r: Range): number {
  const mine = CLASS_PERCENTILE[CLASS_INDEX.get(className(c.v.hole[0], c.v.hole[1]))!];
  let better = 0;
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const w = r[i];
    if (w <= 0) continue;
    total += w;
    if (CLASS_PERCENTILE[COMBO_CLASS[i]] < mine) better += w;
  }
  return total > 0 ? better / total : 1;
}

/** Preflop raise; with short stacks, a raise that commits a third of the stack becomes a shove. */
function commitRaise(c: Ctx, to: number, effBB: number): Action {
  const me = c.v.players[c.me];
  if (effBB <= 25 && to - me.streetBet > (me.stack + me.streetBet) / 4) return raiseTo(c, c.la.maxTo);
  return raiseTo(c, to);
}

function adaptLimpers(c: Ctx): boolean {
  if (!c.p.adapts) return false;
  return c.v.actions.some((a) => a.street === 'preflop' && a.type === 'call' && model(c, a.pi).vpip - model(c, a.pi).pfr > 0.2);
}

/** Call 3-bets wider vs players who 3-bet a lot (adaptive bots). */
function foldTo3BetAdjust(c: Ctx, pi: number): number {
  const m = model(c, pi);
  return clamp(Math.sqrt(m.threeBet / populationFor(c.v.players.length).threeBet), 0.8, 1.6);
}

// =====================================================================================
// equity helpers

function oppRanges(c: Ctx): Range[] {
  // preflop, only players who have put money in are in the hand for sure
  const who = c.v.street === 'preflop' && c.voluntary.length > 0 ? c.voluntary : c.live;
  return who.map((pi) => estimateRange(c.v, pi, c.p.adapts ? model(c, pi) : POPULATION, c.p.rangeReading));
}

/** Call or fold (or jam) purely on equity vs the estimated ranges and the price. */
function equityDecision(c: Ctx, why: string, canJam: boolean, flatRealize = 1): BotDecision {
  const ranges = oppRanges(c);
  let eq = equityVsRanges(c.v.hole, c.v.board, ranges, Math.max(300, c.iters >> 1), c.rng).equity;
  // players still to act may wake up with a hand and overcall or re-raise
  if (c.v.street === 'preflop' && c.behind.length) eq *= Math.pow(0.95, c.behind.length);
  const need = c.toCall > 0 ? c.toCall / (c.pot + c.toCall) : 0;
  const tag = `${why}: equity ${(eq * 100).toFixed(0)}% vs needed ${(need * 100).toFixed(0)}%`;
  if (canJam && c.la.raiseType && eq > 0.62 && (c.v.street === 'preflop' ? c.voluntary.length === 1 : c.live.length === 1)) return { action: raiseTo(c, c.la.maxTo), reason: tag + ' → jam' };
  if (c.toCall === 0) return { action: { type: 'check' }, reason: tag };
  if (eq * (c.la.callIsAllIn ? 1 : flatRealize) >= need + c.p.callMargin) return { action: { type: 'call' }, reason: tag + ' → call' };
  return { action: fold(c), reason: tag + ' → fold' };
}

// =====================================================================================
// postflop

function postflop(c: Ctx): BotDecision {
  const v = c.v;
  const p = c.p;
  const np = v.players.length;
  const street = v.street;
  const nOpp = c.live.length;
  const ranges = oppRanges(c);
  const eq = equityVsRanges(v.hole, v.board, ranges, c.iters, c.rng).equity;
  const table = boardTable(v.board);
  const ci = comboIndex(v.hole[0], v.hole[1]);
  const myStrength = table.strength[ci];
  const myDraw = street === 'river' ? 0 : table.draw[ci];
  const tex = texture(v.board);
  const pot = c.pot;
  const spr = c.effStack / Math.max(1, pot);
  const ipAll = c.live.every((pi) => hasPositionOn(np, v.buttonPi, c.me, pi));
  const wasAggressor = lastAggressorBefore(v) === c.me;
  // the main opponent: the one who bet, or the first live one
  const villain = v.lastAggressor >= 0 && v.lastAggressor !== c.me ? v.lastAggressor : c.live[0];
  const vm = model(c, villain);
  const fair = 1 / (nOpp + 1);
  // thresholds below are for heads-up pots; with more opponents the fair share shrinks
  const scaleThr = (hu: number) => fair * 2 * hu;
  const info = `${street}: equity ${(eq * 100).toFixed(0)}% vs ${nOpp === 1 ? 'range' : nOpp + ' ranges'}`;

  // ------------------------------------------------------------ no bet to us
  if (c.toCall === 0) {
    let valueThr = scaleThr(street === 'flop' ? 0.6 : street === 'turn' ? 0.63 : 0.64) + p.valueShift;
    // exploit: bet thinner vs players who call too much
    if (p.adapts && nOpp === 1) valueThr -= clamp((vm.wtsd - POPULATION.wtsd) * 0.5, -0.04, 0.08);
    valueThr /= Math.sqrt(p.aggression);
    const sizeFrac = betSize(c, street, tex.wetness, spr, eq);
    // Balanced: as the caller, check to the player with the initiative with most of our
    // range (including strong hands, which check-raise or check-call), instead of leading.
    const initiative = lastAggressorBefore(v);
    if (
      p.balanced &&
      spr >= 3 &&
      initiative >= 0 &&
      initiative !== c.me &&
      !v.players[initiative].folded &&
      !v.actions.some((a) => a.street === street && a.pi === initiative) &&
      c.rng() < (eq >= valueThr ? (street === 'flop' ? 0.7 : street === 'turn' ? 0.45 : 0.25) : myDraw >= 1 ? 0.8 : 0.9)
    )
      return { action: { type: 'check' }, reason: `${info} → check to the preflop raiser` };
    if (eq >= valueThr) {
      // occasionally slow-play the nuts on dry boards (keeps checking ranges strong)
      if (myStrength > 0.97 && tex.wetness < 0.3 && street !== 'river' && c.rng() < 0.2 && p.sizingVariety)
        return { action: { type: 'check' }, reason: `${info} → slow-play` };
      return { action: raiseTo(c, pot * sizeFrac), reason: `${info} → value bet ${(sizeFrac * 100).toFixed(0)}% pot` };
    }
    // semi-bluff draws
    if (myDraw >= 1 && street !== 'river') {
      const f = clamp((wasAggressor ? 0.7 : 0.45) * p.bluff * (nOpp === 1 ? 1 : 0.6), 0, 0.95);
      if (c.rng() < f) return { action: raiseTo(c, pot * sizeFrac), reason: `${info}, draw → semi-bluff` };
    }
    // c-bet / barrel bluffs, frequency set by texture and the opponent's folding tendency
    let bluffP = 0;
    if (wasAggressor) {
      if (street === 'flop') bluffP = clamp(0.72 - 0.45 * tex.wetness - 0.2 * (nOpp - 1), 0.1, 0.85) * p.cbet;
      else if (street === 'turn') bluffP = (eq < 0.35 ? 0.33 : 0.15) * p.bluff;
      else bluffP = (eq < 0.2 ? (p.balanced ? 0.42 : 0.3) : 0.05) * p.bluff;
    } else if (ipAll && nOpp === 1) {
      // stab when checked to in position
      bluffP = (street === 'river' ? 0.18 : 0.3) * p.bluff;
    }
    if (p.adapts && nOpp === 1) {
      // bluff more against players who fold too much, less against players who call everything
      const folds = street === 'flop' ? vm.foldToCbet / POPULATION.foldToCbet : vm.foldToBet / POPULATION.foldToBet;
      bluffP *= clamp(Math.pow(folds, 1.5) * Math.sqrt(POPULATION.wtsd / vm.wtsd), 0.2, 2.2);
    }
    if (p.adapts && nOpp > 1) {
      const minFold = Math.min(...c.live.map((pi) => model(c, pi).foldToBet));
      bluffP *= clamp(Math.pow(minFold / POPULATION.foldToBet, 1.5), 0.2, 1.6);
    }
    if (nOpp > 2) bluffP *= 0.4;
    // medium hands with showdown value check more on the river instead of turning into bluffs
    if (street === 'river' && eq > 0.35) bluffP *= 0.2;
    if (c.rng() < bluffP) return { action: raiseTo(c, pot * sizeFrac), reason: `${info} → bluff ${(sizeFrac * 100).toFixed(0)}% pot` };
    return { action: { type: 'check' }, reason: `${info} → check` };
  }

  // ------------------------------------------------------------ facing a bet
  const potOdds = c.toCall / (pot + c.toCall);
  const callIsAllIn = c.la.callIsAllIn;
  let implied = 0;
  if (!callIsAllIn && street !== 'river' && spr > 2) implied = myDraw >= 1 ? 0.06 : myDraw >= 0.5 ? 0.03 : 0;
  // adapt: call lighter against players who bluff a lot, tighter against passive players
  let margin = p.callMargin;
  if (p.adapts) {
    margin -= clamp((vm.aggFreq - POPULATION.aggFreq) * 0.25, -0.05, 0.05);
    // proven bluffers (weak hands seen at showdown after river bets): bluff-catch more
    if (street !== 'flop') margin -= clamp((vm.bluffRate - POPULATION.bluffRate) * 0.4, -0.04, 0.06);
  }
  // raise for value
  let raiseThr = scaleThr(street === 'flop' ? 0.72 : street === 'turn' ? 0.76 : 0.8) / Math.sqrt(p.aggression);
  if (nOpp > 1) raiseThr = Math.max(raiseThr, 0.6);
  // shallow stacks: with good equity, get the chips in now rather than calling and folding later
  if (p.balanced && c.la.raiseType && nOpp === 1 && c.myStack <= 1.5 * (pot + c.toCall) && eq >= Math.max(0.5, potOdds + 0.08) && street !== 'river')
    return { action: raiseTo(c, c.la.maxTo), reason: `${info}, shallow stacks (SPR ${spr.toFixed(1)}) → all-in` };
  const facingRaise = v.actions.some((a) => a.street === street && a.pi === c.me && (a.type === 'bet' || a.type === 'raise'));
  if (facingRaise) raiseThr = Math.max(raiseThr, 0.88);
  if (c.la.raiseType && eq >= raiseThr) {
    const to = raiseSize(c);
    return { action: raiseTo(c, to), reason: `${info}, pot odds need ${(potOdds * 100).toFixed(0)}% → raise for value` };
  }
  // semi-bluff raise with strong draws
  if (c.la.raiseType && myDraw >= 1 && street !== 'river' && spr > 1.5 && nOpp === 1 && c.rng() < 0.22 * p.bluff * p.aggression)
    return { action: raiseTo(c, raiseSize(c)), reason: `${info}, strong draw → semi-bluff raise` };
  // Equity realisation: before the river, weak hands out of position win less than their raw
  // equity (they face more bets later); draws in position realise close to all of it.
  let realize = 1;
  if (street !== 'river' && !callIsAllIn) {
    realize = ipAll ? 0.92 : 0.8;
    if (myDraw >= 1) realize = Math.min(1, realize + 0.1);
    else if (myStrength < 0.5) realize -= ipAll ? 0.06 : p.balanced ? 0.25 : 0.15;
  }
  const effEq = eq * realize + implied;
  if (effEq >= potOdds + margin || myStrength >= 0.995)
    return { action: { type: 'call' }, reason: `${info}${realize < 1 ? ` (×${realize.toFixed(2)} realised)` : ''}${implied ? ` (+${(implied * 100).toFixed(0)}% implied)` : ''} ≥ ${(potOdds * 100).toFixed(0)}% needed → call` };
  return {
    action: fold(c),
    reason: `${info}${realize < 1 ? ` (×${realize.toFixed(2)} realised = ${(effEq * 100).toFixed(0)}%)` : ''} < ${((potOdds + margin) * 100).toFixed(0)}% needed → fold`,
  };
}

/** Who made the last bet/raise on the previous street (the "aggressor" coming into this street). */
function lastAggressorBefore(v: PlayerView): number {
  const order = ['preflop', 'flop', 'turn', 'river'];
  const cur = order.indexOf(v.street);
  for (let s = cur - 1; s >= 0; s--) {
    const acts = v.actions.filter((a) => a.street === order[s] && (a.type === 'bet' || a.type === 'raise'));
    if (acts.length) return acts[acts.length - 1].pi;
  }
  return -1;
}

/** Bet size as a fraction of the pot. */
function betSize(c: Ctx, street: string, wet: number, spr: number, eq: number): number {
  if (!c.p.sizingVariety) return 0.6;
  let f: number;
  if (street === 'flop') f = wet < 0.3 ? 0.33 : wet < 0.6 ? 0.5 : 0.7;
  else if (street === 'turn') f = wet < 0.4 ? 0.6 : 0.75;
  else if (c.p.balanced) {
    // the same size mix for value and bluffs, so the size gives nothing away
    const x = c.rng();
    f = x < 0.3 ? 0.5 : x < 0.7 ? 0.75 : x < 0.92 ? 1 : 1.3;
  } else f = eq > 0.85 ? 0.85 : 0.66;
  if (spr < 1.5) f = Math.max(f, 1); // shallow: get it in
  return f;
}

function raiseSize(c: Ctx): number {
  const cur = c.v.currentBet;
  return Math.max(3 * cur, cur + 0.65 * (c.pot + c.toCall));
}
