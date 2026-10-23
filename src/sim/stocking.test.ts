import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { FIXTURES, storageCap, STORE_RACK_UNITS } from './layout';
import { productDef } from './products';
import { RECYCLE_BACK } from './stocking';
import { wrongFixture } from './people';
import type { FixtureType, GameState } from './types';

/** Put down a new (empty) piece wherever it fits, with the cash for it. */
function place(s: GameState, type: FixtureType) {
  s.cash = Math.max(s.cash, 5000);
  const f = s.shop.floor, n = s.shop.fixtures.length;
  for (let z = f.z0 + 1; z < f.z1 - 1; z++) for (let x = f.x0; x < f.x1 - 1; x++) if (applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot: 0 }).ok) return s.shop.fixtures[n]!;
  throw new Error(`no room for a ${type}`);
}

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

  it('puts cold goods in a Chiller first, and only snacks in a vending machine or frozen goods in the ice-cream chest', () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'T', tutorial: false });
    const chiller = place(s, 'fridge'), vending = place(s, 'vending'), chest = place(s, 'iceChest');
    // Dry goods ordered first: the Chiller still gives its first slot to the milk (dry goods only fill what is spare).
    s.shop.storage = ['bread', 'pasta', 'chips', 'rice'].map((productId) => ({ productId, qty: 20, day: 1 })).concat({ productId: 'milk', qty: 24, day: 1 });
    expect(applyCommand(s, { type: 'topUp', fixtureId: chiller.id }).ok).toBe(true);
    expect(chiller.slots[0]!.productId).toBe('milk');
    expect(chiller.slots[0]!.qty).toBe(FIXTURES.fridge.capacity);
    s.shop.storage = ['flour', 'rice', 'eggs', 'milk', 'cola', 'chips', 'icecream', 'pizza'].map((productId) => ({ productId, qty: 20, day: 1 }));
    expect(applyCommand(s, { type: 'topUpAll' }).ok).toBe(true);
    // Nothing chilled on a dry shelf; nothing but snacks in the machine, nothing but frozen goods and ice cream in the chest.
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId && sl.qty > 0 && f.type !== 'fridge') expect(wrongFixture(sl.productId, f.type), `${sl.productId} on the ${f.type}`).toBeNull();
    expect(new Set(vending.slots.flatMap((sl) => sl.productId ?? []))).toEqual(new Set(['cola', 'chips']));
    expect(new Set(chest.slots.flatMap((sl) => sl.productId ?? []))).toEqual(new Set(['icecream', 'pizza']));
    // By hand the same: crisps and drinks in the machine, frozen goods and ice cream in the chest.
    expect(wrongFixture('flour', 'vending')).toBe('Flour does not go in the vending machine');
    expect(wrongFixture('milk', 'iceChest')).not.toBeNull();
    expect(wrongFixture('icecream', 'iceChest')).toBeNull();
  });

  it('counts for the first day\'s "stock a shelf" step, and says "1 unit"', () => {
    const s = openGame({ seed: 5, plotId: 'main', name: 'T', tutorial: true });
    s.tutorial.completed = s.tutorial.completed.filter((t) => t !== 'stock');
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.slots.some((sl) => sl.productId === 'bread'))!;
    const slot = shelf.slots.find((sl) => sl.productId === 'bread')!;
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = FIXTURES[f.type].capacity;
    slot.qty -= 1;
    s.shop.storage = [{ productId: 'bread', qty: 5, day: 1 }];
    expect(applyCommand(s, { type: 'topUpAll' }).message).toBe('1 unit shelved.');
    expect(s.tutorial.completed).toContain('stock');
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

describe('room on a shelf', () => {
  it('is any slot not full: a full slot of the product never turns the rest of the shelf away', () => {
    const s = openGame({ seed: 5, plotId: 'main', name: 'T', tutorial: false });
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!, cap = FIXTURES.shelf.capacity;
    shelf.slots.forEach((sl, i) => { sl.productId = i === 0 ? 'pasta' : 'chips'; sl.qty = i === 0 ? cap : 0; });
    // With the stock tool, more pasta goes into the sold-out slots.
    s.shop.storage = [{ productId: 'pasta', qty: 10, day: 1 }];
    expect(applyCommand(s, { type: 'topUp', fixtureId: shelf.id }).ok).toBe(true);
    expect(shelf.slots.filter((sl) => sl.productId === 'pasta').reduce((a, sl) => a + sl.qty, 0)).toBe(cap + 10);
  });
});
