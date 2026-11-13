// Dev helper: drive the running app with Playwright (system Edge) and save screenshots.
// usage: node scripts/shoot.mjs <outDir> [width] [height]
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 1600), H = Number(process.argv[4] ?? 900);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/');
await page.screenshot({ path: `${out}/setup-${W}.png` });
await page.getByTestId('start-match').click();
if (process.env.OPENLOG) await page.keyboard.press('l');
let shots = 0;
for (let i = 0; i < 400 && shots < 6; i++) {
  await page.waitForTimeout(250);
  const call = page.getByTestId('btn-call');
  if (await call.isEnabled()) {
    await page.screenshot({ path: `${out}/turn-${W}-${shots++}.png` });
    await call.click();
  }
}
await page.screenshot({ path: `${out}/end-${W}.png` });
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await browser.close();
