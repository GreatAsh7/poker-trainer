import { describe, it, expect } from 'vitest';
import { makeHand, act } from './helpers';
import { deriveDisplay } from '../../src/ui/display';
import { presetsFor, potOdds, defaultRaiseTo } from '../../src/ui/presets';
import { legalActions, applyAction, startHand, type HandState } from '../../src/engine/game';
import { publicHand } from '../../src/engine/view';
import { mulberry32, shuffledDeck } from '../../src/engine/cards';

function randomHand(seed: number): HandState {
  const rng = mulberry32(seed);
  const np = 2 + Math.floor(rng() * 5);
  let s = startHand({
    handId: seed,
    config: { smallBlind: 1, bigBlind: 2 },
    players: Array.from({ length: np }, (_, i) => ({ id: `${i}`, name: `P${i}`, seat: i, stack: 1 + Math.floor(rng() * 200) })),
    buttonPi: 0,
    deck: shuffledDeck(rng),
  });
  while (!s.finished) {
    const la = legalActions(s)!;
    const r = rng();
    if (la.raiseType && r < 0.35) s = applyAction(s, { type: la.raiseType, amount: la.maxTo });
    else if (la.canCall && r < 0.85) s = applyAction(s, { type: 'call' });
    else s = applyAction(s, la.canFold ? { type: 'fold' } : { type: 'check' });
  }
  return s;
}

describe('display model', () => {
  it('pots shown always add up to the pot, chips are conserved, no hidden cards (2,000 hands, every step)', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const full = randomHand(seed);
      const total = full.players.reduce((a, p) => a + p.startStack, 0);
      for (let k = 0; k <= full.events.length; k++) {
        const h = publicHand(full, 0, k);
        const d = deriveDisplay(h, k, 0);
        const chips = d.seats.reduce((a, s) => a + s.stack + s.bet, 0) + d.pot;
        expect(chips).toBe(total);
        if (d.pots.length) expect(d.pots.reduce((a, p) => a + p.amount, 0)).toBe(d.pot);
        for (const s of d.seats) {
          if (s.pi === 0 || !s.cards) continue;
          // a bot's cards may only be visible once they were turned up in the events shown so far
          expect(h.events.some((e) => (e.kind === 'show' || e.kind === 'reveal') && e.pi === s.pi)).toBe(true);
        }
        // the public hand never contains future board cards
        expect(h.board.length).toBe(d.board.length);
      }
      const end = deriveDisplay(full, full.events.length, 0);
      end.seats.forEach((s, pi) => expect(s.stack).toBe(full.players[pi].stack));
    }
  });
});

describe('presets', () => {
  it('isolation sizes over limpers and standard 4-bet sizes', () => {
    let s = makeHand({ stacks: [200, 200, 200, 200, 200, 200] });
    s = act(s, 'c', 'c', 'c'); // UTG, HJ, CO limp; button to act
    const la = legalActions(s)!;
    const ps = presetsFor({ legal: la, street: 'preflop', pot: 9, currentBet: 2, bigBlind: 2, preflopRaises: 0, limpers: 3 });
    expect(ps[0]).toMatchObject({ label: '6x', to: 12 });
    let t = makeHand({ stacks: [200, 200, 200, 200, 200, 200] });
    t = act(t, 'r5', 'r18'); // open, 3-bet
    t = act(t, 'f', 'f', 'f', 'f'); // back to opener
    const la2 = legalActions(t)!;
    const ctx = { legal: la2, street: 'preflop' as const, pot: 26, currentBet: 18, bigBlind: 2, preflopRaises: 2, limpers: 0 };
    expect(presetsFor(ctx)[0]).toMatchObject({ label: '2.2x', to: 40 });
    expect(defaultRaiseTo(ctx)).toBe(40);
  });

  it('every preset is legal', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed);
      let s = makeHand({ stacks: [100 + seed, 150, 80, 300] });
      for (let i = 0; i < 6 && !s.finished; i++) {
        const la = legalActions(s)!;
        if (la.raiseType) {
          const pot = s.players.reduce((a, p) => a + p.totalBet, 0);
          for (const p of presetsFor({ legal: la, street: s.street, pot, currentBet: s.currentBet, bigBlind: 2, preflopRaises: 1, limpers: 0 })) {
            expect(p.to).toBeGreaterThanOrEqual(la.minTo);
            expect(p.to).toBeLessThanOrEqual(la.maxTo);
          }
        }
        s = applyAction(s, la.canCall && rng() < 0.6 ? { type: 'call' } : la.canCheck ? { type: 'check' } : { type: 'call' });
      }
    }
  });
});

describe('pot odds', () => {
  it('normal call', () => {
    // pot 5 before a 3 bet... totals: villain 3+, hero 0
    const o = potOdds({ toCall: 3, callAmount: 3, callIsAllIn: false } as never, [5, 3, 0], 2)!;
    expect(o.pot).toBe(8);
    expect(o.need).toBeCloseTo(3 / 11, 6);
  });
  it('all-in for less only counts chips you can win', () => {
    // button raises to 100, SB folded (1), BB has 30 total and has posted 2 → calls 28
    const o = potOdds({ toCall: 98, callAmount: 28, callIsAllIn: true } as never, [100, 1, 2], 2)!;
    expect(o.pot).toBe(30 + 1 + 2);
    expect(o.need).toBeCloseTo(28 / 61, 6);
  });
  it('excess that forms a side pot between others is excluded', () => {
    // A bet 100, B called 100, hero (20 in) can call 20 more all-in
    const o = potOdds({ toCall: 80, callAmount: 20, callIsAllIn: true } as never, [100, 100, 20], 2)!;
    expect(o.pot).toBe(40 + 40 + 20);
  });
});
