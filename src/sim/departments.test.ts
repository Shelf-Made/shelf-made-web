import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { listWeight } from './customers';
import { PRODUCTS, CORE_PRODUCTS, holidayOn, inSeason, productDef, sizeOf, HOLIDAYS, YEAR_DAYS, HOLIDAY_DAYS } from './products';
import { storageUsed, storageCap } from './layout';
import { holidayNotices } from './economy';
import { autoOrder, DEFAULT_RULES } from './staff';
import { managerSavedOrders } from './savedOrders';
import { RECYCLE_BACK } from './stocking';

describe('departments and the holidays', () => {
  it('shoppers only want goods beyond the first range once you sell them', () => {
    expect(listWeight('convenience', 'teddy', false)).toBe(0);
    expect(listWeight('convenience', 'teddy', true)).toBeGreaterThan(0);
    expect(listWeight('convenience', 'bread', false)).toBeGreaterThan(0);
    // The first range is as it was: none of it is an extra.
    expect(CORE_PRODUCTS.length).toBe(PRODUCTS.filter((p) => !p.extra).length);
    expect(CORE_PRODUCTS.some((p) => p.id === 'milk')).toBe(true);
  });

  it('a holiday comes round every week of four, five days long, its goods ordered from two days before', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= YEAR_DAYS; d++) { const h = holidayOn(d); if (h) seen.add(h); }
    expect([...seen].sort()).toEqual(HOLIDAYS.map((h) => h.id).sort());
    const h = HOLIDAYS.find((x) => x.id === 'halloween')!;
    expect(holidayOn(h.start)).toBe('halloween');
    expect(holidayOn(h.start - 1)).toBeNull();
    expect(holidayOn(h.start - 2, 2)).toBe('halloween');
    expect(holidayOn(h.start + YEAR_DAYS)).toBe('halloween');
    expect(inSeason(productDef('pumpkin'), h.start - 3)).toBe(false);
    expect(inSeason(productDef('pumpkin'), h.start - 2)).toBe(true);
    // Wanted only on the days themselves.
    expect(listWeight('impulse', 'candybucket', true, h.start - 1)).toBe(0);
    expect(listWeight('impulse', 'candybucket', true, h.start + 1)).toBeGreaterThan(listWeight('impulse', 'candybucket', true, h.start + 1) / 2);
  });

  it('out of season, holiday goods cannot be ordered; in season they can, bulky ones taking more room', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 5000; s.shop.storage = [];
    const h = HOLIDAYS.find((x) => x.id === 'halloween')!;
    s.day = h.start - 5;
    const no = applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'pumpkin', qty: 6 }] });
    expect(no.ok).toBe(false);
    expect(no.message).toMatch(/Halloween/);
    s.day = h.start;
    expect(applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'pumpkin', qty: 6 }], instant: true }).ok).toBe(true);
    expect(storageUsed(s.shop)).toBe(6 * sizeOf('pumpkin'));
    expect(sizeOf('pumpkin')).toBeGreaterThan(1);
  });

  it('a holiday product left in a shelf slot never stops the manager reordering everything else', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 5000; s.shop.storage = [];
    const h = HOLIDAYS.find((x) => x.id === 'halloween')!;
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    for (const sl of shelf.slots) sl.qty = 0;
    // Sold out of candy buckets at Halloween: the slot still holds them the day after.
    shelf.slots[0]!.productId = 'candybucket';
    s.day = h.start + HOLIDAY_DAYS;
    const before = s.orders.length;
    autoOrder(s, DEFAULT_RULES, 1000);
    expect(s.orders.length).toBe(before + 1);
    const got = s.orders[s.orders.length - 1]!.lines.map((l) => l.productId);
    expect(got.length).toBeGreaterThan(0);
    expect(got).not.toContain('candybucket');
    // Two days before the next Halloween the slot is reordered too.
    for (const o of s.orders) o.state = 'delivered';
    s.day = h.start + YEAR_DAYS - 2;
    autoOrder(s, DEFAULT_RULES, 1000);
    expect(s.orders[s.orders.length - 1]!.lines.map((l) => l.productId)).toContain('candybucket');
    // A reorder too big for the pallet (Christmas trees take five units each) still brings what fits.
    for (const o of s.orders) o.state = 'delivered';
    for (const f of s.shop.fixtures) for (const sl of f.slots) sl.qty = 0;
    shelf.slots[0]!.productId = 'xmastree'; shelf.slots[1]!.productId = 'xmastree';
    s.day = HOLIDAYS.find((x) => x.id === 'christmas')!.start;
    const n = s.orders.length;
    autoOrder(s, DEFAULT_RULES, 5000);
    expect(s.orders.length).toBe(n + 1);
    expect(s.orders[n]!.lines.reduce((a, l) => a + l.qty * sizeOf(l.productId), 0)).toBeLessThanOrEqual(storageCap(s.shop));
  });

  it('out of season, a holiday line is left off an order and the rest goes; a saved order too', () => {
    const s = openGame({ seed: 10, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 5000; s.shop.storage = [];
    const h = HOLIDAYS.find((x) => x.id === 'valentine')!;
    // Saved on Valentine's, placed by the manager every morning.
    s.day = h.start;
    expect(applyCommand(s, { type: 'saveOrder', name: 'Daily', supplierId: 'local', lines: [{ productId: 'bread', qty: 12 }, { productId: 'roses', qty: 6 }] }).ok).toBe(true);
    const o = s.savedOrders![0]!;
    expect(applyCommand(s, { type: 'editSavedOrder', id: o.id, patch: { when: { kind: 'daily' }, minCash: 0 } }).ok).toBe(true);
    s.day = h.start + HOLIDAY_DAYS + 1;
    s.notices = [];
    expect(applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'milk', qty: 6 }, { productId: 'roses', qty: 6 }] }).ok).toBe(true);
    expect(s.orders[s.orders.length - 1]!.lines.map((l) => l.productId)).toEqual(['milk']);
    expect(s.notices.map((n) => n.text)).toContain("Roses left off the order: only sold around Valentine's.");
    const m = s.staffPool.find((c) => c.role === 'manager') ?? (s.staffPool[0]!.role = 'manager', s.staffPool[0]!);
    expect(applyCommand(s, { type: 'hire', candidateId: m.id }).ok).toBe(true);
    managerSavedOrders(s, true);
    const placed = s.orders.filter((x) => x.savedId === o.id);
    expect(placed.map((x) => x.lines.map((l) => l.productId))).toEqual([['bread']]);
    expect(o.lastDay).toBe(s.day);
  });

  it("a holiday's leftovers on the shelves can go for recycling, freeing their slots", () => {
    const s = openGame({ seed: 11, plotId: 'main', name: 'T', tutorial: false });
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    shelf.slots[0] = { productId: 'crackers', qty: 5 };
    shelf.slots[1] = { productId: 'crackers', qty: 0 };
    s.shop.storage = [{ productId: 'crackers', qty: 4, day: 1 }];
    const cash = s.cash;
    expect(applyCommand(s, { type: 'recycle', productId: 'crackers', shelves: true }).ok).toBe(true);
    expect(s.cash - cash).toBeCloseTo(5 * productDef('crackers').cost * RECYCLE_BACK, 2);
    expect(shelf.slots.slice(0, 2)).toEqual([{ productId: null, qty: 0 }, { productId: null, qty: 0 }]);
    // What is on the pallet stays for the pallet's own Recycle button.
    expect(s.shop.storage).toEqual([{ productId: 'crackers', qty: 4, day: 1 }]);
    expect(applyCommand(s, { type: 'recycle', productId: 'crackers', shelves: true }).ok).toBe(false);
  });

  it('says when a holiday is coming, when it starts, and when it is over', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'T', tutorial: false });
    const h = HOLIDAYS.find((x) => x.id === 'christmas')!;
    const say = (d: number) => { s.notices = []; s.day = d; holidayNotices(s); return s.notices.map((n) => n.text).join(' | '); };
    expect(say(h.start - 2)).toMatch(/Christmas in two days/);
    expect(say(h.start)).toMatch(/Christmas starts today/);
    expect(say(h.start + 1)).toBe('');
    expect(say(h.start + 5)).toMatch(/Christmas is over.*on the shelves or the pallet/);
  });
});

describe('the new displays', () => {
  it('a vending machine sells there and then: no till, and a shopper who only used it is served', async () => {
    const { tick } = await import('./index');
    const { spawnCustomer } = await import('./people');
    const { TICK } = await import('./layout');
    const s = openGame({ seed: 12, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    // Only the vending machine sells cola.
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId === 'cola') { sl.productId = null; sl.qty = 0; }
    const fl = s.shop.floor;
    let vm = null as null | (typeof s.shop.fixtures)[number];
    for (let z = fl.z0; z < fl.z1 && !vm; z++) for (let x = fl.x0; x < fl.x1 && !vm; x++) for (const rot of [0, 1, 2, 3] as const) {
      if (applyCommand(s, { type: 'placeFixture', fixtureType: 'vending', x, z, rot }).ok) { vm = s.shop.fixtures[s.shop.fixtures.length - 1]!; break; }
    }
    expect(vm).toBeTruthy();
    vm!.slots[0]!.productId = 'cola'; vm!.slots[0]!.qty = 8;
    s.people = s.people.filter((p) => p.kind !== 'customer');
    const p = spawnCustomer(s, true)!;
    p.list = [{ productId: 'cola', qty: 1 }]; p.listIdx = 0; p.thief = false; p.budget = 50;
    const revenue = s.today.revenue, served = s.today.served;
    for (let i = 0; i < 240 / TICK && !p.vended; i++) tick(s);
    expect(p.vended).toBe(true);
    expect(s.today.revenue).toBeGreaterThan(revenue);
    for (let i = 0; i < 60 / TICK && s.today.served === served; i++) tick(s);
    expect(s.today.served).toBe(served + 1);
    expect(p.basket ?? []).toEqual([]);
  });

  it('chilled produce takes fruit that needs no fridge; the ice-cream chest only frozen goods and dairy', async () => {
    const { wrongFixture } = await import('./people');
    expect(wrongFixture('apples', 'coolProduce')).toBeNull();
    expect(wrongFixture('mushrooms', 'coolProduce')).toBeNull();
    expect(wrongFixture('bread', 'coolProduce')).not.toBeNull();
    expect(wrongFixture('pizza', 'iceChest')).toBeNull();
    expect(wrongFixture('cola', 'iceChest')).not.toBeNull();
    expect(wrongFixture('chips', 'vending')).toBeNull();
    expect(wrongFixture('teddy', 'displayTable')).toBeNull();
    expect(wrongFixture('milk', 'displayTable')).not.toBeNull();
  });

  it('a wall shelf hangs on a wall and is stocked from in front of it', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const f = s.shop.floor;
    let ok = false;
    for (let z = f.z0; z < f.z1 && !ok; z++) for (let x = f.x0; x < f.x1 && !ok; x++) for (const rot of [0, 1, 2, 3] as const) if (applyCommand(s, { type: 'placeFixture', fixtureType: 'wallShelf', x, z, rot }).ok) { ok = true; break; }
    expect(ok).toBe(true);
  });

  it('a wall shelf never hangs over a pallet, the shop\'s own included', async () => {
    const { canPlace } = await import('./build');
    const s = openGame({ seed: 9, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const d = s.shop.fixtures.find((f) => f.type === 'pallet')!;
    // On the back wall, facing in, over the boxes.
    expect(canPlace(s, 'wallShelf', d.x, d.z, 0).ok).toBe(false);
  });

  it('a shopper at a wall shelf faces the wall, however they came to it', async () => {
    const { tick } = await import('./index');
    const { spawnCustomer } = await import('./people');
    const { fixtureCentre, fixtureFacingWorld } = await import('./grid');
    const s = openGame({ seed: 9, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const fl = s.shop.floor;
    let ws = null as null | (typeof s.shop.fixtures)[number];
    for (let z = fl.z0; z < fl.z1 && !ws; z++) for (let x = fl.x0; x < fl.x1 && !ws; x++) for (const rot of [0, 1, 2, 3] as const) {
      if (applyCommand(s, { type: 'placeFixture', fixtureType: 'wallShelf', x, z, rot }).ok) { ws = s.shop.fixtures[s.shop.fixtures.length - 1]!; break; }
    }
    expect(ws).toBeTruthy();
    s.people = s.people.filter((p) => p.kind !== 'customer');
    const p = spawnCustomer(s, true)!;
    // Come along the wall to the shelf's own tile, stopping just short of its middle.
    const c = fixtureCentre(s.shop, ws!), fw = fixtureFacingWorld(s.shop, ws!.rot), along = { x: fw.z, z: -fw.x };
    p.x = p.px = c.x - along.x * 0.15; p.z = p.pz = c.z - along.z * 0.15; p.yaw = Math.atan2(along.x, along.z);
    p.riding = false; p.bike = undefined; p.carId = null; p.thief = false;
    p.state = 'browsing'; p.anim = 'walk'; p.timer = -1; p.targetFixture = ws!.id; p.path = [{ x: c.x, z: c.z }]; p.pathIdx = 0;
    tick(s);
    expect(p.anim).toBe('browse');
    // Facing back into the wall: the opposite of the way the shelf faces.
    expect(Math.sin(p.yaw) * -fw.x + Math.cos(p.yaw) * -fw.z).toBeGreaterThan(0.9);
  });

  it('frozen goods need a chiller or an ice-cream chest, and the bakery case takes the pastries, not bread or cake', async () => {
    const { wrongFixture } = await import('./people');
    // As the Stock card's Frozen tab and footer say.
    for (const p of PRODUCTS.filter((x) => x.category === 'frozen')) {
      expect(wrongFixture(p.id, 'fridge')).toBeNull();
      expect(wrongFixture(p.id, 'iceChest')).toBeNull();
      expect(wrongFixture(p.id, 'shelf')).not.toBeNull();
      expect(wrongFixture(p.id, 'freezer')).not.toBeNull();
    }
    // Every fridge good goes in a chiller.
    for (const p of PRODUCTS.filter((x) => x.chilled)) expect(wrongFixture(p.id, 'fridge')).toBeNull();
    // As the Build card's note on the bakery case says.
    for (const id of ['donuts', 'croissants', 'muffins', 'applepie', 'baguette']) expect(wrongFixture(id, 'bakeryCase')).toBeNull();
    for (const id of ['bread', 'hotcross', 'cake']) expect(wrongFixture(id, 'bakeryCase')).not.toBeNull();
  });
});
