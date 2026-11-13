/** Promise wrapper around the bot Web Worker. All bot thinking happens off the UI thread. */
import type { BotDecision, BotDecisionRequest } from '../bots/types';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

export class BotClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (d: BotDecision) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../worker/botWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.decision);
      else p.reject(new Error(res.error));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'worker error'));
      this.pending.clear();
    };
  }

  decide(req: BotDecisionRequest): Promise<BotDecision> {
    const id = this.nextId++;
    const msg: WorkerRequest = { id, kind: 'decide', req };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
