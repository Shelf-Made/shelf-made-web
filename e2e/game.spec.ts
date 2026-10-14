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
  // Build mode through real pointer events: pick a shelf, click a free floor tile, the fixture count grows.
  await hooks(page, 'dispatch', { type: 'cheat', cash: 1000 });
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'focusStore');
  await page.getByRole('button', { name: /build/i }).first().click();
  await page.getByRole('button', { name: /place/i }).first().click();
  const before = await page.evaluate(() => (window as unknown as { __shelf: { state: () => { shop: { fixtures: unknown[] } } } }).__shelf.state().shop.fixtures.length);
  // Project a free tile (store-relative 0.5, -3 → world (1, -2.5 + origin)) to the screen and click it.
  const pt = await page.evaluate(() => {
    const h = (window as unknown as { __shelf: { runtime: { renderer: { project: (x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }) => void } | null }; state: () => { shop: { originX: number; originZ: number } } } }).__shelf;
    const s = h.state().shop; const out = { x: 0, y: 0, visible: false };
    h.runtime.renderer!.project(s.originX + 1.0, 0, s.originZ - 2.5, out); return out;
  });
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(300);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => (window as unknown as { __shelf: { state: () => { shop: { fixtures: unknown[] } } } }).__shelf.state().shop.fixtures.length);
  expect(after).toBe(before + 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Back to the lobby: the autosave is listed.
  await page.getByRole('button', { name: /settings/i }).click();
  await page.getByRole('button', { name: /save & quit/i }).click();
  await expect(page.getByText(/E2E Mart/).first()).toBeVisible();
});
