import { describe, it, expect } from 'vitest';
import { makeHand, act } from './helpers';
import { legalActions, validateAction, applyAction } from '../../src/engine/game';
import { describeHandDetailed, evaluate } from '../../src/engine/evaluator';
import { parseCards } from '../../src/engine/cards';

describe('action guards', () => {
  it('rejects an action addressed to a player whose turn it is not', () => {
    const s = makeHand({ stacks: [200, 200, 200] });
    expect(s.toAct).toBe(0);
    expect(validateAction(s, { type: 'call', pi: 1 })).toMatch(/turn/);
    expect(validateAction(s, { type: 'call', pi: 0 })).toBe(null);
  });
  it('rejects a stale double-submit via seq', () => {
    let s = makeHand({ stacks: [200, 200, 200] });
    s = applyAction(s, { type: 'call', pi: 0, seq: 0 });
    expect(validateAction(s, { type: 'call', pi: 1, seq: 0 })).toMatch(/stale/);
  });
});

describe('all-in presentation', () => {
  it('hands are turned up before the run-out board', () => {
    let s = makeHand({ stacks: [100, 100, 100], holes: ['AcAd', 'KcKd', 'QcQd'], board: '2h 3s 8d 9c Jh' });
    s = act(s, 'r100', 'c', 'c');
    const kinds = s.events.map((e) => e.kind);
    const firstStreet = kinds.indexOf('street');
    const reveals = kinds.map((k, i) => (k === 'reveal' ? i : -1)).filter((i) => i >= 0);
    expect(reveals.length).toBe(3);
    expect(Math.max(...reveals)).toBeLessThan(firstStreet);
    expect(s.events.filter((e) => e.kind === 'street').every((e) => e.kind === 'street' && e.runout)).toBe(true);
  });

  it('a called river all-in shows every hand, including the loser', () => {
    let s = makeHand({ stacks: [100, 100], holes: ['AcAd', '7c2d'], board: 'Kh 9s 4d 3c Jh', buttonPi: 0 });
    s = act(s, 'c', 'x', 'x', 'x', 'x', 'x', 'b98', 'c');
    expect(s.finished).toBe(true);
    expect(s.shown.sort()).toEqual([0, 1]);
  });

  it('heads-up: SB facing a big blind all-in for less gets no pointless decision', () => {
    const s = makeHand({ stacks: [100, 1] }); // p0 BTN/SB, p1 BB posts 1 all-in
    expect(s.finished).toBe(true);
    expect(s.board.length).toBe(5);
    expect(s.actions.length).toBe(0);
  });

  it('opening bet below one big blind (all-in): min raise is that bet plus one big blind', () => {
    let s = makeHand({ stacks: [200, 200, 3], buttonPi: 0 }); // BB has 1 behind after posting
    s = act(s, 'c', 'c', 'x');
    s = act(s, 'x'); // SB checks
    expect(legalActions(s)!.minTo).toBe(1); // all-in for 1 is the only bet
    s = act(s, 'b1');
    expect(s.toAct).toBe(0);
    expect(legalActions(s)!.minTo).toBe(3);
  });
});

describe('detailed hand names', () => {
  const name = (c: string) => describeHandDetailed(evaluate(parseCards(c)));
  it('includes kickers', () => {
    expect(name('Ac Ad Kh 5s 2c')).toBe('Pair of Aces, King kicker');
    expect(name('Kc Kd 7h 7s Ac')).toBe('Two pair, Kings and Sevens, Ace kicker');
    expect(name('Ah Qh 9h 4h 2h')).toBe('Flush, Ace-Queen high');
    expect(name('Ac Kd 9h 5s 2c')).toBe('Ace-King high');
    expect(name('Tc Td Th 5s 2c')).toBe('Three of a kind, Tens, Five kicker');
  });
});
