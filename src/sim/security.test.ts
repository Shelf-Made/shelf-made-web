import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, gridFor, doorInside, type GameState } from './index';
import { toWorld, tileKey, FIXTURES } from './layout';
import { nearestWalkable } from './grid';
import { spawnCustomer } from './people';
import { makeCandidate, staffLevel, levelBoost, wageFor, onShift, LEVEL_XP, gainXp } from './staff';
import { cameraCover, securityFactor, watchAt } from './security';
import { GRAB_REACH } from './commands';
import { productDef } from './products';
import { unitCost, INSTANT_MUL } from './economy';
import type { Person, Fixture, StaffRole } from './types';

function quiet(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'T', tutorial: false });
  s.people = s.people.filter((p) => p.kind === 'owner');
  for (const f of s.shop.fixtures) { f.queue = []; f.serving = null; }
  s.shop.storage = [];
  s.cash = 20000;
  const o = s.people[0]!;
  const at = nearestWalkable(gridFor(s), toWorld(s.shop, s.shop.floor.x1 - 0.5, s.shop.floor.z0 + 0.5));
  o.x = o.px = at.x; o.z = o.pz = at.z;
  return s;
}
function thiefAt(s: GameState, lx: number, lz: number): Person {
  const p = spawnCustomer(s, true)!;
  const spot = nearestWalkable(gridFor(s), toWorld(s.shop, lx, lz));
  p.x = p.px = spot.x; p.z = p.pz = spot.z; p.path = []; p.pathIdx = 0; p.xings = undefined;
  p.state = 'shopping'; p.list = [{ productId: 'bread', qty: 2 }]; p.listIdx = 1; p.basket = [{ productId: 'bread', qty: 2, price: 2.5 }];
  p.thief = true;
  return p;
}
function run(s: GameState, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < seconds / TICK; i++) { tick(s); s.people = s.people.filter((p) => p.kind !== 'customer' || p.thief); if (until?.()) return; }
}
function place(s: GameState, type: Fixture['type'], x: number, z: number, rot: 0 | 1 | 2 | 3 = 0): Fixture {
  const r = applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot });
  expect(r.message ?? '').toBe('');
  return s.shop.fixtures[s.shop.fixtures.length - 1]!;
}
function hire(s: GameState, role: StaffRole): Person {
  const c = makeCandidate(s, role);
  s.staffPool.push(c);
  expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
  return s.people.find((p) => p.id === c.id)!;
}
/** A free floor tile (no piece on it) on the ground floor, as near the back-left as there is. */
function freeTile(s: GameState, prefer: (x: number, z: number) => boolean = () => true): { x: number; z: number } {
  const f = s.shop.floor;
  for (let z = f.z0; z < f.z1; z++) for (let x = f.x0; x < f.x1; x++) {
    if (!prefer(x, z)) continue;
    if (s.shop.fixtures.some((fx) => fx.x === x && fx.z === z)) continue;
    if (applyCommand(structuredClone(s), { type: 'placeFixture', fixtureType: 'dome', x, z, rot: 0 }).ok) return { x, z };
  }
  throw new Error('no free tile');
}

describe('security cameras', () => {
  it('a wall camera watches the floor in front of it, not behind; a dome all round it, over a shelf too', () => {
    const s = quiet(51);
    const f = s.shop.floor;
    // On the back wall, looking into the shop.
    const x = s.shop.backDoor.x - 0.5 === f.x0 + 1 ? f.x0 + 2 : f.x0 + 1;
    const cam = place(s, 'camera', x, f.z0, 0);
    const cover = cameraCover(s.shop);
    expect(cover.get(tileKey(cam.x, cam.z + 2))).toBeTruthy();
    expect(cover.get(tileKey(f.x0, f.z1 - 1))).toBeFalsy();
    expect(cover.size).toBeLessThan((f.x1 - f.x0) * (f.z1 - f.z0));
    // A dome may hang over a shelf (it shares the tile), and watches the tiles round it.
    const shelf = s.shop.fixtures.find((fx) => fx.type === 'shelf')!;
    const dome = place(s, 'dome', shelf.x, shelf.z, 0);
    expect(dome.x).toBe(shelf.x);
    expect(cameraCover(s.shop).get(tileKey(shelf.x + 1, shelf.z))).toBeTruthy();
    // But not two up there on one tile.
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'smartCam', x: shelf.x, z: shelf.z, rot: 0 }).ok).toBe(false);
    expect(FIXTURES.dome.overhead).toBe(true);
  });

  it('put shoplifters off, and a guard on duty more so', () => {
    const s = quiet(52);
    expect(securityFactor(s)).toBe(1);
    const t = freeTile(s);
    place(s, 'dome', t.x, t.z);
    const cams = securityFactor(s);
    expect(cams).toBeLessThan(1);
    hire(s, 'guard');
    expect(securityFactor(s)).toBeLessThan(cams * 0.7);
  });

  it('a smart camera holds a running thief still a moment, long enough to be caught', () => {
    const s = quiet(53);
    const f = s.shop.floor;
    const p = thiefAt(s, f.x0 + 0.6, f.z0 + 0.6);
    // Smart cameras over the whole way out.
    for (let z = f.z0; z < f.z1; z += 3) for (let x = f.x0; x < f.x1; x += 3) applyCommand(s, { type: 'placeFixture', fixtureType: 'smartCam', x, z, rot: 0 });
    expect(watchAt(s, p)?.smart).toBe(true);
    run(s, 0.2);
    expect(p.state).toBe('fleeing');
    run(s, 0.5);
    expect(p.zapped).toBe(true);
    const at = { x: p.x, z: p.z };
    run(s, 2);
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThan(0.05);
  });
});

describe('tag gates', () => {
  it('beep at a thief running out through them, and stop most', () => {
    let stopped = 0;
    for (let seed = 60; seed < 70; seed++) {
      const s = quiet(seed);
      // (The one way out, gated: a thief goes out by whichever door is nearest.)
      s.shop.fixtures = s.shop.fixtures.filter((x) => x.type !== 'backDoor'); s.shop.layoutVersion++;
      const d = s.shop.door, f = s.shop.floor;
      place(s, 'tagGate', d.x - 0.5, f.z1 - 1, 0);
      const p = thiefAt(s, f.x0 + 0.6, f.z0 + 0.6);
      run(s, 40, () => (s.today.caught ?? 0) > 0 || (s.today.escaped ?? 0) > 0);
      expect(p.gated).toBe(true);
      if (s.today.caught) { stopped++; expect(s.today.theft).toBe(0); }
    }
    expect(stopped).toBeGreaterThanOrEqual(4);
    expect(stopped).toBeLessThan(10);
  });
});

describe('guards', () => {
  it('stand by the door, never stock shelves, and run a thief down; a catch is worth experience', () => {
    const s = quiet(71);
    const g = hire(s, 'guard');
    const d = doorInside(s);
    g.x = g.px = d.x + 1.1; g.z = g.pz = d.z - 0.5; g.state = 'idle';
    s.shop.storage = [{ productId: 'bread', qty: 30, day: s.day }];
    run(s, 4);
    expect(g.task ?? null).toBeNull();
    const f = s.shop.floor;
    thiefAt(s, f.x0 + 0.6, f.z0 + 0.6);
    run(s, 30, () => (s.today.caught ?? 0) > 0 || (s.today.escaped ?? 0) > 0);
    expect(s.today.caught).toBe(1);
    expect(g.xp).toBeGreaterThanOrEqual(40);
  });

  it('the manager grabs a thief running past (Use), but not from across the shop', () => {
    const s = quiet(72);
    const f = s.shop.floor;
    const p = thiefAt(s, f.x0 + 0.6, f.z0 + 0.6);
    run(s, 0.2);
    expect(p.state).toBe('fleeing');
    const o = s.people.find((x) => x.kind === 'owner')!;
    const far = applyCommand(s, { type: 'grabThief', personId: p.id });
    expect(far.ok).toBe(false);
    o.x = p.x + GRAB_REACH * 0.8; o.z = p.z;
    expect(applyCommand(s, { type: 'grabThief', personId: p.id }).ok).toBe(true);
    expect(p.busted).toBe(true);
    expect(s.today.caught).toBe(1);
  });
});

describe('staff levels, breaks and looks', () => {
  it('experience from the job raises the level, up to 5, each a fifth quicker', () => {
    const s = quiet(81);
    const c = hire(s, 'cashier');
    expect(staffLevel(c)).toBe(1);
    expect(levelBoost(c)).toBe(1);
    gainXp(s, c, LEVEL_XP[2]!);
    expect(staffLevel(c)).toBe(3);
    expect(levelBoost(c)).toBeCloseTo(1.4);
    expect(s.notices.some((n) => /level 3/.test(n.text))).toBe(true);
    gainXp(s, c, 99999);
    expect(staffLevel(c)).toBe(5);
  });

  it('a cashier earns experience scanning; a break takes them off the floor at half pay', () => {
    const s = quiet(82);
    const c = hire(s, 'cashier');
    const reg = s.shop.fixtures.find((f) => f.staffId === c.id)!;
    expect(reg).toBeTruthy();
    // A shopper at the till with a few things.
    for (let i = 0; i < 3; i++) { const q = spawnCustomer(s, true)!; q.thief = true; q.state = 'shopping'; q.list = [{ productId: 'bread', qty: 1 }]; q.listIdx = 1; q.basket = [{ productId: 'bread', qty: 1, price: 2.5 }, { productId: 'milk', qty: 1, price: 2 }]; q.thief = false; }
    for (let i = 0; i < 60 / TICK && !(c.xp ?? 0); i++) tick(s);
    expect(c.xp ?? 0).toBeGreaterThan(0);
    const wage = wageFor(c);
    applyCommand(s, { type: 'setBreak', staffId: c.id, on: true });
    expect(onShift(c, s.time)).toBe(false);
    expect(wageFor(c)).toBe(Math.round(wage * 0.5));
    expect(s.shop.fixtures.some((f) => f.staffId === c.id)).toBe(false);
    const xp = c.xp;
    applyCommand(s, { type: 'setBreak', staffId: c.id, on: false });
    expect(onShift(c, s.time)).toBe(true);
    expect(c.xp).toBe(xp);
  });

  it('the dice give a new name and a new look, the same every time for the same game', () => {
    const a = quiet(83), b = quiet(83);
    const ca = hire(a, 'stocker'), cb = hire(b, 'stocker');
    const before = { name: ca.name, look: JSON.stringify(ca.look) };
    applyCommand(a, { type: 'restyleStaff', staffId: ca.id });
    applyCommand(b, { type: 'restyleStaff', staffId: cb.id });
    expect(ca.name !== before.name || JSON.stringify(ca.look) !== before.look).toBe(true);
    expect(ca.name).toBe(cb.name);
    expect(ca.look).toEqual(cb.look);
  });
});

describe('ordering', () => {
  it('instant delivery puts the goods on the pallet at once, for a quarter more', () => {
    const s = quiet(91);
    const cash = s.cash;
    const r = applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'bread', qty: 10 }], instant: true });
    expect(r.ok).toBe(true);
    expect(s.shop.storage.find((e) => e.productId === 'bread')?.qty).toBe(10);
    expect(cash - s.cash).toBeCloseTo(10 * Math.round(unitCost('bread', 'local', s) * INSTANT_MUL * 100) / 100, 2);
    expect(productDef('bread').cost).toBeGreaterThan(0);
  });
});
