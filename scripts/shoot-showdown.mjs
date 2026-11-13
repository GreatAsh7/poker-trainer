// Dev helper: play (raise/call) until showdowns are on screen; screenshot them.
// usage: node scripts/shoot-showdown.mjs <outDir> [width] [height]
import { chromium } from '@playwright/test';
const [out = '.', W = '1600', H = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://localhost:5199/');
await page.getByRole('radio', { name: '3-max' }).click();
await page.getByRole('radio', { name: '20 BB' }).click();
await page.getByTestId('start-match').click();
let shots = 0;
for (let i = 0; i < 1500 && shots < 3; i++) {
  await page.waitForTimeout(150);
  if (await page.getByTestId('next-hand').isVisible().catch(() => false)) {
    if (await page.locator('.seat__handname').count()) await page.screenshot({ path: `${out}/sd-${W}-${shots++}.png` });
    await page.keyboard.press('Space');
    continue;
  }
  if (await page.getByTestId('btn-call').isEnabled()) await page.keyboard.press(i % 3 === 0 ? 'r' : 'c');
}
console.log('shots', shots, 'errors:', JSON.stringify(errors));
await browser.close();
