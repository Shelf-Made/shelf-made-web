import { describe, it, expect } from 'vitest';
import { applyCommand } from '@/sim/index';
import { openGame } from '@/sim/testUtil';
import { toWorld, zOnLevel } from '@/sim/layout';
import { underFloors, floorMet, spillMark } from './levels';

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
  it('through the eyes under a floor, hides what is up on it, but not up the stairwell or a double-height space', () => {
    const s = openGame({ seed: 94, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    // From eye height on floor `from`, stood over the ground floor's (ex, ez), a point drawn at height y over its (x, z), on floor `on`.
    const seen = (ex: number, ez: number, from: number, x: number, z: number, y: number, on: number) => { const e = toWorld(s.shop, ex, ez), w = toWorld(s.shop, x, z); return !underFloors(s.shop, { x: e.x, y: from + 0.6, z: e.z }, w.x, y, w.z, on, null); };
    // On the ground floor: a shelf upstairs is over the ceiling (its underside too); one down here is in sight.
    expect(seen(-2, -1.5, 0, -2, -3.5, 1.4, 1)).toBe(false);
    expect(seen(-2, -1.5, 0, -2, -3.5, 1, 1)).toBe(false);
    expect(seen(-2, -1.5, 0, -2, -3.5, 0.5, 0)).toBe(true);
    // Up the stairwell, and up through the double-height space.
    expect(seen(1, -0.8, 0, 1, -4.5, 1.9, 1)).toBe(true);
    expect(seen(-1, -0.2, 0, -1, -1.8, 1.9, 1)).toBe(true);
    // Upstairs, what is up there is in sight.
    expect(seen(-2, -1.5, 1, -2, -3.5, 1.4, 1)).toBe(true);
    // A spill upstairs: its marker behind the ceiling, not over it.
    const e = toWorld(s.shop, -2, -1.5), w = toWorld(s.shop, -1.5, zOnLevel(-3.5, 1));
    expect(spillMark(s.shop, { x: e.x, y: 0.6, z: e.z }, w.x, w.z, null)).toEqual({ hidden: false, below: true });
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
  it("draws a spill's marker over everything but a floor over it: from outside too, under the top floor's boards", () => {
    const s = openGame({ seed: 93, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    // A spill at (x, z) on floor `on` (where the sim has it), seen from out front and above, the floor in view `view`.
    const mark = (x: number, z: number, on: number, view: number | null) => { const w = toWorld(s.shop, x, zOnLevel(z, on)), e = toWorld(s.shop, x, z + 6); return spillMark(s.shop, { x: e.x, y: 12, z: e.z }, w.x, w.z, view); };
    // Under the first floor's boards: behind them from outside (every floor drawn), as from up there.
    expect(mark(-1.5, -3.5, 0, null)).toEqual({ hidden: false, below: true });
    expect(mark(-1.5, -3.5, 0, 1)).toEqual({ hidden: false, below: true });
    expect(mark(-1.5, -3.5, 0, 0)).toEqual({ hidden: false, below: false });
    // Under the open sky of the double-height space, from outside: over everything.
    expect(mark(-1, -0.5, 0, null)).toEqual({ hidden: false, below: false });
    // On the first floor: over everything, but not drawn with that floor lifted off.
    expect(mark(-1.5, -3.5, 1, null)).toEqual({ hidden: false, below: false });
    expect(mark(-1.5, -3.5, 1, 0)).toEqual({ hidden: true, below: false });
  });
});
