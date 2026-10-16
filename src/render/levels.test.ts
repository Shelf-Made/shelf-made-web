import { describe, it, expect } from 'vitest';
import { applyCommand } from '@/sim/index';
import { openGame } from '@/sim/testUtil';
import { toWorld } from '@/sim/layout';
import { underFloors } from './levels';

describe('what is in sight upstairs', () => {
  it('hides what is under a floor over it, but not under an opening or a double-height space', () => {
    const s = openGame({ seed: 91, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    // Stairs open the first floor (their flight an opening in it); a panel down over (-1.5, -1): a double-height space.
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    // Looked at from straight over it, a point drawn at height y over the ground floor's (x, z).
    const seen = (x: number, z: number, y: number, view: number | null) => { const w = toWorld(s.shop, x, z); return !underFloors(s.shop, { x: w.x, y: 12, z: w.z }, w.x, y, w.z, view); };
    // A shelf on the ground floor, under the first floor's boards: out of sight from up there, not from the ground floor.
    expect(seen(-2, -3.5, 0.5, 1)).toBe(false);
    expect(seen(-2, -3.5, 0.5, null)).toBe(false);
    expect(seen(-2, -3.5, 0.5, 0)).toBe(true);
    // Down the stairwell, and down into the double-height space.
    expect(seen(1, -2, 0.3, 1)).toBe(true);
    expect(seen(-1, -0.5, 0.3, 1)).toBe(true);
    // Anything on the first floor itself.
    expect(seen(-2, -3.5, 1.4, 1)).toBe(true);
    expect(seen(-2, -3.5, 1, 1)).toBe(true);
  });
});
