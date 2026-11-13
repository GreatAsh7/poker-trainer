import type { LegalActions, Street } from '../engine/game';

export interface Preset {
  label: string;
  to: number;
  /** short explanation for the tooltip */
  hint: string;
}

export interface PresetContext {
  legal: LegalActions;
  street: Street;
  /** all chips in the middle including current-street bets */
  pot: number;
  currentBet: number;
  bigBlind: number;
  /** number of preflop raises so far (0 = unopened or limped) */
  preflopRaises: number;
  /** players who limped in before any raise */
  limpers: number;
}

export const clampTo = (legal: LegalActions, to: number) => Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(to)));

/** Raise-to amount for a pot-fraction bet/raise: call first, then add `frac` of the resulting pot. */
export function potFractionTo(c: PresetContext, frac: number): number {
  const toCall = c.legal.toCall;
  return c.currentBet + frac * (c.pot + toCall);
}

export function presetsFor(c: PresetContext): Preset[] {
  const { legal } = c;
  if (!legal.raiseType) return [];
  const out: Preset[] = [];
  const add = (label: string, to: number, hint: string) => out.push({ label, to: clampTo(legal, to), hint });
  const raising = legal.toCall > 0;
  if (c.street === 'preflop' && c.preflopRaises === 0 && c.limpers > 0) {
    const L = c.limpers;
    add(`${3 + L}x`, (3 + L) * c.bigBlind, `Isolation raise: 3 big blinds plus 1 per limper (${L})`);
    add(`${4 + L}x`, (4 + L) * c.bigBlind, 'Bigger isolation raise: 4 big blinds plus 1 per limper');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else if (c.street === 'preflop' && c.preflopRaises === 0) {
    add('2.5x', 2.5 * c.bigBlind, 'Raise to 2.5 big blinds');
    add('3x', 3 * c.bigBlind, 'Raise to 3 big blinds');
    add('4x', 4 * c.bigBlind, 'Raise to 4 big blinds');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else if (c.street === 'preflop' && c.preflopRaises === 1) {
    add('3x', 3 * c.currentBet, '3-bet to 3 times the open (standard in position)');
    add('4x', 4 * c.currentBet, '3-bet to 4 times the open (standard out of position)');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else if (c.street === 'preflop') {
    add('2.2x', 2.2 * c.currentBet, 'Re-raise to 2.2 times the current bet (standard 4-bet size)');
    add('2.5x', 2.5 * c.currentBet, 'Re-raise to 2.5 times the current bet');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else {
    const how = 'Raise: call, then add';
    add('⅓', potFractionTo(c, 1 / 3), raising ? `${how} one third of the pot` : 'Bet one third of the pot');
    add('½', potFractionTo(c, 1 / 2), raising ? `${how} half of the pot` : 'Bet half the pot');
    add('⅔', potFractionTo(c, 2 / 3), raising ? `${how} two thirds of the pot` : 'Bet two thirds of the pot');
    add('Pot', potFractionTo(c, 1), raising ? `${how} the whole pot (a pot-sized raise)` : 'Bet the size of the pot');
  }
  out.push({ label: 'All-in', to: legal.maxTo, hint: 'Bet everything you have' });
  return out;
}

/** A sensible starting amount for the raise slider. */
export function defaultRaiseTo(c: PresetContext): number {
  const { legal } = c;
  if (!legal.raiseType) return 0;
  if (c.street === 'preflop') {
    if (c.preflopRaises === 0) return clampTo(legal, (c.limpers > 0 ? 3 + c.limpers : 2.5) * c.bigBlind);
    return clampTo(legal, (c.preflopRaises === 1 ? 3 : 2.2) * c.currentBet);
  }
  return clampTo(legal, potFractionTo(c, legal.toCall > 0 ? 1 : 2 / 3));
}

/** Step for keyboard arrows: one big blind. */
export const stepFor = (bigBlind: number) => bigBlind;

export interface PotOdds {
  /** chips the call actually costs */
  call: number;
  /** pot you can win by calling (excludes any part of a bet that would be returned) */
  pot: number;
  /** equity needed to break even: call / (pot + call) */
  need: number;
}

/**
 * Pot odds for a call. Only chips you can actually win count: when the call puts you
 * all-in for less, each opponent's chips above your total go back to them or into a side
 * pot you are not in.
 * @param totals each player's chips committed this hand so far (folded players included)
 */
export function potOdds(legal: LegalActions, totals: readonly number[], heroPi: number): PotOdds | null {
  if (legal.toCall <= 0) return null;
  const call = legal.callAmount;
  const cap = totals[heroPi] + call;
  let pot = 0;
  for (const t of totals) pot += legal.callIsAllIn ? Math.min(t, cap) : t;
  return { call, pot, need: call / (pot + call) };
}
