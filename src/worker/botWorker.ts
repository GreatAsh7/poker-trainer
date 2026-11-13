/// <reference lib="webworker" />
// All heavy work runs here: bot decisions, the match report and per-hand reviews.
import { decideForProfile } from '../bots';
import { buildReport, reviewHand } from '../analysis/coach';
import type { WorkerRequest, WorkerResponse } from './protocol';

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  let res: WorkerResponse;
  try {
    if (msg.kind === 'decide') {
      const t0 = performance.now();
      const decision = decideForProfile(msg.req);
      decision.ms = performance.now() - t0;
      res = { id: msg.id, ok: true, decision };
    } else if (msg.kind === 'report') {
      res = { id: msg.id, ok: true, report: buildReport({ hands: msg.hands, heroId: msg.heroId, settings: msg.settings }) };
    } else {
      res = { id: msg.id, ok: true, notes: reviewHand(msg.hand, msg.heroId, msg.earlier) };
    }
  } catch (e) {
    res = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  (self as unknown as Worker).postMessage(res);
};
