import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, type GameState } from './index';

function day(s: GameState, scan: boolean): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (scan && i % 6 === 0) applyCommand(s, { type: 'scan' }); }
}

describe('staff', () => {
  it('a cashier serves customers without the player scanning; a stocker restocks', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    const cashier = s.staffPool.find((c) => c.role === 'cashier')!;
    const stocker = s.staffPool.find((c) => c.role === 'stocker')!;
    s.cash = 2000;
    expect(applyCommand(s, { type: 'hire', candidateId: cashier.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'hire', candidateId: stocker.id }).ok).toBe(true);
    applyCommand(s, { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'bread', qty: 24 }, { productId: 'chips', qty: 24 }, { productId: 'milk', qty: 18 }] });
    day(s, false);
    expect(s.today.served).toBeGreaterThan(8);
    expect(s.stuckRescues).toBe(0);
    expect(s.history[0]!.wages).toBeGreaterThan(0);
  });
  it('unlocks arrive on schedule with New! badges and a hint always says something', () => {
    const s = openGame({ seed: 22, plotId: 'elm', name: 'T', tutorial: false });
    resetGridCache();
    expect(s.unlocks.build).toBe(true); // you build your own shop from minute one
    expect(s.unlocks.staff).toBe(false);
    for (let d = 0; d < 2; d++) { day(s, true); applyCommand(s, { type: 'openTomorrow' }); }
    expect(s.unlocks.staff).toBe(true);
    expect(s.unlocks.newBadges).toContain('staff');
    applyCommand(s, { type: 'ackBadge', card: 'staff' });
    expect(s.unlocks.newBadges).not.toContain('staff');
  });
});

describe('stockers', () => {
  it('top up a shelf that has room, not only one that is half empty', () => {
    const s = openGame({ seed: 23, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    const st = s.staffPool.find((c) => c.role === 'stocker')!;
    s.cash = 2000;
    expect(applyCommand(s, { type: 'hire', candidateId: st.id }).ok).toBe(true);
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    const slot = shelf.slots.find((sl) => sl.productId)!;
    // Every slot full but one, which is three short; three of its product wait on the pallet.
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = 8;
    slot.qty = 5;
    s.shop.storage = [{ productId: slot.productId!, qty: 3, day: s.day }];
    s.people = s.people.filter((p) => p.kind !== 'customer');
    for (let i = 0; i < 60 / TICK && slot.qty < 8; i++) tick(s);
    expect(slot.qty).toBe(8);
  });
});

describe('idle staff', () => {
  it('a cleaner helps fill shelves, and with nothing at all to do goes and tidies one', () => {
    const s = openGame({ seed: 24, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    const cl = s.staffPool.find((c) => c.role === 'cleaner') ?? s.staffPool.find((c) => c.role === 'orderer')!;
    s.cash = 2000;
    expect(applyCommand(s, { type: 'hire', candidateId: cl.id }).ok).toBe(true);
    const worker = s.people.find((p) => p.kind === 'staff')!;
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    const slot = shelf.slots.find((sl) => sl.productId)!;
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = 8;
    slot.qty = 4;
    s.shop.storage = [{ productId: slot.productId!, qty: 4, day: s.day }];
    s.people = s.people.filter((p) => p.kind !== 'customer');
    for (let i = 0; i < 60 / TICK && slot.qty < 8; i++) tick(s);
    expect(slot.qty).toBe(8);
    // Nothing left to stock or mop: within a while they are off tidying a shelf.
    s.shop.storage = []; s.shop.litter = [];
    let tidied = false;
    for (let i = 0; i < 40 / TICK && !tidied; i++) {
      s.people = s.people.filter((p) => p.kind !== 'customer');
      tick(s);
      tidied = worker.state === 'stocking' && !worker.task;
    }
    expect(tidied).toBe(true);
    expect(s.stuckRescues).toBe(0);
  });
});
