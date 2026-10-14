import { test, expect } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

const out = (name: string) => `docs/screens/${name}.png`;

test.describe('screenshots', () => {
  test('lobby, plot picker, first tip, shop, busy, neighbourhood, delivery, night', async ({ page }) => {
    await ready(page);
    await settle(page, 400);
    await page.screenshot({ path: out('01-lobby') });

    await page.getByRole('button', { name: /new game/i }).click();
    await page.getByRole('button', { name: /^start$/i }).click();
    await settle(page, 900);
    await page.screenshot({ path: out('02-plot-picker') });

    await page.getByRole('button', { name: /main street/i }).click();
    await page.getByPlaceholder(/shop name/i).fill('Corner Fresh');
    await page.getByRole('button', { name: /open the shop/i }).click();
    await settle(page, 500);
    await hooks(page, 'focusStore');
    await settle(page, 300);
    await page.screenshot({ path: out('04-shop-default-zoom') });

    // First tip: advance until a customer reaches the register.
    await hooks(page, 'setSpeed', 0);
    await hooks(page, 'advanceNoScan', 75);
    await settle(page, 400);
    await expect(page.locator('.tip')).toBeVisible({ timeout: 10_000 });
    await settle(page, 500);
    await page.screenshot({ path: out('03-first-tip') });

    // Busy shop: a lunchtime crowd and a slow cashier, so a line forms.
    await hooks(page, 'advanceScan', 200, 2.0);
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 10);
    await hooks(page, 'advanceScan', 40, 5);
    await hooks(page, 'focusStore');
    await settle(page, 900);
    await page.screenshot({ path: out('05-busy-shop') });

    // Neighbourhood zoomed out.
    await hooks(page, 'camera', 0, -1, 44, 0.35, 0.9);
    await settle(page, 400);
    await page.screenshot({ path: out('06-neighbourhood') });

    // Delivery: order from the express supplier and advance until the truck is unloading.
    await hooks(page, 'focusStore');
    await hooks(page, 'dispatch', { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'milk', qty: 12 }, { productId: 'chips', qty: 12 }] });
    await hooks(page, 'advance', 52);
    await hooks(page, 'camera', -2, -4.5, 15, 0.6, 0.95);
    await settle(page, 900);
    await page.screenshot({ path: out('07-delivery') });

    // Night card.
    await hooks(page, 'advance', 800);
    await settle(page, 500);
    await expect(page.getByText(/day 1 done/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: out('08-night-card') });
    const stats = await hooks<{ drawCalls: number }>(page, 'stats');
    expect(stats.drawCalls).toBeLessThan(250);
  });
});
