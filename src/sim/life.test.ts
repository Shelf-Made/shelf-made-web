import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick } from './tick';
import { applyCommand } from './commands';
import { DAY_SECONDS, TICK, toWorld, FRONT_WALK_Z } from './layout';
import { lifeOf, dropLitter, onFrontage, frontageLitter } from './life';
import type { GameState } from './types';

/** Play a day with someone scanning, watching town life as it goes. */
function watchDay(s: GameState, seen: { poops: number; teens: number; hangouts: Set<number>; bumps: Set<number>; litter: number; dogStops: number; drivers: number; stoppedCars: number }): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) {
    tick(s);
    if (i % 6 === 0) applyCommand(s, { type: 'scan' });
    const life = lifeOf(s);
    seen.poops = Math.max(seen.poops, life.litter.filter((l) => l.kind === 'poop').length);
    seen.litter = Math.max(seen.litter, life.litter.length);
    for (const h of life.hangouts) seen.hangouts.add(h.id);
    for (const b of life.bumps) {
      if (!seen.bumps.has(b.id)) {
        seen.bumps.add(b.id);
        // Both cars stop where they are and hold.
        const cars = s.cars.filter((c) => c.id === b.a || c.id === b.b);
        expect(cars.length).toBe(2);
        for (const c of cars) expect(c.timer).toBeGreaterThan(5);
        seen.stoppedCars += cars.length;
      }
    }
    if (i % 20 === 0) {
      seen.teens = Math.max(seen.teens, s.people.filter((p) => p.life === 'teen').length);
      seen.dogStops += s.people.filter((p) => p.dogStop !== undefined).length;
      seen.drivers = Math.max(seen.drivers, s.people.filter((p) => p.life === 'driver').length);
    }
  }
}

describe('town life', () => {
  it('over a week: dogs stop and some leave a mess, teenagers hang about and litter, cars bump and carry on; the town is swept each night', () => {
    const s = openGame({ seed: 41, plotId: 'main', name: 'Life' });
    const seen = { poops: 0, teens: 0, hangouts: new Set<number>(), bumps: new Set<number>(), litter: 0, dogStops: 0, drivers: 0, stoppedCars: 0 };
    for (let d = 0; d < 7; d++) {
      watchDay(s, seen);
      expect(s.phase).toBe('night');
      // Swept overnight; everyone hanging about has gone home.
      expect(lifeOf(s).litter.length).toBe(0);
      expect(lifeOf(s).hangouts.length).toBe(0);
      applyCommand(s, { type: 'openTomorrow' });
    }
    expect(seen.dogStops).toBeGreaterThan(0);
    expect(seen.poops).toBeGreaterThan(0);
    expect(seen.hangouts.size).toBeGreaterThan(1);
    expect(seen.teens).toBeGreaterThanOrEqual(2);
    expect(seen.litter).toBeGreaterThan(3);
    expect(seen.bumps.size).toBeGreaterThan(0);
    expect(seen.drivers).toBe(2);
    // Nothing piles up: drivers get back in, teenagers walk off.
    const leftovers = s.people.filter((p) => p.life === 'driver');
    expect(leftovers.length).toBeLessThanOrEqual(2);
  });

  it('the same seed lives the same life', () => {
    const run = () => {
      const s = openGame({ seed: 42, plotId: 'main', name: 'Twice' });
      for (let i = 0; i < 600 / TICK; i++) tick(s);
      const life = lifeOf(s);
      return JSON.stringify({ litter: life.litter, hangouts: life.hangouts, bumps: life.bumps });
    };
    expect(run()).toBe(run());
  });

  it('asked to move along, the group outside the shop goes; mess on the frontage can be picked up', () => {
    const s = openGame({ seed: 43, plotId: 'main', name: 'Tidy' });
    const life = lifeOf(s);
    // Run until a group turns up (forcing the timer so it is soon).
    life.nextTeens = 0;
    let h = life.hangouts[0];
    for (let i = 0; i < 4000 && !h; i++) { tick(s); h = lifeOf(s).hangouts.find((x) => x.mine); if (!h && lifeOf(s).hangouts.length && s.tick % 400 === 0) { lifeOf(s).hangouts.length = 0; lifeOf(s).nextTeens = 0; } }
    if (h) {
      const ids = [...h.teens];
      expect(applyCommand(s, { type: 'moveAlong', hangoutId: h.id }).ok).toBe(true);
      expect(lifeOf(s).hangouts.some((x) => x.id === h!.id)).toBe(false);
      for (const id of ids) { const p = s.people.find((x) => x.id === id); if (p) { expect(p.state).toBe('walking'); expect(p.hangout).toBeUndefined(); } }
    }
    // A wrapper dropped on the pavement in front of the shop: the shop looks a little less cared for until it is picked up.
    const at = toWorld(s.shop, s.shop.door.x + 2, FRONT_WALK_Z);
    expect(onFrontage(s, at)).toBe(true);
    s.shop.cleanliness = 0.8;
    dropLitter(s, 'wrapper', at);
    expect(s.shop.cleanliness).toBeLessThan(0.8);
    const piece = frontageLitter(s).find((l) => Math.hypot(l.x - at.x, l.z - at.z) < 0.01)!;
    expect(piece).toBeTruthy();
    const before = s.shop.cleanliness;
    expect(applyCommand(s, { type: 'cleanTown', litterId: piece.id }).ok).toBe(true);
    expect(s.shop.cleanliness).toBeGreaterThan(before);
    expect(lifeOf(s).litter.some((l) => l.id === piece.id)).toBe(false);
    // Out on the far side of town is not the shop's frontage.
    expect(onFrontage(s, { x: -30, z: 30 })).toBe(false);
  });
});
