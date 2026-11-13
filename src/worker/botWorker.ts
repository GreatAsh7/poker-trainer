/// <reference lib="webworker" />
import { decideForProfile } from '../bots';
import type { WorkerRequest, WorkerResponse } from './protocol';

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  let res: WorkerResponse;
  try {
    const t0 = performance.now();
    const decision = decideForProfile(msg.req);
    decision.ms = performance.now() - t0;
    res = { id: msg.id, ok: true, decision };
  } catch (e) {
    res = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  (self as unknown as Worker).postMessage(res);
};
