/**
 * No-Limit Hold'em hand state machine. Pure TypeScript, no React.
 *
 * Conventions
 * - Chips are integers.
 * - `seats` holds only the players dealt into this hand, in clockwise table order.
 *   Indexes into `seats` are called "player indexes" (pi). `seat` on each entry is the
 *   physical table seat (0..5) the UI draws.
 * - Bet/raise amounts are "raise to" amounts: the player's total commitment on this street.
 * - `applyAction` never mutates its input; it returns a new state.
 */
import type { Card } from './cards';
import { evaluate, describeHand } from './evaluator';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
}

export interface PlayerInit {
  id: string;
  name: string;
  /** physical table seat */
  seat: number;
  stack: number;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  /** chips behind (not yet committed) */
  stack: number;
  startStack: number;
  hole: Card[];
  /** committed on the current street */
  streetBet: number;
  /** committed over the whole hand */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** has voluntarily acted in the current betting round */
  hasActed: boolean;
  /** the street's bet level when this player last acted (for the short all-in rule) */
  actedAtBet: number;
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface Action {
  type: ActionType;
  /** for bet/raise: total street commitment after the action ("raise to") */
  amount?: number;
}

export interface ActionRecord {
  pi: number;
  seat: number;
  street: Street;
  type: ActionType;
  /** chips put in by this action */
  added: number;
  /** street commitment after the action */
  to: number;
  allIn: boolean;
  /** pot (all committed chips) before the action */
  potBefore: number;
  /** amount the player had to call before acting */
  toCallBefore: number;
  stackBefore: number;
  /** true if a bet/raise was smaller than a full raise (all-in for less) */
  incomplete?: boolean;
}

export interface Pot {
  amount: number;
  /** player indexes eligible to win */
  eligible: number[];
}

export interface PotAward {
  potIndex: number;
  amount: number;
  winners: number[];
  /** chips each winner receives (aligned with winners) */
  shares: number[];
  handName?: string;
}

export type HandEvent =
  | { kind: 'post'; pi: number; blind: 'sb' | 'bb'; amount: number; allIn: boolean }
  | { kind: 'deal' }
  | { kind: 'action'; record: ActionRecord }
  | { kind: 'street'; street: Street; cards: Card[] }
  | { kind: 'refund'; pi: number; amount: number }
  | { kind: 'show'; pi: number; cards: Card[]; value: number; handName: string }
  | { kind: 'muck'; pi: number }
  | { kind: 'award'; award: PotAward }
  | { kind: 'end' };

export interface HandState {
  handId: number;
  config: TableConfig;
  players: PlayerState[];
  buttonPi: number;
  sbPi: number;
  bbPi: number;
  street: Street;
  board: Card[];
  /** full shuffled deck; hole cards and board are dealt from it in order. Hidden info. */
  deck: Card[];
  deckPos: number;
  /** highest street commitment */
  currentBet: number;
  /** size of the last full bet/raise on this street (min raise increment) */
  lastRaiseSize: number;
  /** player to act, or -1 when nobody can act (hand finished) */
  toAct: number;
  /** last player to bet or raise on the current street */
  lastAggressor: number;
  /** last player to bet or raise preflop (for stats) */
  preflopAggressor: number;
  finished: boolean;
  /** true when betting was closed early because at most one player could still act */
  runout: boolean;
  actions: ActionRecord[];
  events: HandEvent[];
  /** final results, set when finished */
  pots: Pot[];
  awards: PotAward[];
  /** chips won (gross, from pots) per player index */
  won: number[];
  /** player indexes whose cards were shown at showdown */
  shown: number[];
  /** hand values at showdown (0 if not shown / folded) */
  values: number[];
  /** true if the hand reached a showdown (2+ players at the end) */
  showdown: boolean;
}

export interface StartHandOptions {
  handId: number;
  config: TableConfig;
  /** players dealt in, in clockwise table order */
  players: PlayerInit[];
  /** player index (into `players`) holding the dealer button */
  buttonPi: number;
  /** shuffled 52-card deck */
  deck: Card[];
}

export class IllegalActionError extends Error {}

// ---------------------------------------------------------------------------------------
// helpers

const n = (s: HandState) => s.players.length;
export const nextPi = (s: HandState, pi: number) => (pi + 1) % n(s);

export const potTotal = (s: HandState) => s.players.reduce((a, p) => a + p.totalBet, 0);

const canAct = (p: PlayerState) => !p.folded && !p.allIn;
const needsToAct = (s: HandState, p: PlayerState) => canAct(p) && (!p.hasActed || p.streetBet < s.currentBet);
const liveCount = (s: HandState) => s.players.reduce((a, p) => a + (p.folded ? 0 : 1), 0);
const actorCount = (s: HandState) => s.players.reduce((a, p) => a + (canAct(p) ? 1 : 0), 0);

function clone(s: HandState): HandState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hole: p.hole })),
    board: [...s.board],
    actions: [...s.actions],
    events: [...s.events],
    pots: [...s.pots],
    awards: [...s.awards],
    won: [...s.won],
    shown: [...s.shown],
    values: [...s.values],
  };
}

function commit(p: PlayerState, amount: number): number {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.streetBet += a;
  p.totalBet += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/** First player after `from` (exclusive), clockwise, matching pred; -1 if none. */
function findNext(s: HandState, from: number, pred: (p: PlayerState, pi: number) => boolean): number {
  for (let k = 1; k <= n(s); k++) {
    const pi = (from + k) % n(s);
    if (pred(s.players[pi], pi)) return pi;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------
// start

export function startHand(o: StartHandOptions): HandState {
  const np = o.players.length;
  if (np < 2) throw new Error('need at least 2 players');
  if (o.deck.length !== 52) throw new Error('deck must have 52 cards');
  const players: PlayerState[] = o.players.map((p) => {
    if (!(p.stack > 0)) throw new Error(`player ${p.id} has no chips`);
    return {
      id: p.id,
      name: p.name,
      seat: p.seat,
      stack: p.stack,
      startStack: p.stack,
      hole: [],
      streetBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      actedAtBet: 0,
    };
  });
  const buttonPi = o.buttonPi;
  // Heads-up: the button posts the small blind and acts first preflop.
  const sbPi = np === 2 ? buttonPi : (buttonPi + 1) % np;
  const bbPi = (sbPi + 1) % np;
  const s: HandState = {
    handId: o.handId,
    config: o.config,
    players,
    buttonPi,
    sbPi,
    bbPi,
    street: 'preflop',
    board: [],
    deck: o.deck,
    deckPos: 0,
    currentBet: 0,
    lastRaiseSize: o.config.bigBlind,
    toAct: -1,
    lastAggressor: -1,
    preflopAggressor: -1,
    finished: false,
    runout: false,
    actions: [],
    events: [],
    pots: [],
    awards: [],
    won: players.map(() => 0),
    shown: [],
    values: players.map(() => 0),
    showdown: false,
  };
  const sbAmt = commit(players[sbPi], o.config.smallBlind);
  s.events.push({ kind: 'post', pi: sbPi, blind: 'sb', amount: sbAmt, allIn: players[sbPi].allIn });
  const bbAmt = commit(players[bbPi], o.config.bigBlind);
  s.events.push({ kind: 'post', pi: bbPi, blind: 'bb', amount: bbAmt, allIn: players[bbPi].allIn });
  // Everyone must call the full big blind even if the big blind was posted short.
  s.currentBet = o.config.bigBlind;
  s.lastRaiseSize = o.config.bigBlind;

  // deal two cards each, one at a time, starting left of the button
  for (let round = 0; round < 2; round++) {
    for (let k = 1; k <= np; k++) {
      const pi = (buttonPi + k) % np;
      players[pi].hole = [...players[pi].hole, s.deck[s.deckPos++]];
    }
  }
  s.events.push({ kind: 'deal' });

  s.toAct = findNext(s, bbPi, (p) => needsToAct(s, p));
  if (s.toAct < 0) closeRound(s);
  return s;
}

// ---------------------------------------------------------------------------------------
// legal actions

export interface LegalActions {
  pi: number;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** chips the call puts in (may be less than toCall when all-in) */
  callAmount: number;
  /** 'bet' when nobody has bet this street, 'raise' otherwise, null if not allowed */
  raiseType: 'bet' | 'raise' | null;
  /** minimum legal raise-to (equals maxTo when only an all-in is possible) */
  minTo: number;
  /** maximum raise-to (all-in) */
  maxTo: number;
}

export function legalActions(s: HandState): LegalActions | null {
  if (s.finished || s.toAct < 0) return null;
  const pi = s.toAct;
  const p = s.players[pi];
  const toCall = Math.max(0, s.currentBet - p.streetBet);
  const maxTo = p.streetBet + p.stack;
  const othersCanAct = s.players.some((q, qi) => qi !== pi && canAct(q));
  const reopened = !p.hasActed || s.currentBet - p.actedAtBet >= s.lastRaiseSize;
  let raiseType: 'bet' | 'raise' | null = null;
  let minTo = 0;
  if (othersCanAct && maxTo > s.currentBet) {
    if (s.currentBet === 0) {
      raiseType = 'bet';
      minTo = Math.min(s.config.bigBlind, maxTo);
    } else if (reopened) {
      raiseType = 'raise';
      minTo = Math.min(s.currentBet + s.lastRaiseSize, maxTo);
    }
  }
  return {
    pi,
    toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.stack),
    raiseType,
    minTo: raiseType ? minTo : 0,
    maxTo: raiseType ? maxTo : 0,
  };
}

/** Is `a` legal right now? Returns an error message or null. */
export function validateAction(s: HandState, a: Action): string | null {
  const la = legalActions(s);
  if (!la) return 'hand is not waiting for an action';
  switch (a.type) {
    case 'fold':
      return la.canFold ? null : 'cannot fold when checking is free';
    case 'check':
      return la.canCheck ? null : 'cannot check facing a bet';
    case 'call':
      return la.canCall ? null : 'nothing to call';
    case 'bet':
    case 'raise': {
      if (la.raiseType !== a.type) return `cannot ${a.type} now`;
      const amt = a.amount;
      if (amt === undefined || !Number.isInteger(amt)) return 'amount must be a whole number of chips';
      if (amt < la.minTo) return `minimum is ${la.minTo}`;
      if (amt > la.maxTo) return `maximum is ${la.maxTo}`;
      return null;
    }
  }
  return 'unknown action';
}

// ---------------------------------------------------------------------------------------
// apply

export function applyAction(prev: HandState, a: Action): HandState {
  const err = validateAction(prev, a);
  if (err) throw new IllegalActionError(err);
  const s = clone(prev);
  const pi = s.toAct;
  const p = s.players[pi];
  const toCallBefore = Math.max(0, s.currentBet - p.streetBet);
  const potBefore = potTotal(s);
  const stackBefore = p.stack;
  let added = 0;
  let incomplete = false;
  switch (a.type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      break;
    case 'call':
      added = commit(p, toCallBefore);
      break;
    case 'bet':
    case 'raise': {
      const to = a.amount!;
      added = commit(p, to - p.streetBet);
      const raiseSize = to - s.currentBet;
      if (a.type === 'bet') {
        // An opening bet always gives everyone else a fresh decision.
        if (raiseSize < s.config.bigBlind) incomplete = true;
        s.lastRaiseSize = Math.max(raiseSize, s.config.bigBlind);
        for (const q of s.players) if (q !== p) q.hasActed = false;
      } else if (raiseSize >= s.lastRaiseSize) {
        s.lastRaiseSize = raiseSize;
        for (const q of s.players) if (q !== p) q.hasActed = false;
      } else {
        // all-in for less than a full raise: does not reopen betting for players who acted
        incomplete = true;
      }
      s.currentBet = to;
      s.lastAggressor = pi;
      if (s.street === 'preflop') s.preflopAggressor = pi;
      break;
    }
  }
  p.hasActed = true;
  p.actedAtBet = s.currentBet;
  const record: ActionRecord = {
    pi,
    seat: p.seat,
    street: s.street,
    type: a.type,
    added,
    to: p.streetBet,
    allIn: p.allIn,
    potBefore,
    toCallBefore,
    stackBefore,
    ...(incomplete ? { incomplete } : {}),
  };
  s.actions.push(record);
  s.events.push({ kind: 'action', record });

  if (liveCount(s) === 1) {
    finishUncontested(s);
    return s;
  }
  const next = findNext(s, pi, (q) => needsToAct(s, q));
  if (next >= 0) {
    s.toAct = next;
  } else {
    closeRound(s);
  }
  return s;
}

/** Return any part of the top bet nobody else matched. */
function refundUncalled(s: HandState) {
  let top = -1;
  let topBet = -1;
  let second = 0;
  s.players.forEach((p, pi) => {
    if (p.streetBet > topBet) {
      second = Math.max(second, topBet);
      topBet = p.streetBet;
      top = pi;
    } else {
      second = Math.max(second, p.streetBet);
    }
  });
  if (top >= 0 && topBet > second) {
    const amt = topBet - second;
    const p = s.players[top];
    p.stack += amt;
    p.streetBet -= amt;
    p.totalBet -= amt;
    if (p.stack > 0) p.allIn = false;
    s.events.push({ kind: 'refund', pi: top, amount: amt });
  }
}

function closeRound(s: HandState) {
  refundUncalled(s);
  if (liveCount(s) === 1) {
    finishUncontested(s);
    return;
  }
  // Keep dealing streets until someone has a decision or the river is done.
  for (;;) {
    if (s.street === 'river') {
      showdown(s);
      return;
    }
    if (actorCount(s) <= 1) s.runout = true;
    dealNextStreet(s);
    if (!s.runout) {
      s.toAct = findNext(s, s.buttonPi, (q) => needsToAct(s, q));
      if (s.toAct >= 0) return;
    }
  }
}

function dealNextStreet(s: HandState) {
  const idx = STREETS.indexOf(s.street);
  const street = STREETS[idx + 1];
  const count = street === 'flop' ? 3 : 1;
  const cards = s.deck.slice(s.deckPos, s.deckPos + count);
  s.deckPos += count;
  s.board = [...s.board, ...cards];
  s.street = street;
  s.currentBet = 0;
  s.lastRaiseSize = s.config.bigBlind;
  s.lastAggressor = -1;
  for (const p of s.players) {
    p.streetBet = 0;
    p.hasActed = false;
    p.actedAtBet = 0;
  }
  s.events.push({ kind: 'street', street, cards });
}

function finishUncontested(s: HandState) {
  refundUncalled(s);
  const winner = s.players.findIndex((p) => !p.folded);
  const amount = potTotal(s);
  s.pots = [{ amount, eligible: [winner] }];
  const award: PotAward = { potIndex: 0, amount, winners: [winner], shares: [amount] };
  s.awards = [award];
  s.won[winner] += amount;
  s.players[winner].stack += amount;
  s.events.push({ kind: 'award', award });
  end(s);
}

function end(s: HandState) {
  s.finished = true;
  s.toAct = -1;
  for (const p of s.players) p.streetBet = 0;
  s.events.push({ kind: 'end' });
}

/** Split all committed chips into a main pot and side pots. Folded players' chips are dead money. */
export function computePots(players: readonly PlayerState[]): Pot[] {
  const levels = [...new Set(players.filter((p) => !p.folded && p.totalBet > 0).map((p) => p.totalBet))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.totalBet, lvl) - prev);
    const eligible = players.map((p, i) => (!p.folded && p.totalBet >= lvl ? i : -1)).filter((i) => i >= 0);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((e, k) => e === eligible[k]))
        last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = lvl;
  }
  // Dead money above the highest live commitment (cannot normally happen after refunds)
  let rest = 0;
  for (const p of players) rest += Math.max(0, p.totalBet - prev);
  if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest;
  return pots;
}

function showdown(s: HandState) {
  s.showdown = true;
  s.toAct = -1;
  const live = s.players.map((p, pi) => (p.folded ? -1 : pi)).filter((pi) => pi >= 0);
  for (const pi of live) s.values[pi] = evaluate([...s.players[pi].hole, ...s.board]);
  s.pots = computePots(s.players);

  // Showdown order: last river aggressor first, otherwise first live player left of the button.
  const first =
    s.lastAggressor >= 0 && !s.players[s.lastAggressor].folded
      ? s.lastAggressor
      : findNext(s, s.buttonPi, (p) => !p.folded);
  const order: number[] = [];
  for (let k = 0; k < n(s); k++) {
    const pi = (first + k) % n(s);
    if (!s.players[pi].folded) order.push(pi);
  }
  // In an all-in run-out every hand is tabled. Otherwise a player shows only if they can
  // still win or tie a pot they are in, given the hands already shown; else they muck.
  const bestShown = s.pots.map(() => -1);
  for (const pi of order) {
    const v = s.values[pi];
    let show = s.runout;
    s.pots.forEach((pot, k) => {
      if (pot.eligible.includes(pi) && v >= bestShown[k]) show = true;
    });
    if (show) {
      s.shown.push(pi);
      s.pots.forEach((pot, k) => {
        if (pot.eligible.includes(pi)) bestShown[k] = Math.max(bestShown[k], v);
      });
      s.events.push({ kind: 'show', pi, cards: s.players[pi].hole, value: v, handName: describeHand(v) });
    } else {
      s.events.push({ kind: 'muck', pi });
    }
  }

  s.pots.forEach((pot, k) => {
    const best = Math.max(...pot.eligible.map((pi) => s.values[pi]));
    // winners ordered clockwise starting left of the button (odd chips go first to them)
    const winners: number[] = [];
    for (let j = 1; j <= n(s); j++) {
      const pi = (s.buttonPi + j) % n(s);
      if (pot.eligible.includes(pi) && s.values[pi] === best) winners.push(pi);
    }
    const base = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - base * winners.length;
    const shares = winners.map(() => base);
    for (let j = 0; odd > 0; j++, odd--) shares[j]++;
    winners.forEach((pi, j) => {
      s.players[pi].stack += shares[j];
      s.won[pi] += shares[j];
    });
    const award: PotAward = { potIndex: k, amount: pot.amount, winners, shares, handName: describeHand(best) };
    s.awards.push(award);
    s.events.push({ kind: 'award', award });
  });
  end(s);
}

// ---------------------------------------------------------------------------------------
// convenience

/** Net result per player index (chips won minus chips committed). */
export function netResults(s: HandState): number[] {
  return s.players.map((p, pi) => s.won[pi] - p.totalBet);
}

/** The all-in action for the player to act (bet/raise to max, or call if raising is not allowed). */
export function allInAction(s: HandState): Action | null {
  const la = legalActions(s);
  if (!la) return null;
  if (la.raiseType) return { type: la.raiseType, amount: la.maxTo };
  if (la.canCall) return { type: 'call' };
  return { type: 'check' };
}

/** Amount needed to call for the player to act (0 if none). */
export function toCallFor(s: HandState, pi: number): number {
  return Math.max(0, s.currentBet - s.players[pi].streetBet);
}
