// Dev helper: play a full 25-hand match quickly, then screenshot the coaching report.
// usage: node scripts/shoot-report.mjs <outDir> [width] [height]
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
await page.getByRole('radio', { name: '25 hands' }).click();
await page.getByTestId('start-match').click();
await page.getByLabel('Fast').check().catch(() => {});
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 600_000) {
  if (await page.getByTestId('report').isVisible().catch(() => false)) break;
  i++;
  if (await page.getByTestId('next-hand').isVisible().catch(() => false)) await page.keyboard.press('Space');
  else if (await page.getByTestId('btn-call').isEnabled().catch(() => false)) {
    const foldable = await page.getByTestId('btn-fold').isEnabled();
    await page.keyboard.press(foldable && i % 4 === 0 ? 'f' : i % 7 === 0 ? 'r' : 'c');
  } else await page.keyboard.press('Space');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/report-${W}-top.png` });
await page.screenshot({ path: `${out}/report-${W}-full.png`, fullPage: false });
await page.locator('.report').evaluate((el) => el.scrollTo(0, 900));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/report-${W}-mid.png` });
await page.locator('.report').evaluate((el) => el.scrollTo(0, 2200));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/report-${W}-low.png` });
await page.getByRole('tab', { name: /Hand-by-hand/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/report-${W}-hands.png` });
console.log('seconds', ((Date.now() - t0) / 1000).toFixed(0), 'errors:', JSON.stringify(errors));
await browser.close();
