import type { Action } from '../engine/game';
import type { PlayerView } from '../engine/view';

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
