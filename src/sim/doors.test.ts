import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, DAY_SECONDS, toLocal, type GameState } from './index';
import { truckStop } from './drive';
import { entrances } from './layout';

/** Take down the wall on this edge and put `type` there (a doorway bought, or a door the shop has moved). */
function door(s: GameState, x: number, z: number, rot: 0 | 1 | 2 | 3, move?: 'frontDoor' | 'backDoor'): void {
  const w = s.shop.fixtures.find((f) => f.type === 'wall' && f.x === x && f.z === z && f.rot === rot)!;
  expect(applyCommand(s, { type: 'removeFixture', fixtureId: w.id }).ok).toBe(true);
  const r = move
    ? applyCommand(s, { type: 'moveFixture', fixtureId: s.shop.fixtures.find((f) => f.type === move)!.id, x, z, rot })
    : applyCommand(s, { type: 'placeFixture', fixtureType: 'doorway', x, z, rot });
  expect(r.ok, r.message).toBe(true);
}

describe('doors', () => {
  it('every door in an outside wall is a way in, and shoppers take whichever is quickest for them', () => {
    // (Two days' shoppers, in two shops: one day's few dozen can go either way.)
    const used = new Map<string, number>();
    for (const seed of [3, 4]) {
      const s = openGame({ seed, plotId: 'main', name: 'T', tutorial: false });
      s.cash = 1e5;
      // A doorway in the side wall by the car park.
      door(s, s.shop.floor.x1 - 1, -2, 3);
      expect(entrances(s.shop).length).toBe(3);
      const seen = new Set<number>();
      for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) {
        tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' });
        for (const p of s.people) {
          if (p.kind !== 'customer' || p.state !== 'entering' || seen.has(p.id)) continue;
          seen.add(p.id);
          const k = `${p.carId != null ? 'car' : 'foot'} ${s.shop.fixtures.find((f) => f.id === p.doorId)?.type}`;
          used.set(k, (used.get(k) ?? 0) + 1);
        }
      }
      expect(s.stuckRescues).toBe(0);
    }
    // Drivers mostly in at the side, by the car park; walkers off the street at the front.
    expect(used.get('car doorway') ?? 0).toBeGreaterThan(used.get('car frontDoor') ?? 0);
    expect(used.get('foot frontDoor') ?? 0).toBeGreaterThan(used.get('foot doorway') ?? 0);
  });

  it('deliveries come to the door by the pallet, wherever it is, and staff on a break wait out there', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 1e5;
    const f = s.shop.floor;
    // The back door into the west wall, by the service lane.
    door(s, f.x0, -5, 1, 'backDoor');
    expect(s.shop.backDoor).toEqual({ x: f.x0, z: -4.5 });
    const stop = truckStop(s.shop)!;
    expect(stop.at.x).toBeLessThan(f.x0);
    expect(applyCommand(s, { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'bread', qty: 24 }] }).ok).toBe(true);
    let unloaded: { x: number; z: number } | null = null;
    for (let i = 0; i < 200 / TICK && !unloaded; i++) { tick(s); const c = s.cars.find((x) => x.state === 'unloading'); if (c) unloaded = toLocal(s.shop, c.x, c.z); }
    expect(unloaded).not.toBeNull();
    expect(unloaded!.x).toBeLessThan(f.x0);
    for (const c of s.staffPool.slice(0, 3)) applyCommand(s, { type: 'hire', candidateId: c.id });
    for (let i = 0; i < 200; i++) tick(s);
    const staff = s.people.filter((p) => p.kind === 'staff');
    for (const p of staff) applyCommand(s, { type: 'setBreak', staffId: p.id, on: true });
    for (let i = 0; i < 1500; i++) tick(s);
    // Outside the west wall, by that door.
    for (const p of staff) { const l = toLocal(s.shop, p.x, p.z); expect(l.x).toBeLessThan(f.x0); expect(Math.abs(l.z + 4.5)).toBeLessThan(3.5); }
    expect(s.stuckRescues).toBe(0);
  });
});
