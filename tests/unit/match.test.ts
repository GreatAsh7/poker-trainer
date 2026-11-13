import { describe, it, expect } from 'vitest';
import {
  createMatch, dealNextHand, recordHand, settleBetweenHands, rebuy, matchOverReason, type MatchState,
} from '../../src/engine/match';
import { applyAction, legalActions, type HandState } from '../../src/engine/game';
import { viewFor, publicHand } from '../../src/engine/view';
import { mulberry32, type Rng } from '../../src/engine/cards';

const CFG = { smallBlind: 1, bigBlind: 2 };
const players = (n: number, autoRebuy = false) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, autoRebuy }));

function foldAround(h: HandState): HandState {
  while (!h.finished) {
    const la = legalActions(h)!;
    h = applyAction(h, la.canFold ? { type: 'fold' } : { type: 'check' });
  }
  return h;
}

/** play one fold-around hand; returns [match, hand] */
function playOne(m: MatchState, rng: Rng): [MatchState, HandState] {
  const d = dealNextHand(m, rng);
  const h = foldAround(d.hand);
  return [settleBetweenHands(recordHand(d.match, h).match), h];
}

const seatOf = (h: HandState, pi: number) => h.players[pi].seat;

describe('match', () => {
  it('button and blinds move one seat clockwise each hand', () => {
    let m = createMatch(CFG, 200, players(4));
    const rng = mulberry32(1);
    const rows: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const [m2, h] = playOne(m, rng);
      m = m2;
      rows.push([seatOf(h, h.buttonPi), seatOf(h, h.sbPi), seatOf(h, h.bbPi)]);
    }
    expect(rows).toEqual([[0, 1, 2], [1, 2, 3], [2, 3, 0], [3, 0, 1], [0, 1, 2]]);
  });

  it('does not mutate its inputs', () => {
    const m = createMatch(CFG, 200, players(3));
    const before = JSON.stringify(m);
    const d = dealNextHand(m, mulberry32(1));
    recordHand(d.match, foldAround(d.hand));
    settleBetweenHands(m);
    rebuy(m, 0);
    expect(JSON.stringify(m)).toBe(before);
  });

  it('3 → heads-up: nobody posts the big blind twice in a row', () => {
    let m = createMatch(CFG, 200, players(3));
    const rng = mulberry32(2);
    const d = dealNextHand(m, rng); // button 0, SB 1, BB 2
    expect([seatOf(d.hand, d.hand.buttonPi), seatOf(d.hand, d.hand.sbPi), seatOf(d.hand, d.hand.bbPi)]).toEqual([0, 1, 2]);
    m = recordHand(d.match, foldAround(d.hand)).match;
    m.seats[0].stack = 0; // seat 0 busts
    m = settleBetweenHands(m);
    const d2 = dealNextHand(m, rng);
    const h = d2.hand;
    expect(h.players.map((p) => p.seat)).toEqual([1, 2]);
    expect(seatOf(h, h.bbPi)).toBe(1); // big blind moves forward to seat 1
    expect(seatOf(h, h.buttonPi)).toBe(2); // seat 2 is button + small blind
    expect(h.sbPi).toBe(h.buttonPi);
  });

  it('big blind always moves forward when a player busts', () => {
    let m = createMatch(CFG, 200, players(4));
    const rng = mulberry32(3);
    const d = dealNextHand(m, rng); // BTN 0, SB 1, BB 2
    m = recordHand(d.match, foldAround(d.hand)).match;
    m.seats[2].stack = 0; // the big blind busts
    m = settleBetweenHands(m);
    const h = dealNextHand(m, rng).hand;
    expect(seatOf(h, h.bbPi)).toBe(3); // seat 3 pays the big blind next, nobody skips it
  });

  it('auto-rebuy refills a broke seat; manual rebuy un-busts', () => {
    let m = createMatch(CFG, 100, [
      { id: 'u', name: 'You', autoRebuy: false },
      { id: 'b', name: 'Bot', autoRebuy: true },
    ]);
    m.seats[1].stack = 0;
    m.seats[0].stack = 0;
    m = settleBetweenHands(m);
    expect(m.seats[1].stack).toBe(100);
    expect(m.seats[1].buyIns).toBe(200);
    expect(m.seats[0].busted).toBe(true);
    expect(matchOverReason(m, 50)).toBe('busted');
    m = rebuy(m, 0);
    expect(m.seats[0].busted).toBe(false);
    expect(m.seats[0].stack).toBe(100);
    expect(matchOverReason(m, 50)).toBe(null);
    m = { ...m, handsPlayed: 50 };
    expect(matchOverReason(m, 50)).toBe('hands');
  });

  it('stacks always add up to buy-ins minus nothing (chips conserved across 300 hands)', () => {
    let m = createMatch(CFG, 100, players(6, true));
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      const d = dealNextHand(m, rng);
      let h = d.hand;
      while (!h.finished) {
        const la = legalActions(h)!;
        const r = rng();
        if (la.raiseType && r < 0.25) h = applyAction(h, { type: la.raiseType, amount: la.maxTo });
        else if (la.canCall && r < 0.7) h = applyAction(h, { type: 'call' });
        else h = applyAction(h, la.canFold ? { type: 'fold' } : { type: 'check' });
      }
      const chipsBefore = d.match.seats.reduce((a, s) => a + s.stack, 0);
      m = recordHand(d.match, h).match;
      expect(m.seats.reduce((a, s) => a + s.stack, 0)).toBe(chipsBefore);
      m = settleBetweenHands(m);
    }
    expect(m.handsPlayed).toBe(300);
  });
});

describe('views hide private information', () => {
  it('a bot view contains only its own hole cards and no deck', () => {
    const { hand: h } = dealNextHand(createMatch(CFG, 200, players(6)), mulberry32(3));
    const v = viewFor(h, 2);
    expect(v.hole).toEqual(h.players[2].hole);
    expect('deck' in v).toBe(false);
    for (const pi of h.players.keys()) expect('hole' in v.players[pi]).toBe(false);
    expect(JSON.stringify(v)).not.toMatch(/deck/);
  });

  it('publicHand strips the deck and untabled hole cards', () => {
    const { hand: h } = dealNextHand(createMatch(CFG, 200, players(6)), mulberry32(4));
    const p = publicHand(h, 0);
    expect(p.deck).toEqual([]);
    expect(p.players[0].hole.length).toBe(2);
    for (let pi = 1; pi < 6; pi++) expect(p.players[pi].hole).toEqual([]);
  });
});
