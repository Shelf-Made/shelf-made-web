import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, toWorld, type GameState } from './index';
import { storeroomPoint } from './people';

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

describe('restocking keeps the range', () => {
  it('a sold-out slot waits for its own product: staff never fill it with something already on the shelves', () => {
    const s = openGame({ seed: 25, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    const st = s.staffPool.find((c) => c.role === 'stocker')!;
    s.cash = 2000;
    expect(applyCommand(s, { type: 'hire', candidateId: st.id }).ok).toBe(true);
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.slots.filter((sl) => sl.productId).length >= 2)!;
    const [a, b] = shelf.slots.filter((sl) => sl.productId) as [typeof shelf.slots[number], typeof shelf.slots[number]];
    // One product sold out; plenty of another (already on the shelf) waits on the pallet.
    a.qty = 0; b.qty = 2;
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl !== a && sl !== b && sl.productId) sl.qty = 8;
    const keep = a.productId!;
    s.shop.storage = [{ productId: b.productId!, qty: 40, day: s.day }];
    s.people = s.people.filter((p) => p.kind !== 'customer');
    for (let i = 0; i < 60 / TICK; i++) tick(s);
    expect(b.qty).toBe(8);
    expect(a.productId).toBe(keep);
    expect(a.qty).toBe(0);
  });
});

describe('two bound for the same corner', () => {
  // Both on their way to the pallet round the corner beside it, from either side: each one's way points at the other,
  // but they come together there, not past each other. Never stepping aside for good, the nearer one off the corner.
  it('get round it, neither held off it by the other', () => {
    const s = openGame({ seed: 4, plotId: 'elm', name: 'T', tutorial: false });
    s.cash = 60000;
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    for (const [x, z, type] of [[-3.5, -6, 'shelf'], [-1.5, -6, 'shelf'], [-3.5, -5, 'shelf'], [-1.5, -5, 'fridge']] as const) expect(applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot: 0 }).ok).toBe(true);
    for (let i = 0; i < 2; i++) expect(applyCommand(s, { type: 'hire', candidateId: s.staffPool.find((c) => c.role === 'stocker')!.id }).ok).toBe(true);
    s.people = s.people.filter((p) => p.kind !== 'customer');
    const o = s.people.find((p) => p.kind === 'owner')!, park = toWorld(s.shop, 2.5, -1);
    o.x = o.px = park.x; o.z = o.pz = park.z; o.path = []; o.pathIdx = 0; o.state = 'idle';
    s.shop.storage = [{ productId: 'bread', qty: 40, day: s.day }];
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.x === -2.5 && f.z === -3)!;
    const pallet = storeroomPoint(s), corner = toWorld(s.shop, -1.75, -5.25);
    const [a, b] = s.people.filter((p) => p.kind === 'staff') as [typeof o, typeof o];
    const set = (p: typeof o, x: number, z: number, speed: number) => {
      const at = toWorld(s.shop, x, z);
      p.x = p.px = at.x; p.z = p.pz = at.z; p.speed = speed; p.state = 'toStock'; p.anim = 'walk'; p.timer = 0; p.carrying = null;
      p.task = { type: 'carry', fixtureId: shelf.id, productId: 'bread', qty: 1 }; p.path = [{ ...corner }, { ...pallet }]; p.pathIdx = 0;
    };
    set(b, -1.8016, -5.2314, 1.04); set(a, -1.5027, -5.4888, 1.472);
    let t = 0;
    for (; t < 30 && (a.pathIdx === 0 || b.pathIdx === 0); t += TICK) tick(s);
    expect(t).toBeLessThan(3);
    expect(s.stuckRescues).toBe(0);
  });
});
