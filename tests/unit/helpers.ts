import { type Card, parseCards, fullDeck } from '../../src/engine/cards';
import { type HandState, type TableConfig, startHand, applyAction, type Action } from '../../src/engine/game';

export const CFG: TableConfig = { smallBlind: 1, bigBlind: 2 };

/**
 * Build a deck so that player i (index into players, clockwise) receives holes[i] and the
 * board comes out as `board`. Dealing starts left of the button, one card at a time.
 */
export function stackedDeck(holes: string[], buttonPi: number, board = ''): Card[] {
  const np = holes.length;
  const hc = holes.map((h) => parseCards(h));
  const order: Card[] = [];
  for (let round = 0; round < 2; round++)
    for (let k = 1; k <= np; k++) order.push(hc[(buttonPi + k) % np][round]);
  order.push(...parseCards(board));
  const used = new Set(order);
  if (used.size !== order.length) throw new Error('duplicate card in stacked deck');
  return [...order, ...fullDeck().filter((c) => !used.has(c))];
}

export function makeHand(opts: {
  stacks: number[];
  holes?: string[];
  board?: string;
  buttonPi?: number;
  config?: TableConfig;
}): HandState {
  const np = opts.stacks.length;
  const buttonPi = opts.buttonPi ?? 0;
  const holes =
    opts.holes ??
    Array.from({ length: np }, (_, i) => ['2c3d', '4h5s', '7c8d', '9hTs', 'JcQd', 'Kh2s'][i]);
  return startHand({
    handId: 1,
    config: opts.config ?? CFG,
    players: opts.stacks.map((stack, i) => ({ id: `p${i}`, name: `P${i}`, seat: i, stack })),
    buttonPi,
    deck: stackedDeck(holes, buttonPi, opts.board ?? ''),
  });
}

export function act(s: HandState, ...actions: (Action | string)[]): HandState {
  for (const a of actions) {
    s = applyAction(s, typeof a === 'string' ? parseAct(a) : a);
  }
  return s;
}

/** "f" fold, "x" check, "c" call, "b10" bet to 10, "r30" raise to 30 */
function parseAct(t: string): Action {
  switch (t[0]) {
    case 'f': return { type: 'fold' };
    case 'x': return { type: 'check' };
    case 'c': return { type: 'call' };
    case 'b': return { type: 'bet', amount: Number(t.slice(1)) };
    case 'r': return { type: 'raise', amount: Number(t.slice(1)) };
  }
  throw new Error(t);
}

export const totalChips = (s: HandState) => s.players.reduce((a, p) => a + p.stack + (s.finished ? 0 : p.totalBet), 0);
