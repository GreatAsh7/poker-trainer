/**
 * Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = [
  'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace',
];
export const RANK_PLURALS = [
  'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces',
];

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function cardToString(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`bad card "${s}"`);
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`bad card "${s}"`);
  return makeCard(r, su);
}

/** "As Kd 7h" or "AsKd7h" -> cards */
export function parseCards(s: string): Card[] {
  const clean = s.replace(/[\s,]+/g, '');
  if (clean.length % 2) throw new Error(`bad cards "${s}"`);
  const out: Card[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.slice(i, i + 2)));
  return out;
}

export const cardsToString = (cs: readonly Card[]): string => cs.map(cardToString).join(' ');

export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (let c = 0; c < 52; c++) d.push(c);
  return d;
}

/** Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(fullDeck(), rng);
}
