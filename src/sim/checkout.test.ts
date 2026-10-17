import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand, tick, gridFor, type GameState } from './index';
import { scanItem, twinTill, queueSlot, tillIdle, CONVEYOR_PRICE } from './people';
import { queueDrain } from './furniture';
import { isFree } from './shoplifting';
import { makeCandidate } from './staff';
import { fixtureBackWorld, fixtureFrontWorld, fixtureFacingWorld, fixtureCentre, fixtureFront, cellOf, cellIndex } from './grid';
import { toWorld, refundOf, FIXTURES, CHANGED_MIND } from './layout';
import type { Fixture, Person, Vec2 } from './types';

function shopper(s: GameState, items: number): Person {
  const p = { id: s.nextId++, kind: 'customer', state: 'paying', basket: [{ productId: 'bread', qty: items, price: 2 }], look: { model: 0, variant: 0, height: 1 }, x: 0, z: 0, px: 0, pz: 0, yaw: 0, anim: 'pay', path: [], pathIdx: 0, speed: 1, timer: 0 } as Person;
  s.people.push(p);
  return p;
}

/** Someone at the front of a till's line with `items` to pay for. */
function payingAt(s: GameState, reg: Fixture, items: number): Person {
  const p = shopper(s, items), at = queueSlot(s, reg, 0);
  p.x = p.px = at.x; p.z = p.pz = at.z; p.registerId = reg.id;
  reg.serving = p.id; reg.scanned = 0;
  return p;
}

/** A cashier (a middling one, new to it) on a till and stood behind it, with nobody else about but the manager. */
function cashierOn(s: GameState, reg: Fixture): Person {
  s.people = s.people.filter((p) => p.kind === 'owner');
  for (const f of s.shop.fixtures) { f.queue = []; f.serving = null; }
  s.cash = 5000;
  const c = makeCandidate(s, 'cashier');
  c.skill = 0.5; s.staffPool.push(c);
  expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
  const p = s.people.find((x) => x.id === c.id)!;
  for (const f of s.shop.fixtures) f.staffId = null;
  reg.staffId = p.id;
  const at = fixtureBackWorld(s.shop, reg);
  p.x = p.px = at.x; p.z = p.pz = at.z; p.state = 'idle'; p.path = []; p.pathIdx = 0;
  return p;
}

/** Ticks until each of them has paid (nobody else let in meanwhile). */
function ticksToPay(s: GameState, ps: Person[]): number[] {
  const done = ps.map(() => 0);
  for (let t = 1; t < 2000 && done.some((d) => !d); t++) {
    tick(s);
    s.people = s.people.filter((p) => p.kind !== 'customer' || ps.includes(p));
    ps.forEach((p, i) => { if (p.paid && !done[i]) done[i] = t; });
  }
  return done;
}

/** Two tills back to back in the middle of the floor (one facing the front, one the back, a tile between them to stand on). */
function twins(s: GameState): [Fixture, Fixture] {
  s.cash = 9999;
  const fl = s.shop.floor;
  let pair: [number, number] | null = null;
  for (let z = fl.z0 + 2; z < fl.z1 - 1 && !pair; z++) for (let x = fl.x0; x < fl.x1 && !pair; x++) {
    const t = structuredClone(s);
    if (applyCommand(t, { type: 'placeFixture', fixtureType: 'register', x, z, rot: 0 }).ok && applyCommand(t, { type: 'placeFixture', fixtureType: 'register', x, z: z - 2, rot: 2 }).ok) pair = [x, z];
  }
  expect(pair).not.toBeNull();
  applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: pair![0], z: pair![1], rot: 0 });
  applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: pair![0], z: pair![1] - 2, rot: 2 });
  return [s.shop.fixtures[s.shop.fixtures.length - 2]!, s.shop.fixtures[s.shop.fixtures.length - 1]!];
}

describe('the tills', () => {
  it('a conveyor belt scans two at a press, for a price', () => {
    const s = openGame({ seed: 40, plotId: 'main', name: 'T', tutorial: false });
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    s.cash = CONVEYOR_PRICE - 1;
    expect(applyCommand(s, { type: 'upgradeTill', fixtureId: reg.id }).ok).toBe(false);
    s.cash = 5000;
    expect(applyCommand(s, { type: 'upgradeTill', fixtureId: reg.id }).ok).toBe(true);
    expect(s.cash).toBe(5000 - CONVEYOR_PRICE);
    expect(applyCommand(s, { type: 'upgradeTill', fixtureId: reg.id }).ok).toBe(false);
    const p = shopper(s, 5);
    reg.serving = p.id; reg.scanned = 0;
    scanItem(s, reg);
    expect(reg.scanned).toBe(2);
    scanItem(s, reg); scanItem(s, reg);
    // Five scanned in three presses: paid.
    expect(p.paid).toBe(true);
  });

  it('two tills back to back share the spot behind them (one cashier serves both)', () => {
    const s = openGame({ seed: 41, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const first = s.shop.fixtures.find((f) => f.type === 'register')!;
    expect(twinTill(s, first)).toBeUndefined();
    const [a, b] = twins(s);
    expect(Math.hypot(fixtureBackWorld(s.shop, a).x - fixtureBackWorld(s.shop, b).x, fixtureBackWorld(s.shop, a).z - fixtureBackWorld(s.shop, b).z)).toBeLessThan(0.3);
    expect(twinTill(s, a)).toBe(b);
    expect(twinTill(s, b)).toBe(a);
  });

  it('a conveyor belt gets people through a cashier about 60% quicker (one item a scan, as ever)', () => {
    const run = (belt: boolean) => {
      const s = openGame({ seed: 40, plotId: 'main', name: 'T', tutorial: false });
      const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
      reg.conveyor = belt;
      const c = cashierOn(s, reg), xp = c.xp ?? 0;
      const [t] = ticksToPay(s, [payingAt(s, reg, 8)]);
      return { t: t!, xp: (c.xp ?? 0) - xp };
    };
    const plain = run(false), belt = run(true);
    expect(plain.t).toBeGreaterThan(0);
    expect(belt.t).toBeGreaterThan(0);
    // 1.6 times as quick, give or take a tick a scan (not the belt counted twice over: 3 times as quick).
    expect(plain.t / belt.t).toBeGreaterThan(1.3);
    expect(plain.t / belt.t).toBeLessThan(2);
    // The same experience for the same eight things rung up.
    expect(belt.xp).toBe(plain.xp);
  });

  it('one cashier on two tills back to back: serves both, one shopper at a time, and the sales are theirs', () => {
    const s = openGame({ seed: 41, plotId: 'main', name: 'T', tutorial: false });
    const [a, b] = twins(s);
    const c = cashierOn(s, a);
    expect(isFree(s, c)).toBe(true);
    // Someone paying at the other till: the cashier is busy (no wandering off to mop or give chase).
    const lone = payingAt(s, b, 8);
    expect(tillIdle(s, c)).toBe(false);
    expect(isFree(s, c)).toBe(false);
    const [alone] = ticksToPay(s, [lone]);
    expect(alone).toBeGreaterThan(0);
    // Rung up by the cashier, not the manager across the shop.
    expect(lone.servedBy).toBe('staff');
    expect(lone.servedSkill).toBe(c.skill);
    // One at each till: one pair of hands, so the two take about twice as long as one did.
    const both = ticksToPay(s, [payingAt(s, a, 8), payingAt(s, b, 8)]);
    expect(Math.min(...both)).toBeGreaterThan(alone! * 1.6);
  });

  it('a belt just fitted to an older till: sold straight away, all the belt comes back', () => {
    const s = openGame({ seed: 40, plotId: 'main', name: 'T', tutorial: false });
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!, price = FIXTURES.register.price;
    s.day = 5; reg.bought = 1; s.cash = 5000;
    expect(applyCommand(s, { type: 'upgradeTill', fixtureId: reg.id }).ok).toBe(true);
    expect(refundOf(reg, s, CONVEYOR_PRICE)).toBe(Math.round(price * 0.6) + CONVEYOR_PRICE);
    // Once the shop has traded with it a while (or the next day), 60% of the lot, as for anything else.
    expect(refundOf(reg, { day: s.day, time: s.time + CHANGED_MIND + 1 }, CONVEYOR_PRICE)).toBe(Math.round((price + CONVEYOR_PRICE) * 0.6));
    expect(refundOf(reg, { day: s.day + 1, time: 0 }, CONVEYOR_PRICE)).toBe(Math.round((price + CONVEYOR_PRICE) * 0.6));
    // An older save's belt, with no day on it: as before.
    delete reg.conveyorBought;
    expect(refundOf(reg, s, CONVEYOR_PRICE)).toBe(Math.round((price + CONVEYOR_PRICE) * 0.6));
  });

  it('queue barriers keep the line straight and calmer', () => {
    const s = openGame({ seed: 42, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    const front = fixtureFrontWorld(s.shop, reg), face = fixtureFacingWorld(s.shop, reg.rot);
    // (The place where a plain line bends: this till faces the back wall, so a barred line runs straight only so far past it.)
    const bent = queueSlot(s, reg, 3);
    const straightness = (q: { x: number; z: number }) => Math.abs((q.x - front.x) * face.z - (q.z - front.z) * face.x);
    // Barriers beside the line: posts a tile to the side of it, along its first tiles.
    let placed = 0;
    for (let x = s.shop.floor.x0; x < s.shop.floor.x1; x++) for (let z = s.shop.floor.z0; z < s.shop.floor.z1; z++) {
      if (placed < 2 && applyCommand(structuredClone(s), { type: 'placeFixture', fixtureType: 'queueRail', x, z, rot: 0 }).ok) {
        const w = toWorld(s.shop, x + 0.5, z + 0.5), dx = w.x - front.x, dz = w.z - front.z, along = dx * face.x + dz * face.z, side = Math.abs(dx * face.z - dz * face.x);
        if (along > 0 && along < 4 && side > 0.6 && side < 1.3 && applyCommand(s, { type: 'placeFixture', fixtureType: 'queueRail', x, z, rot: 0 }).ok) placed++;
      }
    }
    expect(placed).toBeGreaterThan(0);
    const straight = queueSlot(s, reg, 3);
    expect(straightness(straight)).toBeLessThan(straightness(bent));
    const rail = s.shop.fixtures.find((f) => f.type === 'queueRail')!;
    expect(queueDrain(s, fixtureCentre(s.shop, rail))).toBeLessThan(queueDrain(s));
  });

  it('queue barriers by a wall never take the line through it (nobody queues out the back)', () => {
    const s = openGame({ seed: 40, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    // The starter till faces the back wall a few places from it: two barriers a tile to the side of its line.
    expect(reg.rot).toBe(2);
    const fr = fixtureFront(reg);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'queueRail', x: fr.x - 1.5, z: fr.z - 1.5, rot: 1 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'queueRail', x: fr.x - 1.5, z: fr.z - 0.5, rot: 1 }).ok).toBe(true);
    const g = gridFor(s);
    const inside = (q: Vec2) => { const [cx, cz] = cellOf(g, q); return g.inside[cellIndex(g, cx, cz)] === 1; };
    for (let k = 0; k < 8; k++) expect(inside(queueSlot(s, reg, k))).toBe(true);
  });
});
