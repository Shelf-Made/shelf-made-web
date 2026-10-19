import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, toWorld, toLocal, type GameState } from './index';
import { storeroomPoint } from './people';
import { fixtureBackWorld } from './grid';

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

describe('breaks', () => {
  // All on one spot out by the back door, they shoved each other off it for good and the watchdog kept moving them.
  it('everyone on a break waits on a spot of their own, and back at work nobody is stuck', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    s.cash = 50000;
    for (const c of [...s.staffPool]) applyCommand(s, { type: 'hire', candidateId: c.id });
    const staff = s.people.filter((p) => p.kind === 'staff');
    expect(staff.length).toBeGreaterThan(3);
    for (let i = 0; i < 600; i++) tick(s);
    for (const p of staff) expect(applyCommand(s, { type: 'setBreak', staffId: p.id, on: true }).ok).toBe(true);
    for (let i = 0; i < 1500; i++) tick(s);
    for (const p of staff) expect(p.state).toBe('idle');
    for (const [i, p] of staff.entries()) for (const q of staff.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(0.45);
    for (const p of staff) applyCommand(s, { type: 'setBreak', staffId: p.id, on: false });
    day(s, true);
    expect(s.stuckRescues).toBe(0);
  });

  it('a cashier whose post the manager stands on waits beside them, ready to serve', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    s.cash = 5000;
    expect(applyCommand(s, { type: 'hire', candidateId: s.staffPool.find((c) => c.role === 'cashier')!.id }).ok).toBe(true);
    const cashier = s.people.find((p) => p.kind === 'staff')!;
    const reg = s.shop.fixtures.find((f) => f.staffId === cashier.id)!, post = fixtureBackWorld(s.shop, reg);
    const o = s.people.find((p) => p.kind === 'owner')!;
    o.x = o.px = post.x; o.z = o.pz = post.z; o.path = []; o.pathIdx = 0; o.state = 'idle';
    for (let i = 0; i < 1000; i++) tick(s);
    expect(cashier.state).toBe('idle');
    expect(Math.hypot(cashier.x - post.x, cashier.z - post.z)).toBeLessThan(0.8);
    expect(s.stuckRescues).toBe(0);
  });
});

describe('the team', () => {
  it('someone let go leaves for good, and a till they worked is free for another', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 5000;
    expect(applyCommand(s, { type: 'hire', candidateId: s.staffPool.find((c) => c.role === 'cashier')!.id }).ok).toBe(true);
    const p = s.people.find((x) => x.kind === 'staff')!;
    for (let i = 0; i < 100; i++) tick(s);
    expect(applyCommand(s, { type: 'fire', staffId: p.id }).ok).toBe(true);
    for (let i = 0; i < 100; i++) tick(s);
    expect(s.people.some((x) => x.id === p.id)).toBe(false);
    expect(s.shop.fixtures.some((f) => f.staffId === p.id)).toBe(false);
  });

  it('cashiers work the checkout counters, never a self-checkout (whose back is out through the wall)', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 1e5;
    // A self-checkout against the front wall, facing into the shop.
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'kiosk', x: -2.5, z: -1, rot: 2 }).ok).toBe(true);
    for (let k = 0; k < 3; k++) { const c = s.staffPool.find((x) => x.role === 'cashier'); if (c) expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true); }
    const cashiers = s.people.filter((x) => x.kind === 'staff' && x.role === 'cashier');
    expect(cashiers.length).toBeGreaterThan(1);
    const kiosk = s.shop.fixtures.find((f) => f.type === 'kiosk')!;
    // (An older save's cashier on it lets it go.)
    kiosk.staffId = cashiers[1]!.id;
    for (let i = 0; i < 120 / TICK; i++) {
      tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      if (i > 30 / TICK) {
        expect(kiosk.staffId ?? null).toBeNull();
        for (const p of cashiers) expect(toLocal(s.shop, p.x, p.z).z).toBeLessThan(s.shop.floor.z1);
      }
    }
  });
});
