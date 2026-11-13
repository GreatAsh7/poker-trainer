import { describe, it, expect } from 'vitest';
import { act, stackedDeck } from './helpers';
import { startHand, type HandState } from '../../src/engine/game';
import { publicHand } from '../../src/engine/view';
import { buildReport } from '../../src/analysis/coach';
import { decisionsOf } from '../../src/analysis/replay';
import { analyzeDecision } from '../../src/analysis/decision';

/** heads-up hand, hero = p0 on the button; returns the public hand from the hero's view */
function hand(id: number, holes: [string, string], board: string, actions: string[], stacks = [200, 200]): HandState {
  let h = startHand({
    handId: id,
    config: { smallBlind: 1, bigBlind: 2 },
    players: [
      { id: 'you', name: 'You', seat: 0, stack: stacks[0] },
      { id: 'bot', name: 'Bot', seat: 1, stack: stacks[1] },
    ],
    buttonPi: 0,
    deck: stackedDeck(holes, 0, board),
  });
  h = act(h, ...actions);
  return publicHand(h, 0);
}

describe('decision analysis', () => {
  it('replay reproduces the hero view at each decision', () => {
    const h = hand(1, ['AhKh', 'QcQd'], '2h 7h 9c 3c 4d', ['r6', 'c', 'x', 'b4', 'c', 'x', 'x', 'x', 'x']);
    const ds = decisionsOf(h, 0);
    expect(ds.map((d) => d.action.type)).toEqual(['raise', 'bet', 'check', 'check']);
    expect(ds[1].view.board.length).toBe(3);
    expect(ds[1].view.hole).toEqual(h.players[0].hole);
  });

  it('flags a river call with no showdown value as calling without odds', () => {
    // hero bricked a draw; villain bets pot on the river after betting every street
    const h = hand(2, ['5h4h', 'AsKs'], 'Ah Kd 9h 2c Qs', ['r6', 'c', 'x', 'b8', 'c', 'b20', 'c', 'b52', 'c']);
    const ds = decisionsOf(h, 0);
    const river = ds[ds.length - 1];
    expect(river.view.street).toBe('river');
    const a = analyzeDecision(river.view, river.action, river.actionIndex, {});
    expect(a.equity).toBeLessThan(0.15);
    expect(a.need).toBeCloseTo(52 / (68 + 52 + 52), 5); // pot 68 before the river bet
    expect(a.best.kind).toBe('fold');
    expect(a.evLoss).toBeGreaterThan(20);
  });

  it('a fold of the nuts facing a small bet is a costly fold', () => {
    const h = hand(3, ['AhKh', 'QcQd'], '2h 7h 9h 3c 4d', ['r6', 'c', 'x', 'x', 'x', 'x', 'b10', 'f']);
    const ds = decisionsOf(h, 0);
    const last = ds[ds.length - 1];
    const a = analyzeDecision(last.view, last.action, last.actionIndex, {});
    expect(a.equity).toBeGreaterThan(0.99);
    expect(a.evLoss).toBeGreaterThan(10);
  });
});

describe('match report', () => {
  const hands = [
    hand(1, ['5h4h', 'AsKs'], 'Ah Kd 9h 2c Qs', ['r6', 'c', 'x', 'b8', 'c', 'b20', 'c', 'b52', 'c']),
    hand(2, ['AhKh', 'QcQd'], '2h 7h 9h 3c 4d', ['r6', 'c', 'x', 'x', 'x', 'x', 'b10', 'f']),
    // all-in preflop: AA vs KK, KK hits a set (hero loses but was an ~82% favourite)
    hand(3, ['AsAh', 'KcKd'], 'Ks 7d 2c 9h 3s', ['r200', 'c']),
    hand(4, ['7c2d', 'AsKs'], 'Qh Jd 4c 9s 3h', ['f']),
  ];
  const r = buildReport({ hands, heroId: 'you', settings: { players: 2, startingBB: 100, hands: 4, difficulty: 'mixed' } });

  it('reports results and all-in luck correctly', () => {
    expect(r.hands).toBe(4);
    const nets = [-86, -6, -200, -1];
    expect(r.net).toBe(nets.reduce((a, b) => a + b, 0));
    expect(r.allIn.count).toBe(1);
    // AA vs KK preflop: about 82% equity of a 400 pot for a 200 risk → EV ≈ +127
    expect(r.allIn.evNet).toBeGreaterThan(110);
    expect(r.allIn.evNet).toBeLessThan(140);
    expect(r.allIn.actualNet).toBe(-200);
    expect(r.allIn.luck).toBeLessThan(-300);
  });

  it('finds the mistakes and turns them into key hands with numbers', () => {
    const kinds = Object.values(r.decisions).flat().map((d) => d.kind);
    expect(kinds).toContain('call-no-odds');
    expect(kinds).toContain('fold-with-odds');
    expect(r.keyHands.length).toBeGreaterThanOrEqual(2);
    for (const k of r.keyHands) {
      for (const w of k.why) expect(w).toMatch(/\d+%/); // backed by computed numbers
      expect(k.evLossBB).toBeGreaterThan(0);
    }
    expect(r.focus.length).toBeGreaterThan(0);
    expect(r.grade).toBe('–'); // too few hands to grade
  });

  it('does not judge by results: the all-in with aces is not a mistake', () => {
    const notes = r.decisions[3];
    expect(notes.every((n) => n.kind === null || n.kind.startsWith('good'))).toBe(true);
  });
});
