import { test, expect, type Page } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

const out = (name: string) => `docs/screens/${name}.png`;
type Car = { id: number; state: string; lot?: string; x: number; z: number };
type St = { shop: { fixtures: { id: number; type: string }[]; originX: number; originZ: number }; cars: Car[]; rivals: { id: string; corner: string; x: number; z: number; open: boolean }[] };
const st = (page: Page) => hooks<St>(page, 'state');

/** Back in play: the manager at a shop-relative point, the follow camera behind (shop-relative yaw) at a distance. */
async function follow(page: Page, x: number, z: number, dist = 12, yaw = 0, ms = 900, pitch?: number): Promise<void> {
  await hooks(page, 'fp', x, z, yaw, pitch, dist);
  await settle(page, ms);
}

test.describe('screenshots', () => {
  test('lobby, picker, the bare shell, building, stocking, trading, the zooms, the crossroads, night', async ({ page }) => {
    await ready(page);
    await settle(page, 2500);
    await page.screenshot({ path: out('01-lobby') });

    await page.getByRole('button', { name: /new shop/i }).click();
    await page.getByRole('button', { name: /pick a plot/i }).click();
    await settle(page, 800);
    // The colour picker: the shop on the corner takes the colours as you click them.
    await page.getByRole('radio', { name: 'Plum' }).click();
    await settle(page, 1500);
    await page.screenshot({ path: out('02-plot-picker') });
    await page.getByRole('radio', { name: 'Fresh green' }).click();

    await page.getByRole('button', { name: /main road corner/i }).click();
    await page.getByPlaceholder(/shop name/i).fill('Corner Fresh');
    await page.getByRole('button', { name: /open the shop/i }).click();
    await hooks(page, 'setSpeed', 0);
    // The empty shell at the default zoom, with the first job.
    await follow(page, 0.5, -1.0, 12, 0, 1500);
    await expect(page.locator('.tip')).toBeVisible();
    await page.screenshot({ path: out('03-bare-shell') });

    // Placing a shelf: the ghost sits on the tile under the mouse, the camera pulled back so the floor fits beside the card.
    await hooks(page, 'openCard', 'build');
    await hooks(page, 'startPlacing', 'shelf');
    await settle(page, 1500);
    const g = await hooks<{ x: number; y: number }>(page, 'screenAt', -2.0, -3.5, 0);
    await page.mouse.move(g.x, g.y);
    await settle(page, 900);
    await page.screenshot({ path: out('04-build-ghost') });
    await hooks(page, 'openCard', 'build');
    await page.mouse.move(5, 400);

    // Fitted out and stocked; carrying a box from the pallet to a shelf, close in.
    await hooks(page, 'quickSetup', false);
    await hooks(page, 'fp', -1.5, -4.3);
    await hooks(page, 'dispatch', { type: 'pickUp' });
    await hooks(page, 'aimAt', -1.0, -3.4, -2.0, 0.45, -3.6, 8);
    await settle(page, 900);
    await page.screenshot({ path: out('05-carrying-a-box') });
    // Put the box down out of shot so it does not fill every later view.
    await page.evaluate(() => { const s = (window as unknown as { __shelf: { state: () => { people: { kind: string; carrying?: unknown }[] } } }).__shelf.state(); const o = s.people.find((p) => p.kind === 'owner'); if (o) o.carrying = null; });

    // Open, with a line at the till: the close shop view (default zoom), one scroll out, and the overview.
    await hooks(page, 'dispatch', { type: 'openShop' });
    await hooks(page, 'openRivals');
    await hooks(page, 'advanceScan', 120, 2);
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 6);
    await hooks(page, 'crowd', 3, false);
    await hooks(page, 'advanceScan', 30, 6);
    await follow(page, 2.0, -1.5, 12, 0, 1400);
    await page.screenshot({ path: out('06-close-shop') });
    await hooks(page, 'zoom', 1.65);
    await settle(page, 1600);
    await page.screenshot({ path: out('07-mid-zoom') });
    for (let i = 0; i < 6; i++) await hooks(page, 'zoom', 1.4);
    await settle(page, 2200);
    await page.screenshot({ path: out('08-overview') });

    // The crossroads from high above, and at mid zoom with all three rival corners in view.
    await hooks(page, 'viewWorld', 0, 2.5, 0, 68, 1.22);
    await settle(page, 1500);
    await page.screenshot({ path: out('09-crossroads-above') });
    await hooks(page, 'viewWorld', 0, 3, 0.3, 60, 0.9);
    await settle(page, 1500);
    await page.screenshot({ path: out('10-rival-corners') });

    // A delivery truck at the back door.
    await hooks(page, 'dispatch', { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'milk', qty: 12 }, { productId: 'chips', qty: 12 }] });
    let unloading = false;
    for (let i = 0; i < 30 && !unloading; i++) {
      await hooks(page, 'advanceScan', 4, 2);
      unloading = (await st(page)).cars.some((c) => c.state === 'unloading');
    }
    await hooks(page, 'view', -3.0, -8.5, 0.9, 16, 0.85);
    await settle(page, 1200);
    await page.screenshot({ path: out('11-delivery') });

    // The Stats card over the shop.
    await follow(page, 0.4, -1.0, 12, 0, 300);
    await hooks(page, 'openCard', 'stats');
    await settle(page, 1200);
    await page.screenshot({ path: out('12-finance-card') });
    await hooks(page, 'openCard', 'stats');

    // A rival sale across Main Road pulls walkers over the zebra.
    const across = (await st(page)).rivals.find((r) => r.corner === 'se')!;
    await hooks(page, 'rivalSale', across.id);
    await hooks(page, 'advanceScan', 50, 2);
    await hooks(page, 'viewWorld', 11, 4.5, Math.PI - 0.2, 30, 0.85);
    await settle(page, 1500);
    await page.screenshot({ path: out('13-rival-sale-zebra') });

    // Staff on the floor.
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { staffPool: { id: number; role: string }[] }; dispatch: (c: unknown) => unknown } }).__shelf;
      for (const role of ['cashier', 'stocker', 'cleaner']) { const c = h.state().staffPool.find((x) => x.role === role); if (c) h.dispatch({ type: 'hire', candidateId: c.id }); }
    });
    await hooks(page, 'dispatch', { type: 'cheat', cash: 20000 });
    await hooks(page, 'advanceScan', 60, 3);
    await follow(page, -1.4, -1.0, 10, 0.4, 1200);
    await page.screenshot({ path: out('14-staff-on-floor') });

    // A market hall with a doubled lot.
    await hooks(page, 'dispatch', { type: 'expandShop', sizeId: 'large' });
    await hooks(page, 'dispatch', { type: 'expandLot' });
    for (const [x, z, t, rot] of [[-1.5, -6, 'shelf', 0], [-0.5, -6, 'shelf', 0], [0.5, -6, 'endcap', 0], [-3.5, -4, 'freezer', 1], [-1.5, -4, 'shelf', 0], [-0.5, -4, 'shelf', 0], [2.5, -6, 'produce', 0]] as [number, number, string, number][]) await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType: t, x, z, rot });
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 8);
    await hooks(page, 'advanceScan', 40, 3);
    await follow(page, -1.0, -1.2, 14, 0, 1500);
    await page.screenshot({ path: out('15-market-hall') });
    await hooks(page, 'view', 4, -5, 0.55, 30, 0.95);
    await settle(page, 1400);
    await page.screenshot({ path: out('16-market-hall-lot') });

    // A full lot: the next driver carries on to a rival's car park.
    await hooks(page, 'crowd', 14, false);
    let onward: Car | undefined;
    for (let i = 0; i < 40 && !onward; i++) {
      // Only about half of a crowd drives: keep them coming until the lot is full and one is sent on.
      if (i % 4 === 3) await hooks(page, 'crowd', 4, false);
      await hooks(page, 'advanceScan', 1.5, 30);
      onward = (await st(page)).cars.find((c) => c.state === 'arriving' && c.lot !== undefined && c.lot !== 'street');
    }
    expect(onward, 'a car sent on to a rival').toBeTruthy();
    const dest = (await st(page)).rivals.find((r) => r.id === onward!.lot)!;
    const s0 = await st(page);
    await hooks(page, 'viewWorld', (s0.shop.originX + dest.x) / 2, (s0.shop.originZ + dest.z) / 2 + 2, Math.atan2(s0.shop.originX - dest.x, 30) * 0.4, 40, 0.95);
    await settle(page, 1500);
    await page.screenshot({ path: out('17-full-lot-to-rival') });

    // A franchise branch out in East End: its name goes up on the road sign at the edge of town.
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { staffPool: { id: number; role: string }[] }; dispatch: (c: unknown) => unknown } }).__shelf;
      const s = h.state();
      if (!s.staffPool.some((c) => c.role === 'manager')) s.staffPool.push({ id: 99999, name: 'Mo Larsen', role: 'manager', skill: 0.8, speed: 1, wage: 95, look: { model: 1, variant: 1, height: 1 } } as never);
      const m = s.staffPool.find((c) => c.role === 'manager')!;
      h.dispatch({ type: 'openFranchise', siteId: 'eastend', managerId: m.id });
    });
    await hooks(page, 'viewWorld', 25.5, -0.6, -1.15, 9, 0.62);
    await settle(page, 1500);
    await page.screenshot({ path: out('18-franchise-sign') });

    // Shoppers' reactions over their heads at a long queue.
    await hooks(page, 'crowd', 12);
    type R = { reactions: { kind: string; tick: number; personId: number }[]; tick: number };
    for (let i = 0; i < 120; i++) {
      await hooks(page, 'advanceScan', 1, 12);
      const st = await hooks<R>(page, 'state');
      if (st.reactions.filter((r) => st.tick - r.tick < 12).length >= 2) break;
    }
    await follow(page, 0.5, -1.0, 14, 0, 900);
    await page.screenshot({ path: out('22-reactions-queue') });

    // Bags in Cheapo's colours on the pavement during its sale, beside ours.
    const cheapo = (await st(page)).rivals.find((r) => r.id === 'discount')!;
    await hooks(page, 'setTime', 300); // early afternoon: the street is busy and nobody is closing
    await hooks(page, 'rivalSale', 'discount');
    await hooks(page, 'advanceScan', 90, 2);
    // Cheapo's frontage: its corner's origin (north corners face south, south ones are turned round), the pavement in front.
    const origin: Record<string, [number, number, number]> = { nw: [-15.5, -1.6, 1], ne: [10.9, -1.6, 1], sw: [-10.9, 6.6, -1], se: [15.5, 6.6, -1] };
    const [cx, cz, facing] = origin[cheapo.corner]!;
    // Wait for a couple of Cheapo's shoppers to come out with their bags.
    type P = { people: { rivalId?: string; bags?: boolean; x: number; z: number; state: string }[] };
    let seen: { x: number; z: number }[] = [];
    for (let i = 0; i < 200; i++) {
      // Out on the walkway or the pavement (past the pylon), not still in the doorway.
      seen = (await hooks<P>(page, 'state')).people.filter((p) => p.rivalId === 'discount' && p.bags && (p.state === 'leaving' || p.state === 'toCar')
        && Math.hypot(p.x - cx, p.z - (cz + 2 * facing)) < 7 && (p.z - cz) * facing > 2.2);
      if (seen.length >= 2 || (seen.length && i > 100)) break;
      await hooks(page, 'advanceScan', 1, 2);
    }
    expect(seen.length, 'a Cheapo shopper with bags on the pavement').toBeGreaterThan(0);
    // Centre on one of them (not the sale sign over the pavement), from in front of the store and to one side.
    await hooks(page, 'viewWorld', seen[0]!.x, seen[0]!.z, facing > 0 ? 0.8 : Math.PI + 0.8, 8, 0.75);
    await settle(page, 1500);
    await page.screenshot({ path: out('23-bags-cheapo-sale') });

    // The crossroads at dusk: shop windows, signs and lamps lit, light spilling onto the pavement.
    await hooks(page, 'setTime', 700);
    await hooks(page, 'viewWorld', 2, 2, 0.3, 42, 0.92);
    await settle(page, 1800);
    await page.screenshot({ path: out('24-dusk-glow') });

    // Night card.
    await follow(page, 0.4, -1.0, 12, 0, 300);
    await hooks(page, 'advance', 900);
    await settle(page, 1200);
    await expect(page.getByText(/day 1 done/i)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: out('19-night-card') });
    const stats = await hooks<{ drawCalls: number }>(page, 'stats');
    expect(stats.drawCalls).toBeLessThan(250);
  });

  test('playing on a phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await ready(page);
    await hooks(page, 'newGame', 3, 'main', 'Corner Fresh', { tutorial: false });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'setSpeed', 0);
    await hooks(page, 'crowd', 4);
    await hooks(page, 'advanceScan', 30, 6);
    await follow(page, 2.0, -1.5, 14, 0, 1500);
    await page.screenshot({ path: out('20-phone-play') });
    await page.close();
  });

  test('lobby on a phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ready(page);
    await settle(page, 2500);
    await page.screenshot({ path: out('21-lobby-phone') });
  });
});
