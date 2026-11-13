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
  /** a raise has already been made preflop (beyond the big blind) */
  preflopRaised: boolean;
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
  if (c.street === 'preflop' && !c.preflopRaised) {
    add('2.5x', 2.5 * c.bigBlind, 'Raise to 2.5 big blinds');
    add('3x', 3 * c.bigBlind, 'Raise to 3 big blinds');
    add('4x', 4 * c.bigBlind, 'Raise to 4 big blinds');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else if (c.street === 'preflop') {
    add('3x', 3 * c.currentBet, 'Re-raise to 3 times the current bet');
    add('4x', 4 * c.currentBet, 'Re-raise to 4 times the current bet');
    add('Pot', potFractionTo(c, 1), 'Pot-sized raise');
  } else {
    add('⅓', potFractionTo(c, 1 / 3), 'One third of the pot');
    add('½', potFractionTo(c, 1 / 2), 'Half the pot');
    add('⅔', potFractionTo(c, 2 / 3), 'Two thirds of the pot');
    add('Pot', potFractionTo(c, 1), 'The size of the pot');
  }
  out.push({ label: 'All-in', to: legal.maxTo, hint: 'Bet everything you have' });
  return out;
}

/** A sensible starting amount for the raise slider. */
export function defaultRaiseTo(c: PresetContext): number {
  const { legal } = c;
  if (!legal.raiseType) return 0;
  if (c.street === 'preflop') return clampTo(legal, c.preflopRaised ? 3 * c.currentBet : 2.5 * c.bigBlind);
  return clampTo(legal, potFractionTo(c, legal.toCall > 0 ? 1 : 2 / 3));
}

/** Step for keyboard arrows: one big blind. */
export const stepFor = (bigBlind: number) => bigBlind;
