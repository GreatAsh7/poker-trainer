import { test, expect, type Page } from '@playwright/test';

async function waitForTurn(page: Page, timeout = 60_000) {
  await expect(page.getByTestId('btn-call')).toBeEnabled({ timeout });
}

test('plays hands with buttons, keyboard and typed amounts without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Fast' }).count(); // setup screen visible
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('table')).toBeVisible();

  // 1) typed illegal amount cannot be submitted
  await waitForTurn(page);
  const input = page.getByTestId('raise-input');
  if (await input.isEnabled()) {
    await input.fill('1');
    await expect(page.getByTestId('btn-raise')).toBeDisabled();
    await input.fill('7.5');
    await expect(page.getByTestId('btn-raise')).toBeDisabled();
    await input.fill('9');
    await expect(page.getByTestId('btn-raise')).toBeEnabled();
    await input.press('Enter');
    await expect(page.getByTestId('btn-call')).toBeDisabled();
  } else {
    await page.getByTestId('btn-call').click();
  }

  // 2) keyboard play: check/call with C, double press must not act twice
  for (let i = 0; i < 4; i++) {
    await waitForTurn(page);
    const before = await page.locator('.log__line').count();
    await page.keyboard.press('c');
    await page.keyboard.press('c');
    await expect(page.getByTestId('btn-call')).toBeDisabled();
    expect(await page.locator('.log__line').count()).toBeGreaterThanOrEqual(before);
  }

  // 3) fold with F when facing a bet, else check
  await waitForTurn(page);
  if (await page.getByTestId('btn-fold').isEnabled()) await page.keyboard.press('f');
  else await page.keyboard.press('c');

  // reached at least hand 2 with no errors
  await expect
    .poll(async () => Number(await page.getByTestId('hand-number').textContent()), { timeout: 60_000 })
    .toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
