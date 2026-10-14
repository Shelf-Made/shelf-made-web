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
  await expect(page.locator('.tip')).toContainText(/empty shell/i);
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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap the floor to walk there, tap a shelf to use it', async ({ page }) => {
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
    // Tapping a shelf walks over to it and tells you what is on it.
    const shelf = (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
    const q = await screenAt(page, shelf.x + 0.5, shelf.z + 0.5, 0.6);
    await page.touchscreen.tap(q.x, q.y);
    await expect.poll(async () => { const o = await owner(page); return Math.hypot(o.x - shelf.x - 0.5, o.z - shelf.z - 0.5); }, { timeout: 20_000 }).toBeLessThan(1.3);
    await expect(page.locator('.toast')).toContainText(/shelf/i);
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
