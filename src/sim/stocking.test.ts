import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { FIXTURES, storageCap, STORE_RACK_UNITS } from './layout';
import { productDef } from './products';
import { RECYCLE_BACK } from './stocking';

const fill = (f: { type: keyof typeof FIXTURES; slots: { qty: number }[] }) => f.slots.reduce((a, s) => a + s.qty, 0);

describe('the stock tool', () => {
  it('tops a shelf up straight from the pallet, oldest boxes first, and Supply fills every shelf it can', () => {
    const s = openGame({ seed: 5, plotId: 'main', name: 'T', tutorial: false });
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.slots.some((sl) => sl.productId === 'bread'))!;
    for (const sl of shelf.slots) if (sl.productId === 'bread') sl.qty = 0;
    s.shop.storage = [{ productId: 'bread', qty: 5, day: 1 }, { productId: 'bread', qty: 20, day: 3 }];
    expect(applyCommand(s, { type: 'topUp', fixtureId: shelf.id }).ok).toBe(true);
    const on = shelf.slots.filter((sl) => sl.productId === 'bread').reduce((a, sl) => a + sl.qty, 0);
    expect(on).toBeGreaterThan(5);
    // The older box went first.
    expect(s.shop.storage.some((e) => e.day === 1)).toBe(false);
    expect(s.shop.storage.reduce((a, e) => a + e.qty, 0)).toBe(25 - on);
    // Supply: the rest, onto every shelf it fits.
    for (const f of s.shop.fixtures) for (const sl of f.slots) sl.qty = 0;
    s.shop.storage = s.shop.fixtures.flatMap((f) => f.slots.filter((sl) => sl.productId).map((sl) => ({ productId: sl.productId!, qty: 40, day: 1 })));
    expect(applyCommand(s, { type: 'topUpAll' }).ok).toBe(true);
    for (const f of s.shop.fixtures) if (FIXTURES[f.type].slots && f.slots.some((sl) => sl.productId)) expect(fill(f)).toBeGreaterThan(0);
    // Nothing on the pallet: it says so.
    s.shop.storage = [];
    expect(applyCommand(s, { type: 'topUpAll' }).message).toMatch(/pallet is empty/);
  });

  it('recycles unwanted stock for half its cost; a storage rack makes room', () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'T', tutorial: false });
    s.shop.storage = [{ productId: 'cola', qty: 10, day: 1 }, { productId: 'milk', qty: 4, day: 1 }];
    const cash = s.cash;
    expect(applyCommand(s, { type: 'recycle', productId: 'cola' }).ok).toBe(true);
    expect(s.cash - cash).toBeCloseTo(10 * productDef('cola').cost * RECYCLE_BACK, 2);
    expect(s.shop.storage.map((e) => e.productId)).toEqual(['milk']);
    const cap = storageCap(s.shop);
    s.cash = 5000;
    const f = s.shop.floor;
    let placed = false;
    for (let z = f.z0 + 1; z < f.z1 - 1 && !placed; z++) for (let x = f.x0; x < f.x1 - 1 && !placed; x++) placed = applyCommand(s, { type: 'placeFixture', fixtureType: 'storeRack', x, z, rot: 0 }).ok;
    expect(placed).toBe(true);
    expect(storageCap(s.shop)).toBe(cap + STORE_RACK_UNITS);
  });
});
