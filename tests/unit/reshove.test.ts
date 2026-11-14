import { describe, it, expect } from 'vitest';
import { act, stackedDeck } from './helpers';
import { startHand } from '../../src/engine/game';
import { viewFor } from '../../src/engine/view';
import { decide } from '../../src/bots/strategy';
import { PERSONALITIES } from '../../src/bots/personalities';
import { CLASS_NAMES, CLASS_COMBOS, COMBO_CARDS } from '../../src/bots/combos';
import { mulberry32, cardToString } from '../../src/engine/cards';

/** Share of all 169 classes (combo-weighted) the Expert re-shoves from the BB over a 2.5 BB open. */
function reshoveShare(players: number, stackBB: number): number {
  let shoves = 0;
  let total = 0;
  for (let ci = 0; ci < CLASS_NAMES.length; ci++) {
    const [a, b] = COMBO_CARDS[CLASS_COMBOS[ci][0]];
    const hero = cardToString(a) + cardToString(b);
    // fillers for the other seats that avoid the hero's cards
    const pool = ['2c3d', '4h5s', '7c8d', '9h2s', 'JcQd', 'Kh6s', '3h4c', '5c6d', '8h9c', 'Ts3s', 'QhKc', 'Ad7d'].filter(
      (x) => !x.match(/../g)!.some((c) => c === hero.slice(0, 2) || c === hero.slice(2)),
    );
    const n = players;
    const bbPi = n === 2 ? 1 : 2;
    const holes = Array.from({ length: n }, (_, i) => (i === bbPi ? hero : pool[i]));
    let h = startHand({
      handId: ci,
      config: { smallBlind: 1, bigBlind: 2 },
      players: holes.map((_, i) => ({ id: `p${i}`, name: `p${i}`, seat: i, stack: stackBB * 2 })),
      buttonPi: 0,
      deck: stackedDeck(holes, 0, ''),
    });
    // heads-up: the button (SB) opens; 6-max: folds to the cutoff, who opens, then button and SB fold
    h = n === 2 ? act(h, 'r5') : act(h, 'f', 'f', 'r5', 'f', 'f');
    const d = decide({ view: viewFor(h, h.toAct), persona: PERSONALITIES.expert, models: {}, rng: mulberry32(ci) });
    const w = CLASS_COMBOS[ci].length;
    total += w;
    if (d.action.type === 'raise' && d.action.amount === stackBB * 2) shoves += w;
  }
  return shoves / total;
}

describe('re-shove ranges stay sane at 25–40 BB', () => {
  it.each([
    [6, 30, 0.2],
    [6, 35, 0.2],
    [6, 40, 0.2],
    [2, 30, 0.3],
    [2, 40, 0.3],
  ])('%i-handed, %i BB: re-shoves at most %f of hands', (players, bb, max) => {
    expect(reshoveShare(players, bb)).toBeLessThanOrEqual(max);
  });
});
