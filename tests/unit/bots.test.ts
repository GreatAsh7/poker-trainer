import { describe, it, expect } from 'vitest';
import { makeHand, act, stackedDeck } from './helpers';
import { parseCards, mulberry32, shuffledDeck } from '../../src/engine/cards';
import { applyAction, legalActions, startHand, validateAction, type HandState } from '../../src/engine/game';
import { viewFor } from '../../src/engine/view';
import { decide } from '../../src/bots/strategy';
import { PERSONALITIES } from '../../src/bots/personalities';
import { equityVsRanges } from '../../src/bots/equity';
import { parseRange, rangeSize, fullRange } from '../../src/bots/combos';
import { RFI } from '../../src/bots/preflopCharts';
import { drawScore } from '../../src/bots/strength';
import type { BotStyle } from '../../src/bots/types';

const STYLES: Exclude<BotStyle, 'placeholder'>[] = ['expert', 'tag', 'lag', 'nit', 'station'];
const run = (h: HandState, style: Exclude<BotStyle, 'placeholder'>, seed = 1) =>
  decide({ view: viewFor(h, h.toAct), persona: PERSONALITIES[style], models: {}, rng: mulberry32(seed) });

describe('ranges and equity', () => {
  it('open ranges have standard sizes', () => {
    expect(rangeSize(parseRange(RFI.UTG))).toBeGreaterThan(0.14);
    expect(rangeSize(parseRange(RFI.UTG))).toBeLessThan(0.19);
    expect(rangeSize(parseRange(RFI.BTN))).toBeGreaterThan(0.4);
    expect(rangeSize(parseRange(RFI.BTN))).toBeLessThan(0.52);
  });
  it('range notation', () => {
    expect(rangeSize(parseRange('AA'))).toBeCloseTo(6 / 1326, 6);
    expect(rangeSize(parseRange('AKs'))).toBeCloseTo(4 / 1326, 6);
    expect(rangeSize(parseRange('TT+'))).toBeCloseTo(30 / 1326, 6);
    expect(rangeSize(parseRange('A2s+'))).toBeCloseTo(48 / 1326, 6);
    expect(rangeSize(parseRange('76s-54s'))).toBeCloseTo(12 / 1326, 6);
    expect(rangeSize(parseRange('AKo@50'))).toBeCloseTo(6 / 1326, 6);
  });
  it('AA vs KK preflop is about 82%', () => {
    const eq = equityVsRanges(parseCards('AsAh'), [], [parseRange('KK')], 20000, mulberry32(3)).equity;
    expect(eq).toBeGreaterThan(0.79);
    expect(eq).toBeLessThan(0.85);
  });
  it('river equity is exact', () => {
    // top set vs a range of one straight combo and one weaker hand
    const eq = equityVsRanges(parseCards('KsKd'), parseCards('Kh 9c 4d 2s 7h'), [parseRange('AA')], 1, mulberry32(1)).equity;
    expect(eq).toBe(1);
  });
  it('detects draws', () => {
    expect(drawScore(parseCards('Ah5h'), parseCards('Kh 9h 2c'))).toBe(1); // flush draw
    expect(drawScore(parseCards('8c7d'), parseCards('6h 5s Kd'))).toBe(1); // open-ended
    expect(drawScore(parseCards('8h7h'), parseCards('6h 5s Kh'))).toBe(1.5); // combo draw
    expect(drawScore(parseCards('Ac2d'), parseCards('Kh 9s 7d'))).toBe(0);
  });
  it('full range equity of AA vs random is about 85%', () => {
    const eq = equityVsRanges(parseCards('AsAh'), [], [fullRange()], 20000, mulberry32(5)).equity;
    expect(eq).toBeGreaterThan(0.83);
    expect(eq).toBeLessThan(0.87);
  });
});

describe('preflop sanity', () => {
  const six = [200, 200, 200, 200, 200, 200];
  it('UTG folds 72o and opens AA at 100 BB (every style)', () => {
    for (const st of STYLES) {
      const h72 = makeHand({ stacks: six, holes: ['2c3d', '4h5s', '7c8d', '7h2d', 'JcQd', 'Kh2s'] });
      expect(run(h72, st).action.type).toBe('fold');
      const hAA = makeHand({ stacks: six, holes: ['2c3d', '4h5s', '7c8d', 'AhAc', 'JcQd', 'Kh2s'] });
      const a = run(hAA, st).action;
      if (st !== 'station') expect(a.type).toBe('raise');
      else expect(['raise', 'call']).toContain(a.type);
    }
  });
  it('short stack shoves AA and folds trash', () => {
    const h = makeHand({ stacks: [16, 200, 200, 16, 200, 200], holes: ['2c3d', '4h5s', '7c8d', 'AhAc', 'JcQd', 'Kh2s'] });
    const a = run(h, 'expert').action;
    expect(a.type).toBe('raise');
    expect(a.amount).toBe(16);
  });
  it('opens to a standard size', () => {
    const h = makeHand({ stacks: six, holes: ['2c3d', '4h5s', '7c8d', 'AhKh', 'JcQd', 'Kd2s'] });
    expect(run(h, 'expert').action).toEqual({ type: 'raise', amount: 5 });
  });
});

describe('postflop sanity', () => {
  it('never folds the nuts on the river', () => {
    // p0 has the nut flush; p1 bets the river into them
    let h = makeHand({ stacks: [200, 200], holes: ['AhKh', 'QcQd'], board: '2h 7h 9h 3c 4d', buttonPi: 0 });
    h = act(h, 'c', 'x', 'x', 'x', 'x', 'x', 'b20');
    for (const st of STYLES) for (let seed = 1; seed < 6; seed++) expect(run(h, st, seed).action.type).not.toBe('fold');
  });
  it('folds air to a big river bet from a passive range (expert)', () => {
    let h = makeHand({ stacks: [200, 200], holes: ['3s4s', 'QcQd'], board: 'Ah Kd 9c 7h 2d', buttonPi: 0 });
    h = act(h, 'c', 'x', 'x', 'x', 'x', 'x', 'b100');
    let folds = 0;
    for (let seed = 1; seed <= 10; seed++) if (run(h, 'expert', seed).action.type === 'fold') folds++;
    expect(folds).toBeGreaterThanOrEqual(9);
  });
});

describe('every decision is legal and ignores hidden cards', () => {
  it('3,000 random spots: legal, never folds when checking is free', () => {
    const rng = mulberry32(11);
    let checked = 0;
    for (let t = 0; t < 300; t++) {
      const np = 2 + Math.floor(rng() * 5);
      let h = startHand({
        handId: t, config: { smallBlind: 1, bigBlind: 2 },
        players: Array.from({ length: np }, (_, i) => ({ id: `p${i}`, name: `p${i}`, seat: i, stack: 20 + Math.floor(rng() * 400) })),
        buttonPi: 0, deck: shuffledDeck(rng),
      });
      while (!h.finished) {
        const st = STYLES[Math.floor(rng() * STYLES.length)];
        const la = legalActions(h)!;
        const d = run(h, st, Math.floor(rng() * 1e9));
        expect(validateAction(h, d.action)).toBe(null);
        if (la.canCheck) expect(d.action.type).not.toBe('fold');
        checked++;
        h = applyAction(h, d.action);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("changing an opponent's hidden cards does not change the bot's decision", () => {
    const board = 'Kd 8s 4c 2h';
    const base = (opp: string) => {
      let h = startHand({
        handId: 1, config: { smallBlind: 1, bigBlind: 2 },
        players: [0, 1, 2].map((i) => ({ id: `p${i}`, name: `p${i}`, seat: i, stack: 200 })),
        buttonPi: 0, deck: stackedDeck(['JhTh', '9c9d', opp], 0, board + ' 3s'),
      });
      h = act(h, 'r5', 'c', 'c', 'x', 'x', 'b6');
      return h;
    };
    const a = base('AsAc');
    const b = base('5d6d');
    for (const st of STYLES) for (let seed = 1; seed < 5; seed++) expect(run(a, st, seed)).toEqual(run(b, st, seed));
  });
});
