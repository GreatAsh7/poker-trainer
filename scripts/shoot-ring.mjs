// Dev helper: zoomed screenshot of the hero's nameplate while the decision timer runs.
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => localStorage.setItem('poker-trainer.prefs.v1', JSON.stringify({ pace: 0.5, thinkMin: 0.3, thinkMax: 0.6, turnTimer: 15 })));
await page.goto('http://localhost:5199/');
await page.getByTestId('start-match').click();
for (let i = 0; i < 200; i++) {
  if (await page.getByTestId('btn-call').isEnabled()) break;
  await page.waitForTimeout(150);
}
await page.waitForTimeout(4000);
const box = await page.getByTestId('seat-0').locator('.seat__plate').boundingBox();
await page.screenshot({ path: `${out}/ring.png`, clip: { x: box.x - 30, y: box.y - 30, width: box.width + 60, height: box.height + 60 } });
console.log(JSON.stringify(box), await page.locator('.timer-ring').count());
await browser.close();
