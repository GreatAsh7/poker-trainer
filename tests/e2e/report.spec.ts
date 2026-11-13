import { test, expect } from '@playwright/test';

test('a full match ends with a coaching report that is saved for next time', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Heads-up' }).click();
  await page.getByRole('radio', { name: '25 hands' }).click();
  await page.getByTestId('start-match').click();
  await page.getByLabel('Fast').check();
  let i = 0;
  while (!(await page.getByTestId('report').isVisible())) {
    i++;
    if (await page.getByTestId('next-hand').isVisible()) await page.keyboard.press('Space');
    else if (await page.getByTestId('btn-call').isEnabled()) await page.keyboard.press(i % 5 === 0 && (await page.getByTestId('btn-fold').isEnabled()) ? 'f' : 'c');
    else await page.keyboard.press('Space');
    await page.waitForTimeout(100);
  }
  await expect(page.getByText('Your plan for next match')).toBeVisible();
  await expect(page.getByText('Your stats vs a solid player')).toBeVisible();
  await page.getByRole('tab', { name: /Hand-by-hand/ }).click();
  await expect(page.getByRole('heading', { name: 'Hand-by-hand review' })).toBeVisible();
  // saved: back to setup shows the saved-report link
  await page.getByRole('button', { name: 'New match settings' }).click();
  await expect(page.getByRole('button', { name: /View your last report/ })).toBeVisible();
  expect(errors).toEqual([]);
});
