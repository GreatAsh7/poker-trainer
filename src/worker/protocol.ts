import type { BotDecision, BotDecisionRequest } from '../bots/types';
import type { HandState } from '../engine/game';
import type { DecisionNote, MatchReport } from '../analysis/coach';

export type WorkerRequest =
  | { id: number; kind: 'decide'; req: BotDecisionRequest }
  | { id: number; kind: 'report'; hands: HandState[]; heroId: string; settings: MatchReport['settings'] }
  | { id: number; kind: 'review'; hand: HandState; heroId: string; earlier: HandState[] };

export type WorkerResponse =
  | { id: number; ok: true; decision?: BotDecision; report?: MatchReport; notes?: DecisionNote[] }
  | { id: number; ok: false; error: string };
