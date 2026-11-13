/**
 * Rebuild the hero's view at every decision of a finished hand, using only public
 * information (the hero's own cards, the board, and cards that were tabled).
 * Opponents' unknown cards are replaced by filler cards that the view never exposes.
 */
import type { Card } from '../engine/cards';
import { applyAction, startHand, type Action, type HandState } from '../engine/game';
import { viewFor, type PlayerView } from '../engine/view';

export interface DecisionPoint {
  /** state just before the decision */
  state: HandState;
  view: PlayerView;
  action: Action;
  /** index of the action within the hand */
  actionIndex: number;
}

export function replayHand(h: HandState): { states: HandState[]; ok: boolean } {
  const np = h.players.length;
  const used = new Set<Card>();
  const holes: (Card[] | null)[] = h.players.map((p) => (p.hole.length === 2 ? p.hole : null));
  for (const hc of holes) if (hc) hc.forEach((c) => used.add(c));
  h.board.forEach((c) => used.add(c));
  const filler: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) filler.push(c);
  const finalHoles = holes.map((hc) => hc ?? [filler.pop()!, filler.pop()!]);
  // deal order: starting left of the button, one card each, twice
  const deck: Card[] = [];
  for (let round = 0; round < 2; round++)
    for (let k = 1; k <= np; k++) deck.push(finalHoles[(h.buttonPi + k) % np][round]);
  deck.push(...h.board);
  const rest = filler.filter((c) => !deck.includes(c));
  while (deck.length < 52) deck.push(rest.pop()!);
  let s = startHand({
    handId: h.handId,
    config: h.config,
    players: h.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, stack: p.startStack })),
    buttonPi: h.buttonPi,
    deck,
  });
  const states: HandState[] = [s];
  for (const a of h.actions) {
    const act: Action = a.type === 'bet' || a.type === 'raise' ? { type: a.type, amount: a.to } : { type: a.type };
    try {
      s = applyAction(s, act);
    } catch {
      return { states, ok: false };
    }
    states.push(s);
  }
  return { states, ok: true };
}

/** Every decision taken by player `pi` in a finished hand. */
export function decisionsOf(h: HandState, pi: number): DecisionPoint[] {
  const { states } = replayHand(h);
  const out: DecisionPoint[] = [];
  h.actions.forEach((a, i) => {
    if (a.pi !== pi || !states[i]) return;
    const state = states[i];
    out.push({
      state,
      view: viewFor(state, pi),
      action: a.type === 'bet' || a.type === 'raise' ? { type: a.type, amount: a.to } : { type: a.type },
      actionIndex: i,
    });
  });
  return out;
}
