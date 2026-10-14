import { test, expect, type Page } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

const out = (name: string) => `docs/screens/${name}.png`;

/** Stand at a shop-relative point and look at another, then let a few frames render. */
async function eye(page: Page, from: [number, number], to: [number, number, number], ms = 700): Promise<void> {
  await hooks(page, 'aimAt', from[0], from[1], to[0], to[1], to[2]);
  await settle(page, ms);
}

test.describe('screenshots', () => {
  test('lobby, picker, the bare shell, building, stocking, trading, the valley, night', async ({ page }) => {
    await ready(page);
    await settle(page, 2500);
    await page.screenshot({ path: out('01-lobby') });

    await page.getByRole('button', { name: /new shop/i }).click();
    await page.getByRole('button', { name: /pick a plot/i }).click();
    await settle(page, 1200);
    await page.screenshot({ path: out('02-plot-picker') });

    await page.getByRole('button', { name: /main street/i }).click();
    await page.getByPlaceholder(/shop name/i).fill('Corner Fresh');
    await page.getByRole('button', { name: /open the shop/i }).click();
    await hooks(page, 'setSpeed', 0);
    // The empty shell, from just inside the door, with the first tip.
    await eye(page, [0.6, -0.6], [-0.6, 0.45, -6], 1500);
    await expect(page.locator('.tip')).toBeVisible();
    await page.screenshot({ path: out('03-bare-shell') });

    // Placing a shelf: the ghost sits on the tile under the crosshair.
    await hooks(page, 'openCard', 'build');
    await hooks(page, 'startPlacing', 'shelf');
    await eye(page, [-0.3, -1.6], [-2.0, 0, -3.5], 1200);
    await page.screenshot({ path: out('04-build-ghost') });
    await hooks(page, 'openCard', 'build');

    // Fitted out and stocked; carrying a box from the pallet to a shelf.
    await hooks(page, 'quickSetup', false);
    await hooks(page, 'fp', -1.5, -4.3);
    await hooks(page, 'dispatch', { type: 'pickUp' });
    await eye(page, [-1.0, -3.4], [-2.0, 0.45, -3.6]);
    await page.screenshot({ path: out('05-carrying-a-box') });
    // Put the box down out of shot so it does not fill every later view.
    await page.evaluate(() => { const s = (window as unknown as { __shelf: { state: () => { people: { kind: string; carrying?: unknown }[] } } }).__shelf.state(); const o = s.people.find((p) => p.kind === 'owner'); if (o) o.carrying = null; });

    // Open: behind the counter with a line.
    await hooks(page, 'dispatch', { type: 'stockFixture', fixtureId: (await hooks<{ shop: { fixtures: { id: number; type: string }[] } }>(page, 'state')).shop.fixtures.find((f) => f.type === 'shelf')!.id });
    await hooks(page, 'dispatch', { type: 'openShop' });
    await hooks(page, 'advanceScan', 120, 2);
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 6);
    await hooks(page, 'advanceScan', 30, 6);
    await eye(page, [2.0, -1.5], [-0.5, 0.4, -4.2], 1200);
    await page.screenshot({ path: out('06-behind-the-counter') });

    // The shop floor from the door.
    await eye(page, [-0.2, -0.5], [0.2, 0.35, -5], 900);
    await page.screenshot({ path: out('07-shop-floor') });

    // Out on Main Street, looking back at the shop front.
    await eye(page, [3.2, 4.4], [0, 0.9, -1.0], 1200);
    await page.screenshot({ path: out('08-main-street') });

    // The valley from above, and from the bridge.
    await hooks(page, 'camera', 2, 4, 120, 0.35, 0.82);
    await settle(page, 1500);
    await page.screenshot({ path: out('09-valley') });
    await eye(page, [39, 24.5], [30, 0.9, 40], 1500);
    await page.screenshot({ path: out('10-river-bridge') });

    // A delivery truck at the back door.
    await hooks(page, 'dispatch', { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'milk', qty: 12 }, { productId: 'chips', qty: 12 }] });
    let unloading = false;
    for (let i = 0; i < 30 && !unloading; i++) {
      await hooks(page, 'advanceScan', 4, 2);
      unloading = (await hooks<{ cars: { state: string }[] }>(page, 'state')).cars.some((c) => c.state === 'unloading');
    }
    await hooks(page, 'camera', -3.5, -9, 12, 0.9, 0.6);
    await settle(page, 1200);
    await page.screenshot({ path: out('11-delivery') });

    // The Stats card over the shop.
    await eye(page, [0.4, -1.0], [0, 0.4, -5], 300);
    await hooks(page, 'openCard', 'stats');
    await settle(page, 700);
    await page.screenshot({ path: out('12-finance-card') });
    await hooks(page, 'openCard', 'stats');

    // A rival sale across the road.
    await hooks(page, 'rivalSale', 'discount');
    await hooks(page, 'camera', -20, 6, 14, Math.PI, 0.5);
    await settle(page, 1200);
    await page.screenshot({ path: out('13-rival-sale') });

    // Staff on the floor.
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { staffPool: { id: number; role: string }[] }; dispatch: (c: unknown) => unknown } }).__shelf;
      for (const role of ['cashier', 'stocker', 'cleaner']) { const c = h.state().staffPool.find((x) => x.role === role); if (c) h.dispatch({ type: 'hire', candidateId: c.id }); }
    });
    await hooks(page, 'dispatch', { type: 'cheat', cash: 20000 });
    await hooks(page, 'advanceScan', 60, 3);
    await eye(page, [-1.4, -1.0], [1.5, 0.35, -4.5], 1200);
    await page.screenshot({ path: out('14-staff-on-floor') });

    // A market hall with a doubled lot.
    await hooks(page, 'dispatch', { type: 'expandShop', sizeId: 'large' });
    await hooks(page, 'dispatch', { type: 'expandLot' });
    for (const [x, z, t, rot] of [[-1.5, -6, 'shelf', 0], [-0.5, -6, 'shelf', 0], [0.5, -6, 'endcap', 0], [-3.5, -4, 'freezer', 1], [-1.5, -4, 'shelf', 0], [-0.5, -4, 'shelf', 0], [2.5, -6, 'produce', 0]] as [number, number, string, number][]) await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType: t, x, z, rot });
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 8);
    await hooks(page, 'advanceScan', 40, 3);
    await eye(page, [-3.6, -0.6], [1.5, 0.35, -7], 1500);
    await page.screenshot({ path: out('15-market-hall') });
    await hooks(page, 'camera', 4, -5, 26, 0.55, 0.9);
    await settle(page, 1200);
    await page.screenshot({ path: out('16-market-hall-lot') });

    // A franchise branch on the Hillside plot.
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { staffPool: { id: number; role: string }[] }; dispatch: (c: unknown) => unknown } }).__shelf;
      const s = h.state();
      if (!s.staffPool.some((c) => c.role === 'manager')) s.staffPool.push({ id: 99999, name: 'Mo Larsen', role: 'manager', skill: 0.8, speed: 1, wage: 95, look: { model: 1, variant: 1, height: 1 } } as never);
      const m = s.staffPool.find((c) => c.role === 'manager')!;
      h.dispatch({ type: 'openFranchise', plotId: 'hill', managerId: m.id });
    });
    await hooks(page, 'camera', -22, -2, 20, 0.25, 0.7);
    await settle(page, 1500);
    await page.screenshot({ path: out('17-franchise-branch') });

    // Night card.
    await eye(page, [0.4, -1.0], [0, 0.4, -5], 300);
    await hooks(page, 'advance', 900);
    await settle(page, 800);
    await expect(page.getByText(/day 1 done/i)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: out('18-night-card') });
    const stats = await hooks<{ drawCalls: number }>(page, 'stats');
    expect(stats.drawCalls).toBeLessThan(250);
  });

  test('lobby on a phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ready(page);
    await settle(page, 2500);
    await page.screenshot({ path: out('19-lobby-phone') });
  });
});
