/**
 * Table controller: runs a match, paces events for animation, asks the bot worker for
 * decisions and waits for the user's actions. Framework-free; React subscribes to it.
 */
import { mulberry32, type Rng, cardsToString } from '../engine/cards';
import { type Action, type HandState, type LegalActions, applyAction, legalActions, validateAction } from '../engine/game';
import {
  type MatchState, createMatch, dealNextHand, recordHand, settleBetweenHands, matchOverReason,
} from '../engine/match';
import { viewFor, publicHand } from '../engine/view';
import type { BotDecision, BotProfile } from '../bots/types';
import { addHand, toModel, type OpponentModel, type PlayerStats } from '../bots/stats';
import { deriveDisplay, describeEvent, type TableDisplay } from './display';

export interface MatchSetup {
  numBots: number;
  startingBB: number;
  hands: number;
  rebuy: boolean;
  seed: number;
  difficulty: 'mixed' | 'expert' | 'easy';
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
  /** hero's result once the hand is over */
  net?: number;
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
  (profile: BotProfile, h: HandState, pi: number, seed: number, models: Record<string, OpponentModel>): Promise<BotDecision>;
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
  /** the real hand state (contains hidden cards; never put in the snapshot) */
  private full: HandState | null = null;
  private fullHands: HandState[] = [];
  /** public stats of every player this match (what the bots know about each other and you) */
  private stats: Record<string, PlayerStats> = {};
  private models: Record<string, OpponentModel> = {};
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
    this.fullHands = [];
    this.full = null;
    this.stats = {};
    this.models = {};
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
    this.setPaused(false);
    this.skipResolver?.();
    this.skipResolver = null;
    this.userResolver = null;
    this.nextHandResolver = null;
  }

  /** User action. Ignored unless it is the user's turn and the action is legal. */
  act(a: Action): string | null {
    const h = this.full;
    if (!h || !this.userResolver || !this.snap.legal) return 'not your turn';
    const guarded: Action = { ...a, pi: this.snap.userPi, seq: h.actions.length };
    const err = validateAction(h, guarded);
    if (err) return err;
    const r = this.userResolver;
    this.userResolver = null;
    this.set({ legal: null });
    r(guarded);
    return null;
  }

  private paused = false;
  private unpauseResolvers: (() => void)[] = [];

  /** Pause pacing (e.g. while a replay or dialog is open). The current wait finishes first. */
  setPaused(p: boolean) {
    this.paused = p;
    if (!p) {
      const rs = this.unpauseResolvers;
      this.unpauseResolvers = [];
      rs.forEach((r) => r());
    }
  }

  private waitUnpaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((r) => this.unpauseResolvers.push(r));
  }

  /** Skip the current wait (bot thinking or animation pause). */
  skip() {
    this.skipResolver?.();
    this.nextHandResolver?.();
  }

  continueToNextHand() {
    this.nextHandResolver?.();
  }

  /** Full (unsanitized) finished hands, for analysis in the worker. Never rendered. */
  get fullHistory(): readonly HandState[] {
    return this.fullHands;
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
      case 'reveal':
        return 500 * p;
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
        const prior: number[] = [];
        for (let j = 0; j < i; j++) {
          const ej = h.events[j];
          if (ej.kind === 'street') prior.push(...ej.cards);
        }
        const label = `${e.street[0].toUpperCase()}${e.street.slice(1)}`;
        log.lines.push({
          kind: 'street',
          text: prior.length ? `${label}: ${cardsToString(prior)} [${cardsToString(e.cards)}]` : `${label}: ${cardsToString(e.cards)}`,
        });
        continue;
      }
      const text = describeEvent(h, i, userPi);
      if (text) log.lines.push({ kind: e.kind === 'award' || e.kind === 'show' || e.kind === 'muck' ? 'result' : 'action', text });
    }
    return logs.slice(-60);
  }

  private publish(h: HandState, patch: Partial<Snapshot> = {}) {
    const pub = publicHand(h, this.snap.userPi, this.shown);
    this.set({ hand: pub, display: deriveDisplay(pub, this.shown, this.snap.userPi), ...patch });
  }

  /** Reveal events one at a time with animation pacing. */
  private async showEvents(h: HandState, gen: number) {
    while (this.shown < h.events.length) {
      await this.waitUnpaused();
      if (gen !== this.gen) return;
      const i = this.shown++;
      const pub = publicHand(h, this.snap.userPi, this.shown);
      this.publish(h, { logs: this.pushLog(pub, i, i + 1) });
      await this.sleep(this.eventDelay(h, i), gen);
    }
  }

  private async run(gen: number) {
    let m = this.snap.match!;
    const setup = this.setup!;
    try {
      while (gen === this.gen) {
        m = settleBetweenHands(m);
        if (matchOverReason(m, setup.hands, 0)) {
          this.set({ phase: 'matchOver', legal: null, thinkingPi: -1, match: m });
          return;
        }
        const dealt = dealNextHand(m, this.rng);
        m = dealt.match;
        let h = dealt.hand;
        this.full = h;
        const userPi = h.players.findIndex((p) => p.id === USER_ID);
        this.shown = 0;
        this.set({ phase: 'playing', userPi, handNumber: m.handsPlayed + 1, match: m });
        this.publish(h);
        while (gen === this.gen) {
          await this.showEvents(h, gen);
          if (gen !== this.gen) return;
          if (h.finished) break;
          const pi = h.toAct;
          let action: Action;
          if (pi === userPi) {
            action = await new Promise<Action>((resolve) => {
              this.userResolver = resolve;
              this.publish(h, { legal: legalActions(h), thinkingPi: -1 });
            });
          } else {
            await this.waitUnpaused();
            if (gen !== this.gen) return;
            const profile = this.snap.bots.find((b) => b.id === h.players[pi].id)!;
            const duration =
              this.settings.thinkMin + this.rng() * Math.max(0, this.settings.thinkMax - this.settings.thinkMin);
            this.set({ thinkingPi: pi, thinkStart: performance.now(), thinkDuration: duration, legal: null });
            const seed = Math.floor(this.rng() * 2 ** 31);
            const [decision] = await Promise.all([this.decide(profile, h, pi, seed, this.models), this.sleep(duration, gen)]);
            action = decision.action;
            if (validateAction(h, action)) {
              // never let a bad bot decision stall the table
              const la = legalActions(h)!;
              action = la.canCheck ? { type: 'check' } : { type: 'fold' };
            }
          }
          if (gen !== this.gen) return;
          h = applyAction(h, action);
          this.full = h;
          this.set({ thinkingPi: -1 });
        }
        if (gen !== this.gen) return;
        m = recordHand(m, h).match;
        this.fullHands.push(h);
        const pub = publicHand(h, -1);
        addHand(this.stats, pub);
        this.models = Object.fromEntries(Object.entries(this.stats).map(([id, s]) => [id, toModel(s)]));
        const heroNet = h.won[userPi] - h.players[userPi].totalBet;
        const logs = this.snap.logs.map((l) =>
          l.handId === h.handId
            ? { ...l, net: heroNet }
            : l,
        );
        this.set({
          logs,
          history: [...this.snap.history, publicHand(h, userPi)].slice(-200),
          phase: 'handOver',
          match: m,
        });
        if (this.settings.autoNextHand) {
          // give the player time to read a showdown (Space / "Next hand" skips)
          await this.sleep(h.showdown ? Math.max(2600, 4200 * this.settings.pace) : 1700 * this.settings.pace, gen);
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
  return (profile, h, pi, seed, models) => client.decide({ view: viewFor(h, pi), profile, seed, models });
}
