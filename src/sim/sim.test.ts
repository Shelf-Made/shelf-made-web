import { describe, it, expect } from 'vitest';
import { newGame, tick, applyCommand, TICK, DAY_SECONDS, findPath, buildGrid, resetGridCache, type GameState } from './index';

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
    const a = newGame({ seed: 7, plotId: 'main', name: 'A' });
    const b = newGame({ seed: 7, plotId: 'main', name: 'A' });
    resetGridCache();
    for (let i = 0; i < 4000; i++) { tick(a); if (i % 6 === 0) applyCommand(a, { type: 'scan' }); }
    resetGridCache();
    for (let i = 0; i < 4000; i++) { tick(b); if (i % 6 === 0) applyCommand(b, { type: 'scan' }); }
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('runs a full day with customers served and nobody stuck', () => {
    const s = newGame({ seed: 3, plotId: 'main', name: 'Test' });
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
    const s = newGame({ seed: 3, plotId: 'main', name: 'Test' });
    resetGridCache();
    runDay(s, false);
    expect(s.today.served).toBe(0);
    expect(s.today.walkedOut).toBeGreaterThan(3);
  });

  it('delivers an order to the storeroom', () => {
    const s = newGame({ seed: 11, plotId: 'hill', name: 'Test' });
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
    const s = newGame({ seed: 1, plotId: 'main', name: 'T' });
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

  it('plot picking sets up the shop and the sign name', () => {
    const s = newGame({ seed: 5 });
    expect(s.phase).toBe('picking');
    applyCommand(s, { type: 'choosePlot', plotId: 'east', name: 'Corner Fresh' });
    expect(s.phase).toBe('open');
    expect(s.shop.name).toBe('Corner Fresh');
    expect(s.shop.originX).toBe(22);
  });
});
