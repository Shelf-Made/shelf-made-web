import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, computeScores, playerShare, DAY_SECONDS, TICK, resetGridCache, queueSlot, toWorld, gridFor } from './index';
import { doorReaches } from './people';
import { cellOf, isBlocked } from './grid';

describe('customers and rivals', () => {
  it('prices move the price score and bargain share', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'T' });
    s.rivals[0]!.open = true;
    const before = playerShare(s).bargain;
    for (const id of Object.keys(s.prices)) applyCommand(s, { type: 'setPrice', productId: id, price: s.prices[id]! * 1.4 });
    expect(computeScores(s).price).toBeLessThan(0.3);
    expect(playerShare(s).bargain).toBeLessThan(before);
  });
  it('rivals open on schedule and run sales', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'T' });
    resetGridCache();
    for (let day = 1; day <= 4; day++) {
      for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
      applyCommand(s, { type: 'openTomorrow' });
    }
    expect(s.rivals.find((r) => r.id === 'discount')!.open).toBe(true);
    expect(s.notices.some((n) => /opened/.test(n.text))).toBe(true);
    expect(s.stuckRescues).toBe(0);
  });
  it('customers respect budgets and the shop records misses', () => {
    const s = openGame({ seed: 2, plotId: 'bus', name: 'T' });
    resetGridCache();
    for (let i = 0; i < 6000; i++) { tick(s); if (i % 4 === 0) applyCommand(s, { type: 'scan' }); }
    expect(s.today.served).toBeGreaterThan(3);
    expect(s.scores.waitSamples).toBeGreaterThan(0);
  });
});

describe('the line at a till', () => {
  /** The spots a till's line stands on: each one reached from the door, none on top of another. */
  const line = (s: ReturnType<typeof openGame>, reg: NonNullable<ReturnType<typeof openGame>['shop']['fixtures'][number]>) => {
    const spots = [0, 1, 2, 3, 4, 5].map((k) => queueSlot(s, reg, k));
    const cut = spots.findIndex((q) => !doorReaches(s, q) || isBlocked(gridFor(s), ...cellOf(gridFor(s), q)));
    let close = Infinity;
    spots.forEach((a, i) => spots.forEach((b, j) => { if (i < j) close = Math.min(close, Math.hypot(a.x - b.x, a.z - b.z)); }));
    return { cut, close };
  };

  // A spot that fell on a piece went to the nearest free floor: a pocket nobody gets to (walked to through the
  // chiller), or right on the spot before it (the next in line stood inside the one paying).
  it('takes spots the door reaches, a body apart, round anything in the way', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'Q', tutorial: false });
    s.cash = 5000;
    const o = s.people.find((p) => p.kind === 'owner')!, out = toWorld(s.shop, 0, 1);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    s.people = [o];
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: -0.5, z: -5, rot: 3 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'fridge', x: -2.5, z: -5, rot: 3 }).ok).toBe(true);
    const reg = s.shop.fixtures[s.shop.fixtures.length - 2]!;
    expect(line(s, reg)).toEqual({ cut: -1, close: expect.any(Number) });
    expect(line(s, reg).close).toBeGreaterThan(0.6);

    const t = openGame({ seed: 1, plotId: 'main', name: 'Q', tutorial: false });
    t.cash = 5000;
    const till = t.shop.fixtures.find((f) => f.type === 'register')!;
    expect([till.x, till.z, till.rot]).toEqual([1.5, -3, 2]);
    // A shelf two tiles in front of it.
    expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'shelf', x: 1.5, z: -5, rot: 0 }).ok).toBe(true);
    expect(line(t, till).cut).toBe(-1);
    expect(line(t, till).close).toBeGreaterThan(0.6);
  });
});
