/** Promise wrapper around the Web Worker. Bot thinking and analysis never run on the UI thread. */
import type { BotDecision, BotDecisionRequest } from '../bots/types';
import type { HandState } from '../engine/game';
import type { DecisionNote, MatchReport } from '../analysis/coach';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

type Ok = Extract<WorkerResponse, { ok: true }>;
type Body = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export class BotClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (d: Ok) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../worker/botWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res);
      else p.reject(new Error(res.error));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'worker error'));
      this.pending.clear();
    };
  }

  private send(body: Body): Promise<Ok> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id } as WorkerRequest);
    });
  }

  decide(req: BotDecisionRequest): Promise<BotDecision> {
    return this.send({ kind: 'decide', req }).then((r) => r.decision!);
  }

  report(hands: HandState[], heroId: string, settings: MatchReport['settings']): Promise<MatchReport> {
    return this.send({ kind: 'report', hands, heroId, settings }).then((r) => r.report!);
  }

  review(hand: HandState, heroId: string, earlier: HandState[]): Promise<DecisionNote[]> {
    return this.send({ kind: 'review', hand, heroId, earlier }).then((r) => r.notes!);
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
