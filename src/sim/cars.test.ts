import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK } from './index';
import { spawnTraffic, tickCars, leaveLot } from './cars';
import { lotLayout, toLocal, toWorld, LOT_FRONT } from './layout';
import type { Car, GameState } from './types';

/** Do two cars' bodies (1.5 × 0.82, centred) overlap? Separating-axis test on the two rectangles. */
function bodiesOverlap(a: Car, b: Car, margin = 0.02): boolean {
  const hl = 0.75 - margin, hw = 0.41 - margin;
  const axes = (c: Car) => [[Math.sin(c.yaw), Math.cos(c.yaw)], [Math.cos(c.yaw), -Math.sin(c.yaw)]] as const;
  const corners = (c: Car) => { const [f, r] = axes(c); return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, j]) => [c.x + f[0] * hl * i! + r[0] * hw * j!, c.z + f[1] * hl * i! + r[1] * hw * j!]); };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of [...axes(a), ...axes(b)]) {
    const pa = ca.map(([x, z]) => x! * ax + z! * az), pb = cb.map(([x, z]) => x! * ax + z! * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** A parked car nose-in at the player's bay i (no driver, so it stays put). */
function parkAt(s: GameState, i: number, id: number): Car {
  const b = s.shop.bays[i]!, L = lotLayout(s.shop), dx = (L.driveway.x0 + L.driveway.x1) / 2;
  const l = toLocal(s.shop, b.x, b.z), side = l.x < dx ? -1 : 1;
  const n = toWorld(s.shop, l.x + side, l.z);
  const car: Car = { id, model: 0, x: b.x, z: b.z, yaw: Math.atan2(n.x - b.x, n.z - b.z), px: b.x, pz: b.z, pyaw: 0, path: [], pathIdx: 0, speed: 0, state: 'parked', bay: i, ownerId: null, timer: 0 };
  car.pyaw = car.yaw; b.carId = id;
  s.cars.push(car);
  return car;
}

describe('backing out of a bay', () => {
  it('rolls back round an arc (the rear axle never slides sideways), clears the cars either side, then drives off', () => {
    for (const plotId of ['main', 'elm', 'bus']) for (const rows of [1, 2]) {
      const s = openGame({ seed: 4, plotId, name: 'Reverse' });
      s.cars = []; s.people = s.people.filter((p) => p.kind === 'owner');
      s.shop.lotRows = rows;
      const L = lotLayout(s.shop);
      s.shop.bays = L.bays.map((bb) => ({ ...toWorld(s.shop, bb.x, bb.z), yaw: 0, carId: null }));
      const perRow = rows > 1 ? s.shop.bays.length / 2 : s.shop.bays.length;
      for (let i = 0; i < s.shop.bays.length; i++) {
        s.cars = []; for (const bb of s.shop.bays) bb.carId = null;
        // Neighbours either side in the same row.
        const row = Math.floor(i / perRow), k = i % perRow;
        const others = [k - 1, k + 1].filter((j) => j >= 0 && j < perRow).map((j, n) => parkAt(s, row * perRow + j, 900 + n));
        const car = parkAt(s, i, 800);
        leaveLot(s, car);
        let worstSlip = 0, worstTurn = 0, overlaps = 0, reversed = 0;
        for (let t = 0; t < 40 / TICK && s.cars.includes(car); t++) {
          const was = { x: car.x - 0.45 * Math.sin(car.yaw), z: car.z - 0.45 * Math.cos(car.yaw), yaw: car.yaw, rev: !!car.reversing };
          tickCars(s);
          // Never into the cars either side, backing out or pulling away.
          for (const o of others) if (bodiesOverlap(car, o)) overlaps++;
          if (!was.rev) continue;
          reversed++;
          const r = { x: car.x - 0.45 * Math.sin(car.yaw), z: car.z - 0.45 * Math.cos(car.yaw) };
          const mx = r.x - was.x, mz = r.z - was.z, m = Math.hypot(mx, mz);
          const hx = Math.sin(was.yaw), hz = Math.cos(was.yaw);
          // Sideways movement of the rear axle, and turning faster than the arc allows.
          worstSlip = Math.max(worstSlip, Math.abs(mx * hz - mz * hx) - 0.03 * m);
          let dy = car.yaw - was.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
          worstTurn = Math.max(worstTurn, Math.abs(dy) - m / 1.3 - 1e-6);
        }
        const where = `${plotId} rows ${rows} bay ${i}`;
        expect(reversed, where).toBeGreaterThan(10);
        expect(worstSlip, where).toBeLessThan(0.002);
        expect(worstTurn, where).toBeLessThan(0.002);
        expect(overlaps, where).toBe(0);
        // And it got away: out of the lot and gone.
        expect(s.cars.includes(car), where).toBe(false);
      }
    }
  });
});

describe('traffic', () => {
  it('cars queue behind each other instead of driving through', () => {
    const s = openGame({ seed: 11, plotId: 'main', name: 'Cars' });
    let worstSameLane = Infinity, worstAny = Infinity, parkedOk = 0;
    for (let i = 0; i < (360 / TICK); i++) {
      // Rush hour: far more traffic than the game ever makes.
      if (i % 30 === 0) spawnTraffic(s);
      tick(s);
      if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      const moving = s.cars.filter((c) => c.state !== 'parked' && c.state !== 'unloading');
      for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) {
        const A = moving[a]!, B = moving[b]!;
        const d = Math.hypot(A.x - B.x, A.z - B.z);
        worstAny = Math.min(worstAny, d);
        const fx = Math.sin(A.yaw), fz = Math.cos(A.yaw);
        const same = fx * Math.sin(B.yaw) + fz * Math.cos(B.yaw) > 0.95;
        const side = Math.abs((B.x - A.x) * fz - (B.z - A.z) * fx);
        if (same && side < 0.4) worstSameLane = Math.min(worstSameLane, d);
      }
      parkedOk += s.cars.filter((c) => c.state === 'parked').length;
    }
    // Same lane: a car length and a gap. Anything else: never inside each other.
    expect(worstSameLane).toBeGreaterThan(1.6);
    expect(worstAny).toBeGreaterThan(0.75);
    expect(parkedOk).toBeGreaterThan(0);
  });

  it('parked cars sit nose-in, square to their bay', () => {
    const s = openGame({ seed: 5, plotId: 'bus', name: 'Bays' });
    // Every car seen parked over five minutes (not just the ones parked at the end).
    const parked = new Map<number, { yaw: number }>();
    for (let i = 0; i < 300 / TICK; i++) {
      tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      for (const c of s.cars) if (c.state === 'parked') parked.set(c.id, { yaw: c.yaw });
    }
    expect(parked.size).toBeGreaterThan(0);
    for (const c of parked.values()) {
      const q = c.yaw / (Math.PI / 2);
      expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-6);
      // First-row bays face the shop wall: the car drove in forwards. (South corners are turned half round.)
      expect(Math.sin(c.yaw) * (s.shop.flip ? -1 : 1)).toBeLessThan(-0.99);
    }
  });
});

describe('getting out of the car', () => {
  // The step out was put a fixed way in the world: on the corner turned round (the bus stop's), toward the shop, and
  // the nearest free floor was inside it. They appeared in the shop, walked out of the door and back in.
  it('every driver steps out on the lot, never inside the shop, on every corner', () => {
    for (const plotId of ['main', 'elm', 'bus']) {
      const s = openGame({ seed: 1, plotId, name: 'Out', tutorial: false });
      const f = s.shop.floor, was = new Map<number, string>();
      let inside = 0, out = 0;
      // (Six minutes: Elm Street is a quiet corner, few enough drive there that four can be a near thing.)
      for (let i = 0; i < 360 / TICK; i++) {
        tick(s);
        if (i % 6 === 0) applyCommand(s, { type: 'scan' });
        for (const p of s.people) {
          if (p.kind !== 'customer') continue;
          if (was.get(p.id) === 'driving' && p.state === 'toDoor') { out++; const l = toLocal(s.shop, p.x, p.z); if (l.x > f.x0 && l.x < f.x1 && l.z > f.z0 && l.z < f.z1) inside++; }
          was.set(p.id, p.state);
        }
      }
      expect(out, plotId).toBeGreaterThan(3);
      expect(inside, plotId).toBe(0);
    }
  });
});

describe('a lot laid by hand', () => {
  /** Dig up the car park and the service lane, and sell the bays: a bare lot to lay your own on. */
  function bare(seed: number): GameState {
    const s = openGame({ seed, plotId: 'main', name: 'Lane', tutorial: false });
    s.cash = 50000;
    for (const f of s.shop.fixtures.filter((x) => x.type === 'parkingBay')) expect(applyCommand(s, { type: 'removeFixture', fixtureId: f.id }).ok).toBe(true);
    for (const [k, v] of Object.entries(s.shop.lotTiles!)) {
      if (v !== 'asphalt') continue;
      const [x, z] = k.split(',').map(Number) as [number, number];
      expect(applyCommand(s, { type: 'pave', x, z, surface: null }).ok).toBe(true);
    }
    return s;
  }

  it('one lane a tile wide, bays either side: cars take turns in it, never meet head on, and give up rather than block the road', () => {
    const s = bare(5);
    for (let z = 1.5; z >= -4.5; z--) expect(applyCommand(s, { type: 'pave', x: 8, z, surface: 'asphalt' }).ok).toBe(true);
    for (const z of [-0.5, -1.5, -2.5, -3.5]) {
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'parkingBay', x: 9, z, rot: 3 }).ok).toBe(true);
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'parkingBay', x: 7, z, rot: 1 }).ok).toBe(true);
    }
    expect(s.shop.bays.length).toBe(8);
    let worst = Infinity, parked = 0, out = 0;
    const was = new Map<number, string>();
    for (let i = 0; i < 600 / TICK; i++) {
      tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      const moving = s.cars.filter((c) => c.state !== 'parked' && c.state !== 'unloading');
      for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) worst = Math.min(worst, Math.hypot(moving[a]!.x - moving[b]!.x, moving[a]!.z - moving[b]!.z));
      parked += s.cars.filter((c) => c.state === 'parked' && c.lot === undefined).length;
      for (const c of s.cars) if (c.lot === undefined) expect(c.waited ?? 0, `car ${c.id} ${c.state}`).toBeLessThan(35);
      for (const p of s.people) { if (was.get(p.id) === 'driving' && p.state === 'toDoor') out++; was.set(p.id, p.state); }
    }
    expect(worst).toBeGreaterThan(0.75);
    expect(parked).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(3);
  });

  it('with no tarmac to the back door, the truck unloads at the kerb (and the news says how to fix it)', () => {
    const s = bare(6);
    expect(applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [{ productId: 'bread', qty: 10 }] }).ok).toBe(true);
    let truck = null as Car | null;
    for (let i = 0; i < 120 / TICK && !s.orders.every((o) => o.state === 'delivered'); i++) { tick(s); truck ??= s.cars.find((c) => c.model >= 6 && c.model <= 7) ?? null; }
    expect(s.orders.every((o) => o.state === 'delivered')).toBe(true);
    expect(s.notices.some((n) => n.text.startsWith('No tarmac to the back door'))).toBe(true);
    // It stopped on the road, by the door, never on the lot.
    const l = toLocal(s.shop, truck!.x, truck!.z);
    expect(l.z).toBeGreaterThan(LOT_FRONT);
  });
});
