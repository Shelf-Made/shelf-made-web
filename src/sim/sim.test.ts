import { CORNERS } from './layout';
import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { newGame, tick, applyCommand, TICK, DAY_SECONDS, findPath, buildGrid, resetGridCache, gridFor, type GameState } from './index';
import { cellOf, isBlocked, fixtureAccessWorld } from './grid';
import { spawnCustomer } from './people';
import { canPlace } from './build';
import { toWorld, toLocal } from './layout';

function runDay(state: GameState, autoScan = true): void {
  const ticks = Math.ceil((DAY_SECONDS + 130) / TICK);
  for (let i = 0; i < ticks && state.phase !== 'night'; i++) {
    tick(state);
    if (autoScan && i % 6 === 0) applyCommand(state, { type: 'scan' });
    if (i % 200 === 0) { const shelf = state.shop.fixtures.find((f) => f.type === 'shelf')!; applyCommand(state, { type: 'carry', fixtureId: shelf.id }); }
  }
}

describe('simulation', () => {
  it('is deterministic for the same seed and commands', () => {
    const a = openGame({ seed: 7, plotId: 'main', name: 'A' });
    const b = openGame({ seed: 7, plotId: 'main', name: 'A' });
    resetGridCache();
    for (let i = 0; i < 4000; i++) { tick(a); if (i % 6 === 0) applyCommand(a, { type: 'scan' }); }
    resetGridCache();
    for (let i = 0; i < 4000; i++) { tick(b); if (i % 6 === 0) applyCommand(b, { type: 'scan' }); }
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('runs a full day with customers served and nobody stuck', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'Test' });
    resetGridCache();
    runDay(s);
    expect(s.phase).toBe('night');
    expect(s.today.customers).toBeGreaterThan(10);
    expect(s.today.served).toBeGreaterThan(5);
    expect(s.stuckRescues).toBe(0);
    expect(s.history.length).toBe(1);
    expect(s.people.filter((p) => p.kind === 'customer').length).toBe(0);
  });

  it('serves nobody and loses customers when nobody scans', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'Test' });
    resetGridCache();
    runDay(s, false);
    expect(s.today.served).toBe(0);
    expect(s.today.walkedOut).toBeGreaterThan(3);
  });

  it('delivers an order to the storeroom', () => {
    const s = openGame({ seed: 11, plotId: 'elm', name: 'Test' });
    resetGridCache();
    const before = s.shop.storage.reduce((a, e) => a + e.qty, 0);
    const res = applyCommand(s, { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'milk', qty: 10 }, { productId: 'rice', qty: 5 }] });
    expect(res.ok).toBe(true);
    for (let i = 0; i < (60 / TICK) * 2.5; i++) tick(s);
    const after = s.shop.storage.reduce((a, e) => a + e.qty, 0);
    expect(after - before).toBe(15);
    expect(s.orders[0]!.state).toBe('delivered');
  });

  it('finds paths around fixtures and through the door', () => {
    const s = openGame({ seed: 1, plotId: 'main', name: 'T' });
    const g = buildGrid(s.shop, 1);
    const o = { x: s.shop.originX, z: s.shop.originZ };
    const outside = { x: o.x, z: o.z + 1 };
    const back = { x: o.x - 1, z: o.z - 2.5 };
    const path = findPath(g, outside, back);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(1);
    // Through the wall is not allowed: a point east of the wall should route via the door.
    const outsideEast = { x: o.x + 2, z: o.z + 1 };
    const p2 = findPath(g, outsideEast, back)!;
    // Every crossing of the front wall line must happen inside the 1-unit door gap.
    const pts = [outsideEast, ...p2];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      if ((a.z - o.z) * (b.z - o.z) < 0) {
        const t = (o.z - a.z) / (b.z - a.z);
        const x = a.x + (b.x - a.x) * t;
        expect(Math.abs(x - o.x)).toBeLessThan(0.5);
      }
    }
  });

  it('starts as a bare shell and only opens once there is a counter and stock', () => {
    const s = newGame({ seed: 8, plotId: 'main', name: 'Bare' });
    expect(s.shop.fixtures.length).toBe(0);
    expect(s.phase).toBe('setup');
    expect(applyCommand(s, { type: 'openShop' }).ok).toBe(false);
    for (let i = 0; i < 2000; i++) tick(s);
    expect(s.people.filter((p) => p.kind === 'customer').length).toBe(0);
    expect(s.time).toBe(0);
    s.cash = 2000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: 1.5, z: -3, rot: 2 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: 0.3, z: -3, rot: 0 }).ok).toBe(false); // off the tile grid
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: -6, rot: 0 }).ok).toBe(false); // delivery zone
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: -3, rot: 1 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'bread', qty: 10 }] }).ok).toBe(true);
    for (let i = 0; i < 70 / TICK; i++) tick(s);
    expect(s.shop.storage.reduce((a, e) => a + e.qty, 0)).toBe(10);
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    expect(applyCommand(s, { type: 'carry', fixtureId: shelf.id }).ok).toBe(true);
    for (let i = 0; i < 40 / TICK; i++) tick(s);
    expect(shelf.slots.some((sl) => sl.productId === 'bread' && sl.qty > 0)).toBe(true);
    expect(applyCommand(s, { type: 'openShop' }).ok).toBe(true);
    expect(s.phase).toBe('open');
  });

  it('you scan in person: far from the till, Space walks you there first', () => {
    const s = openGame({ seed: 12, plotId: 'main', name: 'T' });
    const owner = s.people.find((p) => p.kind === 'owner')!;
    owner.x = owner.px = s.shop.originX - 2; owner.z = owner.pz = s.shop.originZ - 1;
    for (let i = 0; i < 3000 && !s.shop.fixtures.find((f) => f.type === 'register')!.serving; i++) tick(s);
    const res = applyCommand(s, { type: 'scan' });
    expect(res.ok).toBe(false);
    expect(owner.state).toBe('walking');
    for (let i = 0; i < 200; i++) tick(s);
    expect(applyCommand(s, { type: 'scan' }).ok).toBe(true);
  });

  it('WASD steering never walks through walls or fixtures', () => {
    const s = openGame({ seed: 13, plotId: 'main', name: 'T' });
    const owner = s.people.find((p) => p.kind === 'owner')!;
    const g = gridFor(s);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
    for (let k = 0; k < 40; k++) {
      const [x, z] = dirs[(k * 5) % dirs.length]!;
      applyCommand(s, { type: 'moveDir', x, z });
      for (let i = 0; i < 40; i++) {
        tick(s);
        const [cx, cz] = cellOf(g, owner);
        expect(isBlocked(g, cx, cz)).toBe(false);
      }
    }
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
  });

  it('plot picking sets up the shop and the sign name', () => {
    const s = newGame({ seed: 5 });
    expect(s.phase).toBe('picking');
    applyCommand(s, { type: 'choosePlot', plotId: 'bus', name: 'Corner Fresh' });
    expect(s.phase).toBe('setup');
    expect(s.shop.name).toBe('Corner Fresh');
    expect(s.shop.originX).toBe(CORNERS.sw.originX);
    expect(s.shop.flip).toBe(true);
    // The rivals took the other three corners.
    expect(new Set(s.rivals.map((r) => r.corner))).toEqual(new Set(['nw', 'ne', 'se']));
  });
  it('building never traps the manager: not on top of you, never boxing you in', () => {
    const s = newGame({ seed: 9, plotId: 'main', name: 'Boxed' });
    s.cash = 5000;
    const o = s.people.find((p) => p.kind === 'owner')!;
    const at = toWorld(s.shop, 1.0, -3.5);
    o.x = o.px = at.x; o.z = o.pz = at.z;
    expect(canPlace(s, 'shelf', 0.5, -4, 0).reason).toBe('You are standing there');
    // Walls of shelves round the manager's tile: the last one that would close the ring is refused.
    const ring: [number, number][] = [[-0.5, -4], [1.5, -4], [0.5, -5], [-0.5, -5], [1.5, -5], [-0.5, -3], [1.5, -3]];
    for (const [x, z] of ring) expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x, z, rot: 0 }).ok, `${x},${z}`).toBe(true);
    expect(canPlace(s, 'shelf', 0.5, -3, 0).reason).toBe('Would box you in');
    // Nor sealing the spot in front of the pallet into a pocket (the stock has to come off it).
    const t = newGame({ seed: 9, plotId: 'main', name: 'Pallet' });
    t.cash = 5000;
    expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: -4, rot: 0 }).ok).toBe(true);
    expect(canPlace(t, 'shelf', -1.5, -5, 0).reason).toBe('Would block the way to the delivery pallet');
  });

  it('clicking a shelf against the wall walks you to its room side', () => {
    const s = newGame({ seed: 10, plotId: 'bus', name: 'Wall' });
    s.cash = 5000;
    // Facing west, straight into the wall: its front tile is outside the floor.
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: -4, rot: 3 }).ok).toBe(true);
    const f = s.shop.fixtures[0]!;
    const o = s.people.find((p) => p.kind === 'owner')!;
    const w = fixtureAccessWorld(s.shop, f, o), p = toLocal(s.shop, w.x, w.z);
    expect(p.x).toBeGreaterThan(s.shop.floor.x0);
    expect(Math.hypot(p.x - (f.x + 0.5), p.z - (f.z + 0.5))).toBeCloseTo(1, 5);
  });
  it('never sends anyone to stand in a pocket sealed off behind a fixture', () => {
    const s = newGame({ seed: 10, plotId: 'bus', name: 'Pocket' });
    const fl = s.shop.floor, x = fl.x1 - 1, z = fl.z0;
    // In the back corner: a shelf against the back wall and a fridge in front of the corner tile seal it off
    // (the side wall and the back wall do the rest; the back door is further along).
    s.shop.fixtures.push({ id: 9001, type: 'shelf', x: x - 1, z, rot: 0, slots: [] }, { id: 9003, type: 'fridge', x, z: z + 1, rot: 0, slots: [] });
    s.shop.layoutVersion++;
    const fridge = s.shop.fixtures.find((f) => f.id === 9003)!;
    // Coming from the corner the sealed tile is the nearest side, and it used to be chosen.
    const pocket = toWorld(s.shop, x + 0.5, z + 0.5);
    expect(Math.abs(x + 0.5 - s.shop.backDoor.x)).toBeGreaterThan(1.5);
    const w = fixtureAccessWorld(s.shop, fridge, pocket), p = toLocal(s.shop, w.x, w.z);
    expect(Math.hypot(p.x - (x + 0.5), p.z - (z + 0.5))).toBeGreaterThan(0.5);
    const door = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 - 0.5);
    expect(findPath(gridFor(s), door, w)).toBeTruthy();
  });
  it('a shelf pushed against the wall is shopped from inside, never through the wall', () => {
    const s = openGame({ seed: 17, plotId: 'main', name: 'Wallside' });
    s.cash = 5000;
    const fl = s.shop.floor;
    // Against the east wall, facing it: its front tile is outside the building.
    const spot = [-5, -4, -3, -2].map((z) => ({ x: fl.x1 - 1, z })).find((t) => canPlace(s, 'shelf', t.x, t.z, 1).ok)!;
    expect(spot).toBeTruthy();
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: spot.x, z: spot.z, rot: 1 }).ok).toBe(true);
    const shelf = s.shop.fixtures.find((f) => f.x === spot.x && f.z === spot.z)!;
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId === 'chocolate') sl.productId = null;
    shelf.slots[0] = { productId: 'chocolate', qty: 8 };
    const shoppers = Array.from({ length: 4 }, () => spawnCustomer(s, true)!).filter(Boolean);
    for (const p of shoppers) { p.list = [{ productId: 'chocolate', qty: 1 }]; p.listIdx = 0; }
    const at: { x: number; z: number }[] = [];
    for (let i = 0; i < 240 / TICK; i++) {
      tick(s);
      for (const p of shoppers) if (p.state === 'browsing' && p.targetFixture === shelf.id && p.timer > 0) at.push(toLocal(s.shop, p.x, p.z));
      if (i % 6 === 0) applyCommand(s, { type: 'scan' });
    }
    expect(at.length).toBeGreaterThan(0);
    for (const q of at) { expect(q.x).toBeLessThan(fl.x1); expect(q.x).toBeGreaterThan(fl.x0); expect(q.z).toBeLessThan(fl.z1); }
    // A counter facing the wall is refused: its line would form outside.
    expect(canPlace(s, 'register', fl.x0, -1, 3).reason).toMatch(/face into the shop|reach|block|standing|already/i);
  });

  it('a till line never waits on someone who has left the world', () => {
    const s = openGame({ seed: 16, plotId: 'main', name: 'Ghost' });
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    // Somebody at the head of the line vanishes (closing time sends the last customers home).
    reg.queue = [987654, ...(reg.queue ?? [])];
    let served = s.today.served;
    for (let i = 0; i < 240 / TICK; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
    expect(reg.queue.includes(987654)).toBe(false);
    served = s.today.served - served;
    expect(served).toBeGreaterThan(0);
  });
});

describe('designing the manager', () => {
  it('sets character, height and colours, puts colours back, refuses nonsense, and keeps the look in a save', async () => {
    const s = newGame({ seed: 21, plotId: 'main', name: 'Looks' });
    const o = s.people.find((p) => p.kind === 'owner')!;
    expect(applyCommand(s, { type: 'designManager', look: { model: 3, height: 1.1, skin: '#c8925a', hair: '#E9C46A', top: '#3570BC', bottom: '#38383D' } }).ok).toBe(true);
    expect(o.look).toMatchObject({ model: 3, height: 1.1, skin: '#C8925A', hair: '#E9C46A', top: '#3570BC', bottom: '#38383D' });
    expect(applyCommand(s, { type: 'designManager', look: { hair: null } }).ok).toBe(true);
    expect(o.look.hair).toBeUndefined();
    expect(applyCommand(s, { type: 'designManager', look: { model: 40 } }).ok).toBe(false);
    // A guy or a girl: the shop worker (12) is not one of the choices.
    expect(applyCommand(s, { type: 'designManager', look: { model: 12 } }).ok).toBe(false);
    expect(applyCommand(s, { type: 'designManager', look: { top: 'red' } }).ok).toBe(false);
    expect(applyCommand(s, { type: 'designManager', look: { height: 3 } }).ok).toBe(true);
    expect(o.look.height).toBeLessThanOrEqual(1.12);
    const { serialize, parse } = await import('../save/saves');
    const back = parse(serialize(s)).state.people.find((p) => p.kind === 'owner')!;
    expect(back.look).toEqual(o.look);
  });
});
