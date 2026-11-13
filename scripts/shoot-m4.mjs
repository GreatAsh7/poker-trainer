// Dev helper: screenshots of setup, settings, decision timer ring and replay with coach's notes.
// usage: node scripts/shoot-m4.mjs <outDir> [width] [height]
import { chromium } from '@playwright/test';
const [out = '.', W = '1280', H = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.addInitScript(() =>
  localStorage.setItem('poker-trainer.prefs.v1', JSON.stringify({ pace: 0.5, thinkMin: 0.3, thinkMax: 0.6, turnTimer: 15 })),
);
await page.goto('http://localhost:5199/');
await page.screenshot({ path: `${out}/m4-setup-${W}.png` });
await page.getByRole('button', { name: '⚙ Settings' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/m4-settings-${W}.png` });
await page.keyboard.press('Escape');
await page.getByTestId('start-match').click();
// wait for my turn, screenshot the timer ring a few seconds in
for (let i = 0; i < 200; i++) {
  if (await page.getByTestId('btn-call').isEnabled()) break;
  await page.waitForTimeout(150);
}
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/m4-timer-${W}.png` });
// play a hand to the end, then open the replay
for (let i = 0; i < 400; i++) {
  if (await page.getByText('Replay last hand').isEnabled().catch(() => false)) break;
  if (await page.getByTestId('btn-call').isEnabled()) await page.keyboard.press('c');
  await page.waitForTimeout(150);
}
await page.getByText('Replay last hand').click().catch(async () => {
  await page.keyboard.press('l');
  await page.getByText('Replay last hand').click();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/m4-replay-${W}.png` });
console.log('errors:', JSON.stringify(errors));
await browser.close();
