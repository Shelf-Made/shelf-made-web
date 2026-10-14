import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK } from './index';
import { spawnTraffic, spawnCustomerCar, carTo } from './cars';
import { STOP_LINE, greenFor, LANE_EAST_Z, LANE_WEST_Z, LANE_SOUTH_X, LANE_NORTH_X, toLocal, CORNERS } from './layout';
import { rivalVisitors, rivalFront } from './rivalShoppers';
import { onZebra } from './streets';
import type { GameState } from './types';

function run(s: GameState, seconds: number, each?: (s: GameState, i: number) => void): void {
  for (let i = 0; i < seconds / TICK; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); each?.(s, i); }
}

describe('crossroads traffic', () => {
  it('no two cars overlap at rush hour, junction included, and nobody runs a red', () => {
    const s = openGame({ seed: 7, plotId: 'elm', name: 'Cars' });
    let worst = Infinity, redRuns = 0, sawQueue = false;
    const prev = new Map<number, { x: number; z: number }>();
    run(s, 420, (st, i) => {
      if (i % 30 === 0) spawnTraffic(st);
      const moving = st.cars.filter((c) => c.state !== 'parked' && c.state !== 'unloading');
      for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) worst = Math.min(worst, Math.hypot(moving[a]!.x - moving[b]!.x, moving[a]!.z - moving[b]!.z));
      for (const c of st.cars) {
        const p = prev.get(c.id);
        if (p) {
          // A car that crosses its stop line must have had a green (or amber) light.
          const east = Math.abs(c.z - LANE_EAST_Z) < 0.3 && p.x < STOP_LINE.eastbound && c.x >= STOP_LINE.eastbound;
          const west = Math.abs(c.z - LANE_WEST_Z) < 0.3 && p.x > STOP_LINE.westbound && c.x <= STOP_LINE.westbound;
          const south = Math.abs(c.x - LANE_SOUTH_X) < 0.3 && p.z < STOP_LINE.southbound && c.z >= STOP_LINE.southbound;
          const north = Math.abs(c.x - LANE_NORTH_X) < 0.3 && p.z > STOP_LINE.northbound && c.z <= STOP_LINE.northbound;
          if ((east || west) && greenFor('main', st.tick) === 'stop') redRuns++;
          if ((south || north) && greenFor('side', st.tick) === 'stop') redRuns++;
        }
        prev.set(c.id, { x: c.x, z: c.z });
      }
      if (st.cars.some((c) => Math.abs(c.x - STOP_LINE.eastbound) < 0.2 && Math.abs(c.z - LANE_EAST_Z) < 0.3 && c.speed > 0 && c.px === c.x)) sawQueue = true;
    });
    expect(worst).toBeGreaterThan(0.75);
    expect(redRuns).toBe(0);
    expect(sawQueue).toBe(true);
    // Traffic keeps flowing: nothing piles up (about 30 cars are on the roads at this rate).
    expect(s.cars.length).toBeLessThan(55);
    expect(s.cars.filter((c) => (c.waited ?? 0) > 15).length).toBe(0);
  });

  it('a car turned away by a full lot parks at a rival, on Elm Street, or leaves town; it never gets stuck', () => {
    const s = openGame({ seed: 12, plotId: 'main', name: 'Full' });
    for (const r of s.rivals) r.open = true;
    for (const b of s.shop.bays) b.carId = 999999;
    const sent: number[] = [];
    for (let k = 0; k < 6; k++) {
      const { car, onward } = spawnCustomerCar(s, 5000 + k, k % 2 === 0);
      expect(onward).not.toBeNull();
      if (car) sent.push(car.id);
    }
    expect(sent.length).toBeGreaterThan(0);
    let parkedElsewhere = 0;
    run(s, 120, (st) => { for (const c of st.cars) if (sent.includes(c.id) && c.state === 'parked') parkedElsewhere++; });
    expect(parkedElsewhere).toBeGreaterThan(0);
    for (const c of s.cars.filter((x) => sent.includes(x.id))) {
      expect(c.state === 'parked' || c.state === 'leaving').toBe(true);
      expect((c.waited ?? 0)).toBeLessThan(20);
    }
  });
});

describe('Elm Street bays', () => {
  it('a car pulls into a bay past the car parked in the bay behind it', () => {
    const s = openGame({ seed: 14, plotId: 'main', name: 'Kerb' });
    const me = s.people.find((p) => p.kind === 'owner')!.id;
    const first = carTo(s, { kind: 'street', bay: 0 }, false, 0, me)!;
    run(s, 40);
    expect(first.state).toBe('parked');
    const second = carTo(s, { kind: 'street', bay: 1 }, false, 1, me)!;
    let worst = 0;
    run(s, 40, () => { worst = Math.max(worst, second.waited ?? 0); });
    expect(second.state).toBe('parked');
    expect(Math.hypot(second.x - s.streetBays[1]!.x, second.z - s.streetBays[1]!.z)).toBeLessThan(0.05);
    expect(worst).toBeLessThan(10);
  });

  it('a parked car whose driver has gone home drives off and frees its bay', () => {
    const s = openGame({ seed: 15, plotId: 'main', name: 'Orphan' });
    const car = carTo(s, { kind: 'street', bay: 0 }, false, 0, 424242)!;
    run(s, 60);
    expect(car.state === 'leaving' || car.state === 'gone' || !s.cars.includes(car)).toBe(true);
    expect(s.streetBays[0]!.carId).toBeNull();
  });
});

describe('rival shoppers', () => {
  it('walk in at a rival door, come out with bags, and their numbers rise during a sale', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'Watch' });
    for (const r of s.rivals) r.open = true;
    const base = rivalVisitors(s).discount!;
    const cheapo = s.rivals.find((r) => r.id === 'discount')!;
    cheapo.saleDaysLeft = 2;
    const sale = rivalVisitors(s).discount!;
    expect(sale).toBeGreaterThan(base * 1.1);
    cheapo.saleDaysLeft = 0;
    const entered = new Set<number>(), bagged = new Set<number>();
    const door = rivalFront(cheapo).door;
    run(s, 300, (st) => {
      for (const p of st.people) {
        if (!p.rivalId) continue;
        if (p.state === 'inRival') { entered.add(p.id); expect(Math.hypot(p.x - (st.rivals.find((r) => r.id === p.rivalId)!.x), p.z - st.rivals.find((r) => r.id === p.rivalId)!.z)).toBeLessThan(0.3); }
        if (p.bags) bagged.add(p.id);
      }
    });
    expect(entered.size).toBeGreaterThan(3);
    expect(bagged.size).toBeGreaterThan(0);
    for (const id of bagged) expect(entered.has(id)).toBe(true);
    void door;
  });

  it('walkers only stand on a zebra during the walk phase or while finishing a crossing', () => {
    const s = openGame({ seed: 9, plotId: 'bus', name: 'Walk' });
    for (const r of s.rivals) r.open = true;
    let onZebraAtRed = 0, crossings = 0;
    const wasOn = new Set<number>();
    run(s, 240, (st) => {
      for (const p of st.people) {
        if ((p.kind !== 'walker' && !p.xings) || p.state === 'driving') continue;
        const on = onZebra(p);
        if (on && !wasOn.has(p.id)) { crossings++; if (greenFor('main', st.tick) !== 'stop' || greenFor('side', st.tick) !== 'stop') onZebraAtRed++; }
        if (on) wasOn.add(p.id); else wasOn.delete(p.id);
      }
    });
    expect(crossings).toBeGreaterThan(3);
    expect(onZebraAtRed).toBe(0);
  });
});

describe('corners', () => {
  it('south corners are turned half round: their doors face north onto Main Road', () => {
    const s = openGame({ seed: 3, plotId: 'bus', name: 'South' });
    expect(s.shop.originX).toBe(CORNERS.sw.originX);
    const door = toLocal(s.shop, s.shop.originX, s.shop.originZ - 1);
    // One unit north of the origin in the world is one unit in front of the door (shop-relative +z).
    expect(door.z).toBeCloseTo(1);
  });
});
