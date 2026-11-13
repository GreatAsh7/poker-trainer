/**
 * Match layer: a table of seats that plays a sequence of hands. Pure TypeScript.
 * Every function returns a new MatchState (inputs are never mutated).
 *
 * Blind rotation uses the "big blind always moves forward" rule: each hand the big blind
 * goes to the next seat with chips after the previous big blind, so nobody skips or
 * repeats the big blind when players bust. The small blind and button are the live seats
 * immediately before it. Heads-up, the non-big-blind player has the button and posts the
 * small blind.
 */
import { type Rng, shuffledDeck } from './cards';
import { type HandState, type TableConfig, startHand, netResults } from './game';

export interface SeatInfo {
  seat: number;
  id: string;
  name: string;
  stack: number;
  /** total chips bought in (starting stack + rebuys) */
  buyIns: number;
  /** may rebuy automatically when broke */
  autoRebuy: boolean;
  busted: boolean;
}

export interface MatchState {
  config: TableConfig;
  startingStack: number;
  seats: SeatInfo[];
  /** physical seat that held the button last hand (-1 before the first hand) */
  buttonSeat: number;
  /** physical seat that posted the big blind last hand (-1 before the first hand) */
  bbSeat: number;
  /** physical seat that should get the button on the first hand */
  firstButtonSeat: number;
  handsPlayed: number;
}

export function createMatch(
  config: TableConfig,
  startingStack: number,
  players: { id: string; name: string; autoRebuy: boolean }[],
  firstButtonSeat = 0,
): MatchState {
  return {
    config,
    startingStack,
    seats: players.map((p, i) => ({
      seat: i,
      id: p.id,
      name: p.name,
      stack: startingStack,
      buyIns: startingStack,
      autoRebuy: p.autoRebuy,
      busted: false,
    })),
    buttonSeat: -1,
    bbSeat: -1,
    firstButtonSeat,
    handsPlayed: 0,
  };
}

const copy = (m: MatchState): MatchState => ({ ...m, seats: m.seats.map((s) => ({ ...s })) });

/** Seats that will be dealt into the next hand. */
export function activeSeats(m: MatchState): SeatInfo[] {
  return m.seats.filter((s) => !s.busted && s.stack > 0);
}

/** Apply automatic rebuys for broke seats that allow it; mark the rest busted. */
export function settleBetweenHands(prev: MatchState): MatchState {
  const m = copy(prev);
  for (const s of m.seats) {
    if (s.stack <= 0 && !s.busted) {
      if (s.autoRebuy) {
        s.stack = m.startingStack;
        s.buyIns += m.startingStack;
      } else {
        s.busted = true;
        s.stack = 0;
      }
    }
  }
  return m;
}

/** Rebuy a specific seat (e.g. the user chose to rebuy). */
export function rebuy(prev: MatchState, seat: number): MatchState {
  const m = copy(prev);
  const s = m.seats.find((x) => x.seat === seat);
  if (!s) return m;
  s.stack = m.startingStack;
  s.buyIns += m.startingStack;
  s.busted = false;
  return m;
}

/** Why the match is over, or null if another hand can be dealt. */
export function matchOverReason(m: MatchState, handsToPlay: number, heroSeat = 0): 'hands' | 'busted' | 'winner' | null {
  const hero = m.seats.find((s) => s.seat === heroSeat);
  if (hero && (hero.busted || hero.stack <= 0) && !hero.autoRebuy) return 'busted';
  if (activeSeats(m).length < 2) return 'winner';
  if (m.handsPlayed >= handsToPlay) return 'hands';
  return null;
}

/** Start the next hand. Returns the updated match (blind positions) and the new hand. */
export function dealNextHand(prev: MatchState, rng: Rng, handId = prev.handsPlayed + 1): { match: MatchState; hand: HandState } {
  const m = copy(prev);
  const live = activeSeats(m).map((s) => s.seat); // ascending = clockwise
  if (live.length < 2) throw new Error('not enough players');
  const nSeats = m.seats.length;
  const nextLive = (from: number) => {
    for (let k = 1; k <= nSeats; k++) {
      const c = (from + k) % nSeats;
      if (live.includes(c)) return c;
    }
    return live[0];
  };
  let bbSeat: number;
  if (m.bbSeat < 0) {
    // first hand: button on firstButtonSeat (or the next live seat)
    const btn = live.includes(m.firstButtonSeat) ? m.firstButtonSeat : nextLive(m.firstButtonSeat);
    bbSeat = live.length === 2 ? nextLive(btn) : nextLive(nextLive(btn));
  } else {
    bbSeat = nextLive(m.bbSeat);
  }
  const players = live.map((seat) => {
    const s = m.seats[seat];
    return { id: s.id, name: s.name, seat: s.seat, stack: s.stack };
  });
  const np = players.length;
  const bbPi = players.findIndex((p) => p.seat === bbSeat);
  // heads-up: the other player is button + small blind; otherwise button is two seats before the BB
  const buttonPi = np === 2 ? (bbPi + 1) % 2 : (bbPi - 2 + np) % np;
  m.bbSeat = bbSeat;
  m.buttonSeat = players[buttonPi].seat;
  const hand = startHand({ handId, config: m.config, players, buttonPi, deck: shuffledDeck(rng) });
  return { match: m, hand };
}

/** Write a finished hand's stacks back to the match. */
export function recordHand(prev: MatchState, h: HandState): { match: MatchState; net: number[] } {
  if (!h.finished) throw new Error('hand not finished');
  const m = copy(prev);
  for (const p of h.players) {
    const s = m.seats.find((x) => x.seat === p.seat)!;
    s.stack = p.stack;
  }
  m.handsPlayed++;
  return { match: m, net: netResults(h) };
}
