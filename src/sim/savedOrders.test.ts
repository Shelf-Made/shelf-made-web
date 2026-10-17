import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK } from './index';
import { openGame } from './testUtil';
import { ruleMet, savedOrderCost } from './savedOrders';
import { storageUsed } from './layout';

describe('saved orders', () => {
  it('saves an order, places it by hand, and a manager places it when its condition comes true', () => {
    const s = openGame({ seed: 61, plotId: 'main', name: 'Saved', tutorial: false });
    s.cash = 5000;
    expect(applyCommand(s, { type: 'saveOrder', name: 'Milk run', supplierId: 'local', lines: [{ productId: 'milk', qty: 12 }, { productId: 'bread', qty: 12 }] }).ok).toBe(true);
    const o = s.savedOrders![0]!;
    expect(o.name).toBe('Milk run');
    expect(o.when.kind).toBe('never');
    expect(savedOrderCost(s, o)).toBeGreaterThan(0);
    // By hand.
    const orders = s.orders.length;
    expect(applyCommand(s, { type: 'placeSavedOrder', id: o.id }).ok).toBe(true);
    expect(s.orders.length).toBe(orders + 1);
    expect(s.orders[s.orders.length - 1]!.savedId).toBe(o.id);
    // When milk runs low, and only with a manager on the staff.
    expect(applyCommand(s, { type: 'editSavedOrder', id: o.id, patch: { when: { kind: 'productBelow', productId: 'milk', units: 1000 }, minCash: 100 } }).ok).toBe(true);
    expect(ruleMet(s, o, false)).toBe(true);
    for (const x of s.orders) x.state = 'delivered';
    o.lastDay = undefined;
    applyCommand(s, { type: 'openTomorrow' }); s.phase = 'open';
    const before = s.orders.length;
    for (let i = 0; i < 40 / TICK; i++) tick(s);
    expect(s.orders.length).toBe(before); // no manager yet
    const m = s.staffPool.find((c) => c.role === 'manager') ?? (s.staffPool[0]!.role = 'manager', s.staffPool[0]!);
    expect(applyCommand(s, { type: 'hire', candidateId: m.id }).ok).toBe(true);
    for (let i = 0; i < 40 / TICK; i++) tick(s);
    const placed = s.orders.filter((x) => x.savedId === o.id).length;
    expect(s.orders.filter((x) => x.savedId === o.id && x.state !== 'delivered').length).toBe(1);
    expect(o.lastDay).toBe(s.day);
    // Once a day at most, even once it has arrived.
    for (const x of s.orders) x.state = 'delivered';
    for (let i = 0; i < 60 / TICK; i++) tick(s);
    expect(s.orders.filter((x) => x.savedId === o.id).length).toBe(placed);
    // A cash floor it will not go under.
    expect(applyCommand(s, { type: 'editSavedOrder', id: o.id, patch: { minCash: 1e9 } }).ok).toBe(true);
    expect(applyCommand(s, { type: 'deleteSavedOrder', id: o.id }).ok).toBe(true);
    expect(s.savedOrders!.length).toBe(0);
  });

  it('counts the pallet by the room its goods take, as placing an order does (bulky goods take more)', () => {
    const s = openGame({ seed: 62, plotId: 'main', name: 'Saved', tutorial: false });
    expect(applyCommand(s, { type: 'saveOrder', name: 'Top up', supplierId: 'local', lines: [{ productId: 'milk', qty: 12 }] }).ok).toBe(true);
    const o = s.savedOrders![0]!;
    o.when = { kind: 'palletBelow', units: 50 };
    // Twenty Christmas trees: twenty on the pallet, but a hundred units of its room.
    s.shop.storage = [{ productId: 'xmastree', qty: 20, day: s.day }];
    expect(storageUsed(s.shop)).toBe(100);
    expect(ruleMet(s, o, false)).toBe(false);
    s.shop.storage = [{ productId: 'milk', qty: 20, day: s.day }];
    expect(ruleMet(s, o, false)).toBe(true);
  });
});
