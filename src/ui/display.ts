/**
 * Display model: what the table should show after the first `k` events of a hand.
 * The engine jumps straight to the next state; the UI walks through the events one by one
 * so every deal, bet, street and award can be animated in order.
 */
import type { Card } from '../engine/cards';
import type { ActionRecord, HandState, PotAward, Street } from '../engine/game';
import { computePots } from '../engine/game';
import { cardsToString } from '../engine/cards';
import { describeHandDetailed, evaluate } from '../engine/evaluator';

export interface SeatDisplay {
  pi: number;
  seat: number;
  id: string;
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  /** cards visible to the viewer (null = face down; [] = no cards) */
  cards: Card[] | null;
  hasCards: boolean;
  mucked: boolean;
  /** last action label this street, e.g. "Raise 12" */
  label: string | null;
  labelKind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'blind' | 'win' | null;
  isButton: boolean;
  isSB: boolean;
  isBB: boolean;
  /** chips won in the award shown so far */
  won: number;
  handName: string | null;
  winner: boolean;
}

export interface PotDisplay {
  amount: number;
  label: string;
}

export interface TableDisplay {
  handId: number;
  street: Street;
  board: Card[];
  seats: SeatDisplay[];
  /** chips already collected into the middle */
  pot: number;
  /** pot including bets in front of players */
  totalPot: number;
  /** main + side pots (collected chips only), only when more than one */
  pots: PotDisplay[];
  /** pot awards revealed so far */
  awards: PotAward[];
  /** index of the event that was just shown (-1 = none) */
  lastEvent: number;
  /** collected-bets animation tick: increments each time bets are swept into the pot */
  sweep: number;
  finished: boolean;
  /** player index whose turn it is (only when all events are shown) */
  toAct: number;
  currentBet: number;
}

function actionLabel(r: ActionRecord): { label: string; kind: SeatDisplay['labelKind'] } {
  if (r.allIn && r.type !== 'fold' && r.type !== 'check') return { label: `All-in ${r.to}`, kind: 'allin' };
  switch (r.type) {
    case 'fold':
      return { label: 'Fold', kind: 'fold' };
    case 'check':
      return { label: 'Check', kind: 'check' };
    case 'call':
      return { label: `Call ${r.added}`, kind: 'call' };
    case 'bet':
      return { label: `Bet ${r.to}`, kind: 'bet' };
    case 'raise':
      return { label: `Raise to ${r.to}`, kind: 'raise' };
  }
}

export function deriveDisplay(h: HandState, k: number, viewerPi: number): TableDisplay {
  const seats: SeatDisplay[] = h.players.map((p, pi) => ({
    pi,
    seat: p.seat,
    id: p.id,
    name: p.name,
    stack: p.startStack,
    bet: 0,
    folded: false,
    allIn: false,
    cards: null,
    hasCards: false,
    mucked: false,
    label: null,
    labelKind: null,
    isButton: pi === h.buttonPi,
    isSB: pi === h.sbPi,
    isBB: pi === h.bbPi,
    won: 0,
    handName: null,
    winner: false,
  }));
  const totals = h.players.map(() => 0);
  let pot = 0;
  let board: Card[] = [];
  let street: Street = 'preflop';
  let sweep = 0;
  const awards: PotAward[] = [];
  let finished = false;
  let currentBet = 0;

  let labelsCleared = false;
  const clearLabels = () => {
    if (labelsCleared) return;
    labelsCleared = true;
    for (const s of seats) {
      if (s.labelKind === 'win') continue;
      s.label = null;
      s.labelKind = null;
    }
  };
  const collect = () => {
    let any = false;
    for (const s of seats) {
      if (s.bet > 0) any = true;
      pot += s.bet;
      s.bet = 0;
    }
    if (any) sweep++;
  };

  const count = Math.min(k, h.events.length);
  for (let i = 0; i < count; i++) {
    const e = h.events[i];
    switch (e.kind) {
      case 'post': {
        const s = seats[e.pi];
        s.stack -= e.amount;
        s.bet += e.amount;
        totals[e.pi] += e.amount;
        s.allIn = e.allIn;
        s.label = e.blind === 'sb' ? `SB ${e.amount}` : `BB ${e.amount}`;
        s.labelKind = 'blind';
        currentBet = Math.max(currentBet, s.bet);
        break;
      }
      case 'deal':
        for (const s of seats) {
          s.hasCards = true;
          s.cards = s.pi === viewerPi && h.players[s.pi].hole.length ? [...h.players[s.pi].hole] : null;
        }
        break;
      case 'action': {
        const r = e.record;
        const s = seats[r.pi];
        s.stack -= r.added;
        s.bet += r.added;
        totals[r.pi] += r.added;
        if (r.type === 'fold') {
          s.folded = true;
          s.hasCards = false;
          if (s.pi !== viewerPi) s.cards = null;
        }
        s.allIn = r.allIn;
        const l = actionLabel(r);
        s.label = l.label;
        s.labelKind = l.kind;
        currentBet = Math.max(currentBet, s.bet);
        break;
      }
      case 'refund': {
        const s = seats[e.pi];
        s.stack += e.amount;
        s.bet -= e.amount;
        totals[e.pi] -= e.amount;
        if (s.stack > 0) s.allIn = false;
        if (s.labelKind === 'allin' && s.bet > 0) {
          s.label = `Bet ${s.bet}`;
          s.labelKind = 'bet';
        }
        break;
      }
      case 'street':
        collect();
        board = [...board, ...e.cards];
        street = e.street;
        currentBet = 0;
        for (const s of seats) {
          if (s.labelKind !== 'allin' && s.labelKind !== 'fold') {
            s.label = null;
            s.labelKind = null;
          }
        }
        break;
      case 'reveal':
        clearLabels();
        seats[e.pi].cards = [...e.cards];
        break;
      case 'show': {
        clearLabels();
        const s = seats[e.pi];
        s.cards = [...e.cards];
        s.handName = e.handName;
        break;
      }
      case 'muck': {
        const s = seats[e.pi];
        s.mucked = true;
        // the hero always sees the name of their own hand
        const hole = h.players[e.pi].hole;
        if (e.pi === viewerPi && hole.length === 2 && board.length === 5) s.handName = describeHandDetailed(evaluate([...hole, ...board]));
        break;
      }
      case 'award': {
        collect();
        const a = e.award;
        awards.push(a);
        pot -= a.amount;
        a.winners.forEach((pi, j) => {
          seats[pi].stack += a.shares[j];
          seats[pi].won += a.shares[j];
          seats[pi].winner = true;
          seats[pi].label = `Wins ${seats[pi].won}`;
          seats[pi].labelKind = 'win';
        });
        break;
      }
      case 'end':
        finished = true;
        break;
    }
  }
  const caughtUp = count >= h.events.length;
  // side pots from collected chips only (bets in front of players not yet swept)
  let pots: PotDisplay[] = [];
  if (!finished && pot > 0) {
    const committed = h.players.map((p, pi) => ({
      ...p,
      totalBet: totals[pi] - seats[pi].bet,
      folded: seats[pi].folded,
    }));
    const ps = computePots(committed);
    if (ps.length > 1) {
      const awarded = new Set(awards.map((a) => a.potIndex));
      const open = ps.map((p, i) => ({ amount: p.amount, label: i === 0 ? 'Main pot' : `Side pot ${i}` })).filter((_, i) => !awarded.has(i));
      if (open.length >= 1) pots = open;
    }
  }
  return {
    handId: h.handId,
    street,
    board,
    seats,
    pot,
    totalPot: pot + seats.reduce((a, s) => a + s.bet, 0),
    pots,
    awards,
    lastEvent: count - 1,
    sweep,
    finished,
    toAct: caughtUp && !h.finished ? h.toAct : -1,
    currentBet,
  };
}

/** Plain-text line for the hand log. */
export function describeEvent(h: HandState, i: number, viewerPi: number): string | null {
  const e = h.events[i];
  const name = (pi: number) => (pi === viewerPi ? 'You' : h.players[pi].name);
  switch (e.kind) {
    case 'post':
      return `${name(e.pi)} post${e.pi === viewerPi ? '' : 's'} ${e.blind === 'sb' ? 'small blind' : 'big blind'} ${e.amount}${e.allIn ? ' (all-in)' : ''}`;
    case 'deal':
      return null;
    case 'action': {
      const r = e.record;
      const you = r.pi === viewerPi;
      const v = (base: string) => (you ? base : base + 's');
      const allIn = r.allIn ? ' (all-in)' : '';
      switch (r.type) {
        case 'fold':
          return `${name(r.pi)} ${v('fold')}`;
        case 'check':
          return `${name(r.pi)} ${v('check')}`;
        case 'call':
          return `${name(r.pi)} ${v('call')} ${r.added}${allIn}`;
        case 'bet':
          return `${name(r.pi)} ${v('bet')} ${r.to}${allIn}`;
        case 'raise':
          return `${name(r.pi)} ${v('raise')} to ${r.to}${allIn}`;
      }
      return null;
    }
    case 'street':
      return null;
    case 'refund':
      return `Uncalled bet (${e.amount}) returned to ${name(e.pi)}`;
    case 'show':
      return `${name(e.pi)} ${e.pi === viewerPi ? 'show' : 'shows'} ${cardsToString(e.cards)} — ${e.handName}`;
    case 'muck':
      return `${name(e.pi)} ${e.pi === viewerPi ? 'muck' : 'mucks'}`;
    case 'award': {
      const a = e.award;
      const potName = h.pots.length > 1 || a.potIndex > 0 ? (a.potIndex === 0 ? 'main pot' : `side pot ${a.potIndex}`) : 'pot';
      if (a.winners.length === 1) {
        const w = a.winners[0];
        return `${name(w)} ${w === viewerPi ? 'win' : 'wins'} ${a.amount} (${potName})${a.handName && h.showdown ? ` with ${a.handName}` : ''}`;
      }
      return `${a.winners.map(name).join(' and ')} split the ${potName} (${a.amount})${a.handName ? ` with ${a.handName}` : ''}`;
    }
    case 'reveal':
      return `${name(e.pi)} ${e.pi === viewerPi ? 'turn' : 'turns'} up ${cardsToString(e.cards)}`;
    case 'end':
      return null;
  }
}
