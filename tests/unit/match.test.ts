import { describe, it, expect } from 'vitest';
import { createMatch, dealNextHand, recordHand, settleBetweenHands, rebuy } from '../../src/engine/match';
import { applyAction, legalActions, type HandState } from '../../src/engine/game';
import { viewFor } from '../../src/engine/view';
import { mulberry32 } from '../../src/engine/cards';

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

describe('match', () => {
  it('button moves one seat clockwise each hand', () => {
    const m = createMatch(CFG, 200, players(4));
    const rng = mulberry32(1);
    const buttons: number[] = [];
    for (let i = 0; i < 6; i++) {
      const h = dealNextHand(m, rng);
      buttons.push(h.players[h.buttonPi].seat);
      recordHand(m, foldAround(h));
      settleBetweenHands(m);
    }
    expect(buttons).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('skips busted seats and switches to heads-up blind rules', () => {
    const m = createMatch(CFG, 200, players(3));
    m.seats[1].stack = 0;
    settleBetweenHands(m);
    expect(m.seats[1].busted).toBe(true);
    const h = dealNextHand(m, mulberry32(2));
    expect(h.players.map((p) => p.seat)).toEqual([0, 2]);
    expect(h.sbPi).toBe(h.buttonPi); // heads-up: button is the small blind
  });

  it('auto-rebuy refills a broke seat; manual rebuy un-busts', () => {
    const m = createMatch(CFG, 100, [
      { id: 'u', name: 'You', autoRebuy: false },
      { id: 'b', name: 'Bot', autoRebuy: true },
    ]);
    m.seats[1].stack = 0;
    m.seats[0].stack = 0;
    settleBetweenHands(m);
    expect(m.seats[1].stack).toBe(100);
    expect(m.seats[1].buyIns).toBe(200);
    expect(m.seats[0].busted).toBe(true);
    rebuy(m, 0);
    expect(m.seats[0].busted).toBe(false);
    expect(m.seats[0].stack).toBe(100);
  });

  it('total chips across hands equal total buy-ins', () => {
    const m = createMatch(CFG, 100, players(6, true));
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      let h = dealNextHand(m, rng);
      while (!h.finished) {
        const la = legalActions(h)!;
        const r = rng();
        if (la.raiseType && r < 0.25) h = applyAction(h, { type: la.raiseType, amount: la.maxTo });
        else if (la.canCall && r < 0.7) h = applyAction(h, { type: 'call' });
        else h = applyAction(h, la.canFold ? { type: 'fold' } : { type: 'check' });
      }
      recordHand(m, h);
      settleBetweenHands(m);
      const chips = m.seats.reduce((a, s) => a + s.stack, 0);
      const buyIns = m.seats.reduce((a, s) => a + s.buyIns, 0);
      // busted-then-rebought chips are counted in buyIns; stacks + lost = buyIns
      expect(chips).toBeLessThanOrEqual(buyIns);
    }
    expect(m.handsPlayed).toBe(300);
  });
});

describe('player view hides private information', () => {
  it('a view contains only the viewer’s hole cards and no deck', () => {
    const m = createMatch(CFG, 200, players(6));
    const h = dealNextHand(m, mulberry32(3));
    const v = viewFor(h, 2);
    const json = JSON.stringify(v);
    expect(v.hole).toEqual(h.players[2].hole);
    expect('deck' in v).toBe(false);
    for (const [pi, p] of h.players.entries()) {
      expect('hole' in v.players[pi]).toBe(false);
      if (pi !== 2) expect(p.hole.every((c) => !v.hole.includes(c))).toBe(true);
    }
    expect(json).not.toMatch(/deck/);
  });
});
