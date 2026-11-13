/**
 * Match layer: a table of seats that plays a sequence of hands. Pure TypeScript.
 * Handles stacks between hands, button rotation, busting and rebuys.
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
  /** physical seat holding the button for the last hand (-1 before the first hand) */
  buttonSeat: number;
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
    // so the first hand's button lands on firstButtonSeat
    buttonSeat: (firstButtonSeat - 1 + players.length) % players.length,
    handsPlayed: 0,
  };
}

/** Seats that will be dealt into the next hand (after applying rebuys). */
export function activeSeats(m: MatchState): SeatInfo[] {
  return m.seats.filter((s) => !s.busted && s.stack > 0);
}

/** Apply rebuys for broke seats that allow it; mark the rest busted. Mutates and returns m. */
export function settleBetweenHands(m: MatchState): MatchState {
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
export function rebuy(m: MatchState, seat: number): void {
  const s = m.seats.find((x) => x.seat === seat);
  if (!s) return;
  s.stack = m.startingStack;
  s.buyIns += m.startingStack;
  s.busted = false;
}

/** Start the next hand: moves the button clockwise to the next seat with chips and deals. */
export function dealNextHand(m: MatchState, rng: Rng, handId = m.handsPlayed + 1): HandState {
  const live = activeSeats(m);
  if (live.length < 2) throw new Error('not enough players');
  const nSeats = m.seats.length;
  let btn = m.buttonSeat;
  for (let k = 1; k <= nSeats; k++) {
    const cand = (m.buttonSeat + k) % nSeats;
    if (live.some((s) => s.seat === cand)) {
      btn = cand;
      break;
    }
  }
  m.buttonSeat = btn;
  const players = live.map((s) => ({ id: s.id, name: s.name, seat: s.seat, stack: s.stack }));
  const buttonPi = players.findIndex((p) => p.seat === btn);
  return startHand({ handId, config: m.config, players, buttonPi, deck: shuffledDeck(rng) });
}

/** Write a finished hand's stacks back to the match. */
export function recordHand(m: MatchState, h: HandState): number[] {
  if (!h.finished) throw new Error('hand not finished');
  for (const p of h.players) {
    const s = m.seats.find((x) => x.seat === p.seat)!;
    s.stack = p.stack;
  }
  m.handsPlayed++;
  return netResults(h);
}
