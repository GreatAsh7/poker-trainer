import { describe, it, expect } from 'vitest';
import { makeHand, act, totalChips } from './helpers';
import {
  legalActions, applyAction, validateAction, computePots, netResults, allInAction, IllegalActionError,
  type HandState,
} from '../../src/engine/game';
import { mulberry32, shuffledDeck } from '../../src/engine/cards';
import { startHand } from '../../src/engine/game';

const stacks6 = [200, 200, 200, 200, 200, 200];

describe('blinds and action order', () => {
  it('6-max: SB and BB left of the button, UTG acts first', () => {
    const s = makeHand({ stacks: stacks6 });
    expect(s.sbPi).toBe(1);
    expect(s.bbPi).toBe(2);
    expect(s.players[1].streetBet).toBe(1);
    expect(s.players[2].streetBet).toBe(2);
    expect(s.toAct).toBe(3);
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
  });

  it('heads-up: button posts the small blind, acts first preflop and last postflop', () => {
    let s = makeHand({ stacks: [200, 200], buttonPi: 1 });
    expect(s.sbPi).toBe(1);
    expect(s.bbPi).toBe(0);
    expect(s.toAct).toBe(1);
    s = act(s, 'c', 'x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(0); // big blind acts first after the flop
    s = act(s, 'x');
    expect(s.toAct).toBe(1);
  });

  it('postflop action starts with the first live player left of the button', () => {
    let s = makeHand({ stacks: stacks6 });
    s = act(s, 'c', 'c', 'c', 'c', 'f', 'x'); // UTG, MP, CO, BTN call; SB folds; BB checks
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(2); // SB folded, so BB is first
  });

  it('big blind gets the option after limps', () => {
    let s = makeHand({ stacks: stacks6 });
    s = act(s, 'c', 'f', 'f', 'f', 'c');
    const la = legalActions(s)!;
    expect(s.toAct).toBe(2);
    expect(la.canCheck).toBe(true);
    expect(la.raiseType).toBe('raise');
    expect(la.minTo).toBe(4);
  });

  it('button rotation order: dealing starts left of the button', () => {
    const s = makeHand({ stacks: [200, 200, 200], holes: ['AcAd', 'KcKd', 'QcQd'], buttonPi: 2 });
    expect(s.players[0].hole.length).toBe(2);
    expect(s.sbPi).toBe(0);
    expect(s.bbPi).toBe(1);
    expect(s.toAct).toBe(2);
  });
});

describe('bet sizing rules', () => {
  it('min open raise is 2x the big blind; min re-raise adds the last raise size', () => {
    let s = makeHand({ stacks: stacks6 });
    expect(legalActions(s)!.minTo).toBe(4);
    s = act(s, 'r6'); // raise of 4
    expect(legalActions(s)!.minTo).toBe(10);
    s = act(s, 'r20'); // raise of 14
    expect(legalActions(s)!.minTo).toBe(34);
  });

  it('min bet postflop is one big blind', () => {
    let s = makeHand({ stacks: [200, 200, 200] });
    s = act(s, 'c', 'c', 'x');
    expect(s.street).toBe('flop');
    const la = legalActions(s)!;
    expect(la.raiseType).toBe('bet');
    expect(la.minTo).toBe(2);
    expect(la.maxTo).toBe(198);
  });

  it('rejects illegal actions', () => {
    const s = makeHand({ stacks: stacks6 });
    expect(validateAction(s, { type: 'raise', amount: 3 })).toMatch(/minimum/);
    expect(validateAction(s, { type: 'raise', amount: 201 })).toMatch(/maximum/);
    expect(validateAction(s, { type: 'raise', amount: 5.5 })).toMatch(/whole/);
    expect(validateAction(s, { type: 'check' })).toBeTruthy();
    expect(validateAction(s, { type: 'bet', amount: 10 })).toBeTruthy();
    expect(() => applyAction(s, { type: 'check' })).toThrow(IllegalActionError);
  });

  it('cannot fold when checking is free', () => {
    let s = makeHand({ stacks: stacks6 });
    s = act(s, 'c', 'f', 'f', 'f', 'c');
    expect(legalActions(s)!.canFold).toBe(false);
    expect(validateAction(s, { type: 'fold' })).toBeTruthy();
  });

  it('a raise smaller than the minimum is allowed only as an all-in', () => {
    let s = makeHand({ stacks: [200, 200, 200, 3] }); // p3 (UTG) has 3
    expect(s.toAct).toBe(3);
    const la = legalActions(s)!;
    expect(la.minTo).toBe(3);
    expect(la.maxTo).toBe(3);
    s = act(s, 'r3');
    expect(s.players[3].allIn).toBe(true);
  });

  it('all-in for less than the call is a call', () => {
    let s = makeHand({ stacks: [200, 200, 200, 100] });
    s = act(s, 'r50', 'r150'); // UTG(p3)=50? order: p3 is UTG
    // p3 raised to 50, p0 (button) raised to 150
    expect(s.toAct).toBe(1);
    s = act(s, 'f', 'f'); // SB, BB fold
    const la = legalActions(s)!; // p3 has 50 behind, faces 100 more
    expect(la.callAmount).toBe(50);
    expect(la.raiseType).toBe(null);
    s = act(s, 'c');
    expect(s.players[3].allIn).toBe(true);
    // uncalled 50 returned to p0, board runs out
    expect(s.finished).toBe(true);
    expect(s.events.some((e) => e.kind === 'refund' && e.pi === 0 && e.amount === 50)).toBe(true);
  });

  it('raising is not allowed when every opponent is all-in', () => {
    let s = makeHand({ stacks: [200, 200, 20] }); // p0 BTN, p1 SB, p2 BB(20)
    s = act(s, 'r200'); // BTN shoves
    s = act(s, 'f'); // SB folds
    const la = legalActions(s)!;
    expect(la.raiseType).toBe(null); // BB has 18 behind < call, can only call all-in or fold
    expect(la.callAmount).toBe(18);
  });
});

describe('short all-in does not reopen the betting', () => {
  // 3 players postflop: p1 (SB) bets, p2 (BB) shoves for less than a full raise, p0 calls
  const setup = (bbStack: number) => {
    let s = makeHand({ stacks: [500, 500, bbStack], buttonPi: 0 });
    s = act(s, 'c', 'c', 'x'); // BTN calls, SB calls, BB checks
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
    return s;
  };

  it('players who already acted may only call or fold', () => {
    let s = setup(17); // BB has 15 behind after the flop
    s = act(s, 'b10'); // SB bets 10
    s = act(s, 'r15'); // BB all-in 15: raise of 5 < 10, incomplete
    expect(s.actions[s.actions.length - 1].incomplete).toBe(true);
    // BTN has not acted yet on this street: may raise; min raise-to = 15 + 10 = 25
    let la = legalActions(s)!;
    expect(s.toAct).toBe(0);
    expect(la.raiseType).toBe('raise');
    expect(la.minTo).toBe(25);
    s = act(s, 'c');
    // SB already acted and faced only an incomplete raise: call or fold only
    la = legalActions(s)!;
    expect(s.toAct).toBe(1);
    expect(la.raiseType).toBe(null);
    expect(la.canCall).toBe(true);
    expect(la.callAmount).toBe(5);
  });

  it('a full raise after an incomplete one reopens it', () => {
    let s = setup(17);
    s = act(s, 'b10', 'r15'); // incomplete
    s = act(s, 'r40'); // BTN makes a full raise (25 more than 15 >= 10)
    const la = legalActions(s)!;
    expect(s.toAct).toBe(1);
    expect(la.raiseType).toBe('raise');
    expect(la.minTo).toBe(65);
  });

  it('several short all-ins that add up to a full raise reopen it', () => {
    let s = makeHand({ stacks: [500, 500, 500, 17, 24], buttonPi: 0 });
    // preflop: p3 UTG, p4, p0 BTN, p1 SB, p2 BB
    s = act(s, 'c', 'c', 'c', 'c', 'x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
    s = act(s, 'b10', 'c'); // SB bets 10, BB calls
    s = act(s, 'r15'); // p3 all-in to 15 (incomplete)
    s = act(s, 'r22'); // p4 all-in to 22: total 12 over the 10 bet >= 10 → reopens for those who faced only 10
    s = act(s, 'c'); // BTN (not yet acted) calls 22
    const la = legalActions(s)!;
    expect(s.toAct).toBe(1);
    expect(la.raiseType).toBe('raise');
  });
});

describe('pots', () => {
  it('uncontested pot goes to the last player; uncalled raise is returned', () => {
    let s = makeHand({ stacks: stacks6 });
    s = act(s, 'r6', 'f', 'f', 'f', 'f', 'f');
    expect(s.finished).toBe(true);
    expect(s.showdown).toBe(false);
    expect(netResults(s)).toEqual([0, -1, -2, 3, 0, 0]);
    expect(s.players[3].stack).toBe(203);
  });

  it('side pots with three all-ins of different sizes', () => {
    // p0 BTN 300 (worst hand), p1 SB 50 (best), p2 BB 100 (second), p3 UTG 200 (third)
    let s = makeHand({
      stacks: [300, 50, 100, 200],
      holes: ['7c2d', 'AcAd', 'KcKd', 'QcQd'],
      board: '3h 4s 9d Jc 8h',
    });
    s = act(s, 'r200', 'r300', 'c', 'c'); // UTG shoves 200, BTN shoves 300, SB/BB call all-in
    expect(s.finished).toBe(true);
    expect(s.runout).toBe(true);
    expect(s.pots.map((p) => p.amount)).toEqual([200, 150, 200]);
    expect(s.pots.map((p) => p.eligible)).toEqual([[0, 1, 2, 3], [0, 2, 3], [0, 3]]);
    // 100 uncalled from BTN returned
    expect(s.events.some((e) => e.kind === 'refund' && e.pi === 0 && e.amount === 100)).toBe(true);
    expect(s.players.map((p) => p.stack)).toEqual([100, 200, 150, 200]);
    expect(totalChips(s)).toBe(650);
    expect(s.shown.length).toBe(4); // all-in: everyone shows
  });

  it('folded players chips are dead money in the pot', () => {
    const pots = computePots([
      { totalBet: 10, folded: true },
      { totalBet: 40, folded: false },
      { totalBet: 100, folded: false },
    ].map((x) => ({ ...x, id: '', name: '', seat: 0, stack: 0, startStack: 0, hole: [], streetBet: 0, allIn: false, hasActed: false, actedAtBet: 0 })));
    expect(pots).toEqual([
      { amount: 90, eligible: [1, 2] },
      { amount: 60, eligible: [2] },
    ]);
  });

  it('split pot: board plays, odd chip goes to the first winner left of the button', () => {
    // 3 players; SB folds after posting 1 → pot odd
    let s = makeHand({
      stacks: [100, 100, 100],
      holes: ['2c3d', '4h5c', '2d3c'],
      board: 'Ah Kh Qh Jh Th',
      buttonPi: 0,
    });
    s = act(s, 'c', 'f', 'x'); // BTN calls 2, SB folds (1 dead), BB checks
    s = act(s, 'x', 'x', 'x', 'x', 'x', 'x'); // check down
    expect(s.finished).toBe(true);
        // pot 5: BB (left of button among winners: p2 comes before p0) gets 3
    const award = s.awards[0];
    expect(award.amount).toBe(5);
    expect(award.winners).toEqual([2, 0]);
    expect(award.shares).toEqual([3, 2]);
  });

  it('kicker decides; ties split exactly', () => {
    let s = makeHand({ stacks: [100, 100], holes: ['AcKd', 'AdQc'], board: 'As 7h 4d 9c 2s', buttonPi: 0 });
    s = act(s, 'c', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.awards[0].winners).toEqual([0]);
    expect(s.players[0].stack).toBe(102);
  });
});

describe('showdown order and mucking', () => {
  it('last river aggressor shows first; a beaten caller mucks', () => {
    let s = makeHand({ stacks: [100, 100, 100], holes: ['AcAd', '7c2d', 'KcKd'], board: '3h 4s 9d Jc 8h' });
    s = act(s, 'c', 'f', 'x'); // flop: BB acts first
    s = act(s, 'x', 'x', 'x', 'x', 'b10', 'c'); // BB bets the river, BTN calls
    expect(s.finished).toBe(true);
    const shows = s.events.filter((e) => e.kind === 'show' || e.kind === 'muck');
    expect(shows[0]).toMatchObject({ kind: 'show', pi: 2 }); // BB (aggressor) first
    expect(shows[1]).toMatchObject({ kind: 'show', pi: 0 }); // BTN wins → shows
    expect(s.awards[0].winners).toEqual([0]);
  });

  it('checked-down river: first player left of the button shows first, losers muck', () => {
    let s = makeHand({ stacks: [100, 100, 100], holes: ['7c2d', 'AcAd', 'KcKd'], board: '3h 4s 9d Jc 8h' });
    s = act(s, 'c', 'c', 'x');
    s = act(s, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    const shows = s.events.filter((e) => e.kind === 'show' || e.kind === 'muck');
    expect(shows.map((e) => [e.kind, (e as { pi: number }).pi])).toEqual([
      ['show', 1],
      ['muck', 2],
      ['muck', 0],
    ]);
  });
});

describe('short blinds and edge cases', () => {
  it('big blind all-in for less still makes others call the full big blind', () => {
    let s = makeHand({ stacks: [100, 100, 1] });
    expect(s.players[2].allIn).toBe(true);
    expect(s.currentBet).toBe(2);
    expect(legalActions(s)!.callAmount).toBe(2);
    s = act(s, 'c', 'c'); // BTN calls 2, SB completes to 2
    // BB is all-in, two players can still act, so the flop is dealt
    expect(s.street).toBe('flop');
  });

  it('everyone all-in from the blinds runs the board out immediately', () => {
    const s = makeHand({ stacks: [1, 2] }); // HU: p0 BTN/SB posts 1 all-in, BB posts 2 all-in
    expect(s.finished).toBe(true);
    expect(s.board.length).toBe(5);
    expect(totalChips(s)).toBe(3);
  });

  it('allInAction picks raise, call or check as appropriate', () => {
    const s = makeHand({ stacks: stacks6 });
    expect(allInAction(s)).toEqual({ type: 'raise', amount: 200 });
  });
});

describe('random play invariants', () => {
  function randomHand(seed: number): HandState {
    const rng = mulberry32(seed);
    const np = 2 + Math.floor(rng() * 5);
    const stacks = Array.from({ length: np }, () => 1 + Math.floor(rng() * 300));
    let s = startHand({
      handId: seed,
      config: { smallBlind: 1, bigBlind: 2 },
      players: stacks.map((st, i) => ({ id: `${i}`, name: `${i}`, seat: i, stack: st })),
      buttonPi: Math.floor(rng() * np),
      deck: shuffledDeck(rng),
    });
    const total = stacks.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (!s.finished) {
      const la = legalActions(s)!;
      const r = rng();
      if (la.raiseType && r < 0.3) {
        const amt = la.minTo + Math.floor(rng() * (la.maxTo - la.minTo + 1));
        s = applyAction(s, { type: la.raiseType, amount: amt });
      } else if (la.canFold && r < 0.45) s = applyAction(s, { type: 'fold' });
      else if (la.canCall) s = applyAction(s, { type: 'call' });
      else s = applyAction(s, { type: 'check' });
      expect(s.players.every((p) => p.stack >= 0)).toBe(true);
      expect(++guard).toBeLessThan(500);
    }
    expect(s.players.reduce((a, p) => a + p.stack, 0)).toBe(total);
    const net = netResults(s);
    expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    if (s.showdown) expect(s.board.length).toBe(5);
    return s;
  }

  it('chips are conserved and every hand terminates (20,000 random hands)', () => {
    let showdowns = 0;
    let sidePots = 0;
    for (let seed = 1; seed <= 20000; seed++) {
      const s = randomHand(seed);
      if (s.showdown) showdowns++;
      if (s.pots.length > 1) sidePots++;
    }
    expect(showdowns).toBeGreaterThan(1000);
    expect(sidePots).toBeGreaterThan(100);
  });
});
