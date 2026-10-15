import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK } from './index';
import { spawnTraffic } from './cars';

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
