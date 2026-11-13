import type { BotDecision, BotDecisionRequest } from '../bots/types';

export type WorkerRequest = { id: number; kind: 'decide'; req: BotDecisionRequest };
export type WorkerResponse =
  | { id: number; ok: true; decision: BotDecision }
  | { id: number; ok: false; error: string };
