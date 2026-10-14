import { test, expect, type Page } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

type Fx = { id: number; type: string; x: number; z: number; slots: { productId: string | null; qty: number }[]; serving?: number | null; scanned?: number };
type S = { phase: string; cash: number; shop: { fixtures: Fx[]; storage: { productId: string; qty: number }[] }; orders: { state: string }[]; people: { kind: string; carrying?: { productId: string; qty: number } | null }[]; today: { served: number } };

const state = (page: Page) => hooks<S>(page, 'state');
const EYE = 0.6 * 1.04;

/** Stand at (x, z) in the shop and look at a point (shop-relative), the way a player turns the mouse. */
async function lookAt(page: Page, from: [number, number], to: [number, number, number]): Promise<void> {
  const dx = to[0] - from[0], dz = to[2] - from[1];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(to[1] - EYE, Math.hypot(dx, dz));
  await hooks(page, 'fp', from[0], from[1], yaw, pitch);
  // A couple of frames so the crosshair (and the build ghost) catch up.
  await page.waitForFunction(() => (window as unknown as { __shelf: { aim: () => unknown } }).__shelf.aim() !== null, null, { timeout: 15_000 }).catch(() => {});
  await settle(page, 350);
}

test('the first day in person: build, stock, open, scan, close up', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 5, 'main', 'E2E Mart', { tutorial: true });
  await hooks(page, 'setSpeed', 0);
  await expect(page.locator('.tip')).toContainText(/empty shell/i);
  await expect(page.getByRole('button', { name: /open shop/i })).toBeVisible();
  // Opening with nothing inside is refused.
  await page.getByRole('button', { name: /open shop/i }).click();
  await expect(page.locator('.toast')).toContainText(/checkout counter/i);

  // B opens Build; place a counter by the door with E, turned to face into the shop (two R presses).
  await page.keyboard.press('KeyB');
  await expect(page.locator('.card')).toBeVisible();
  // (The card scrolls; a dispatched click is what a tap on the button does.)
  await page.locator('.card .item', { hasText: 'Checkout counter' }).getByRole('button', { name: 'Place' }).dispatchEvent('click');
  await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
  await lookAt(page, [0.6, -1.0], [2.0, 0, -2.5]);
  await expect.poll(async () => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '').toMatch(/place checkout counter/i);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'register').length).toBe(1);
  // A shelf against the west wall, facing east.
  await page.locator('.card .item', { hasText: /^Shelf/ }).getByRole('button', { name: 'Place' }).dispatchEvent('click');
  await page.keyboard.press('KeyR');
  await lookAt(page, [-0.6, -2.4], [-2.0, 0, -3.5]);
  await expect.poll(async () => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '').toMatch(/place shelf/i);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'shelf').length).toBe(1);
  await page.keyboard.press('Escape');
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

  // Pick up a box at the pallet, carry it to the shelf, stock it.
  await lookAt(page, [-1.5, -4.2], [-1.5, 0.3, -5.5]);
  await expect.poll(async () => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '').toMatch(/pick up bread/i);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).people.find((p) => p.kind === 'owner')?.carrying?.productId ?? null).toBe('bread');
  await lookAt(page, [-1.0, -3.5], [-2.0, 0.4, -3.5]);
  await expect.poll(async () => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '').toMatch(/stock bread/i);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!.slots.some((s) => s.productId === 'bread' && s.qty > 0)).toBe(true);

  // Open the doors.
  await page.getByRole('button', { name: /open shop/i }).click();
  await expect.poll(async () => (await state(page)).phase).toBe('open');

  // Step behind the counter and scan with Space when somebody is waiting.
  await lookAt(page, [2.0, -1.5], [2.0, 0.2, -2.5]);
  await expect.poll(async () => (await hooks<{ text: string } | null>(page, 'aim'))?.text ?? '').toMatch(/scan item|nobody waiting/i);
  let waiting = false;
  for (let i = 0; i < 30 && !waiting; i++) {
    await hooks(page, 'advanceNoScan', 6);
    await hooks(page, 'fp', 2.0, -1.5);
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

test('lobby: the manager logo, a live shop behind the menu, and a new game reaches the plot picker', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.lobby .head')).toBeVisible();
  await expect(page.locator('.lobby.live')).toBeVisible();
  const logo = await page.locator('.lobby .head').evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(logo).toBeGreaterThan(100);
  await page.getByRole('button', { name: /new shop/i }).click();
  await page.getByRole('button', { name: /pick a plot/i }).click();
  await expect(page.getByRole('dialog', { name: /pick a plot/i })).toBeVisible();
});
