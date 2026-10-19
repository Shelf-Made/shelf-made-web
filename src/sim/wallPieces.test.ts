import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, buildGrid, findPath, FIXTURES, type GameState } from './index';
import { canPlace, canSellTile, openEdges, canBuyTile } from './build';
import { toWorld, edgeOf, edgeSide, edgePieceAt, wallSegments, isFloor, refundOf } from './layout';
import type { FixtureType } from './types';
import { fixtureStandWorld, cellOf, canStep, isBlocked } from './grid';
import { looksOf } from './reviews';
import { canRemovePanel } from './storeys';
import { doorInside, doorOutside } from './people';
import { resetGridCache } from './state';

/** A new shop (walls all round, nothing in it), money to spend, the manager out on the lot by the door. */
function shop(seed = 3): GameState {
  resetGridCache();
  const s = newGame({ seed, plotId: 'main', name: 'Walls' });
  s.cash = 20000;
  const o = s.people.find((p) => p.kind === 'owner')!, at = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
  o.x = o.px = at.x; o.z = o.pz = at.z;
  return s;
}
const place = (s: GameState, fixtureType: FixtureType, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
const walls = (s: GameState) => s.shop.fixtures.filter((f) => FIXTURES[f.type].edge);
/** How long the walk is between two shop-relative points (null: no way there). */
function walk(s: GameState, a: { x: number; z: number }, b: { x: number; z: number }): number | null {
  const from = toWorld(s.shop, a.x, a.z), path = findPath(buildGrid(s.shop, 99), from, toWorld(s.shop, b.x, b.z));
  if (!path) return null;
  let n = 0, at = from;
  for (const q of path) { n += Math.hypot(q.x - at.x, q.z - at.z); at = q; }
  return n;
}

describe('walls are pieces', () => {
  it('a new shop is walled all round, each wall one it came with: taken down for nothing, and no looks', () => {
    const s = shop();
    expect(openEdges(s.shop)).toEqual([]);
    expect(walls(s).every((f) => f.free && refundOf(f, s) === 0)).toBe(true);
    const before = looksOf(s).score;
    // A wall with a window bought for a side wall counts; one the shop came with never did.
    const left = walls(s).find((f) => f.type === 'wall' && f.rot === 1)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: left.id }).ok).toBe(true);
    expect(s.cash).toBe(20000);
    expect(place(s, 'wallWindow', left.x, left.z, 1).ok).toBe(true);
    expect(looksOf(s).score).toBeGreaterThan(before);
  });

  it('a tile sold takes the walls with nothing behind them, puts none up, and the shop is open there', () => {
    const s = shop();
    const f = s.shop.floor, n = walls(s).length;
    // The back-right corner: its two walls go with it, nothing back for them.
    const check = canSellTile(s, f.x1 - 1, f.z0);
    expect(check.reason).toBe('Sell this tile, and the walls on it');
    expect(applyCommand(s, { type: 'sellTile', x: f.x1 - 1, z: f.z0 }).ok).toBe(true);
    expect(walls(s).length).toBe(n - 2);
    // Its two neighbours are open where it was: no wall went up.
    expect(openEdges(s.shop).map((g) => `${g.x},${g.z},${g.rot}`).sort()).toEqual([`${f.x1 - 2},${f.z0},3`, `${f.x1 - 1},${f.z0 + 1},0`].sort());
    // Anyone can walk in that way: from out the back, in over the open edge, a short walk.
    expect(walk(s, { x: f.x1 - 0.5, z: f.z0 - 1 }, { x: f.x1 - 0.5, z: f.z0 + 1.5 })).toBeLessThan(3.5);
    // Someone out in the band a wall would fill (walking in over the open edge): no wall goes up round them.
    const o = s.people.find((p) => p.kind === 'owner')!, at = toWorld(s.shop, f.x1 - 0.5, f.z0 + 1 - 0.35);
    o.x = o.px = at.x; o.z = o.pz = at.z;
    expect(canPlace(s, 'wall', f.x1 - 1, f.z0 + 1, 0).reason).toBe('You are standing there');
    expect(applyCommand(s, { type: 'wallUp' }).message).toBe('Someone is standing in the way: try again in a moment');
    // Stepped in off it, both go up.
    const inside = toWorld(s.shop, f.x1 - 0.5, f.z0 + 1.6);
    o.x = o.px = inside.x; o.z = o.pz = inside.z;
    expect(canPlace(s, 'wall', f.x1 - 1, f.z0 + 1, 0).ok).toBe(true);
    expect(applyCommand(s, { type: 'wallUp' }).ok).toBe(true);
  });

  it('a tile sold beside a wall across the shop: the wall stays, turned to face the floor it still stands by', () => {
    const s = shop();
    const f = s.shop.floor;
    // A wall across the back row, on the edge between it and the row in front.
    expect(place(s, 'wall', f.x1 - 1, f.z0 + 1, 0).ok).toBe(true);
    const w = s.shop.fixtures[s.shop.fixtures.length - 1]!, key = edgeOf(w).key;
    expect(edgeSide(s.shop, w)).toBe('inner');
    // The back-row tile behind it sold: the wall is the one round the shop there now, on the same edge.
    expect(applyCommand(s, { type: 'sellTile', x: f.x1 - 1, z: f.z0 }).ok).toBe(true);
    const now = s.shop.fixtures.find((x) => x.id === w.id)!;
    expect(edgeOf(now).key).toBe(key);
    expect(edgeSide(s.shop, now)).toBe('outer');
    expect(isFloor(s.shop, now.x, now.z)).toBe(true);
  });

  it('turns round its tile: R puts it on the next edge, and nobody steps over its line', () => {
    const s = shop();
    expect(place(s, 'wall', -0.5, -3, 0).ok).toBe(true);
    const w = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    const keys = [edgeOf(w).key];
    for (const rot of [1, 2, 3] as const) {
      expect(applyCommand(s, { type: 'moveFixture', fixtureId: w.id, x: w.x, z: w.z, rot }).ok, `rot ${rot}`).toBe(true);
      keys.push(edgeOf(w).key);
    }
    expect(new Set(keys).size).toBe(4);
    // Turned to face -x (rot 3), it stands on the tile's right edge: the line x = 0.5.
    expect(edgeOf(w)).toMatchObject({ axis: 'z', line: 0.5, t: -2.5 });
    const g = buildGrid(s.shop, 99);
    // Across its line: no single step; along it, either side: fine.
    const a = cellOf(g, toWorld(s.shop, 0.25, -2.5)), b = cellOf(g, toWorld(s.shop, 0.75, -2.5)), c = cellOf(g, toWorld(s.shop, 0.25, -1.75));
    expect(canStep(g, a[0], a[1], b[0], b[1])).toBe(false);
    expect(canStep(g, a[0], a[1], c[0], c[1])).toBe(true);
    expect(isBlocked(g, a[0], a[1])).toBe(false);
    // The walk round it is longer than straight through.
    expect(walk(s, { x: 0.25, z: -2.5 }, { x: 0.75, z: -2.5 })!).toBeGreaterThan(1);
  });

  it('nobody uses a piece through a wall: a shelf faces the room, and the side walled is never stood at', () => {
    const s = shop();
    expect(place(s, 'shelf', -0.5, -3, 0).ok).toBe(true);
    const shelf = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    const front = fixtureStandWorld(s.shop, shelf)!;
    // A wall across its front: used from a side instead.
    expect(place(s, 'wall', -0.5, -3, 2).ok).toBe(true);
    const now = fixtureStandWorld(s.shop, shelf, undefined, buildGrid(s.shop, 98))!;
    expect(Math.hypot(now.x - front.x, now.z - front.z)).toBeGreaterThan(0.5);
    // Walled on every side: nobody could reach it, and the last wall is refused.
    expect(place(s, 'wall', -0.5, -3, 1).ok).toBe(true);
    expect(place(s, 'wall', -0.5, -3, 3).ok).toBe(true);
    expect(canPlace(s, 'wall', -0.5, -3, 0).reason).toBe('Would cut off the shelf');
  });

  it('walls up every gap at once, for a wall each, glass along the front: never round anyone, nor shutting anything off', () => {
    const s = shop();
    const f = s.shop.floor, front = walls(s).find((x) => x.type === 'wallWindow' && x.rot === 2)!;
    expect(applyCommand(s, { type: 'wallUp' }).message).toMatch(/No open edges/);
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: front.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'buyTile', x: f.x1, z: -3 }).ok).toBe(true);
    const gaps = openEdges(s.shop);
    expect(gaps.length).toBe(4);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'wallUp' }).ok).toBe(true);
    expect(cash - s.cash).toBe(FIXTURES.wallWindow.price + 3 * FIXTURES.wall.price);
    expect(openEdges(s.shop)).toEqual([]);
    expect(edgePieceAt(s.shop.fixtures, front.x, front.z, 2)!.type).toBe('wallWindow');
    // Two tiles bought out to the side (the wall they were built against still up), a shelf on one used from the other:
    // reached only round through their open sides, so walling those would cut it off.
    const s2 = shop(4), f2 = s2.shop.floor;
    for (const z of [-3, -4]) expect(applyCommand(s2, { type: 'buyTile', x: f2.x1, z }).ok).toBe(true);
    expect(place(s2, 'shelf', f2.x1, -4, 0).ok).toBe(true);
    expect(applyCommand(s2, { type: 'wallUp' }).message).toMatch(/^Would cut off the shelf: put the walls up one at a time/);
  });

  it('shoppers come in by an open side as by the door, and a door moved along the front is the way in', () => {
    const s = shop();
    const f = s.shop.floor;
    // Through the door, as ever.
    expect(findPath(buildGrid(s.shop, 99), doorOutside(s), doorInside(s))).not.toBeNull();
    // The left wall's front-most piece down: the shop is open there, a short way in from the side.
    const w = walls(s).find((x) => x.rot === 1 && x.x === f.x0 && x.z === f.z1 - 1)!;
    expect(walk(s, { x: f.x0 - 1, z: f.z1 - 0.5 }, { x: f.x0 + 0.5, z: f.z1 - 0.5 })).toBeGreaterThan(3);
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: w.id }).ok).toBe(true);
    expect(walk(s, { x: f.x0 - 1, z: f.z1 - 0.5 }, { x: f.x0 + 0.5, z: f.z1 - 0.5 })).toBeLessThan(2);
  });

  it('upstairs walls are pieces too: a ceiling panel never comes down from under one', () => {
    const s = shop();
    expect(place(s, 'stairs', 0.5, -4, 0).ok).toBe(true);
    // The floor up there comes open; walled, its walls stand on its tiles.
    expect(openEdges(s.shop).some((g) => g.z < -12)).toBe(true);
    expect(applyCommand(s, { type: 'wallUp' }).ok).toBe(true);
    const up = walls(s).find((x) => x.z < -12 && x.rot === 1)!;
    expect(canRemovePanel(s, up.x, up.z - (-16)).reason).toBe('Move or sell the walls on it upstairs first');
  });

  it('the tile behind the back door is never bought on its own: the back door is moved first, or pushed out with its wall', () => {
    const s = shop();
    const bd = s.shop.fixtures.find((x) => x.type === 'backDoor')!, e = edgeOf(bd);
    expect(canBuyTile(s, e.bx, e.bz).reason).toMatch(/door opens out here/);
    const seg = wallSegments(s.shop).find((w) => w.id === bd.id)!;
    expect(applyCommand(s, { type: 'pushWall', key: seg.key }).ok).toBe(true);
    expect(s.shop.backDoor.z).toBe(e.line - 1);
  });
});
