import { describe, it, expect } from 'vitest';
import { evaluate, categoryOf, Category, describeHand, bestFive } from '../../src/engine/evaluator';
import { parseCards, mulberry32, shuffledDeck, cardsToString } from '../../src/engine/cards';

const ev = (s: string) => evaluate(parseCards(s));
const cat = (s: string) => categoryOf(ev(s));

describe('hand categories', () => {
  it.each([
    ['As Ks Qs Js Ts', Category.StraightFlush],
    ['5d 4d 3d 2d Ad', Category.StraightFlush],
    ['9c 9d 9h 9s 2c', Category.Quads],
    ['Kc Kd Kh 7s 7c', Category.FullHouse],
    ['Ah 9h 7h 4h 2h', Category.Flush],
    ['Ah Kd Qc Js Th', Category.Straight],
    ['5h 4d 3c 2s Ah', Category.Straight],
    ['7c 7d 7h Ks 2c', Category.Trips],
    ['7c 7d 5h 5s 2c', Category.TwoPair],
    ['7c 7d Ah Ks 2c', Category.Pair],
    ['Ac Jd 9h 5s 2c', Category.HighCard],
  ])('%s', (cards, c) => expect(cat(cards)).toBe(c));

  it('names hands in plain language', () => {
    expect(describeHand(ev('As Ks Qs Js Ts'))).toBe('Royal flush');
    expect(describeHand(ev('Kc Kd Kh 7s 7c'))).toBe('Full house, Kings full of Sevens');
    expect(describeHand(ev('5h 4d 3c 2s Ah'))).toBe('Straight, Five high');
    expect(describeHand(ev('7c 7d 5h 5s 2c'))).toBe('Two pair, Sevens and Fives');
  });
});

describe('ordering and kickers', () => {
  const beats = (a: string, b: string) => expect(ev(a)).toBeGreaterThan(ev(b));
  const ties = (a: string, b: string) => expect(ev(a)).toBe(ev(b));
  it('category order', () => {
    const hands = [
      'Ac Jd 9h 5s 2c', '2c 2d 3h 4s 6c', '2c 2d 3h 3s 4c', '2c 2d 2h 3s 4c', 'Ac 2d 3h 4s 5c',
      '2h 3h 4h 5h 7h', '2c 2d 2h 3s 3c', '2c 2d 2h 2s 3c', 'Ac 2c 3c 4c 5c',
    ];
    for (let i = 1; i < hands.length; i++) beats(hands[i], hands[i - 1]);
  });
  it('pair kickers', () => {
    beats('Ac Ad Kh 5s 2c', 'As Ah Qh Js Tc');
    beats('Ac Ad Kh 5s 3c', 'As Ah Kd 5c 2d');
    ties('Ac Ad Kh 5s 3c', 'As Ah Kd 5c 3d');
  });
  it('two pair kicker and high pair first', () => {
    beats('Kc Kd 2h 2s Ac', 'Qc Qd Jh Js Ac');
    beats('Kc Kd 5h 5s Ac', 'Kh Ks 5c 5d Qc');
  });
  it('high card uses all five', () => {
    beats('Ac Jd 9h 5s 3c', 'As Jh 9c 5d 2d');
  });
  it('wheel is the lowest straight', () => {
    beats('6c 5d 4h 3s 2c', '5h 4d 3c 2s Ah');
    beats('6c 5c 4c 3c 2c', '5h 4h 3h 2h Ah');
  });
  it('flush compares all five cards', () => {
    beats('Ah Kh 9h 4h 3h', 'As Ks 9s 4s 2s');
  });
  it('full house compares trips first', () => {
    beats('3c 3d 3h 2s 2c', '2c 2d 2h As Ac');
  });
  it('quads kicker', () => {
    beats('9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc');
  });
});

describe('7-card hands', () => {
  it('picks flush over straight', () => expect(cat('9h 8h 7c 6h 5d 2h Ah')).toBe(Category.Flush));
  it('two trips make a full house with the higher trips', () => {
    expect(describeHand(ev('Kc Kd Kh 7s 7c 7d 2h'))).toBe('Full house, Kings full of Sevens');
  });
  it('three pairs use the best two plus best kicker', () => {
    expect(ev('Ac Ad Kc Kd Qc Qd 2h')).toBe(ev('Ac Ad Kc Kd Qc'));
  });
  it('straight flush found among 7', () => expect(cat('2s 3s 4s 5s 6s Ks Kd')).toBe(Category.StraightFlush));
  it('6-card straight uses the top', () => expect(describeHand(ev('2c 3d 4h 5s 6c 7d Kh'))).toBe('Straight, Seven high'));
  it('board plays: both players tie', () => {
    expect(ev('2c 3d Ah Kh Qh Jh Th')).toBe(ev('4c 5d Ah Kh Qh Jh Th'));
  });
  it('bestFive returns the cards that make the hand', () => {
    const five = bestFive(parseCards('Kc Kd Kh 7s 7c 2d 3h'));
    expect(cardsToString(five).split(' ').sort()).toEqual(['7c', '7s', 'Kc', 'Kd', 'Kh'].sort());
  });

  it('7-card value equals the best of its 21 five-card subsets (5,000 random hands)', () => {
    const rng = mulberry32(42);
    for (let t = 0; t < 5000; t++) {
      const cs = shuffledDeck(rng).slice(0, 7);
      let best = 0;
      for (let a = 0; a < 7; a++)
        for (let b = a + 1; b < 7; b++) {
          const sub = cs.filter((_, i) => i !== a && i !== b);
          best = Math.max(best, evaluate(sub));
        }
      expect(evaluate(cs)).toBe(best);
    }
  });
});

describe('exhaustive 5-card enumeration', () => {
  it('matches the known category counts over all 2,598,960 hands', () => {
    const counts = new Array(9).fill(0);
    const h = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              h[0] = a; h[1] = b; h[2] = c; h[3] = d; h[4] = e;
              counts[evaluate(h) >> 20]++;
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  }, 60_000);
});
