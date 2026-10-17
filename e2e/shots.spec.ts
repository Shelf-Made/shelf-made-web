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

/** A new game on Main Road, paused in the same breath (not a tick of the street run, however slow the page is). */
async function newPaused(page: Page, seed: number, name: string): Promise<void> {
  await page.evaluate(({ seed, name }) => {
    const h = (window as unknown as { __shelf: { newGame: (seed: number, plotId: string, name: string, opts: { tutorial: boolean }) => void; setSpeed: (s: number) => void } }).__shelf;
    h.newGame(seed, 'main', name, { tutorial: false });
    h.setSpeed(0);
  }, { seed, name });
}

test.describe('screenshots', () => {
  test('lobby, picker, the bare shell, building, stocking, trading, the zooms, the crossroads, night', async ({ page }) => {
    // Fourteen views (about three minutes on a fast CI runner, five on a slow one).
    test.setTimeout(420_000);
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
  });

  test('a market hall, a full lot, a franchise sign, reactions, a rival sale\'s bags, dusk and the night card', async ({ page }) => {
    // Split from the views above: together they ran past seven minutes on a slow CI runner.
    test.setTimeout(420_000);
    await ready(page);
    await hooks(page, 'newGame', 3, 'main', 'Corner Fresh', { tutorial: false });
    await hooks(page, 'setSpeed', 0);
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'openRivals');
    await hooks(page, 'dispatch', { type: 'cheat', cash: 20000 });
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { staffPool: { id: number; role: string }[] }; dispatch: (c: unknown) => unknown } }).__shelf;
      for (const role of ['cashier', 'stocker', 'cleaner']) { const c = h.state().staffPool.find((x) => x.role === role); if (c) h.dispatch({ type: 'hire', candidateId: c.id }); }
    });
    await hooks(page, 'advanceScan', 60, 3);

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
    // A few of the sale's shoppers on their way, so the shot never waits on luck.
    await hooks(page, 'rivalShoppers', 'discount', 8);
    await hooks(page, 'advanceScan', 90, 2);
    // Cheapo's frontage: its corner's origin (north corners face south, south ones are turned round), the pavement in front.
    const origin: Record<string, [number, number, number]> = { nw: [-15.5, -1.6, 1], ne: [10.9, -1.6, 1], sw: [-10.9, 6.6, -1], se: [15.5, 6.6, -1] };
    const [cx, cz, facing] = origin[cheapo.corner]!;
    // Wait for a couple of Cheapo's shoppers to come out with their bags.
    type P = { people: { rivalId?: string; bags?: boolean; x: number; z: number; state: string }[] };
    let seen: { x: number; z: number }[] = [];
    let cheapoPeople: Record<string, number> = {};
    for (let i = 0; i < 320; i++) {
      // Out on the walkway or the pavement (past the pylon), not still in the doorway.
      const people = (await hooks<P>(page, 'state')).people.filter((p) => p.rivalId === 'discount');
      seen = people.filter((p) => p.bags && (p.state === 'leaving' || p.state === 'toCar') && Math.hypot(p.x - cx, p.z - (cz + 2 * facing)) < 7 && (p.z - cz) * facing > 2.2);
      cheapoPeople = {}; for (const p of people) cheapoPeople[`${p.state}${p.bags ? '+bags' : ''}`] = (cheapoPeople[`${p.state}${p.bags ? '+bags' : ''}`] ?? 0) + 1;
      if (seen.length >= 2 || (seen.length && i > 100)) break;
      // The town is a new one every run (its seed is random): never wait on luck. After a minute,
      // whoever is inside comes out now; later, a few more are sent along.
      if (i === 60 || i === 180) await page.evaluate(() => { const st = (window as unknown as { __shelf: { state: () => { people: { rivalId?: string; state: string; timer: number }[] } } }).__shelf.state(); for (const p of st.people) if (p.rivalId === 'discount' && p.state === 'inRival') p.timer = 0.05; });
      if (i === 120 || i === 240) await hooks(page, 'rivalShoppers', 'discount', 6);
      await hooks(page, 'advanceScan', 1, 2);
    }
    expect(seen.length, `a Cheapo shopper with bags on the pavement (Cheapo's shoppers: ${JSON.stringify(cheapoPeople)})`).toBeGreaterThan(0);
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

  test('goals, a good night and a bad one, a corner for sale and a corner bought', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    // Paused as it starts: the street runs while the page settles, so how long that took (the machine's load) changed it.
    await newPaused(page, 11, 'Corner Fresh');
    await settle(page, 1500);
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'openRivals');
    await hooks(page, 'goalAt', 'cheapo');
    await hooks(page, 'crowd', 6);
    await hooks(page, 'advanceScan', 60, 2);
    // The active goal as a chip under the top bar.
    await follow(page, 0.5, -1.0, 12, 0, 1200);
    await expect(page.locator('.goal-chip')).toContainText('Beat the discounter');
    await page.screenshot({ path: out('25-goal-chip') });
    // A click on it opens the whole ladder.
    await page.locator('.goal-chip').click();
    await expect(page.locator('.goal-ladder li')).toHaveCount(7);
    await settle(page, 600);
    await page.screenshot({ path: out('26-goals-ladder') });
    await page.keyboard.press('Escape');

    // A good day: busy and stocked. The card says why, how the crossroads split, and what tomorrow brings.
    await hooks(page, 'restock');
    for (let i = 0; i < 6; i++) { await hooks(page, 'crowd', 5); await hooks(page, 'advanceScan', 60, 1.2); await hooks(page, 'restock'); }
    await hooks(page, 'advance', 900);
    await expect(page.locator('.card.night')).toBeVisible({ timeout: 15_000 });
    await settle(page, 800);
    await page.screenshot({ path: out('27-night-card-profit') });
    expect(await page.locator('.card.night').getAttribute('class')).toContain('profit');

    // A bad day: bare shelves, nobody served. The headline goes red.
    await page.getByRole('button', { name: /open tomorrow/i }).click();
    await page.evaluate(() => { const s = (window as unknown as { __shelf: { state: () => { shop: { fixtures: { slots: { qty: number }[] }[] } } } }).__shelf.state(); for (const f of s.shop.fixtures) for (const sl of f.slots) sl.qty = 0; });
    await hooks(page, 'advance', 900);
    await expect(page.locator('.card.night.loss')).toBeVisible({ timeout: 15_000 });
    await settle(page, 800);
    await page.screenshot({ path: out('28-night-card-loss') });
    await page.getByRole('button', { name: /open tomorrow/i }).click();

    // Cheapo goes under: the sign comes down and a "For sale" board goes up.
    const cheapo = (await st(page)).rivals.find((r) => r.id === 'discount')!;
    const origin: Record<string, [number, number, number]> = { nw: [-15.5, -1.6, 1], ne: [10.9, -1.6, 1], sw: [-10.9, 6.6, -1], se: [15.5, 6.6, -1] };
    const [cx, cz, facing] = origin[cheapo.corner]!;
    await hooks(page, 'closeRival', 'discount');
    await hooks(page, 'viewWorld', cx, cz + 0.5 * facing, facing > 0 ? 0.3 : Math.PI + 0.3, 17, 0.8);
    await settle(page, 1500);
    await page.screenshot({ path: out('29-corner-for-sale') });

    // Bought: the building in the shop's colours and under its name, its shoppers carrying its bags.
    expect(await hooks<boolean>(page, 'buyCorner', 'discount')).toBe(true);
    await hooks(page, 'advanceScan', 120, 2);
    await hooks(page, 'viewWorld', cx, cz + 0.5 * facing, facing > 0 ? 0.3 : Math.PI + 0.3, 17, 0.8);
    await settle(page, 1500);
    await page.screenshot({ path: out('30-corner-bought') });
  });

  test('rivals answer back: a price match, a renovation; who is who and who shops where', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    // Paused as it starts: the street runs while the page settles, so how long that took (the machine's load) changed it.
    await newPaused(page, 11, 'Corner Fresh');
    await settle(page, 1500);
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'openRivals');
    await hooks(page, 'setTime', 300);
    await hooks(page, 'crowd', 6);
    await hooks(page, 'advanceScan', 60, 2);
    const rivals = (await st(page)).rivals;
    const origin: Record<string, [number, number, number]> = { nw: [-15.5, -1.6, 1], ne: [10.9, -1.6, 1], sw: [-10.9, 6.6, -1], se: [15.5, 6.6, -1] };
    const front = (id: string) => origin[rivals.find((r) => r.id === id)!.corner]!;

    // Undercut Cheapo and it matches you: a banner across its front and a notice in the corner.
    await hooks(page, 'rivalMove', 'discount', 'priceMatch');
    {
      const [cx, cz, facing] = front('discount');
      await hooks(page, 'viewWorld', cx, cz + 1.2 * facing, facing > 0 ? 0.35 : Math.PI + 0.35, 11, 0.62);
      await settle(page, 1600);
      await page.screenshot({ path: out('31-cheapo-price-match') });
    }

    // Outshine Fresh & Fine and it closes for a refit: scaffolding and a board for two days.
    await hooks(page, 'rivalMove', 'premium', 'renovation');
    {
      const [cx, cz, facing] = front('premium');
      await hooks(page, 'viewWorld', cx + 1.5 * facing, cz + 0.8 * facing, facing > 0 ? 0.7 : Math.PI + 0.7, 13, 0.72);
      await settle(page, 1600);
      await page.screenshot({ path: out('32-fresh-renovation') });
    }

    // Click one of Cheapo's shoppers: who they are and why they went to Cheapo, not to you.
    await hooks(page, 'rivalShoppers', 'discount', 8);
    const [cx, cz, facing] = front('discount');
    type P = { people: { id: number; rivalId?: string; bags?: boolean; x: number; z: number; state: string }[] };
    let who: P['people'][number] | undefined, at: { x: number; y: number } | undefined, clear = false;
    // One the click can only mean: nobody else (a passer-by, a dog walker) between them and the camera there.
    for (let tries = 0; tries < 20 && !clear; tries++) {
      who = undefined;
      for (let i = 0; i < 200 && !who; i++) {
        who = (await hooks<P>(page, 'state')).people.find((p) => p.rivalId === 'discount' && p.bags && (p.state === 'leaving' || p.state === 'toCar')
          && Math.hypot(p.x - cx, p.z - (cz + 2 * facing)) < 7 && (p.z - cz) * facing > 2.2);
        if (!who) await hooks(page, 'advanceScan', 1, 2);
      }
      expect(who, 'a Cheapo shopper on the pavement').toBeTruthy();
      await hooks(page, 'viewWorld', who!.x, who!.z, facing > 0 ? 0.8 : Math.PI + 0.8, 9, 0.8);
      await settle(page, 1500);
      at = await hooks<{ x: number; y: number }>(page, 'personScreen', who!.id);
      clear = await page.evaluate(({ x, y, id }) => {
        const h = (window as unknown as { __shelf: { runtime: { renderer: { personAt: (x: number, y: number, s: unknown) => number | null } }; state: () => unknown } }).__shelf;
        return h.runtime.renderer.personAt(x, y, h.state()) === id;
      }, { x: at.x, y: at.y, id: who!.id });
      if (!clear) await hooks(page, 'advanceScan', 1, 2);
    }
    expect(clear, 'the Cheapo shopper is the one under the click').toBe(true);
    await page.mouse.click(at!.x, at!.y);
    const panel = page.getByTestId('inspect');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.why-label')).toContainText('Cheapo because');
    await settle(page, 800);
    await page.screenshot({ path: out('33-inspect-rival-shopper') });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // The Stats card: today's shoppers by type at each store. A row lights those shoppers up in town.
    await hooks(page, 'rivalShoppers', 'discount', 6);
    await hooks(page, 'rivalShoppers', 'chain', 6);
    await hooks(page, 'crowd', 6, false);
    await hooks(page, 'advanceScan', 25, 2);
    // Light up whichever type has the most people out and about right now.
    type Q = { people: { ctype?: string; kind: string; rivalId?: string; state: string }[] };
    const about = (await hooks<Q>(page, 'state')).people.filter((p) => p.ctype && (p.kind === 'customer' || p.rivalId) && p.state !== 'inRival' && p.state !== 'driving');
    const names: Record<string, string> = { bargain: 'Bargain hunters', convenience: 'Convenience shoppers', loyalist: 'Brand loyalists', impulse: 'Impulse buyers' };
    const most = Object.keys(names).sort((a, b) => about.filter((p) => p.ctype === b).length - about.filter((p) => p.ctype === a).length)[0]!;
    await hooks(page, 'viewWorld', 0, 1, 0.3, 30, 0.95);
    await hooks(page, 'openCard', 'stats');
    const table = page.locator('table.who-where');
    await table.scrollIntoViewIfNeeded();
    await table.getByRole('button', { name: new RegExp(names[most]!) }).click();
    await settle(page, 1500);
    await page.screenshot({ path: out('34-who-shops-where') });
  });

  test('a gentler first day, product pictures, your own manager, and a greener town', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    await hooks(page, 'newGame', 5, 'main', 'Corner Fresh', { tutorial: true });
    await hooks(page, 'setSpeed', 0);
    await follow(page, 0.5, -2.0, 12, 0, 1500);
    // One step at a time: the coach says what to do next, and the tool it means pulses.
    await expect(page.locator('.tip.coach')).toContainText('Place a checkout counter');
    await page.screenshot({ path: out('35-tutorial-coach') });
    // The Stock card shows each product as it stands on the shelves.
    await hooks(page, 'openCard', 'stock');
    await expect(page.locator('.card img.product-pic').first()).toBeVisible();
    await settle(page, 800);
    await page.screenshot({ path: out('36-stock-pictures') });
    await page.keyboard.press('Escape');
    await hooks(page, 'dispatch', { type: 'skipTutorial' });
    await hooks(page, 'quickSetup', true);
    // Furniture clicked with empty hands: its menu (Stock, Move, Turn, Sell); Move picks it up and the ghost follows the pointer.
    {
      const sh = (await st(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
      await follow(page, 0.5, -1.2, 9, 0, 1200);
      const p = await hooks<{ x: number; y: number }>(page, 'screenAt', (sh as unknown as { x: number }).x + 0.5, (sh as unknown as { z: number }).z + 0.5, 0.6);
      await page.mouse.click(p.x, p.y);
      await expect(page.getByRole('menu', { name: 'Shelf' })).toBeVisible();
      await settle(page, 600);
      await page.screenshot({ path: out('40-furniture-menu') });
      await page.getByRole('menuitem', { name: 'Move' }).click();
      const q = await hooks<{ x: number; y: number }>(page, 'screenAt', 1.0, -2.5, 0);
      await page.mouse.move(q.x, q.y);
      await settle(page, 900);
      await page.screenshot({ path: out('41-moving-a-shelf') });
      await page.keyboard.press('Escape');
      await page.mouse.move(5, 400);
    }
    // A greener town: textured lawns with grass and flowers, a mix of trees round every corner, softer zebras.
    await hooks(page, 'openRivals');
    await hooks(page, 'viewWorld', 2, 2, 0.3, 40, 0.92);
    await settle(page, 2000);
    await page.screenshot({ path: out('38-town-trees') });
    await hooks(page, 'view', 4, 1.5, -0.5, 9, 0.75);
    await settle(page, 1800);
    await page.screenshot({ path: out('39-lawn-close') });
  });

  test('weather: a grey day, rain and umbrellas, a thunderstorm and its lightning; the lawn up close', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    await hooks(page, 'newGame', 12, 'main', 'Rainy Days', { tutorial: false });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'crowd', 8);
    await hooks(page, 'advanceNoScan', 25);
    await hooks(page, 'setSpeed', 0);
    // The lawn, still and thick, from low down.
    await hooks(page, 'camera', 12, -4, 14, 2.4, 0.12);
    await settle(page, 1500);
    await page.screenshot({ path: out('42-lawn-up-close') });
    // Overcast: no hard shadows, a grey sky.
    await hooks(page, 'setSky', 'grey');
    await follow(page, 0.5, 2.5, 9, 0.5, 1500, 0.5);
    await page.screenshot({ path: out('43-grey-day') });
    // Rain: streaks, splashes, wet roads, umbrellas up.
    await hooks(page, 'setSky', 'rain');
    await hooks(page, 'soak');
    await settle(page, 1500);
    const wx = await hooks<{ wet: number; rain: number }>(page, 'weather');
    expect(wx.rain).toBeGreaterThan(0.3);
    expect(wx.wet).toBeGreaterThan(0.5);
    await page.screenshot({ path: out('44-rain') });
    await hooks(page, 'viewWorld', 2, 2, 0.3, 32, 0.55);
    await settle(page, 1500);
    await page.screenshot({ path: out('45-rain-umbrellas') });
    // A storm, and lightning: the bolt held at its brightest for the picture.
    await hooks(page, 'setSky', 'storm');
    await hooks(page, 'camera', 12, -4, 16, 2.4, 0.16);
    await settle(page, 1200);
    await hooks(page, 'freezeStrike', true);
    await hooks(page, 'strike', -40, 44);
    await settle(page, 600);
    // Lit once a frame has drawn since the strike (rain frames can be slow under software GL).
    await expect.poll(async () => (await hooks<{ flash: number }>(page, 'weather')).flash).toBeGreaterThan(0.2);
    await page.screenshot({ path: out('46-lightning') });
    await hooks(page, 'freezeStrike', false);
    // Close up in the rain: puddles holding the sky, rings where the drops land, splashes bouncing.
    await hooks(page, 'setSky', 'rain');
    await hooks(page, 'soak');
    await follow(page, 0.5, 2.6, 5, 0.5, 1800, 0.45);
    await page.screenshot({ path: out('47-puddles-and-ripples') });
  });

  test('town life: teenagers outside the shop, a bump on Main Road', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    await hooks(page, 'newGame', 8, 'main', 'Lively', { tutorial: false });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'setSky', 'fair');
    await hooks(page, 'setSpeed', 0);
    await hooks(page, 'setTime', 335);
    type Life = { hangouts: { x: number; z: number }[]; bumps: { x: number; z: number }[] };
    let life: Life | null = null;
    // Run the afternoon until a group is hanging about (a bump is staged below if none has come round).
    for (let i = 0; i < 400 && !life?.hangouts.length; i++) {
      await hooks(page, 'advanceNoScan', 5);
      life = await page.evaluate(() => { const s = (window as unknown as { __shelf: { state: () => { time: number; life?: Life & { nextTeens: number; nextBump: number } } } }).__shelf.state(); if (s.time > 620) { s.time = 335; if (s.life) { s.life.nextTeens = 0; s.life.nextBump = 0; } } return s.life ?? null; });
    }
    expect(life?.hangouts.length).toBeGreaterThan(0);
    const h = life!.hangouts[0]!;
    await hooks(page, 'viewWorld', h.x, h.z, 0.6, 6, 1.0);
    await settle(page, 1800);
    await page.screenshot({ path: out('48-teens-hanging-about') });
    // A bump: when none has come round by itself, two cars on Main Road have one now.
    for (let i = 0; i < 30 && !life!.bumps.length; i++) {
      if (await hooks<boolean>(page, 'bump')) life = await page.evaluate(() => (window as unknown as { __shelf: { state: () => { life: Life } } }).__shelf.state().life);
      else await hooks(page, 'advanceNoScan', 3);
    }
    if (life!.bumps.length) {
      const b = life!.bumps[0]!;
      await hooks(page, 'viewWorld', b.x, b.z, 0.9, 7, 0.6);
      await settle(page, 1800);
      await page.screenshot({ path: out('49-fender-bender') });
    }
  });

  test('the business profile: the listing, reviews with the photos shoppers took, what shoppers notice', async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page);
    await hooks(page, 'newGame', 12, 'main', 'Corner Fresh', { tutorial: false });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'setSpeed', 0);
    // Dressed up a little: plants by the door and along the aisle, an aisle sign, baskets.
    for (const [t, x, z] of [['plant', -2.5, -1], ['plant', 1.5, -6], ['sign', -2.5, -4], ['basketStack', -2.5, -2], ['plant', -0.5, -6]] as const) {
      await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType: t, x, z, rot: 0 });
    }
    await hooks(page, 'playDays', 3);
    await hooks(page, 'dispatch', { type: 'openTomorrow' });
    await hooks(page, 'setTime', 260);
    await hooks(page, 'restock');
    await hooks(page, 'crowd', 4);
    await hooks(page, 'advanceScan', 20, 6);
    await follow(page, 0.5, 2.6, 13, Math.PI, 1500);
    await page.locator('.hud-time [data-card="reviews"]').click();
    const card = page.getByRole('dialog', { name: 'Business Profile' });
    // Develop the photos: the covers, then the reviews' (a frame each).
    await expect.poll(async () => {
      const l = await hooks<{ photos: number; developed: number }>(page, 'listing');
      return l.developed >= Math.min(l.photos, 14);
    }, { timeout: 200_000, intervals: [1500] }).toBe(true);
    await settle(page, 1200);
    await page.screenshot({ path: out('50-business-profile') });
    await card.getByRole('tab', { name: 'Reviews' }).click();
    await card.locator('.biz-scroll').evaluate((e) => { e.scrollTop = 330; });
    await settle(page, 1000);
    await page.screenshot({ path: out('51-reviews') });
    await card.getByRole('tab', { name: 'Photos' }).click();
    await settle(page, 1000);
    await page.screenshot({ path: out('52-customer-photos') });
    const selfie = card.locator('.biz-grid button[aria-label^="A selfie"]').first();
    if (await selfie.count()) { await selfie.click(); await settle(page, 800); await page.screenshot({ path: out('53-photo-selfie') }); await page.locator('.biz-lightbox').click(); }
    await card.getByRole('tab', { name: 'Performance' }).click();
    await settle(page, 800);
    await page.screenshot({ path: out('54-profile-performance') });
  });

  test('fitting out: the Build card, furniture, walls and lights, a wooden floor, windows, lamps after dark', async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    await hooks(page, 'newGame', 5, 'main', 'Corner Fresh', { tutorial: false });
    await hooks(page, 'setSpeed', 0);
    await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 50000; });
    await hooks(page, 'dispatch', { type: 'expandShop', sizeId: 'medium' });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'setTime', 300);
    const put: [string, number, number, number][] = [
      ['cafe', -3.5, -2, 0], ['sofa', -3.5, -3, 1], ['desk', 2.5, -2, 3], ['trolleys', -1.5, -1, 0], ['bin', 1.5, -1, 0], ['speaker', -3.5, -4, 1], ['screen', -3.5, -5, 1], ['bookcase', 2.5, -6, 2],
      ['flowers', 2.5, -3, 0], ['rug', -1.5, -3, 0], ['doormat', -0.5, -1, 0], ['plant', -3.5, -1, 0],
      ['wall', 0.5, -5, 1], ['wallWindow', 0.5, -4, 1], ['doorway', 0.5, -3, 1], ['railing', -1.5, -5, 0], ['gate', -0.5, -5, 0],
      ['floorLamp', 2.5, -4, 0], ['wallLight', -3.5, -6, 1], ['pendant', -1.5, -4, 0], ['neon', 2.5, -5, 3],
    ];
    for (const [fixtureType, x, z, rot] of put) await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType, x, z, rot });
    await hooks(page, 'dispatch', { type: 'setFloor', style: 'wood' });
    // Windows down the left wall: each wall there swapped for a wall with a window.
    await page.evaluate(() => {
      const h = (window as unknown as { __shelf: { state: () => { shop: { fixtures: { id: number; type: string; x: number; z: number; rot: number }[] } }; dispatch: (c: unknown) => unknown } }).__shelf;
      for (const z of [-7, -5, -4, -3, -2, -1]) {
        const w = h.state().shop.fixtures.find((f) => f.type === 'wall' && f.x === -3.5 && f.z === z && f.rot === 1);
        if (w) h.dispatch({ type: 'removeFixture', fixtureId: w.id });
        h.dispatch({ type: 'placeFixture', fixtureType: 'wallWindow', x: -3.5, z, rot: 1 });
      }
    });
    await follow(page, 0, -3.5, 10, 0, 2000);
    await page.keyboard.press('KeyB');
    await page.locator('.card.t-build').getByRole('tab', { name: 'Furniture' }).click();
    await settle(page, 1500);
    await page.screenshot({ path: out('55-build-card') });
    await page.keyboard.press('Escape');
    await follow(page, 0, -3.5, 15, 0.35, 2500);
    await page.screenshot({ path: out('56-fitted-out') });
    await hooks(page, 'setTime', 712);
    await follow(page, 0, -3.5, 10, 0, 2500);
    await page.screenshot({ path: out('57-lamps-after-dark') });
  });

  test('building up: stairs, an escalator and a lift, shoppers on the first floor, the building three storeys tall', async ({ page }) => {
    test.setTimeout(300_000);
    const UP = -16;
    await ready(page);
    await hooks(page, 'newGame', 7, 'main', 'Tall Order', { tutorial: false });
    await hooks(page, 'setSpeed', 0);
    await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 50000; });
    await hooks(page, 'quickSetup', true);
    const put: [string, number, number, number][] = [
      ['stairs', 0.5, -2, 0], ['elevator', -2.5, -2, 1],
      ['shelf', -2.5, -4 + UP, 1], ['shelf', -2.5, -3 + UP, 1], ['fridge', 1.5, -6 + UP, 3], ['register', 1.5, -2 + UP, 2], ['plant', -1.5, -6 + UP, 0], ['pendant', -1.5, -5 + UP, 0],
      ['escalator', -0.5, -2 + UP, 0], ['produce', 1.5, -5 + 2 * UP, 3], ['produce', 1.5, -4 + 2 * UP, 3],
    ];
    for (const [fixtureType, x, z, rot] of put) await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType, x, z, rot });
    // A double-height corner by the pallet: the panel over it sold, a lamp hung high.
    await hooks(page, 'dispatch', { type: 'removePanel', x: -2.5, z: -5 });
    await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType: 'pendant', x: -2.5, z: -5, rot: 0 });
    await page.evaluate(() => {
      const s = (window as unknown as { __shelf: { state: () => { shop: { fixtures: { z: number; type: string; slots: { productId: string | null; qty: number }[] }[] } } } }).__shelf.state();
      const goods: Record<string, string[]> = { shelf: ['pasta', 'cereal', 'cookies', 'beans'], fridge: ['milk', 'cheese', 'juice', 'cola'], produce: ['apples', 'bananas'] };
      for (const f of s.shop.fixtures) if (f.z < -12 && goods[f.type]) f.slots = f.slots.map((_, i) => ({ productId: goods[f.type]![i % goods[f.type]!.length]!, qty: 8 }));
    });
    await hooks(page, 'crowd', 8);
    await hooks(page, 'advance', 45);
    await follow(page, -1, -2.5 + UP, 12, 0.5, 2000);
    await page.screenshot({ path: out('58-upstairs') });
    await follow(page, 3, 2, 24, 0.6, 2000, 0.6);
    await page.screenshot({ path: out('59-three-storeys') });
  });

  test('design your manager in the lobby', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: /your manager/i }).click();
    const panel = page.getByRole('group', { name: 'Your manager' });
    await panel.getByRole('radio', { name: 'Girl 3' }).click();
    await panel.getByRole('radiogroup', { name: 'Top' }).getByRole('radio', { name: 'Purple' }).click();
    await panel.getByRole('radiogroup', { name: 'Hair' }).getByRole('radio', { name: 'Pink' }).click();
    await panel.getByRole('radiogroup', { name: 'Trousers' }).getByRole('radio', { name: 'Denim' }).click();
    await settle(page, 2500);
    await page.screenshot({ path: out('37-manager-designer') });
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
