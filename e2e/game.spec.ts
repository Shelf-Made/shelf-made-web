import { test, expect, type Page } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

type Fx = { id: number; type: string; x: number; z: number; rot?: number; slots: { productId: string | null; qty: number }[]; serving?: number | null; scanned?: number };
type S = { phase: string; cash: number; shop: { fixtures: Fx[]; storage: { productId: string; qty: number }[]; delivery: { x0: number; z0: number; x1: number; z1: number }; litter: { id: number }[] }; orders: { state: string }[]; people: { kind: string; carrying?: { productId: string; qty: number } | null }[]; today: { served: number } };
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
  // The longest journey in the suite (a whole first day in a software-rendered browser).
  test.setTimeout(240_000);
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
  const build = page.locator('.card.t-build');
  await build.getByRole('tab', { name: 'Tills' }).dispatchEvent('click');
  await build.getByRole('button', { name: /^Checkout counter/ }).dispatchEvent('click');
  await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR');
  await pointAt(page, 2.0, -2.5);
  await expect.poll(() => aimText(page)).toMatch(/place checkout counter/i);
  await clickAt(page, 2.0, -2.5);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'register').length).toBe(1);
  // A shelf against the west wall, facing east.
  await build.getByRole('tab', { name: 'Shelves' }).dispatchEvent('click');
  await build.getByRole('button', { name: /^Shelf\b/ }).dispatchEvent('click');
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

  // Click the counter: its menu offers Serve here; the manager walks round behind it. Space scans when somebody is waiting.
  await hooks(page, 'setSpeed', 0);
  const reg = (await state(page)).shop.fixtures.find((f) => f.type === 'register')!;
  await hooks(page, 'setSpeed', 1);
  await clickAt(page, reg.x + 0.5, reg.z + 0.5, 0.4);
  await page.getByRole('menuitem', { name: /serve here/i }).click();
  // The walk round runs on the sim, not the clock: a slow runner draws few frames a second.
  await hooks(page, 'setSpeed', 0);
  for (let i = 0; i < 40 && !/scan item|nobody waiting/i.test(await aimText(page)); i++) await hooks(page, 'advanceNoScan', 0.5);
  await expect.poll(() => aimText(page)).toMatch(/scan item|nobody waiting/i);
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

test('click a piece of furniture with empty hands to move it, turn it or sell it', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 6, 'main', 'Movers', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'fp', 0.5, -1.0);
  const shelf = (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
  const stock = JSON.stringify(shelf.slots);
  // A click opens its menu: Stock, Move, Turn, Sell.
  await clickAt(page, shelf.x + 0.5, shelf.z + 0.5, 0.6);
  const menu = page.getByRole('menu', { name: 'Shelf' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Stock', 'Move', 'Turn', /^Sell \$\d+$/]);
  // Move: it follows the pointer and a click puts it down somewhere free (its stock goes with it).
  await menu.getByRole('menuitem', { name: 'Move' }).click();
  await expect(menu).toHaveCount(0);
  const taken = new Set((await state(page)).shop.fixtures.map((f) => `${f.x},${f.z}`));
  let to: { x: number; z: number } | null = null;
  for (const z of [-2, -3, -4]) for (const x of [-1.5, -0.5, 0.5, 1.5]) if (!to && !taken.has(`${x},${z}`) && Math.abs(x - shelf.x) + Math.abs(z - shelf.z) > 1) {
    await pointAt(page, x + 0.5, z + 0.5);
    if (/^move shelf/i.test(await aimText(page))) to = { x, z };
  }
  expect(to).not.toBeNull();
  await clickAt(page, to!.x + 0.5, to!.z + 0.5);
  await expect.poll(async () => { const f = (await state(page)).shop.fixtures.find((x) => x.id === shelf.id)!; return `${f.x},${f.z}`; }).toBe(`${to!.x},${to!.z}`);
  expect(JSON.stringify((await state(page)).shop.fixtures.find((x) => x.id === shelf.id)!.slots)).toBe(stock);
  // Turn: a quarter round where it stands.
  const rot = ((await state(page)).shop.fixtures.find((x) => x.id === shelf.id) as unknown as { rot: number }).rot;
  await clickAt(page, to!.x + 0.5, to!.z + 0.5, 0.6);
  await page.getByRole('menuitem', { name: 'Turn' }).click();
  await expect.poll(async () => ((await state(page)).shop.fixtures.find((x) => x.id === shelf.id) as unknown as { rot: number }).rot).not.toBe(rot);
  // Esc closes the menu; picking a piece up and pressing Esc puts it back where it was.
  await clickAt(page, to!.x + 0.5, to!.z + 0.5, 0.6);
  await page.getByRole('menuitem', { name: 'Move' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => aimText(page)).not.toMatch(/move shelf/i);
  const f = (await state(page)).shop.fixtures.find((x) => x.id === shelf.id)!;
  expect(`${f.x},${f.z}`).toBe(`${to!.x},${to!.z}`);
  // Sell: gone, for part of what it cost.
  const cash = (await state(page)).cash;
  await clickAt(page, to!.x + 0.5, to!.z + 0.5, 0.6);
  await page.getByRole('menuitem', { name: /^Sell/ }).click();
  await expect.poll(async () => (await state(page)).shop.fixtures.some((x) => x.id === shelf.id)).toBe(false);
  expect((await state(page)).cash).toBeGreaterThan(cash);
});

test("the day's log: closes and comes back, gives way to a card, says when Staff opens, and is kept in Stats", async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 8, 'main', 'Logbook', { tutorial: false });
  await hooks(page, 'quickSetup', true);
  await hooks(page, 'setSpeed', 0);
  // Shoppers gave up in the queue today: the fix is Staff, which opens on day 3.
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { today: { complaints: { queue: number } } } } }).__shelf.state().today.complaints.queue = 40; });
  await hooks(page, 'advance', 900);
  const log = page.getByRole('dialog', { name: 'Day summary' });
  await expect(log).toBeVisible({ timeout: 15_000 });
  const staff = log.getByRole('button', { name: /^staff/i });
  await expect(staff).toContainText('day 3');
  await staff.click();
  await expect(page.locator('.toast')).toContainText('Staff opens on day 3');
  await expect(page.locator('.card.t-staff')).toHaveCount(0);
  await expect(log).toBeVisible();
  // A card opened at night takes the log's place (nothing hides behind it); closing the card brings it back.
  await page.locator('.dock [data-card="stats"]').click();
  await expect(page.locator('.card.t-stats')).toBeVisible();
  await expect(log).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Day 1 log' })).toBeVisible();
  // Every day's log is kept in Stats.
  const row = page.getByRole('list', { name: 'Day logs' }).getByRole('button', { name: /day 1/i });
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.day-logs .log')).toContainText('Day 1:');
  await expect(page.locator('.day-logs .log')).toContainText('Waited too long');
  await page.keyboard.press('Escape');
  await expect(log).toBeVisible();
  // × closes it; the bar at the top brings it back; Esc closes it too; Open tomorrow works from the bar.
  await log.getByRole('button', { name: "Close the day's log" }).click();
  await expect(log).toHaveCount(0);
  await page.getByRole('button', { name: 'Day 1 log' }).click();
  await expect(log).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);
  await page.getByRole('button', { name: /open tomorrow/i }).click();
  await expect(page.locator('.clock')).toContainText('Day 2');
  await expect(page.getByRole('button', { name: 'Day 1 log' })).toHaveCount(0);
});

test('after a fast-forwarded day the manager walks at normal pace, and the shop can be fitted out at night', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 8, 'main', 'Night Shift', { tutorial: false });
  await hooks(page, 'quickSetup', true);
  // The day runs out at the fastest speed; the night puts the clock back to normal speed, and the manager's pace with it.
  await hooks(page, 'setSpeed', 4);
  await expect.poll(async () => (await hooks<{ timeScale: number }>(page, 'state')).timeScale).toBe(4);
  await hooks(page, 'advance', 900);
  await expect(page.getByRole('dialog', { name: 'Day summary' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await hooks<{ timeScale: number }>(page, 'state')).timeScale).toBe(1);
  await expect(page.getByRole('group', { name: 'Game speed' }).getByRole('button', { name: '1x speed' })).toHaveAttribute('aria-pressed', 'true');
  // Build at night: open Build, pick a shelf, and put it down on a free tile.
  await page.locator('.dock [data-card="build"]').click();
  await expect(page.locator('.card.t-build')).toBeVisible();
  await hooks(page, 'fp', 0.5, -1.0);
  const before = (await state(page)).shop.fixtures.length;
  await hooks(page, 'startPlacing', 'shelf');
  const taken = new Set((await state(page)).shop.fixtures.map((f) => `${f.x},${f.z}`));
  let placed = false;
  for (const z of [-2, -3, -4]) for (const x of [-1.5, -0.5, 0.5, 1.5]) if (!placed && !taken.has(`${x},${z}`)) {
    await pointAt(page, x + 0.5, z + 0.5);
    if (/^place shelf/i.test(await aimText(page))) { await clickAt(page, x + 0.5, z + 0.5); placed = true; }
  }
  expect(placed).toBe(true);
  await expect.poll(async () => (await state(page)).shop.fixtures.length).toBe(before + 1);
  expect((await state(page)).phase).toBe('night');
});

test('the Build card: tabs of pictures, a café table placed, a tile of floor laid, a window put in', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Fit Out', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 5000; });
  await hooks(page, 'fp', 0.5, -1.0);
  await page.keyboard.press('KeyB');
  const build = page.locator('.card.t-build');
  await expect(build).toBeVisible();
  await expect(build.getByRole('tab')).toHaveText(['Tills', 'Shelves', 'Furniture', 'Decor', 'Walls', 'Lights', 'Floors', 'Upstairs', 'Outside', 'Shop']);
  await build.getByRole('tab', { name: 'Furniture' }).click();
  const cafe = build.getByRole('button', { name: /^Café table/ });
  await expect(cafe.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await cafe.dispatchEvent('click');
  const before = (await state(page)).shop.fixtures.length;
  const taken = new Set((await state(page)).shop.fixtures.map((f) => `${f.x},${f.z}`));
  let placed = false;
  for (const z of [-2, -3]) for (const x of [-1.5, -0.5, 0.5]) if (!placed && !taken.has(`${x},${z}`)) {
    await pointAt(page, x + 0.5, z + 0.5);
    if (/^place café table/i.test(await aimText(page))) { await clickAt(page, x + 0.5, z + 0.5); placed = true; }
  }
  expect(placed).toBe(true);
  await expect.poll(async () => (await state(page)).shop.fixtures.length).toBe(before + 1);
  await page.keyboard.press('Escape');
  // Floors: wooden boards over the whole shop. Walls: a window in the left wall, turned to face in by itself.
  await build.getByRole('tab', { name: 'Floors' }).click();
  // A tile at a time: pick the finish, then click tiles.
  await build.locator('.item', { hasText: 'Wooden boards' }).getByRole('button', { name: 'Lay' }).click();
  await pointAt(page, -0.0, -1.5);
  await expect.poll(() => aimText(page)).toMatch(/^Lay wooden boards/i);
  await clickAt(page, 0.0, -1.5);
  await expect.poll(async () => (await hooks<{ shop: { tileStyles?: Record<string, string> } }>(page, 'state')).shop.tileStyles?.['-0.5,-2']).toBe('wood');
  await page.keyboard.press('Escape');
  await build.getByRole('tab', { name: 'Walls' }).click();
  await build.getByRole('button', { name: /^Window/ }).dispatchEvent('click');
  await pointAt(page, -2.0, -2.5);
  await expect.poll(() => aimText(page)).toMatch(/^Place Window/);
  await clickAt(page, -2.0, -2.5);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'window').map((f) => `${f.x},${f.z},${f.rot}`)).toEqual(['-2.5,-3,1']);
});

test('building up: stairs open the first floor, a shelf goes up there, and a ceiling panel comes down', async ({ page }) => {
  const UP = -16;
  test.setTimeout(300_000);
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Up We Go', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 20000; });
  await hooks(page, 'fp', -0.5, -1.0);
  await page.keyboard.press('KeyB');
  const build = page.locator('.card.t-build');
  await build.getByRole('tab', { name: 'Upstairs' }).click();
  // Only the ground floor so far: stairs beside the counter, coming up a tile behind it.
  await expect(build.getByRole('group', { name: 'Which floor' }).getByRole('button')).toHaveText(['Ground']);
  await build.getByRole('button', { name: /^Stairs/ }).dispatchEvent('click');
  await pointAt(page, 1.0, -1.5);
  // The price takes in the ceiling over the floor they open (30 panels at $25).
  await expect.poll(() => aimText(page)).toMatch(/^Place Stairs · \$1,200/);
  await clickAt(page, 1.0, -1.5);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'stairs').map((f) => `${f.x},${f.z}`)).toEqual(['0.5,-2']);
  await page.keyboard.press('Escape');
  // The first floor is open: build on it.
  await build.getByRole('group', { name: 'Which floor' }).getByRole('button', { name: '1st' }).click();
  await build.getByRole('tab', { name: 'Shelves' }).click();
  await build.getByRole('button', { name: /^Shelf/ }).dispatchEvent('click');
  await pointAt(page, -2.0, -3.5 + UP);
  await expect.poll(() => aimText(page)).toMatch(/^Place Shelf/);
  await clickAt(page, -2.0, -3.5 + UP);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'shelf' && f.z < -12).length).toBe(1);
  await page.keyboard.press('Escape');
  // A panel over the first floor taken down: sold, a double-height space above it.
  await build.getByRole('tab', { name: 'Upstairs' }).click();
  await build.locator('.item', { hasText: 'over the 1st floor' }).getByRole('button', { name: 'Take down' }).click();
  await pointAt(page, -1.0, -0.5 + UP);
  await expect.poll(() => aimText(page)).toMatch(/^Take the panel down/);
  await clickAt(page, -1.0, -0.5 + UP);
  await expect.poll(async () => (await hooks<{ shop: { ceilings: string[][] } }>(page, 'state')).shop.ceilings[1]!.includes('-1.5,-1')).toBe(false);
});

test('upstairs as it looks: nothing picked through the floor, the stairs ridden from an end, the lot built from any floor, no roof over a floor lifted off', async ({ page }) => {
  const UP = -16;
  test.setTimeout(300_000);
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Up We Go', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 20000; });
  expect((await hooks<{ ok: boolean }>(page, 'dispatch', { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 })).ok).toBe(true);
  // A wall on the ground floor, a storey tall: its top is flush with the first floor's boards.
  expect((await hooks<{ ok: boolean }>(page, 'dispatch', { type: 'placeFixture', fixtureType: 'wall', x: -0.5, z: -5, rot: 0 })).ok).toBe(true);
  // A shopper and a spill on the ground floor, under the first floor's boards.
  const shopper = await page.evaluate(() => {
    const h = (window as unknown as { __shelf: { crowd: (n: number) => void; state: () => { shop: { originX: number; originZ: number; flip?: boolean; litter: { id: number; x: number; z: number }[] }; people: { id: number; x: number; z: number; px: number; pz: number; path: unknown[]; state: string; timer: number }[] } } }).__shelf;
    const s = h.state(), f = s.shop.flip ? -1 : 1, at = (x: number, z: number) => ({ x: s.shop.originX + x * f, z: s.shop.originZ + z * f });
    h.crowd(1);
    const c = s.people[s.people.length - 1]!, w = at(-1.5, -3.5);
    c.x = c.px = w.x; c.z = c.pz = w.z; c.path = []; c.state = 'browsing'; c.timer = 999;
    s.shop.litter.push({ id: 9901, ...at(-1.5, -1.5) });
    return c.id;
  });
  // Upstairs over the ground floor's shelves: a click on the boards walks there, never picks the shelf under them.
  await hooks(page, 'fp', -0.5, -2.5 + UP);
  // Nor the wall, nor the delivery's boxes in the corner (as tall), down there.
  await pointAt(page, 0, -4.5 + UP);
  expect(await aimText(page)).not.toMatch(/wall/i);
  await pointAt(page, -1.5, -5.5 + UP);
  expect(await aimText(page)).not.toMatch(/delivery/i);
  await pointAt(page, -2.2, -3.2 + UP);
  expect(await aimText(page)).not.toMatch(/shelf/i);
  await clickAt(page, -2.2, -3.2 + UP);
  await expect(page.locator('.fixture-menu')).toHaveCount(0);
  await expect.poll(async () => (await owner(page)).walking).toBe(true);
  // Nor the spill or the shopper down there.
  await pointAt(page, -1.5, -1.5, 0.03);
  expect(await aimText(page)).not.toMatch(/spill/i);
  const seen = await hooks<Pt>(page, 'personScreen', shopper);
  await page.mouse.click(seen.x, seen.y);
  await settle(page, 300);
  expect(await hooks(page, 'inspect')).toBeNull();
  // Loaded with the manager up there, the camera starts over them, not out in their floor's region behind the shop.
  await hooks(page, 'fp', -0.5, -2.5 + UP);
  const off = await page.evaluate(() => {
    const h = (window as unknown as { __shelf: { runtime: { state: unknown; loadState: (s: unknown) => void }; state: () => { shop: { originX: number; originZ: number; flip?: boolean }; people: { kind: string; x: number; z: number }[] }; cameraTarget: () => { x: number; z: number } } }).__shelf;
    h.runtime.loadState(JSON.parse(JSON.stringify(h.runtime.state)));
    const s = h.state(), o = s.people.find((p) => p.kind === 'owner')!, t = h.cameraTarget(), f = s.shop.flip ? -1 : 1;
    return { dx: (t.x - o.x) * f, dz: (t.z - o.z) * f };
  });
  expect(off.dx).toBeCloseTo(0, 1);
  expect(off.dz).toBeCloseTo(-UP, 1);
  await hooks(page, 'setSpeed', 0);
  // Beside the flight the prompt says to go round to its foot; at the foot, up.
  await hooks(page, 'aimAt', -0.1, -2.0, 1.0, 0, -2.0);
  await expect.poll(() => aimText(page)).toBe('Walk round to the foot of the stairs');
  await hooks(page, 'aimAt', 1.0, -0.4, 1.0, 0, -2.0);
  await expect.poll(() => aimText(page)).toBe('Go up the stairs');
  // Their menu's Ride wears an icon of its own, not the till's.
  const useIcon = async (type: string) => {
    const id = (await state(page)).shop.fixtures.find((f) => f.type === type)!.id;
    await page.evaluate((id) => (window as unknown as { __shelf: { runtime: { openFixtureMenu: (id: number) => void } } }).__shelf.runtime.openFixtureMenu(id), id);
    await expect(page.locator('.fixture-menu')).toHaveCount(1);
    const use = page.locator('.fixture-menu .fm-btn.primary');
    return { text: await use.innerText(), icon: await use.locator('svg').innerHTML() };
  };
  const till = await useIcon('register'), ride = await useIcon('stairs');
  expect([till.text, ride.text]).toEqual(['Serve here', 'Ride']);
  expect(ride.icon).not.toBe(till.icon);
  await page.keyboard.press('Escape');
  await expect(page.locator('.fixture-menu')).toHaveCount(0);
  // A pendant hung in a double-height space: a storey up, under the high ceiling; its pool of light down on the floor.
  expect((await hooks<{ ok: boolean }>(page, 'dispatch', { type: 'removePanel', x: -1.5, z: -1 })).ok).toBe(true);
  expect((await hooks<{ ok: boolean }>(page, 'dispatch', { type: 'placeFixture', fixtureType: 'pendant', x: -1.5, z: -1, rot: 0 })).ok).toBe(true);
  const lampY = () => page.evaluate(() => {
    type Inst = { count: number; instanceMatrix: { array: ArrayLike<number> } };
    const st = (window as unknown as { __shelf: { runtime: { renderer: { store: { lampPools: Inst | null; glows: Map<string, Inst> } } } } }).__shelf.runtime.renderer.store;
    const ys = (m: Inst | null | undefined) => Array.from({ length: m?.count ?? 0 }, (_, i) => +m!.instanceMatrix.array[i * 16 + 13]!.toFixed(2));
    return { glow: ys(st.glows.get('pendant')), pool: ys(st.lampPools) };
  });
  await expect.poll(async () => (await lampY()).glow.length).toBe(1);
  const lamp = await lampY();
  expect(lamp.glow[0]).toBeCloseTo(1, 1);
  expect(lamp.pool).toHaveLength(1);
  expect(lamp.pool[0]).toBeLessThan(0.1);
  // Building on the first floor, a flower bed still goes out on the lot.
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 20000; });
  await hooks(page, 'fp', 1.5, -0.5 + UP);
  await page.keyboard.press('KeyB');
  const build = page.locator('.card.t-build');
  const floors = build.getByRole('group', { name: 'Which floor' });
  await expect(floors.getByRole('button', { name: '1st' })).toHaveAttribute('aria-pressed', 'true');
  await build.getByRole('tab', { name: 'Outside' }).click();
  await build.getByRole('button', { name: /^Flower bed/ }).dispatchEvent('click');
  await pointAt(page, 3.5, 2.0);
  await expect.poll(() => aimText(page)).toMatch(/^Place Flower bed/);
  await clickAt(page, 3.5, 2.0);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'flowerBed').map((f) => `${f.x},${f.z}`)).toEqual(['3,1.5']);
  await page.keyboard.press('Escape');
  // Selling tiles from the first floor works on the ground floor too, like adding them (not the corner right of the
  // door: past the stairs, the only way round behind the counter).
  await build.getByRole('tab', { name: 'Shop' }).click();
  await build.getByRole('button', { name: 'Sell tiles' }).click();
  await pointAt(page, -2.0, -0.5);
  await expect.poll(() => aimText(page)).toMatch(/^Sell this tile/);
  await page.keyboard.press('Escape');
  // From out front: the roof on; with the Build card on the ground floor, the first floor lifted off and no roof floating over it.
  const roof = () => page.evaluate(() => (window as unknown as { __shelf: { runtime: { renderer: { store: { roof: { visible: boolean } } } } } }).__shelf.runtime.renderer.store.roof.visible);
  await hooks(page, 'openCard', 'build');
  await expect(build).toHaveCount(0);
  await hooks(page, 'fp', 0.5, 2.5, 0, 0.9, 20);
  await expect.poll(roof).toBe(true);
  await hooks(page, 'openCard', 'build');
  await expect(floors.getByRole('button', { name: 'Ground' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(roof).toBe(false);
  await floors.getByRole('button', { name: '1st' }).click();
  await expect.poll(roof).toBe(true);
  // The stairs sold: the first floor closes, and the floor picker comes down to the ground floor.
  const stairs = (await state(page)).shop.fixtures.find((f) => f.type === 'stairs')!;
  await hooks(page, 'fp', -0.5, -0.5);
  expect((await hooks<{ ok: boolean }>(page, 'dispatch', { type: 'removeFixture', fixtureId: stairs.id })).ok).toBe(true);
  await build.getByRole('tab', { name: 'Upstairs' }).click();
  await expect(floors.getByRole('button')).toHaveText(['Ground']);
  await expect(floors.getByRole('button', { name: 'Ground' })).toHaveAttribute('aria-pressed', 'true');
  await expect(build.locator('.item', { hasText: 'over the ground floor' })).toHaveCount(1);
});

test('building outside: a flower bed on the grass, a tile of paving, and one more parking bay painted', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Fit Out', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 5000; });
  await hooks(page, 'fp', 0.5, -1.0);
  await page.keyboard.press('KeyB');
  const build = page.locator('.card.t-build');
  await build.getByRole('tab', { name: 'Outside' }).click();
  // A flower bed on the grass out front (the lot's tiles sit flush with the outside of the walls).
  const bed = build.getByRole('button', { name: /^Flower bed/ });
  await expect(bed.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await bed.dispatchEvent('click');
  await pointAt(page, 3.5, 2.0);
  await expect.poll(() => aimText(page)).toMatch(/^Place Flower bed/);
  await clickAt(page, 3.5, 2.0);
  await expect.poll(async () => (await state(page)).shop.fixtures.filter((f) => f.type === 'flowerBed').map((f) => `${f.x},${f.z}`)).toEqual(['3,1.5']);
  await page.keyboard.press('Escape');
  // Brick paving, a tile at a time; not on the walkway (paved already).
  await build.locator('.item', { hasText: 'Brick paving' }).getByRole('button', { name: 'Lay' }).click();
  await pointAt(page, 0.0, 2.0);
  await expect.poll(() => aimText(page)).toMatch(/Paved already/);
  await pointAt(page, 2.5, 2.0);
  await expect.poll(() => aimText(page)).toMatch(/^Lay brick paving/i);
  await clickAt(page, 2.5, 2.0);
  await expect.poll(async () => (await hooks<{ shop: { lotTiles?: Record<string, string> } }>(page, 'state')).shop.lotTiles?.['2,1.5']).toBe('brick');
  await page.keyboard.press('Escape');
  // A fifth bay, across the aisle from the four the lot came with.
  const bays = (await hooks<{ shop: { bays: unknown[] } }>(page, 'state')).shop.bays.length;
  await build.locator('.item', { hasText: 'bays' }).getByRole('button', { name: 'Paint' }).click();
  // Over to the car park, so it is not behind the card.
  await hooks(page, 'fp', 6.9, -1.0);
  await pointAt(page, 8.5, -1.6);
  await expect.poll(() => aimText(page)).toMatch(/^Paint a parking bay/);
  await clickAt(page, 8.5, -1.6);
  await expect.poll(async () => (await hooks<{ shop: { bays: unknown[] } }>(page, 'state')).shop.bays.length).toBe(bays + 1);
});

test('a spill beside a shelf: F mops it rather than stocking the shelf, and clicking its marker walks over to mop it', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Mop Shop', { tutorial: false });
  await hooks(page, 'quickSetup', false);
  await hooks(page, 'setSpeed', 0);
  // A spill on the floor in front of a shelf, and the manager stood on it facing the shelf.
  const at = await page.evaluate(() => {
    const w = window as unknown as { __shelf: { state: () => { shop: { originX: number; originZ: number; fixtures: { type: string; x: number; z: number; rot: number }[]; litter: { id: number; x: number; z: number }[] }; nextId: number } } };
    const s = w.__shelf.state();
    const f = s.shop.fixtures.find((x) => x.type === 'shelf' && x.rot === 1)!;
    const lx = f.x + 1.5, lz = f.z + 0.5;
    s.shop.litter.push({ id: s.nextId++, x: s.shop.originX + lx, z: s.shop.originZ + lz });
    return { lx, lz };
  });
  await hooks(page, 'aimAt', at.lx + 0.1, at.lz, at.lx - 1, 0.5, at.lz);
  await expect.poll(() => aimText(page)).toMatch(/^Mop up the spill/);
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await state(page)).shop.litter.length).toBe(0);
  // Another, a few steps away: a click on the marker floating above it sends the manager to mop it.
  await page.evaluate((p) => {
    const w = window as unknown as { __shelf: { state: () => { shop: { originX: number; originZ: number; litter: { id: number; x: number; z: number }[] }; nextId: number } } };
    const s = w.__shelf.state();
    s.shop.litter.push({ id: s.nextId++, x: s.shop.originX + p.lx + 1.5, z: s.shop.originZ + p.lz - 1 });
  }, at);
  await hooks(page, 'setSpeed', 1);
  await clickAt(page, at.lx + 1.5, at.lz - 1, 0.5);
  await hooks(page, 'advanceNoScan', 6);
  await expect.poll(async () => (await state(page)).shop.litter.length).toBe(0);
});

test("the shop's business profile: reviews come in, the badge counts them, photos develop, and the owner replies", async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  await hooks(page, 'newGame', 12, 'main', 'Review Mart', { tutorial: false });
  await hooks(page, 'quickSetup', true);
  await hooks(page, 'setSpeed', 0);
  const button = page.locator('.hud-time [data-card="reviews"]');
  await expect(button.locator('.badge')).toHaveText('0');
  // Two days of trade: shoppers go home and write about it.
  await hooks(page, 'playDays', 2);
  const listing = await hooks<{ count: number; stars: number[]; photos: number }>(page, 'listing');
  expect(listing.count).toBeGreaterThan(3);
  await expect(button.locator('.badge')).toHaveText(String(listing.count));
  await expect(button).toHaveAttribute('aria-label', new RegExp(`${listing.count} reviews, rated \\d\\.\\d`));
  // The profile: the listing, the stars, the reviews; the photos are taken in the town as it stands.
  await page.keyboard.press('Escape');
  await button.click();
  const card = page.getByRole('dialog', { name: 'Business Profile' });
  await expect(card).toBeVisible();
  await expect(card.locator('.biz-title h2')).toHaveText('Review Mart');
  await expect(card.locator('.biz-hero img').first()).toHaveAttribute('src', /^data:image\/jpeg/, { timeout: 60_000 });
  await card.getByRole('tab', { name: 'Reviews' }).click();
  const items = card.getByRole('list', { name: 'Reviews' }).locator('.biz-review');
  await expect(items).toHaveCount(Math.min(40, listing.count));
  if (listing.photos > 0) await expect(card.locator('.biz-review .shots img').first()).toHaveAttribute('src', /^data:image\/jpeg/, { timeout: 90_000 });
  // Reply to the first review: it shows under the review as the owner's response.
  const first = items.first();
  await first.getByRole('button', { name: 'Reply' }).click();
  await first.getByRole('textbox', { name: 'Your reply' }).fill('Thanks for coming in!');
  await first.getByRole('button', { name: 'Post reply' }).click();
  await expect(first.locator('.owner-reply')).toContainText('Thanks for coming in!');
  // What shoppers notice: the looks behind the stars.
  await card.getByRole('tab', { name: 'Performance' }).click();
  await expect(card.locator('.biz-perf .looks li')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap the floor to walk there, tap a shelf for its menu and its stock', async ({ page }) => {
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
    // Tapping a shelf empty-handed opens its menu; Stock opens the Stock card at what goes on it, with
    // the products' pictures; the manager stays put.
    const shelf = (await state(page)).shop.fixtures.find((f) => f.type === 'shelf')!;
    // Arrived: done walking (within 0.6 of the spot, the last steps can still be under way).
    await expect.poll(async () => (await owner(page)).walking, { timeout: 10_000 }).toBe(false);
    const before = await owner(page);
    const q = await screenAt(page, shelf.x + 0.5, shelf.z + 0.5, 0.6);
    await page.touchscreen.tap(q.x, q.y);
    await page.getByRole('menuitem', { name: 'Stock' }).tap();
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
