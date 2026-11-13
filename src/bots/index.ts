import type { BotDecision, BotDecisionRequest } from './types';
import { placeholderBot } from './placeholder';
import { PERSONALITIES } from './personalities';
import { decide } from './strategy';
import { mulberry32 } from '../engine/cards';

export function decideForProfile(req: BotDecisionRequest): BotDecision {
  if (req.profile.style === 'placeholder') return placeholderBot.decide(req);
  const persona = PERSONALITIES[req.profile.style];
  return decide({ view: req.view, persona, models: req.models ?? {}, rng: mulberry32(req.seed) });
}
