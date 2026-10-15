import { describe, it, expect } from 'vitest';
import { grassPatch } from './grass';

describe('grass patch', () => {
  it('is a unit square of short blades, each rooted at its own base', () => {
    const g = grassPatch();
    const pos = g.getAttribute('position'), root = g.getAttribute('root'), col = g.getAttribute('color');
    const blades = pos.count / 3;
    expect(blades).toBeGreaterThanOrEqual(80);
    expect(col.count).toBe(pos.count);
    for (let b = 0; b < blades; b++) {
      const rx = root.getX(b * 3), rz = root.getY(b * 3);
      expect(rx).toBeGreaterThanOrEqual(0); expect(rx).toBeLessThanOrEqual(1);
      expect(rz).toBeGreaterThanOrEqual(0); expect(rz).toBeLessThanOrEqual(1);
      // Two corners on the ground either side of the root, the tip above it: no taller than a tuft.
      for (const k of [0, 1]) { expect(pos.getY(b * 3 + k)).toBe(0); expect(Math.hypot(pos.getX(b * 3 + k) - rx, pos.getZ(b * 3 + k) - rz)).toBeLessThan(0.03); }
      const h = pos.getY(b * 3 + 2);
      expect(h).toBeGreaterThan(0.05); expect(h).toBeLessThan(0.17);
      for (const k of [1, 2]) { expect(root.getX(b * 3 + k)).toBe(rx); expect(root.getY(b * 3 + k)).toBe(rz); }
      // Darker at the root than at the tip.
      expect(col.getY(b * 3)).toBeLessThan(col.getY(b * 3 + 2));
    }
  });

  it('is the same lawn every load', () => {
    expect(Array.from(grassPatch().getAttribute('position').array)).toEqual(Array.from(grassPatch().getAttribute('position').array));
  });
});
