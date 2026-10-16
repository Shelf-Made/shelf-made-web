import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3, Color } from 'three';
import { applyCommand } from '@/sim/index';
import { openGame } from '@/sim/testUtil';
import { spawnCustomer } from '@/sim/people';
import { toWorld, zOnLevel, storeysOf, liftWorld } from '@/sim/layout';
import { Overlays } from './Overlays';

describe('the heat and paths views upstairs', () => {
  it('cover the floor being built on, where it is drawn, with the shoppers up there', () => {
    const s = openGame({ seed: 93, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    // A shopper standing upstairs, on their way across the floor.
    const p = spawnCustomer(s, true)!;
    const at = toWorld(s.shop, -1, zOnLevel(-3.5, 1)), next = toWorld(s.shop, -2, zOnLevel(-3.5, 1));
    p.x = p.px = at.x; p.z = p.pz = at.z; p.state = 'walking'; p.path = [{ x: next.x, z: next.z }]; p.pathIdx = 0;
    const o = new Overlays(), tiles = (o as unknown as { tiles: { count: number; getMatrixAt(i: number, m: Matrix4): void; getColorAt(i: number, c: Color): void } }).tiles;
    // Each tile: where it is drawn, and how hot.
    const read = () => Array.from({ length: tiles.count }, (_, i) => { const m = new Matrix4(), c = new Color(); tiles.getMatrixAt(i, m); tiles.getColorAt(i, c); return { at: new Vector3().setFromMatrixPosition(m), hot: c.r > c.g }; });
    const over = (q: { x: number; z: number }) => { const l = liftWorld(s.shop, q.x, q.z); return (t: { at: Vector3 }) => Math.abs(t.at.x - l.x) < 0.5 && Math.abs(t.at.z - l.z) < 0.5; };
    o.kind = 'heat';
    for (let i = 0; i < 5; i++) o.sample(s);
    o.update(s, 1);
    const heat = read();
    expect(heat.length).toBe(storeysOf(s.shop).floors[1]!.size);
    expect(heat.every((t) => Math.abs(t.at.y - 1.05) < 1e-6)).toBe(true);
    expect(heat.find(over(at))?.hot).toBe(true);
    o.kind = 'paths';
    o.update(s, 1);
    expect(read().find(over(next))?.hot).toBe(true);
  });
});
