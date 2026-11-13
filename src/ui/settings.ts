/** User preferences (per browser). Every access is guarded: storage may be unavailable. */
export interface Prefs {
  /** bot thinking time range, seconds */
  thinkMin: number;
  thinkMax: number;
  /** animation pacing: 1 = normal, 0.6 = fast, 0.35 = very fast */
  pace: number;
  /** wait for "Next hand" (Space) after every hand instead of continuing automatically */
  pauseAfterHand: boolean;
  /** optional decision timer for you, seconds (0 = off) */
  turnTimer: number;
  sound: boolean;
  volume: number;
  showHud: boolean;
  showPotOdds: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  thinkMin: 0.6,
  thinkMax: 1.8,
  pace: 1,
  pauseAfterHand: false,
  turnTimer: 0,
  sound: false,
  volume: 0.5,
  showHud: true,
  showPotOdds: true,
};

const KEY = 'poker-trainer.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
