import { test, expect, type Page } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

type Fx = { id: number; type: string; x: number; z: number; slots: { productId: string | null; qty: number }[]; serving?: number | null; scanned?: number };
type S = { phase: string; cash: number; shop: { fixtures: Fx[]; storage: { productId: string; qty: number }[]; delivery: { x0: number; z0: number; x1: number; z1: number } }; orders: { state: string }[]; people: { kind: string; carrying?: { productId: string; qty: number } | null }[]; today: { served: number } };
type Pt = { x: number; y: number; visible: boolean };

const state = (page: Page) => hooks<S>(page, 'state');
const aimText = async (page: Page) => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '';
const owner = (page: Page) => hooks<{ x: number; z: number; walking: boolean }>(page, 'ownerLocal');

/** Where a shop-relative point is on screen, once the camera has stopped gliding; it has to be in view. */
async function screenAt(page: Page, x: number, z: number, y = 0): Promise<Pt> {
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  let last: Pt | null = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForFunction(() => (window as unknown as { __shelf: { cameraSettled: () => boolean } }).__shelf.cameraSettled(), null, { timeout: 20_000 });
    await frames(); await settle(page, 200);
    const p = await hooks<Pt>(page, 'screenAt', x, z, y);
    // Panels come and go (the jobs list, a card), and the camera slides to keep the manager in view: wait for it to stay put.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) { expect(p.visible, `(${x}, ${z}) on screen`).toBe(true); return p; }
    last = p;
  }
  throw new Error(`the camera never settled over (${x}, ${z})`);
}

/** Move the real mouse over a shop-relative point, and give the hover a few frames to catch up. */
async function pointAt(page: Page, x: number, z: number, y = 0): Promise<Pt> {
  const p = await screenAt(page, x, z, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await settle(page, 300);
  return p;
}

async function clickAt(page: Page, x: number, z: number, y = 0): Promise<void> {
  const p = await pointAt(page, x, z, y);
  await page.mouse.click(p.x, p.y);
}

test('the first day with the follow camera: build, walk, stock, open, scan, close up', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 5, 'main', 'E2E Mart', { tutorial: true });
  await hooks(page, 'setSpeed', 0);
  await expect(page.locator('.tip.coach')).toContainText(/checkout counter/i);
  await expect(page.getByRole('button', { name: /open shop/i })).toBeVisible();
  // Opening with nothing inside is refused.
  await page.getByRole('button', { name: /open shop/i }).click();
  await expect(page.locator('.toast')).toContainText(/checkout counter/i);

  // B opens Build. The ghost follows the mouse; a click places it. A counter by the door, turned to face in (two R presses).
  await hooks(page, 'fp', 0.5, -2.0);
  await page.keyboard.press('KeyB');
  await expect(page.locator('.card')).toBeVisible();
  await settle(page, 500);
  // (The card scrolls; a dispatched click is what a tap on the button does.)
  await page.locator('.card .item', { hasText: 'Checkout counter' }).getByRole('button', { name: 'Place' }).dispatchEvent('click');
  await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
  await pointAt(page, 2.0, -2.5);
  await expect.poll(() => aimText(page)).toMatch(/place checkout counter/i);
  await clickAt(page, 2.0, -2.5);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'register').length).toBe(1);
  // A shelf against the west wall, facing east.
  await page.locator('.card .item', { hasText: /^Shelf/ }).getByRole('button', { name: 'Place' }).dispatchEvent('click');
  await page.keyboard.press('KeyR');
  await pointAt(page, -2.0, -3.5);
  await expect.poll(() => aimText(page)).toMatch(/place shelf/i);
  await clickAt(page, -2.0, -3.5);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'shelf').length).toBe(1);
  // A plain right click stops placing; Esc closes the card.
  const rc = await screenAt(page, 0.5, -1.0);
  await page.mouse.click(rc.x, rc.y, { button: 'right' });
  await expect(page.locator('.card')).not.toContainText(/placing shelf/i);
  await page.keyboard.press('Escape');
  await expect(page.locator('.card')).toHaveCount(0);

  // Tab opens Stock: order bread and wait for the truck (the clock stands still while you set up).
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: /more bread/i }).click();
  await page.getByRole('button', { name: /place order/i }).click();
  expect((await state(page)).orders.length).toBe(1);
  await page.keyboard.press('Escape');
  await hooks(page, 'advanceNoScan', 70);
  await expect.poll(async () => (await state(page)).shop.storage.reduce((a, e) => a + e.qty, 0)).toBeGreaterThan(0);

  // Walk to the pallet: click the floor just in front of it, then F picks a box up.
  await hooks(page, 'setSpeed', 1);
  await hooks(page, 'fp', 0.5, -2.0);
  await settle(page, 400);
  const d = (await state(page)).shop.delivery;
  const px = (d.x0 + d.x1) / 2, pz = d.z1 + 0.45;
  await clickAt(page, px, pz);
  await expect.poll(async () => { const o = await owner(page); return Math.hypot(o.x - px, o.z - pz); }, { timeout: 20_000 }).toBeLessThan(0.5);
  await expect.poll(async () => (await owner(page)).walking, { timeout: 10_000 }).toBe(false);
  // Face the pallet squarely (walking up to it usually leaves you facing it anyway).
  await hooks(page, 'aimAt', px, pz, px, 0, (d.z0 + d.z1) / 2);
  await expect.poll(() => aimText(page)).toMatch(/pick up bread/i);
  await expect(page.locator('.aim-prompt')).toContainText(/F/);
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await state(page)).people.find((p) => p.kind === 'owner')?.carrying?.productId ?? null).toBe('bread');

  // Click the shelf: the manager carries the box over and stocks it.
  const shelf = (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
  await clickAt(page, shelf.x + 0.5, shelf.z + 0.5, 0.6);
  await expect.poll(async () => (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!.slots.some((s) => s.productId === 'bread' && s.qty > 0), { timeout: 20_000 }).toBe(true);

  // Open the doors.
  await page.getByRole('button', { name: /open shop/i }).click();
  await expect.poll(async () => (await state(page)).phase).toBe('open');

  // Click the counter: the manager walks round behind it. Space scans when somebody is waiting.
  await hooks(page, 'setSpeed', 0);
  const reg = (await state(page)).shop.fixtures.find((f) => f.type === 'register')!;
  await hooks(page, 'setSpeed', 1);
  await clickAt(page, reg.x + 0.5, reg.z + 0.5, 0.8);
  await expect.poll(() => aimText(page), { timeout: 20_000 }).toMatch(/scan item|nobody waiting/i);
  await hooks(page, 'setSpeed', 0);
  let waiting = false;
  for (let i = 0; i < 30 && !waiting; i++) {
    await hooks(page, 'advanceNoScan', 6);
    waiting = (await state(page)).shop.fixtures.some((f) => f.type === 'register' && f.serving !== null && f.serving !== undefined);
  }
  expect(waiting).toBe(true);
  // One scan rings up an item; a one-item basket is paid for straight away.
  const progress = async () => { const st = await state(page); return st.today.served * 100 + (st.shop.fixtures.find((f) => f.type === 'register')!.scanned ?? 0); };
  const before = await progress();
  await page.keyboard.press('Space');
  await expect.poll(progress).toBeGreaterThan(before);

  // Run the rest of the day and close up.
  await hooks(page, 'advance', 900);
  await expect(page.getByText(/day 1 done/i)).toBeVisible({ timeout: 15_000 });
  expect((await state(page)).today.served).toBeGreaterThan(0);
  await page.getByRole('button', { name: /open tomorrow/i }).click();
  await expect(page.locator('.clock')).toContainText('Day 2');

  // Back to the lobby: the autosave is the Continue button.
  await page.getByRole('button', { name: /settings/i }).click();
  await page.getByRole('button', { name: /save & quit/i }).click();
  await expect(page.getByRole('button', { name: /continue/i })).toContainText(/E2E Mart/);
});

test('the camera zooms from the shelves out to the crossroads, turns in steps, and comes back with C', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 6, 'main', 'Zoom Mart', { tutorial: false });
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'fp', 0.5, -2.0);
  const cam = () => page.evaluate(() => { const f = (window as unknown as { __shelf: { runtime: { renderer: { follow: { goalDistance: number; goalYaw: number; following: boolean } } } } }).__shelf.runtime.renderer.follow; return { d: f.goalDistance, yaw: f.goalYaw, following: f.following }; });
  const start = await cam();
  expect(start.following).toBe(true);
  // The wheel zooms out; far enough out the camera lets go of the manager.
  const mid = await screenAt(page, 0.5, -2.0);
  await page.mouse.move(mid.x, mid.y);
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await cam()).d).toBeGreaterThan(40);
  expect((await cam()).following).toBe(false);
  // E turns a 45° step.
  await page.keyboard.press('KeyE');
  await expect.poll(async () => Math.abs((await cam()).yaw - start.yaw)).toBeCloseTo(Math.PI / 4, 3);
  // C brings it back to the manager at the default distance.
  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await cam()).following).toBe(true);
  expect((await cam()).d).toBeLessThan(20);
});

test('click a customer: the panel says who they are and why they came; Follow tracks them; Esc lets go', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 12, 'main', 'Nosy Mart', { tutorial: false });
  await hooks(page, 'quickSetup', true);
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'crowd', 6, true);
  await hooks(page, 'advance', 35);
  await hooks(page, 'fp', 0.5, -0.6, 0, 0.95, 15);
  await page.waitForFunction(() => (window as unknown as { __shelf: { cameraSettled: () => boolean } }).__shelf.cameraSettled(), null, { timeout: 20_000 });
  await settle(page, 400);
  // A customer in the shop, well apart from everyone else on screen, so the click can only mean them.
  const pick = await page.evaluate(() => {
    const h = (window as unknown as { __shelf: { state: () => { people: { id: number; kind: string; state: string }[] }; personScreen: (id: number) => { x: number; y: number; visible: boolean } | null } }).__shelf;
    const all = h.state().people.filter((p) => p.state !== 'driving' && p.state !== 'inRival').map((p) => ({ ...p, at: h.personScreen(p.id) }));
    const W = window.innerWidth, H = window.innerHeight;
    const ok = all.filter((p) => p.kind === 'customer' && p.at?.visible && p.at.x > 80 && p.at.x < W - 360 && p.at.y > 120 && p.at.y < H - 160);
    let best: { id: number; x: number; y: number; gap: number } | null = null;
    for (const p of ok) {
      const gap = Math.min(999, ...all.filter((q) => q.id !== p.id && q.at?.visible).map((q) => Math.hypot(q.at!.x - p.at!.x, q.at!.y - p.at!.y)));
      if (!best || gap > best.gap) best = { id: p.id, x: p.at!.x, y: p.at!.y, gap };
    }
    return best;
  });
  expect(pick, 'a customer on screen').not.toBeNull();
  expect(pick!.gap).toBeGreaterThan(30);
  await page.mouse.click(pick!.x, pick!.y);
  const panel = page.getByTestId('inspect');
  await expect(panel).toBeVisible();
  expect((await hooks<{ id: number }>(page, 'inspect')).id).toBe(pick!.id);
  // Who they are, what kind of shopper, how they feel, their list, and why they came here (two reasons in plain words).
  await expect(panel.locator('.name')).toHaveText(/^\w+ \w+$/);
  await expect(panel.locator('.sub')).toHaveText(/hunters|shoppers|loyalists|buyers/);
  await expect(panel.locator('.mood-word')).toHaveText(/Happy|Fine|Annoyed/);
  await expect(panel.locator('.inspect-list li').first()).toBeVisible();
  await expect(panel.locator('.why-label')).toHaveText('Came here because…');
  await expect(panel.locator('.inspect-why li')).toHaveCount(2);
  expect(await panel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  // Follow: the camera leaves the manager and settles over them.
  await panel.getByRole('button', { name: 'Follow' }).click();
  expect(await hooks(page, 'followId')).toBe(pick!.id);
  const gapToPerson = () => page.evaluate((id) => {
    const h = (window as unknown as { __shelf: { state: () => { people: { id: number; x: number; z: number }[] }; cameraTarget: () => { x: number; z: number } } }).__shelf;
    const p = h.state().people.find((q) => q.id === id)!; const c = h.cameraTarget();
    return Math.hypot(p.x - c.x, p.z - c.z);
  }, pick!.id);
  await expect.poll(gapToPerson, { timeout: 20_000 }).toBeLessThan(0.3);
  await expect(panel.getByRole('button', { name: 'Stop following' })).toBeVisible();
  // Esc: the panel closes, the outline goes, and the camera comes back to the manager.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(await hooks(page, 'followId')).toBeNull();
  const gapToOwner = () => page.evaluate(() => {
    const h = (window as unknown as { __shelf: { ownerPos: () => { x: number; z: number }; cameraTarget: () => { x: number; z: number } } }).__shelf;
    const o = h.ownerPos(), c = h.cameraTarget();
    return Math.hypot(o.x - c.x, o.z - c.z);
  });
  await expect.poll(gapToOwner, { timeout: 20_000 }).toBeLessThan(0.3);
});

test('design your manager in the lobby: the shopkeeper out front changes as you click, and every game wears it', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /your manager/i }).click();
  const panel = page.getByRole('group', { name: 'Your manager' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.char-grid img').first()).toBeVisible();
  // A guy or a girl first, then one of six of them.
  await panel.getByRole('radiogroup', { name: 'Guy or girl' }).getByRole('radio', { name: 'Guy' }).click();
  await expect(panel.getByRole('radio', { name: 'Girl 1' })).toHaveCount(0);
  await panel.getByRole('radio', { name: 'Guy 2' }).click();
  await panel.getByRole('radiogroup', { name: 'Top' }).getByRole('radio', { name: 'Purple' }).click();
  await panel.getByRole('radiogroup', { name: 'Hair' }).getByRole('radio', { name: 'Ginger' }).click();
  await panel.getByRole('radiogroup', { name: 'Height' }).getByRole('radio', { name: 'Taller' }).click();
  // "Own" puts the hair back.
  await panel.getByRole('radiogroup', { name: 'Hair' }).getByRole('radio', { name: 'Own', exact: true }).click();
  // The lobby's shopkeeper wears it straight away.
  const lobbyLook = () => page.evaluate(() => (window as unknown as { __shelf: { runtime: { lobbyState: { people: { kind: string; look: Record<string, unknown> }[] } | null } } }).__shelf.runtime.lobbyState?.people.find((p) => p.kind === 'owner')?.look ?? {});
  expect(await lobbyLook()).toMatchObject({ model: 3, top: '#7E57C2', height: 1.1 });
  expect((await lobbyLook()).hair).toBeUndefined();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel).toHaveCount(0);
  // A new shop's manager wears the design, and so does one after a reload (it is kept with your settings).
  const look = () => page.evaluate(() => (window as unknown as { __shelf: { state: () => { people: { kind: string; look: Record<string, unknown> }[] } | null } }).__shelf.state()?.people.find((p) => p.kind === 'owner')?.look ?? {});
  await hooks(page, 'newGame', 14, 'main', 'Looks Mart', { tutorial: false });
  expect(await look()).toMatchObject({ model: 3, top: '#7E57C2', height: 1.1 });
  await hooks(page, 'quickSetup', true);
  await hooks(page, 'setSpeed', 0);
  // Leave mid-morning: the page saves on its way out, and Continue brings the same shop back.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await settle(page, 800);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __shelf?: { ready: () => boolean } }).__shelf?.ready() === true, null, { timeout: 90_000 });
  const cont = page.getByRole('button', { name: /continue/i });
  await expect(cont).toContainText(/Looks Mart/);
  await cont.click();
  await expect.poll(async () => (await look()).top).toBe('#7E57C2');
  expect((await look()).model).toBe(3);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap the floor to walk there, tap a shelf to see its stock', async ({ page }) => {
    await ready(page);
    await hooks(page, 'newGame', 8, 'main', 'Pocket Mart', { tutorial: false });
    await hooks(page, 'quickSetup', false);
    await hooks(page, 'setSpeed', 1);
    await hooks(page, 'fp', 0.5, -1.0);
    await settle(page, 600);
    const to = { x: -0.5, z: -2.5 };
    const p = await screenAt(page, to.x, to.z);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => { const o = await owner(page); return Math.hypot(o.x - to.x, o.z - to.z); }, { timeout: 20_000 }).toBeLessThan(0.6);
    // Tapping a shelf empty-handed opens the Stock card at what goes on it, with the products' pictures;
    // the manager stays put.
    const shelf = (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
    const before = await owner(page);
    const q = await screenAt(page, shelf.x + 0.5, shelf.z + 0.5, 0.6);
    await page.touchscreen.tap(q.x, q.y);
    await expect(page.locator('.card img.product-pic').first()).toBeVisible();
    const after = await owner(page);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.3);
  });

  test('tap a customer to see who they are: the panel docks above the tool shelf', async ({ page }) => {
    await ready(page);
    await hooks(page, 'newGame', 12, 'main', 'Pocket Nosy', { tutorial: false });
    await hooks(page, 'quickSetup', true);
    await hooks(page, 'setSpeed', 0);
    await hooks(page, 'crowd', 6, true);
    await hooks(page, 'advance', 35);
    // The phone's view is narrow: look straight at one of them.
    type Q = { people: { id: number; kind: string; state: string; x: number; z: number }[] };
    const c = (await hooks<Q>(page, 'state')).people.find((p) => p.kind === 'customer' && p.state !== 'driving')!;
    await hooks(page, 'viewWorld', c.x, c.z, 0, 12, 0.95);
    // Wait until they stop moving on screen (the camera keeps sliding a moment after it says it has settled).
    let at = { x: 0, y: 0, visible: false };
    for (let i = 0, last = { x: -1, y: -1 }; i < 60; i++) {
      await page.waitForFunction(() => (window as unknown as { __shelf: { cameraSettled: () => boolean } }).__shelf.cameraSettled(), null, { timeout: 20_000 });
      await settle(page, 250);
      at = await hooks<{ x: number; y: number; visible: boolean }>(page, 'personScreen', c.id);
      if (Math.hypot(at.x - last.x, at.y - last.y) < 0.5) break;
      last = at;
    }
    expect(at.visible, 'the customer on screen').toBe(true);
    await page.touchscreen.tap(at.x, at.y);
    const panel = page.getByTestId('inspect');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/docked/);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // Big enough to hit with a thumb.
    const close = (await panel.getByRole('button', { name: 'Close' }).boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(40);
    await panel.getByRole('button', { name: 'Close' }).tap();
    await expect(panel).toHaveCount(0);
  });
});

test('lobby: the shop-front logo, a live shop behind the menu, and a new game reaches the plot picker', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Shelf Made' })).toBeVisible();
  await expect(page.locator('.lobby.live')).toBeVisible();
  const logo = await page.locator('.lobby .logo-hero img').evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(logo).toBeGreaterThan(100);
  // The favicon and the top-bar mark are the same shop front.
  expect(await page.locator('link[rel="icon"]').first().getAttribute('href')).toBe('/brand/logo-small.svg');
  await page.getByRole('button', { name: /new shop/i }).click();
  await page.getByRole('button', { name: /pick a plot/i }).click();
  await expect(page.getByRole('dialog', { name: /pick a plot/i })).toBeVisible();
});
