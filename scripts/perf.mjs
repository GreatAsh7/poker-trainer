// Dev helper: play ~20 hands and measure smoothness: frame times, long tasks, heap growth.
// usage: node scripts/perf.mjs [url]
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5199/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem('poker-trainer.prefs.v1', JSON.stringify({ pace: 1, thinkMin: 0.6, thinkMax: 1.2 }));
  // frame-time and long-task collectors
  window.__frames = [];
  window.__long = [];
  let last = performance.now();
  const loop = (t) => {
    window.__frames.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: true });
});
await page.goto(url);
await page.getByTestId('start-match').click();
const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 90_000) {
  i++;
  if (await page.getByTestId('btn-call').isEnabled().catch(() => false)) await page.keyboard.press(i % 3 ? 'c' : 'f');
  await page.waitForTimeout(200);
}
const res = await page.evaluate(() => {
  const f = window.__frames.slice(30).sort((a, b) => a - b);
  const q = (p) => f[Math.floor(f.length * p)];
  return {
    frames: f.length,
    p50: q(0.5).toFixed(1),
    p95: q(0.95).toFixed(1),
    p99: q(0.99).toFixed(1),
    over34ms: f.filter((x) => x > 34).length,
    longTasks: window.__long.length,
    longestTask: Math.max(0, ...window.__long).toFixed(0),
    heap: performance.memory?.usedJSHeapSize ?? 0,
    hand: document.querySelector('[data-testid="hand-number"]')?.textContent,
  };
});
console.log(JSON.stringify({ ...res, heapGrowthMB: ((res.heap - heap0) / 1e6).toFixed(1) }));
await browser.close();
