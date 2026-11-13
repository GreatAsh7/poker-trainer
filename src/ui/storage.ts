/** Saved match reports (localStorage). All access is guarded: storage may be unavailable. */
import type { MatchReport } from '../analysis/coach';

const KEY = 'poker-trainer.reports.v1';
const MAX = 25;

export function loadReports(): MatchReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MatchReport[];
    return Array.isArray(arr) ? arr.filter((r) => r && r.version === 1) : [];
  } catch {
    return [];
  }
}

export function saveReport(r: MatchReport): MatchReport[] {
  const all = [...loadReports().filter((x) => x.id !== r.id), r].slice(-MAX);
  // keep the full per-decision detail only for the newest few reports to stay small
  const trimmed = all.map((x, i) => (i < all.length - 5 ? { ...x, decisions: {} } : x));
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed.map((x) => ({ ...x, decisions: {} }))));
    } catch {
      /* storage full or blocked: the report still shows, it just isn't saved */
    }
  }
  return trimmed;
}

export function clearReports() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
