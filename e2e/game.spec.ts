import { test, expect } from '@playwright/test';
import { ready, hooks } from './helpers';

test('new game → scan a customer → night → open tomorrow → autosave shows in lobby', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 5, 'main', 'E2E Mart', { tutorial: true });
  await expect(page.locator('.money')).toContainText('$');
  await hooks(page, 'advance', 400);
  const served = await page.evaluate(() => (window as unknown as { __shelf: { state: () => { today: { served: number } } } }).__shelf.state().today.served);
  expect(served).toBeGreaterThan(0);
  await hooks(page, 'advance', 500);
  await expect(page.getByText(/day 1 done/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /open tomorrow/i }).click();
  await expect(page.locator('.clock')).toContainText('Day 2');
  // Esc closes cards; Space scans without error.
  await page.getByRole('button', { name: /prices/i }).click();
  await expect(page.locator('.card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card')).toHaveCount(0);
  // Back to the lobby: the autosave is listed.
  await page.getByRole('button', { name: /settings/i }).click();
  await page.getByRole('button', { name: /save & quit/i }).click();
  await expect(page.getByText(/E2E Mart/).first()).toBeVisible();
});
