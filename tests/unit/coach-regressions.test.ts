import { describe, it, expect } from 'vitest';
import { act, stackedDeck } from './helpers';
import { startHand, type HandState } from '../../src/engine/game';
import { publicHand } from '../../src/engine/view';
import { buildReport } from '../../src/analysis/coach';
import { decisionsOf } from '../../src/analysis/replay';
import { analyzeDecision } from '../../src/analysis/decision';
import type { OpponentModel } from '../../src/bots/stats';

/** hand with the hero at seat 0 (the button); returns the public hand from the hero's view */
function handN(id: number, holes: string[], board: string, actions: string[], stacks: number[]): HandState {
  let h = startHand({
    handId: id,
    config: { smallBlind: 1, bigBlind: 2 },
    players: stacks.map((s, i) => ({ id: i === 0 ? 'you' : `b${i}`, name: i === 0 ? 'You' : `B${i}`, seat: i, stack: s })),
    buttonPi: 0,
    deck: stackedDeck(holes, 0, board),
  });
  h = act(h, ...actions);
  return publicHand(h, 0);
}

function lastDecision(h: HandState, models: Record<string, OpponentModel> = {}) {
  const ds = decisionsOf(h, 0);
  const d = ds[ds.length - 1];
  return analyzeDecision(d.view, d.action, d.actionIndex, models);
}

const STATION: OpponentModel = { hands: 60, vpip: 0.6, pfr: 0.06, threeBet: 0.01, foldTo3Bet: 0.2, foldToCbet: 0.1, aggFreq: 0.05, wtsd: 0.6, bluffRate: 0.1, foldToBet: 0.1 };
const NIT: OpponentModel = { hands: 60, vpip: 0.13, pfr: 0.08, threeBet: 0.02, foldTo3Bet: 0.8, foldToCbet: 0.55, aggFreq: 0.3, wtsd: 0.45, bluffRate: 0.05, foldToBet: 0.55 };
const six = [200, 200, 200, 200, 200, 200];
const settings = { players: 6, startingBB: 100, hands: 1, difficulty: 'mixed' };

describe('coach regressions', () => {
  it('all-in for less: only chips you can win count in the price', () => {
    // 3-handed: hero (BTN, 20 chips) opens to 5, SB folds, BB shoves 200, hero calls 15 more
    const h = handN(10, ['6c4d', '2c3d', 'AsKs'], '', ['r5', 'f', 'r200', 'c'], [20, 200, 200]);
    const a = lastDecision(h);
    expect(a.pot).toBe(5 + 1 + 20); // hero's 5, the SB's dead 1, the BB capped at hero's 20
    expect(a.need).toBeCloseTo(15 / (26 + 15), 5);
  });

  it('when every opponent is all-in there is no realisation discount', () => {
    let hh = startHand({
      handId: 11,
      config: { smallBlind: 1, bigBlind: 2 },
      players: [
        { id: 'b1', name: 'B1', seat: 0, stack: 40 },
        { id: 'you', name: 'You', seat: 1, stack: 400 },
      ],
      buttonPi: 0,
      deck: stackedDeck(['Kc7d', 'Ah2c'], 0, '3s 8d 9h Tc Qs'),
    });
    hh = act(hh, 'r40', 'c');
    const pub = publicHand(hh, 1);
    const d = decisionsOf(pub, 1)[0];
    const a = analyzeDecision(d.view, d.action, d.actionIndex, {});
    const call = a.options.find((o) => o.kind === 'call')!;
    expect(call.ev).toBeCloseTo(a.equity * (a.pot + 38) - 38, 5);
  });

  it('folding aces first in is flagged as a missed open', () => {
    const h = handN(13, ['AsAh', '4h5s', '7c8d', '9h2s', 'JcQd', 'Kh6s'], '', ['f', 'f', 'f', 'f'], six);
    const r = buildReport({ hands: [h], heroId: 'you', settings });
    const note = r.decisions[13][0];
    expect(note.kind).toBe('missed-open');
    expect(note.text).toMatch(/\d+%/);
  });

  it('opening 72o under the gun is flagged as a loose open', () => {
    // 6-max, hero is UTG: put the hero at seat 3 by making seat 0 the button and acting first
    let h = startHand({
      handId: 16,
      config: { smallBlind: 1, bigBlind: 2 },
      players: six.map((s, i) => ({ id: i === 3 ? 'you' : `b${i}`, name: i === 3 ? 'You' : `B${i}`, seat: i, stack: s })),
      buttonPi: 0,
      deck: stackedDeck(['2c3d', '4h5s', '8c8d', '7h2s', 'JcQd', 'Kh6s'], 0, ''),
    });
    h = act(h, 'r5', 'f', 'f', 'f', 'f', 'f');
    const r = buildReport({ hands: [publicHand(h, 3)], heroId: 'you', settings });
    expect(r.decisions[16][0].kind).toBe('loose-open');
  });

  it('a nit river check-raise is respected: folding one pair is not a big mistake', () => {
    // hero BTN Kd Jc vs the BB; board K 7 2 3 9; BB checks, hero bets 30, BB raises to 100, hero folds
    const h = handN(14, ['KdJc', '4h5s', '7c8d'], 'Ks 7s 2c 3d 9s', ['r5', 'f', 'c', 'x', 'x', 'x', 'x', 'x', 'b30', 'r100', 'f'], [200, 200, 200]);
    const a = lastDecision(h, { b2: NIT });
    expect(a.equity).toBeLessThan(0.4);
    expect(a.evLoss / 2).toBeLessThan(3);
  });

  it('a pure bluff into a calling station is not rated as good', () => {
    // heads-up river: hero has nothing and bets into a station
    const h = handN(15, ['5c4c', 'QsJd'], 'Ah Kd 9h 2c 7s', ['r6', 'c', 'x', 'x', 'x', 'x', 'x', 'b8'], [200, 200]);
    const a = lastDecision(h, { b1: STATION });
    const bet = a.options.find((o) => o.kind === 'bet' && o.to === 8)!;
    expect(bet.foldPct!).toBeLessThan(0.45);
    expect(bet.ev).toBeLessThan(a.options.find((o) => o.kind === 'check')!.ev);
  });

  it('a population river check-raise is mostly two pair or better: folding top pair is fine, calling is not', () => {
    // 6-max, hero BTN KJ vs the BB: BB check-calls flop and turn, then check-raises the river
    const h = handN(17, ['KdJc', '8c4s', '7c7d', '6c5s', 'Js4d', 'Qd6d'], 'Ks 7s 2c 3d 9h',
      ['f', 'f', 'f', 'r5', 'f', 'c', 'x', 'b6', 'c', 'x', 'b12', 'c', 'x', 'b30', 'r100', 'c'], six);
    const a = lastDecision(h);
    expect(a.villainMix!.strong).toBeGreaterThan(0.75);
    expect(a.best.kind).toBe('fold');
  });

  it('checking back the nuts on the river (closing the action) is a missed value bet', () => {
    const h = handN(18, ['AsKs', '7c7d', '9h2d'], 'Qs 8s 3s 5d 2c', ['r5', 'f', 'c', 'x', 'x', 'x', 'x', 'x', 'x'], [200, 200, 200]);
    const r = buildReport({ hands: [h], heroId: 'you', settings: { ...settings, players: 3 } });
    expect(r.decisions[18].at(-1)!.kind).toBe('missed-value');
  });

  it('heads-up, the button opens wide: 65o is not flagged as too weak', () => {
    const h = handN(30, ['6c5d', 'Kh9s'], '', ['r5', 'f'], [200, 200]);
    const a = lastDecision(h);
    expect(a.openChart!.rangePct).toBeGreaterThan(0.75);
    expect(a.evLoss / a.bigBlind).toBeLessThan(0.3); // at worst a marginal open
    const r = buildReport({ hands: [h], heroId: 'you', settings: { ...settings, players: 2 } });
    expect(r.decisions[30]?.[0]?.kind ?? null).toBeNull();
  });

  it('opening 72o on the button is flagged as a loose open', () => {
    const h = handN(31, ['7c2d', '4h5s', '8c9d', '9h3s', 'JcQd', 'Kh6s'], '', ['f', 'f', 'f', 'r5', 'f', 'f'], six);
    const r = buildReport({ hands: [h], heroId: 'you', settings });
    expect(r.decisions[31][0].kind).toBe('loose-open');
  });

  it('call explanations never claim the caller is out of position', () => {
    const h = handN(32, ['8c5d', '4h4s', '7c8d', '9h2s', 'JcQd', 'AhJh'], '2d 7d Kc 4c 9c', ['f', 'f', 'r5', 'c', 'f', 'f', 'x', 'x', 'x', 'x', 'x', 'x'], six);
    const r = buildReport({ hands: [h], heroId: 'you', settings });
    for (const n of r.decisions[32] ?? []) expect(n.text).not.toMatch(/out of position/i);
  });

  it('a pot-sized value bet with the nuts is not judged against an overbet shove', () => {
    const h = handN(33, ['AhKh', 'QcJd'], '2h 7h 9h Tc 3s', ['r5', 'c', 'x', 'x', 'x', 'x', 'x', 'b10'], [200, 200]);
    const a = lastDecision(h);
    expect(a.best.overbet ?? false).toBe(false);
    const r = buildReport({ hands: [h], heroId: 'you', settings: { ...settings, players: 2 } });
    expect(r.decisions[33].at(-1)?.kind ?? null).not.toBe('sizing');
  });
});
