import type { BotDecision, BotDecisionRequest } from './types';
import { placeholderBot } from './placeholder';

export function decideForProfile(req: BotDecisionRequest): BotDecision {
  return placeholderBot.decide(req);
}
