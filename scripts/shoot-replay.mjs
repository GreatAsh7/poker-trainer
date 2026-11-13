// Dev helper: play until a hand finishes, open the replay and screenshot it.
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5199/');
await page.getByTestId('start-match').click();
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(200);
  if (await page.getByText('Replay last hand').isEnabled()) break;
  const fold = page.getByTestId('btn-fold');
  if (await fold.isEnabled()) await fold.click();
  else if (await page.getByTestId('btn-call').isEnabled()) await page.getByTestId('btn-call').click();
}
await page.getByText('Replay last hand').click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/replay.png` });
await page.keyboard.press('Escape');
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/after-replay.png` });
console.log('errors:', JSON.stringify(errors));
await browser.close();
