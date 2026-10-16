import { describe, it, expect } from 'vitest';
import { applyCommand } from '@/sim/index';
import { openGame } from '@/sim/testUtil';
import { toWorld } from '@/sim/layout';
import { underFloors, floorMet } from './levels';

describe('what is in sight upstairs', () => {
  it('hides what is under a floor over it, but not under an opening or a double-height space', () => {
    const s = openGame({ seed: 91, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    // Stairs open the first floor (their flight an opening in it); a panel down over (-1.5, -1): a double-height space.
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    // Looked at from straight over it, a point drawn at height y over the ground floor's (x, z), on floor `on`.
    const seen = (x: number, z: number, y: number, on: number, view: number | null) => { const w = toWorld(s.shop, x, z); return !underFloors(s.shop, { x: w.x, y: 12, z: w.z }, w.x, y, w.z, on, view); };
    // A shelf on the ground floor, under the first floor's boards: out of sight from up there, not from the ground floor.
    expect(seen(-2, -3.5, 0.5, 0, 1)).toBe(false);
    expect(seen(-2, -3.5, 0.5, 0, null)).toBe(false);
    expect(seen(-2, -3.5, 0.5, 0, 0)).toBe(true);
    // A piece a storey tall (a wall, the delivery's boxes): its top is flush with the boards over it, and as hidden.
    expect(seen(-2, -3.5, 1, 0, 1)).toBe(false);
    expect(seen(-2, -3.5, 1, 0, 0)).toBe(true);
    // Down the stairwell, and down into the double-height space.
    expect(seen(1, -2, 0.3, 0, 1)).toBe(true);
    expect(seen(-1, -0.5, 0.3, 0, 1)).toBe(true);
    expect(seen(-1, -0.5, 1, 0, 1)).toBe(true);
    // Anything on the first floor itself.
    expect(seen(-2, -3.5, 1.4, 1, 1)).toBe(true);
    expect(seen(-2, -3.5, 1, 1, 1)).toBe(true);
    // The stairs' rail, up through their opening, seen from out front: the boards past it are not in the way.
    const rail = toWorld(s.shop, 1.4, -2.9), eye = toWorld(s.shop, 1, 2);
    expect(underFloors(s.shop, { x: eye.x, y: 4, z: eye.z }, rail.x, 1.3, rail.z, 0, 1)).toBe(false);
  });
  it('says which floor a look down meets first with the whole building drawn: the top boards, else down a gap', () => {
    const s = openGame({ seed: 92, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    // Straight down onto a point of the ground floor's (x, z), from out front and above.
    const met = (x: number, z: number) => { const w = toWorld(s.shop, x, z), e = toWorld(s.shop, x, z + 6); return floorMet(s.shop, { x: e.x, y: 12, z: e.z }, { x: w.x - e.x, y: -12, z: w.z - e.z }); };
    // Over the shelves: the first floor's boards.
    expect(met(-2, -3.5)).toBe(1);
    // Down the stairwell, into the double-height space, and out on the lawn: the ground.
    expect(met(1, -2.5)).toBe(0);
    expect(met(-1, -0.5)).toBe(0);
    expect(met(-6, -3)).toBe(0);
    // Looking up from under the boards meets none of them.
    const w = toWorld(s.shop, -2, -3.5);
    expect(floorMet(s.shop, { x: w.x, y: 0.5, z: w.z }, { x: 0, y: 1, z: 0 })).toBe(0);
  });
});
