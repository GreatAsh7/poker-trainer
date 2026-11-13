/**
 * Table controller: runs a match, paces events for animation, asks the bot worker for
 * decisions and waits for the user's actions. Framework-free; React subscribes to it.
 */
import { mulberry32, type Rng, cardsToString } from '../engine/cards';
import { type Action, type HandState, type LegalActions, applyAction, legalActions, validateAction } from '../engine/game';
import {
  type MatchState, createMatch, dealNextHand, recordHand, settleBetweenHands, rebuy,
} from '../engine/match';
import { viewFor } from '../engine/view';
import type { BotDecision, BotProfile } from '../bots/types';
import { deriveDisplay, describeEvent, type TableDisplay } from './display';

export interface MatchSetup {
  numBots: number;
  startingBB: number;
  hands: number;
  rebuy: boolean;
  seed: number;
  bots: BotProfile[];
}

export interface Settings {
  /** bot thinking delay range, ms */
  thinkMin: number;
  thinkMax: number;
  /** animation pacing multiplier (1 = normal, 0.5 = twice as fast) */
  pace: number;
  autoNextHand: boolean;
}

export const DEFAULT_SETTINGS: Settings = { thinkMin: 600, thinkMax: 1800, pace: 1, autoNextHand: true };

export interface LogLine {
  text: string;
  kind: 'street' | 'action' | 'result' | 'header';
}

export interface HandLog {
  handId: number;
  lines: LogLine[];
}

export type Phase = 'idle' | 'playing' | 'handOver' | 'matchOver';

export interface Snapshot {
  phase: Phase;
  display: TableDisplay | null;
  hand: HandState | null;
  userPi: number;
  /** legal actions when it is the user's turn and the table has caught up */
  legal: LegalActions | null;
  /** player index currently "thinking" (bot) */
  thinkingPi: number;
  /** when the current thinking started and how long it will take (for the timer ring) */
  thinkStart: number;
  thinkDuration: number;
  handNumber: number;
  handsTotal: number;
  match: MatchState | null;
  logs: HandLog[];
  /** finished hands this match (most recent last) */
  history: HandState[];
  bots: BotProfile[];
  error: string | null;
}

export interface DecideFn {
  (profile: BotProfile, h: HandState, pi: number, seed: number): Promise<BotDecision>;
}

const USER_ID = 'you';

export class TableController {
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private gen = 0;
  private rng: Rng = mulberry32(1);
  private skipResolver: (() => void) | null = null;
  private userResolver: ((a: Action) => void) | null = null;
  private nextHandResolver: (() => void) | null = null;
  private shown = 0;
  private setup: MatchSetup | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };

  constructor(private decide: DecideFn) {
    this.snap = {
      phase: 'idle',
      display: null,
      hand: null,
      userPi: -1,
      legal: null,
      thinkingPi: -1,
      thinkStart: 0,
      thinkDuration: 0,
      handNumber: 0,
      handsTotal: 0,
      match: null,
      logs: [],
      history: [],
      bots: [],
      error: null,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------------ public API

  startMatch(setup: MatchSetup) {
    this.stop();
    this.setup = setup;
    const gen = ++this.gen;
    this.rng = mulberry32(setup.seed);
    const bb = 2;
    const players = [
      { id: USER_ID, name: 'You', autoRebuy: setup.rebuy },
      ...setup.bots.slice(0, setup.numBots).map((b) => ({ id: b.id, name: b.name, autoRebuy: true })),
    ];
    const firstButton = Math.floor(this.rng() * players.length);
    const match = createMatch({ smallBlind: 1, bigBlind: bb }, setup.startingBB * bb, players, firstButton);
    this.set({
      phase: 'playing',
      match,
      handsTotal: setup.hands,
      handNumber: 0,
      logs: [],
      history: [],
      bots: setup.bots.slice(0, setup.numBots),
      display: null,
      hand: null,
      error: null,
    });
    void this.run(gen);
  }

  stop() {
    this.gen++;
    this.skipResolver?.();
    this.skipResolver = null;
    this.userResolver = null;
    this.nextHandResolver = null;
  }

  /** User action. Ignored unless it is the user's turn and the action is legal. */
  act(a: Action): string | null {
    const h = this.snap.hand;
    if (!h || !this.userResolver || !this.snap.legal) return 'not your turn';
    const err = validateAction(h, a);
    if (err) return err;
    const r = this.userResolver;
    this.userResolver = null;
    this.set({ legal: null });
    r(a);
    return null;
  }

  /** Skip the current wait (bot thinking or animation pause). */
  skip() {
    this.skipResolver?.();
  }

  continueToNextHand() {
    this.nextHandResolver?.();
  }

  rebuyUser() {
    const m = this.snap.match;
    if (!m) return;
    rebuy(m, 0);
    this.set({ match: { ...m } });
  }

  // ------------------------------------------------------------------ loop

  private sleep(ms: number, gen: number): Promise<void> {
    if (gen !== this.gen) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, Math.max(0, ms));
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.skipResolver = done;
    });
  }

  private eventDelay(h: HandState, i: number): number {
    const e = h.events[i];
    const p = this.settings.pace;
    switch (e.kind) {
      case 'post':
        return 180 * p;
      case 'deal':
        return 750 * p;
      case 'action':
        return (e.record.pi === this.snap.userPi ? 260 : 420) * p;
      case 'street':
        return (e.street === 'flop' ? 1000 : 700) * p;
      case 'refund':
        return 380 * p;
      case 'show':
        return 650 * p;
      case 'muck':
        return 250 * p;
      case 'award':
        return 1200 * p;
      case 'end':
        return 0;
    }
  }

  private pushLog(h: HandState, from: number, to: number) {
    const userPi = this.snap.userPi;
    const logs = [...this.snap.logs];
    let log = logs[logs.length - 1];
    if (!log || log.handId !== h.handId) {
      const you = h.players[userPi];
      const pos = you ? positionName(h, userPi) : '';
      log = {
        handId: h.handId,
        lines: [{ kind: 'header', text: `Hand ${h.handId} · You (${pos}) ${cardsToString(you.hole)}` }],
      };
      logs.push(log);
    } else {
      log = { ...log, lines: [...log.lines] };
      logs[logs.length - 1] = log;
    }
    for (let i = from; i < to; i++) {
      const e = h.events[i];
      if (e.kind === 'street') {
        log.lines.push({ kind: 'street', text: `${e.street[0].toUpperCase()}${e.street.slice(1)}: ${cardsToString(e.cards)}` });
        continue;
      }
      const text = describeEvent(h, i, userPi);
      if (text) log.lines.push({ kind: e.kind === 'award' || e.kind === 'show' || e.kind === 'muck' ? 'result' : 'action', text });
    }
    return logs.slice(-60);
  }

  /** Reveal events one at a time with animation pacing. */
  private async showEvents(h: HandState, gen: number) {
    while (this.shown < h.events.length) {
      if (gen !== this.gen) return;
      const i = this.shown++;
      const logs = this.pushLog(h, i, i + 1);
      this.set({ hand: h, display: deriveDisplay(h, this.shown, this.snap.userPi), logs });
      await this.sleep(this.eventDelay(h, i), gen);
    }
  }

  private async run(gen: number) {
    const m = this.snap.match!;
    const setup = this.setup!;
    try {
      while (gen === this.gen) {
        settleBetweenHands(m);
        const user = m.seats[0];
        const live = m.seats.filter((s) => !s.busted && s.stack > 0);
        if (m.handsPlayed >= setup.hands || user.busted || live.length < 2) {
          this.set({ phase: 'matchOver', legal: null, thinkingPi: -1, match: { ...m } });
          return;
        }
        let h = dealNextHand(m, this.rng);
        const userPi = h.players.findIndex((p) => p.id === USER_ID);
        this.shown = 0;
        this.set({ phase: 'playing', hand: h, userPi, handNumber: m.handsPlayed + 1, match: { ...m } });
        while (gen === this.gen) {
          await this.showEvents(h, gen);
          if (gen !== this.gen) return;
          if (h.finished) break;
          const pi = h.toAct;
          let action: Action;
          if (pi === userPi) {
            action = await new Promise<Action>((resolve) => {
              this.userResolver = resolve;
              this.set({ legal: legalActions(h), thinkingPi: -1, display: deriveDisplay(h, this.shown, userPi) });
            });
          } else {
            const profile = this.snap.bots.find((b) => b.id === h.players[pi].id)!;
            const duration =
              this.settings.thinkMin + this.rng() * Math.max(0, this.settings.thinkMax - this.settings.thinkMin);
            const t0 = performance.now();
            this.set({ thinkingPi: pi, thinkStart: t0, thinkDuration: duration, legal: null });
            const seed = Math.floor(this.rng() * 2 ** 31);
            const [decision] = await Promise.all([this.decide(profile, h, pi, seed), this.sleep(duration, gen)]);
            action = decision.action;
            if (validateAction(h, action)) {
              // never let a bad bot decision stall the table
              const la = legalActions(h)!;
              action = la.canCheck ? { type: 'check' } : { type: 'fold' };
            }
          }
          if (gen !== this.gen) return;
          this.set({ thinkingPi: -1 });
          h = applyAction(h, action);
        }
        if (gen !== this.gen) return;
        recordHand(m, h);
        this.set({ history: [...this.snap.history, h].slice(-200), phase: 'handOver', match: { ...m } });
        if (this.settings.autoNextHand) {
          await this.sleep(1600 * this.settings.pace, gen);
        } else {
          await new Promise<void>((resolve) => {
            this.nextHandResolver = resolve;
          });
          this.nextHandResolver = null;
        }
      }
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Position name for a player index, e.g. "BTN", "SB", "UTG". */
export function positionName(h: HandState, pi: number): string {
  const np = h.players.length;
  const off = (pi - h.buttonPi + np) % np; // 0 = button
  if (np === 2) return off === 0 ? 'BTN/SB' : 'BB';
  if (off === 0) return 'BTN';
  if (off === 1) return 'SB';
  if (off === 2) return 'BB';
  const names6 = ['UTG', 'HJ', 'CO']; // for 6 players: off 3=UTG, 4=HJ, 5=CO
  const fromEnd = np - off; // 1 = CO, 2 = HJ, 3 = UTG ...
  if (fromEnd === 1) return 'CO';
  if (fromEnd === 2) return np >= 5 ? 'HJ' : 'UTG';
  if (fromEnd === 3) return 'UTG';
  return names6[0];
}

export function createDecideFn(client: { decide: (req: import('../bots/types').BotDecisionRequest) => Promise<BotDecision> }): DecideFn {
  return (profile, h, pi, seed) => client.decide({ view: viewFor(h, pi), profile, seed });
}
