/** Table position names for a hand. */
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

/** Position of player index `pi` in a hand with `np` players and the button at `buttonPi`. */
export function positionOf(np: number, buttonPi: number, pi: number): Position {
  const off = (pi - buttonPi + np) % np; // 0 = button
  if (np === 2) return off === 0 ? 'SB' : 'BB'; // heads-up: the button is the small blind
  if (off === 0) return 'BTN';
  if (off === 1) return 'SB';
  if (off === 2) return 'BB';
  const fromEnd = np - off; // 1 = CO, 2 = HJ, 3 = UTG
  if (fromEnd === 1) return 'CO';
  if (fromEnd === 2) return 'HJ';
  return 'UTG';
}

/** Short label for the UI (heads-up button shows as "BTN/SB"). */
export function positionLabel(np: number, buttonPi: number, pi: number): string {
  const p = positionOf(np, buttonPi, pi);
  return np === 2 && p === 'SB' ? 'BTN/SB' : p;
}

/** Does `me` act after `other` on postflop streets? */
export function hasPositionOn(np: number, buttonPi: number, me: number, other: number): boolean {
  const off = (x: number) => (x - buttonPi - 1 + np) % np; // 0 = first to act postflop
  return off(me) > off(other);
}
