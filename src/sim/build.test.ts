import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, FIXTURES, buildGrid, findPath, type GameState } from './index';
import { canPlace, floorCost, windowsFromSides } from './build';
import { toWorld } from './layout';
import { looksOf } from './reviews';
import { doorInside, storeroomPoint } from './people';

/** A new shop with money to spend, the manager stood out of the way by the front door. */
function shop(seed = 3): GameState {
  const s = newGame({ seed, plotId: 'main', name: 'Fit Out' });
  s.cash = 20000;
  const o = s.people.find((p) => p.kind === 'owner')!;
  const at = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
  o.x = o.px = at.x; o.z = o.pz = at.z;
  return s;
}
const place = (s: GameState, fixtureType: keyof typeof FIXTURES, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });

describe('building: walls, doors, lights, floors and windows', () => {
  it('sorts every piece onto a Build tab', () => {
    const tabs = new Set(Object.values(FIXTURES).map((d) => d.category));
    expect([...tabs].sort()).toEqual(['checkout', 'decor', 'furniture', 'lights', 'shelves', 'walls']);
    for (const d of Object.values(FIXTURES)) { expect(d.price).toBeGreaterThan(0); if (d.onWall) expect(d.walkable).toBe(true); }
  });

  it('lets people walk over rugs and through doorways, and a doormat go right inside the door', () => {
    const s = shop();
    const f = s.shop.floor, doorX = s.shop.door.x - 0.5;
    expect(canPlace(s, 'shelf', doorX, f.z1 - 1, 0).reason).toBe('Keep the front door clear');
    expect(place(s, 'doormat', doorX, f.z1 - 1).ok).toBe(true);
    // A wall right across the shop would cut off the back door: the last piece is refused...
    const z = -3;
    const xs = [f.x0, f.x0 + 1, f.x0 + 2, f.x0 + 3, f.x0 + 4];
    for (const x of xs.slice(0, 4)) expect(place(s, 'wall', x, z).ok, `wall at ${x}`).toBe(true);
    expect(canPlace(s, 'wall', xs[4]!, z, 0).ok).toBe(false);
    // ...but a doorway closes the line and the way through stays open.
    expect(place(s, 'doorway', xs[4]!, z).ok).toBe(true);
    const grid = buildGrid(s.shop, -1);
    expect(findPath(grid, doorInside(s), storeroomPoint(s))).toBeTruthy();
    // Rugs never get in the way either.
    expect(place(s, 'rug', f.x0 + 1, -2).ok).toBe(true);
    expect(findPath(buildGrid(s.shop, -2), doorInside(s), toWorld(s.shop, f.x0 + 1.5, -1.5))).toBeTruthy();
  });

  it('hangs wall lights and neon on an outer wall, facing in', () => {
    const s = shop();
    const f = s.shop.floor;
    // On the left wall, facing into the shop (+x): its back is outside the floor.
    expect(canPlace(s, 'wallLight', f.x0, -3, 1).ok).toBe(true);
    expect(canPlace(s, 'wallLight', f.x0, -3, 3).reason).toMatch(/Hang it on a wall/);
    expect(canPlace(s, 'neon', f.x0 + 2, -3, 0).reason).toMatch(/Hang it on a wall/);
    expect(canPlace(s, 'neon', f.x1 - 1, -4, 3).ok).toBe(true);
    expect(place(s, 'pendant', f.x0 + 2, -3).ok).toBe(true);
  });

  it('lays a new floor and puts windows in, once each, for money, and the shop looks better for it', () => {
    const s = shop();
    const before = looksOf(s);
    const cash = s.cash, cost = floorCost(s, 'wood');
    expect(cost).toBeGreaterThan(0);
    expect(applyCommand(s, { type: 'setFloor', style: 'wood' }).ok).toBe(true);
    expect(s.cash).toBeCloseTo(cash - cost);
    expect(s.shop.floorStyle).toBe('wood');
    expect(applyCommand(s, { type: 'setFloor', style: 'wood' }).ok).toBe(false);
    const f = s.shop.floor;
    for (let z = f.z0; z < f.z1; z++) expect(place(s, 'window', f.x0, z, 1).ok).toBe(true);
    expect(s.cash).toBeCloseTo(cash - cost - FIXTURES.window.price * (f.z1 - f.z0));
    expect(looksOf(s).extras).toBeGreaterThan(before.extras + 0.2);
    // Too poor: refused, nothing taken.
    s.cash = 5;
    expect(applyCommand(s, { type: 'setFloor', style: 'stone' }).ok).toBe(false);
    expect(s.cash).toBe(5);
  });

  it('puts windows in one at a time: in a side or back wall, never the front, and a shelf may stand in front of one', () => {
    const s = shop();
    const f = s.shop.floor;
    // Its back to the left wall, facing in.
    expect(place(s, 'window', f.x0, -4, 1).ok).toBe(true);
    // Facing the wrong way, in the middle of the floor, or against the glazed front: no.
    expect(canPlace(s, 'window', f.x0, -3, 3).reason).toMatch(/wall/);
    expect(canPlace(s, 'window', -0.5, -3, 0).ok).toBe(false);
    expect(canPlace(s, 'window', f.x0, f.z1 - 1, 2).reason).toMatch(/front/);
    // The same window twice, or a wall light on it: no. A shelf in front of it: yes; the next tile along: yes.
    expect(canPlace(s, 'window', f.x0, -4, 1).ok).toBe(false);
    expect(canPlace(s, 'wallLight', f.x0, -4, 1).ok).toBe(false);
    expect(place(s, 'shelf', f.x0, -4, 1).ok).toBe(true);
    expect(place(s, 'window', f.x0, -5, 1).ok).toBe(true);
    // In the back wall, over the delivery pallet, but never over the back door.
    expect(place(s, 'window', f.x0, f.z0, 0).ok).toBe(true);
    expect(canPlace(s, 'window', s.shop.backDoor.x - 0.5, f.z0, 0).reason).toMatch(/door/);
    // Built bigger, the windows go out with their walls.
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    const wins = s.shop.fixtures.filter((x) => x.type === 'window');
    expect(wins.filter((x) => x.rot === 1).every((x) => x.x === s.shop.floor.x0)).toBe(true);
    expect(wins.filter((x) => x.rot === 0).every((x) => x.z === s.shop.floor.z0)).toBe(true);
  });

  it('turns an old save\'s whole walls of windows into a window on each tile', () => {
    const s = shop();
    s.shop.windows = { right: true, back: true };
    windowsFromSides(s);
    const f = s.shop.floor;
    const wins = s.shop.fixtures.filter((x) => x.type === 'window');
    expect(wins.filter((x) => x.rot === 3).length).toBe(f.z1 - f.z0);
    expect(wins.filter((x) => x.rot === 0).length).toBe(f.x1 - f.x0 - 1);
    expect(s.shop.windows).toBeUndefined();
  });

  it('counts furniture, decor and lights toward the looks, each kind up to its cap', () => {
    const s = shop();
    const f = s.shop.floor;
    const d0 = looksOf(s).decor;
    expect(place(s, 'cafe', f.x0, -5).ok).toBe(true);
    expect(place(s, 'floorLamp', f.x0 + 1, -5).ok).toBe(true);
    expect(place(s, 'flowers', f.x0 + 2, -5).ok).toBe(true);
    const d1 = looksOf(s).decor;
    expect(d1).toBeCloseTo(d0 + FIXTURES.cafe.looks! + FIXTURES.floorLamp.looks! + FIXTURES.flowers.looks!);
    // A sixth plant adds nothing past the fourth.
    const spots: [number, number][] = [[f.x0, -2], [f.x0 + 1, -2], [f.x0 + 3, -2], [f.x0 + 4, -2], [f.x0, -3], [f.x0 + 4, -3]];
    for (const [x, z] of spots) expect(place(s, 'plant', x, z).ok, `plant at ${x},${z}`).toBe(true);
    expect(s.shop.fixtures.filter((x) => x.type === 'plant').length).toBeGreaterThan(4);
    expect(looksOf(s).decor).toBeCloseTo(Math.min(1, d1 + 4 * FIXTURES.plant.looks!));
  });
});
