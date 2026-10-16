import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, tick, TICK, FIXTURES, buildGrid, findPath, type GameState } from './index';
import { canPlace, floorCost, windowsFromSides, canBuyTile, styleAt, wallStyleAt, canSellTile } from './build';
import { makeCandidate } from './staff';
import { toWorld, storageCap, PALLET_UNITS, tilePrice, isFloor, floorTileCount, lotLayout, FLOORS, wallSegments } from './layout';
import { looksOf } from './reviews';
import { doorInside, storeroomPoint, spawnCustomer } from './people';
import { openGame } from './testUtil';
import { gridFor } from './state';
import { cellOf, isBlocked } from './grid';

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
    expect([...tabs].sort()).toEqual(['checkout', 'decor', 'furniture', 'lights', 'outside', 'shelves', 'storeys', 'walls']);
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
    expect(place(s, 'floorLamp', f.x0 + 3, -5).ok).toBe(true);
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

describe('pallets', () => {
  it('an extra pallet on the floor holds more deliveries, and is not sold while its boxes need it', () => {
    const s = shop();
    const cap = storageCap(s.shop);
    expect(place(s, 'pallet', -0.5, -3).ok).toBe(true);
    expect(storageCap(s.shop)).toBe(cap + PALLET_UNITS);
    const pallet = s.shop.fixtures.find((f) => f.type === 'pallet')!;
    // It takes up its tile like anything else on the floor.
    expect(canPlace(s, 'shelf', -0.5, -3, 0).ok).toBe(false);
    s.shop.storage = [{ productId: 'beans', qty: cap + 10, day: s.day }];
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: pallet.id }).ok).toBe(false);
    s.shop.storage = [{ productId: 'beans', qty: cap - 10, day: s.day }];
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: pallet.id }).ok).toBe(true);
  });

  // Where boxes are picked up was judged by the nearest free cell to it, so a piece could stand on it; taking a piece
  // away (never judged at all) then moved that cell into a pocket, and stockers walked to it through the sign.
  it('nothing stands where boxes are picked up, and taking a piece away never cuts the pallet off', () => {
    const s = openGame({ seed: 138, plotId: 'main', name: 'Pallet', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, out = toWorld(s.shop, 0, 1);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    s.people = [o];
    expect(place(s, 'pallet', -2.5, -5, 3).ok).toBe(true);
    expect(place(s, 'sign', -1.5, -5, 0).message).toBe('Keep the way to the delivery pallet clear');
    // As an older save could have it: then the pallet does not go.
    s.shop.fixtures.push({ id: s.nextId++, type: 'sign', x: -1.5, z: -5, rot: 0, slots: [] });
    s.shop.layoutVersion++;
    const extra = s.shop.fixtures.find((f) => f.type === 'pallet')!;
    expect(findPath(buildGrid(s.shop, -1, true), doorInside(s), storeroomPoint(s))).not.toBeNull();
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: extra.id }).message).toBe('Would block the way to the delivery pallet.');
  });

  it('the manager can pick a box up at an extra pallet', () => {
    const s = shop();
    expect(place(s, 'pallet', 0.5, -2).ok).toBe(true);
    s.shop.storage = [{ productId: 'beans', qty: 12, day: s.day }];
    const o = s.people.find((p) => p.kind === 'owner')!;
    const at = toWorld(s.shop, 1.0, -0.5);
    o.x = o.px = at.x; o.z = o.pz = at.z;
    expect(applyCommand(s, { type: 'pickUp', productId: 'beans' }).ok).toBe(true);
    expect(o.carrying).toEqual({ productId: 'beans', qty: 8 });
  });
});

describe('growing the shop a tile at a time', () => {
  it('buys a tile next to the floor, and walls move out round it', () => {
    const s = shop();
    const f0 = { ...s.shop.floor };
    const cash = s.cash, price = tilePrice(s.shop);
    // Not next to the floor, in front of the front wall, or already floor: no.
    expect(canBuyTile(s, f0.x1 + 1, -3).reason).toMatch(/next to/i);
    expect(canBuyTile(s, f0.x0, f0.z1).reason).toMatch(/front wall/i);
    expect(canBuyTile(s, f0.x0, -3).reason).toMatch(/floor already/i);
    // One tile out to the east: the floor's rectangle grows and the rest of that column is a gap.
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -3 }).ok).toBe(true);
    expect(s.cash).toBeCloseTo(cash - price);
    expect(isFloor(s.shop, f0.x1, -3)).toBe(true);
    expect(isFloor(s.shop, f0.x1, -4)).toBe(false);
    expect(s.shop.floor.x1).toBe(f0.x1 + 1);
    expect(floorTileCount(s.shop)).toBe((f0.x1 - f0.x0) * (f0.z1 - f0.z0) + 1);
    // Something can go on it; the gap beside it is not floor.
    expect(canPlace(s, 'shelf', f0.x1, -3, 3).ok).toBe(true);
    expect(canPlace(s, 'shelf', f0.x1, -4, 3).reason).toMatch(/inside the shop/);
    // Filling a gap: it is floor now and the gap list shrinks.
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -4 }).ok).toBe(true);
    expect(isFloor(s.shop, f0.x1, -4)).toBe(true);
  });

  it('nobody walks through the new walls, and the parking moves out with the east wall', () => {
    const s = shop();
    const bay0 = lotLayout(s.shop).bays[0]!.x;
    const f0 = { ...s.shop.floor };
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -3 }).ok).toBe(true);
    expect(lotLayout(s.shop).bays[0]!.x).toBe(bay0 + 1);
    const g = buildGrid(s.shop, 99);
    // From the new tile, out through its north side (a gap, walled off) is blocked; through the door is fine.
    const inTile = toWorld(s.shop, f0.x1 + 0.5, -2.5);
    const path = findPath(g, inTile, toWorld(s.shop, f0.x1 + 0.5, -4.5));
    // The path exists (out of the door and round) but is long: never straight through the wall.
    expect(path).not.toBeNull();
    let len = 0, at = inTile;
    for (const q of path!) { len += Math.hypot(q.x - at.x, q.z - at.z); at = q; }
    expect(len).toBeGreaterThan(5);
  });

  // The walls go up round a tile bought: nobody may be standing where they go, nor be boxed in by them. The manager
  // was walled in by one (no key moved them, every click was "You can't get there"); expandShop put a driver in one.
  it('never puts a wall up round the manager, or anyone, out by a tile bought', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'Walled', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, side = toWorld(s.shop, 3.75, -2.5);
    s.people = [o];
    o.x = o.px = side.x; o.z = o.pz = side.z; o.path = []; o.pathIdx = 0; o.state = 'idle';
    expect(canBuyTile(s, 2.5, -3).reason).toBe('You are standing there');
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).message).toBe('You are standing there');
    // Someone else walking up the side.
    const out = toWorld(s.shop, 0, 1);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    const p = spawnCustomer(s, true)!;
    p.x = p.px = side.x; p.z = p.pz = side.z; p.xings = undefined; p.state = 'toDoor'; p.path = [toWorld(s.shop, 3.75, 1)]; p.pathIdx = 0;
    expect(canBuyTile(s, 2.5, -3).reason).toBe('Someone is standing there');
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).message).toBe('Someone is standing there');
    // Nobody there: fine.
    s.people = [o];
    expect(canBuyTile(s, 2.5, -3).ok).toBe(true);
  });

  it('a window on a wall that moves goes out with it; the back door moves back with the back wall', () => {
    const s = shop();
    const f0 = { ...s.shop.floor };
    expect(place(s, 'window', f0.x1 - 1, -3, 3).ok).toBe(true);
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -3 }).ok).toBe(true);
    const w = s.shop.fixtures.find((x) => x.type === 'window')!;
    expect(w.x).toBe(f0.x1);
    const bd = { ...s.shop.backDoor };
    expect(applyCommand(s, { type: 'buyTile', x: bd.x - 0.5, z: bd.z - 1 }).ok).toBe(true);
    expect(s.shop.backDoor.z).toBe(bd.z - 1);
  });

  it('lays a finish on one tile at a time', () => {
    const s = shop();
    const f0 = s.shop.floor;
    const cash = s.cash;
    expect(applyCommand(s, { type: 'paintFloor', x: f0.x0, z: -3, style: 'wood' }).ok).toBe(true);
    expect(s.cash).toBeCloseTo(cash - FLOORS.find((x) => x.id === 'wood')!.perTile);
    expect(styleAt(s.shop, f0.x0, -3)).toBe('wood');
    expect(styleAt(s.shop, f0.x0, -4)).toBe('lino');
    expect(applyCommand(s, { type: 'paintFloor', x: f0.x0, z: -3, style: 'wood' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'paintFloor', x: f0.x0 - 1, z: -3, style: 'wood' }).ok).toBe(false);
  });
});

describe('the commands themselves (bots, tests): only what the Build card offers', () => {
  // The card snaps to tiles and never grows the shop in one go, so only the command layer saw these.
  it('a tile sold or laid off the tile grid does nothing and pays nothing', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'Junk', tutorial: false });
    s.cash = 5000;
    const cash = s.cash, n = floorTileCount(s.shop);
    expect(applyCommand(s, { type: 'sellTile', x: 1, z: -4 }).message).toBe('Snap to a tile');
    expect(applyCommand(s, { type: 'paintFloor', x: 0.3, z: -4.2, style: 'lino' }).message).toBe('Snap to a tile');
    expect(applyCommand(s, { type: 'paintFloor', x: 0.3, z: -4.2, style: 'wood' }).message).toBe('Snap to a tile');
    expect(s.cash).toBe(cash);
    expect(floorTileCount(s.shop)).toBe(n);
  });

  it('growing the shop after a tile bought out the back keeps the pallet and the back door on the floor', () => {
    const s = shop();
    expect(applyCommand(s, { type: 'buyTile', x: 1.5, z: -7 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'buyTile', x: 1.5, z: -8 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    const d = s.shop.delivery, b = s.shop.backDoor;
    for (let x = d.x0; x < d.x1; x++) for (let z = d.z0; z < d.z1; z++) expect(isFloor(s.shop, x, z), `pallet on ${x},${z}`).toBe(true);
    expect(isFloor(s.shop, b.x - 0.5, b.z), 'back door').toBe(true);
    expect(findPath(buildGrid(s.shop, 99), doorInside(s), toWorld(s.shop, b.x, b.z - 0.6))).not.toBeNull();
  });
});

describe('finishes and selling floor', () => {
  it('a new shop has plain walls; a stretch at a time takes a finish, and swapping it sells the old one back', () => {
    const s = shop();
    const segs = wallSegments(s.shop);
    const w = segs.find((x) => x.dir === 'left')!;
    expect(wallStyleAt(s.shop, w.key)).toBe('plain');
    const cash = s.cash;
    expect(applyCommand(s, { type: 'paintWall', key: w.key, style: 'brick' }).ok).toBe(true);
    expect(s.cash).toBe(cash - 12);
    expect(wallStyleAt(s.shop, w.key)).toBe('brick');
    expect(wallStyleAt(s.shop, segs.find((x) => x.dir === 'left' && x.key !== w.key)!.key)).toBe('plain');
    // Back to plain: 60% of the brick back.
    expect(applyCommand(s, { type: 'paintWall', key: w.key, style: 'plain' }).ok).toBe(true);
    expect(s.cash).toBe(cash - 12 + 7);
    // A tile laid in wood, then taken back to lino: some of it comes back.
    const f = s.shop.floor;
    const c2 = s.cash;
    expect(applyCommand(s, { type: 'paintFloor', x: f.x0, z: -2, style: 'wood' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'paintFloor', x: f.x0, z: -2, style: 'lino' }).ok).toBe(true);
    expect(s.cash).toBe(c2 - 7 + 4);
  });

  it('new floor comes with the cheapest finish even when the rest of the shop has a better one', () => {
    const s = shop();
    expect(applyCommand(s, { type: 'setFloor', style: 'wood' }).ok).toBe(true);
    const f = { ...s.shop.floor };
    expect(applyCommand(s, { type: 'buyTile', x: f.x1, z: -3 }).ok).toBe(true);
    expect(styleAt(s.shop, f.x1, -3)).toBe('lino');
    expect(styleAt(s.shop, f.x1 - 1, -3)).toBe('wood');
  });

  it("sells a tile of floor back, never one that would split the shop, the door's, or one with something on it", () => {
    const s = shop();
    const f = { ...s.shop.floor };
    expect(applyCommand(s, { type: 'buyTile', x: f.x1, z: -3 }).ok).toBe(true);
    const n = floorTileCount(s.shop), cash = s.cash;
    // The door's tile, the pallet's: no.
    expect(canSellTile(s, s.shop.door.x - 0.5, f.z1 - 1).ok).toBe(false);
    expect(canSellTile(s, s.shop.delivery.x0, s.shop.delivery.z0).ok).toBe(false);
    // The tile just bought: yes, for part of its price.
    expect(applyCommand(s, { type: 'sellTile', x: f.x1, z: -3 }).ok).toBe(true);
    expect(floorTileCount(s.shop)).toBe(n - 1);
    expect(s.cash).toBeGreaterThan(cash);
    expect(s.shop.floor.x1).toBe(f.x1);
    // A corner tile of the starter shop: fine; something on a tile: move it first.
    expect(canSellTile(s, f.x1 - 1, f.z0 + 1).ok).toBe(true);
    expect(place(s, 'plant', f.x1 - 1, f.z0 + 1).ok).toBe(true);
    expect(canSellTile(s, f.x1 - 1, f.z0 + 1).reason).toMatch(/first/);
  });
});

describe('nothing on the ground floor cut off either', () => {
  it("never sells the tile a shelf or a counter is used from, nor puts anything on a counter's queue spot", () => {
    const s = shop();
    // A shelf in the corner by the front wall, another behind it: used from the tile in front alone.
    expect(place(s, 'shelf', -2.5, -1, 1).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, -2, 1).ok).toBe(true);
    expect(canSellTile(s, -1.5, -1).reason).toBe('Would cut off the shelf');
    // A counter facing the back: the queue in front of it, whoever serves behind it.
    expect(place(s, 'register', 1.5, -3, 2).ok).toBe(true);
    expect(canSellTile(s, 1.5, -4).reason).toBe('Would cut off the checkout counter');
    expect(canSellTile(s, 1.5, -2).reason).toBe('Would block the way behind the counter');
    for (const t of ['shelf', 'wall', 'plant'] as const) expect(canPlace(s, t, 1.5, -4, 0).reason, t).toBe('Would cut off the checkout counter');
    expect(canPlace(s, 'shelf', 1.5, -2, 0).reason).toBe('Would block the way behind the counter');
    // A tile with neither on it: fine.
    expect(canSellTile(s, 1.5, -5).ok).toBe(true);
  });

  it('builds on round a shelf or counter already cut off (an older layout)', () => {
    const s = shop();
    expect(place(s, 'register', 1.5, -3, 2).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, -1, 1).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, -2, 1).ok).toBe(true);
    // As an older build let them be: a plant on the counter's queue spot, a wall in front of the corner shelf.
    s.shop.fixtures.push({ id: s.nextId++, type: 'plant', x: 1.5, z: -4, rot: 0, slots: [] }, { id: s.nextId++, type: 'wall', x: -1.5, z: -1, rot: 0, slots: [] });
    s.shop.layoutVersion++;
    expect(place(s, 'plant', 0.5, -5, 0).message).toBeUndefined();
    expect(applyCommand(s, { type: 'sellTile', x: 1.5, z: -6 }).message).toBeUndefined();
  });

  it('never sells a tile that cuts the back door or the pallet off from inside (nor boxes the manager in), as building would not', () => {
    const s = shop();
    // A wall across the shop but for one tile, the way through to the back half.
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(place(s, 'wall', x, -4).ok, `wall at ${x}`).toBe(true);
    expect(canPlace(s, 'plant', 1.5, -4, 0).reason).toBe('Would cut the shop in two');
    expect(canSellTile(s, 1.5, -4).reason).toBe('Would cut the shop in two');
    // The manager in a nook only that tile opens onto (the back door shut on that side).
    const o = s.people.find((p) => p.kind === 'owner')!, nook = toWorld(s.shop, 2, -4.5);
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(applyCommand(s, { type: 'removeFixture', fixtureId: s.shop.fixtures.find((f) => f.type === 'wall' && f.x === x)!.id }).ok).toBe(true);
    for (const [x, z] of [[0.5, -5], [1.5, -6]] as const) expect(place(s, 'wall', x, z).ok, `wall at ${x}, ${z}`).toBe(true);
    o.x = o.px = nook.x; o.z = o.pz = nook.z;
    expect(canSellTile(s, 1.5, -4).reason).toBe('Would box you in');
  });

  it("never sells the back door's tile when the back door, coming forward, would open onto something", () => {
    for (const type of ['plant', 'shelf', 'wall'] as const) {
      const s = shop(5), bd = { ...s.shop.backDoor };
      expect(place(s, type, bd.x - 0.5, bd.z + 1, 0).ok, type).toBe(true);
      expect(canSellTile(s, bd.x - 0.5, bd.z).reason, type).toBe('Keep the back door clear');
      expect(applyCommand(s, { type: 'sellTile', x: bd.x - 0.5, z: bd.z }).ok, type).toBe(false);
      expect(s.shop.backDoor, type).toEqual(bd);
    }
    // Nothing there: it sells, and the back door comes forward.
    const s = shop(5), bd = { ...s.shop.backDoor };
    expect(applyCommand(s, { type: 'sellTile', x: bd.x - 0.5, z: bd.z }).message).toBeUndefined();
    expect(s.shop.backDoor).toEqual({ x: bd.x, z: bd.z + 1 });
  });

  it('builds on in a shop an older save left with the back half cut off from inside', () => {
    const s = shop();
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(place(s, 'wall', x, -4).ok, `wall at ${x}`).toBe(true);
    // As selling a tile let it be: the one way through sold.
    s.shop.gaps = [...s.shop.gaps ?? [], '1.5,-4'];
    s.shop.layoutVersion++;
    expect(findPath(buildGrid(s.shop, -1, true), doorInside(s), storeroomPoint(s))).toBeNull();
    expect(place(s, 'plant', -2.5, -1, 0).message).toBeUndefined();
    // Nothing more shut for it: the manager in the corner by the front wall is not walled in.
    const o = s.people.find((p) => p.kind === 'owner')!, corner = toWorld(s.shop, 2, -0.5);
    o.x = o.px = corner.x; o.z = o.pz = corner.z;
    expect(place(s, 'wall', 1.5, -2).ok).toBe(true);
    expect(canPlace(s, 'wall', 0.5, -1, 0).reason).toBe('Would box you in');
  });
});

describe('building across someone downstairs', () => {
  /** A fitted-out shop, open, nobody about but a shopper set walking (or standing) at (x, z), the manager out by the door. */
  const one = (seed: number, x: number, z: number) => {
    const s = openGame({ seed, plotId: 'main', name: 'Across', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, out = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    s.phase = 'open';
    const p = spawnCustomer(s, true)!, at = toWorld(s.shop, x, z);
    p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined; p.path = []; p.pathIdx = 0; p.list = []; p.basket = [];
    return { s, p };
  };

  it('a piece put down, or a tile sold, across a walk sends them round it, as upstairs', () => {
    for (const how of ['wall', 'sell'] as const) {
      const { s, p } = one(63, -2, -1.5);
      p.state = 'leaving'; p.path = [toWorld(s.shop, 2, -1.5)];
      tick(s);
      const r = how === 'wall' ? place(s, 'wall', -0.5, -2, 1) : applyCommand(s, { type: 'sellTile', x: -0.5, z: -2 });
      expect(r.message, how).toBeUndefined();
      let into = 0;
      for (let i = 0; i < 10 / TICK && p.state === 'leaving'; i++) { tick(s); const g = gridFor(s), [cx, cz] = cellOf(g, p); if (isBlocked(g, cx, cz)) into++; }
      expect(into, how).toBe(0);
    }
  });

  // Nobody but the manager was asked: a piece went down on a stocker, who walked from inside it into the pocket it
  // closed (judged by the free cell beside them, the other side of it), then from there straight through the shelves.
  it('puts nothing down on top of anyone, a worker or a shopper', () => {
    const s = openGame({ seed: 5, plotId: 'main', name: 'On top', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, back = toWorld(s.shop, 1.5, -5.5);
    o.x = o.px = back.x; o.z = o.pz = back.z;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    expect(place(s, 'shelf', -2.5, -1, 2).ok).toBe(true);
    const shelf = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    for (const sl of shelf.slots) { sl.productId = 'rice'; sl.qty = 4; }
    const c = makeCandidate(s, 'stocker');
    s.staffPool.push(c);
    expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
    const w = s.people.find((p) => p.id === c.id)!, at = toWorld(s.shop, -1.25, -1.75);
    w.x = w.px = at.x; w.z = w.pz = at.z; w.carrying = { productId: 'rice', qty: 4 }; w.task = { type: 'carry', fixtureId: shelf.id, productId: 'rice', qty: 4 };
    w.state = 'carrying'; w.path = [toWorld(s.shop, -2, -1.5)]; w.pathIdx = 0;
    expect(canPlace(s, 'plant', -1.5, -2, 0).reason).toBe('Someone is standing there');
    // A shopper the same.
    s.people = [o];
    const p = spawnCustomer(s, true)!;
    p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined; p.state = 'shopping'; p.path = []; p.pathIdx = 0;
    expect(canPlace(s, 'floorLamp', -1.5, -2, 0).reason).toBe('Someone is standing there');
    // Clear of them: fine.
    expect(canPlace(s, 'plant', 1.5, -5, 0).ok).toBe(true);
  });

  it('never walls a shopper in downstairs, as upstairs', () => {
    const { s, p } = one(77, -2, -0.5);
    p.state = 'browsing'; p.timer = 5;
    expect(place(s, 'wall', -2.5, -2, 0).ok).toBe(true);
    expect(canPlace(s, 'wall', -1.5, -1, 0).reason).toBe('Would shut someone in');
  });
});
