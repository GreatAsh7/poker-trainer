import type { Action } from '../engine/game';
import type { PlayerView } from '../engine/view';
import type { OpponentModel } from './stats';

export type BotStyle = 'tag' | 'lag' | 'nit' | 'station' | 'expert' | 'placeholder';

export interface BotProfile {
  id: string;
  name: string;
  style: BotStyle;
}

export interface BotDecisionRequest {
  view: PlayerView;
  profile: BotProfile;
  /** seed for the bot's own randomness (mixed strategies) */
  seed: number;
  /** public stats of the other players, keyed by player id (for adaptation) */
  models?: Record<string, OpponentModel>;
}

export interface BotDecision {
  action: Action;
  /** short plain-language reason (debugging / HUD) */
  reason?: string;
  ms?: number;
}

export interface Bot {
  decide(req: BotDecisionRequest): BotDecision;
}
