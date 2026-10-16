import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand, type GameState } from './index';
import { scanItem, twinTill, queueSlot, CONVEYOR_PRICE } from './people';
import { queueDrain } from './furniture';
import { fixtureBackWorld, fixtureFrontWorld, fixtureFacingWorld, fixtureCentre } from './grid';
import { toWorld } from './layout';
import type { Person } from './types';

function shopper(s: GameState, items: number): Person {
  const p = { id: s.nextId++, kind: 'customer', state: 'paying', basket: [{ productId: 'bread', qty: items, price: 2 }], look: { model: 0, variant: 0, height: 1 }, x: 0, z: 0, px: 0, pz: 0, yaw: 0, anim: 'pay', path: [], pathIdx: 0, speed: 1, timer: 0 } as Person;
  s.people.push(p);
  return p;
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
    // A pair in the middle of the floor: one facing the front, one the back, a tile between them to stand on.
    const fl = s.shop.floor;
    let pair: [number, number] | null = null;
    for (let z = fl.z0 + 2; z < fl.z1 - 1 && !pair; z++) for (let x = fl.x0; x < fl.x1 && !pair; x++) {
      const t = structuredClone(s);
      if (applyCommand(t, { type: 'placeFixture', fixtureType: 'register', x, z, rot: 0 }).ok && applyCommand(t, { type: 'placeFixture', fixtureType: 'register', x, z: z - 2, rot: 2 }).ok) pair = [x, z];
    }
    expect(pair).not.toBeNull();
    applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: pair![0], z: pair![1], rot: 0 });
    applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: pair![0], z: pair![1] - 2, rot: 2 });
    const a = s.shop.fixtures[s.shop.fixtures.length - 2]!, b = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    expect(Math.hypot(fixtureBackWorld(s.shop, a).x - fixtureBackWorld(s.shop, b).x, fixtureBackWorld(s.shop, a).z - fixtureBackWorld(s.shop, b).z)).toBeLessThan(0.3);
    expect(twinTill(s, a)).toBe(b);
    expect(twinTill(s, b)).toBe(a);
  });

  it('queue barriers keep the line straight and calmer', () => {
    const s = openGame({ seed: 42, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 9999;
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    const front = fixtureFrontWorld(s.shop, reg), face = fixtureFacingWorld(s.shop, reg.rot);
    const bent = queueSlot(s, reg, 5);
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
    const straight = queueSlot(s, reg, 5);
    expect(straightness(straight)).toBeLessThanOrEqual(straightness(bent) + 1e-6);
    const rail = s.shop.fixtures.find((f) => f.type === 'queueRail')!;
    expect(queueDrain(s, fixtureCentre(s.shop, rail))).toBeLessThan(queueDrain(s));
  });
});
