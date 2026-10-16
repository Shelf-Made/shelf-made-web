import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { listWeight } from './customers';
import { PRODUCTS, CORE_PRODUCTS, holidayOn, inSeason, productDef, sizeOf, HOLIDAYS, YEAR_DAYS } from './products';
import { storageUsed } from './layout';
import { holidayNotices } from './economy';

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

  it('says when a holiday is coming, when it starts, and when it is over', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'T', tutorial: false });
    const h = HOLIDAYS.find((x) => x.id === 'christmas')!;
    const say = (d: number) => { s.notices = []; s.day = d; holidayNotices(s); return s.notices.map((n) => n.text).join(' | '); };
    expect(say(h.start - 2)).toMatch(/Christmas in two days/);
    expect(say(h.start)).toMatch(/Christmas starts today/);
    expect(say(h.start + 1)).toBe('');
    expect(say(h.start + 5)).toMatch(/Christmas is over/);
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
});
