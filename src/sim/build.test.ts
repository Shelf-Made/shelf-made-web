import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, tick, TICK, FIXTURES, buildGrid, findPath, type GameState } from './index';
import { canPlace, floorCost, windowsFromSides, canBuyTile, styleAt, wallStyleAt, canSellTile, openEdges } from './build';
import { makeCandidate } from './staff';
import { toWorld, storageCap, PALLET_UNITS, tilePrice, isFloor, floorTileCount, FLOORS, wallSegments, BAY_PRICE, MAX_FLOOR, PLOT_RECT, WALL_T, onBuilding, footprintOf, edgeSide } from './layout';
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
    expect([...tabs].sort()).toEqual(['checkout', 'decor', 'furniture', 'lights', 'outside', 'security', 'shelves', 'storeys', 'walls']);
    // (The doors come with the shop: never bought.)
    for (const d of Object.values(FIXTURES)) { if (!d.fixed) expect(d.price).toBeGreaterThan(0); if (d.onWall) expect(d.walkable).toBe(true); if (d.edge) expect(d.category).toBe('walls'); }
  });

  it('lets people walk over rugs and through doorways, and a doormat go right inside the door', () => {
    const s = shop();
    const f = s.shop.floor, doorX = s.shop.door.x - 0.5;
    expect(canPlace(s, 'shelf', doorX, f.z1 - 1, 0).reason).toBe('Keep the front door clear');
    expect(place(s, 'doormat', doorX, f.z1 - 1).ok).toBe(true);
    // A wall right across the shop (on the back edge of a row of tiles) would cut off the back door: the last piece is refused...
    const z = -3;
    const xs = [f.x0, f.x0 + 1, f.x0 + 2, f.x0 + 3, f.x0 + 4];
    for (const x of xs.slice(0, 4)) expect(place(s, 'wall', x, z).ok, `wall at ${x}`).toBe(true);
    expect(canPlace(s, 'wall', xs[4]!, z, 0).ok).toBe(false);
    // ...but a doorway closes the line and the way through stays open.
    expect(place(s, 'doorway', xs[4]!, z).ok).toBe(true);
    // One to an edge, from either side of it; R turns one round its tile to another edge.
    expect(canPlace(s, 'wall', f.x0, z - 1, 2).reason).toMatch(/wall is there/);
    expect(canPlace(s, 'wall', f.x0 + 1, z, 1).ok).toBe(true);
    const grid = buildGrid(s.shop, -1);
    expect(findPath(grid, doorInside(s), storeroomPoint(s))).toBeTruthy();
    // Rugs never get in the way either.
    expect(place(s, 'rug', f.x0 + 1, -2).ok).toBe(true);
    expect(findPath(buildGrid(s.shop, -2), doorInside(s), toWorld(s.shop, f.x0 + 1.5, -1.5))).toBeTruthy();
  });

  it('hangs wall lights and neon on a wall, facing in, and that wall stays while they hang on it', () => {
    const s = shop();
    const f = s.shop.floor;
    // On the left wall, facing into the shop (+x): the wall on the edge behind it.
    expect(canPlace(s, 'wallLight', f.x0, -3, 1).ok).toBe(true);
    expect(canPlace(s, 'wallLight', f.x0, -3, 3).reason).toMatch(/Hang it on a wall/);
    expect(canPlace(s, 'neon', f.x0 + 2, -3, 0).reason).toMatch(/Hang it on a wall/);
    expect(canPlace(s, 'neon', f.x1 - 1, -4, 3).ok).toBe(true);
    expect(place(s, 'pendant', f.x0 + 2, -3).ok).toBe(true);
    // A wall across the shop takes one too, either side; never the front's glass, nor a door.
    expect(place(s, 'wall', f.x0 + 2, -4, 0).ok).toBe(true);
    expect(canPlace(s, 'wallLight', f.x0 + 2, -4, 0).ok).toBe(true);
    expect(place(s, 'neon', f.x0 + 2, -5, 2).ok).toBe(true);
    expect(canPlace(s, 'wallLight', f.x0, f.z1 - 1, 2).reason).toMatch(/not a window/);
    expect(canPlace(s, 'wallLight', s.shop.door.x - 0.5, f.z1 - 1, 2).reason).toBe('Not over a door');
    // The wall it hangs on stays where it is till it is down.
    const wall = s.shop.fixtures.find((x) => x.type === 'wall' && x.x === f.x0 + 2 && x.z === -4)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: wall.id }).message).toBe('Take down what hangs on it first.');
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: wall.id, x: f.x0 + 2, z: -4, rot: 1 }).message).toBe('Take down what hangs on it first');
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
    // The left wall, every one of it a wall with a window now (the walls the shop came with come down for nothing).
    for (let z = f.z0; z < f.z1; z++) {
      const w = s.shop.fixtures.find((x) => x.type === 'wall' && x.x === f.x0 && x.z === z && x.rot === 1)!;
      expect(applyCommand(s, { type: 'removeFixture', fixtureId: w.id }).ok).toBe(true);
      expect(place(s, 'wallWindow', f.x0, z, 1).ok).toBe(true);
    }
    expect(s.cash).toBeCloseTo(cash - cost - FIXTURES.wallWindow.price * (f.z1 - f.z0));
    expect(looksOf(s).extras).toBeGreaterThan(before.extras + 0.2);
    // Too poor: refused, nothing taken.
    s.cash = 5;
    expect(applyCommand(s, { type: 'setFloor', style: 'stone' }).ok).toBe(false);
    expect(s.cash).toBe(5);
  });

  it('puts windows in a wall at a time: one to an edge, a shelf may stand in front of one, and the doors stay doors', () => {
    const s = shop();
    const f = s.shop.floor;
    const left = (z: number) => s.shop.fixtures.find((x) => FIXTURES[x.type].edge && x.x === f.x0 && x.z === z && x.rot === 1)!;
    // A wall stands there: take it down first (it came with the shop: nothing back for it).
    expect(canPlace(s, 'wallWindow', f.x0, -4, 1).reason).toMatch(/wall is there/);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: left(-4).id }).ok).toBe(true);
    expect(s.cash).toBe(cash);
    expect(place(s, 'wallWindow', f.x0, -4, 1).ok).toBe(true);
    // A light never hangs on it; a shelf stands in front of it; the next tile along keeps its wall.
    expect(canPlace(s, 'wallLight', f.x0, -4, 1).reason).toMatch(/not a window/);
    expect(place(s, 'shelf', f.x0, -4, 1).ok).toBe(true);
    expect(left(-5).type).toBe('wall');
    // The front door and the back door: moved, never sold or turned.
    const front = s.shop.fixtures.find((x) => x.type === 'frontDoor')!, back = s.shop.fixtures.find((x) => x.type === 'backDoor')!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: front.id }).message).toMatch(/needs its front door/);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: back.id, x: back.x, z: back.z, rot: 1 }).ok).toBe(false);
    expect(canPlace(s, 'frontDoor', f.x0, f.z1 - 1, 2).ok).toBe(false);
    // Built bigger in one go, the extension comes walled; the window stays where it stood.
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    expect(s.shop.fixtures.some((x) => x.type === 'wallWindow' && x.x === f.x0 && x.z === -4 && x.rot === 1)).toBe(true);
    expect(openEdges(s.shop)).toEqual([]);
  });

  it('moves the front door along the front wall, and the back door to another wall at the back', () => {
    const s = shop();
    const f = s.shop.floor, front = s.shop.fixtures.find((x) => x.type === 'frontDoor')!, back = s.shop.fixtures.find((x) => x.type === 'backDoor')!;
    // Where a front window is: swap them round (the window moved off first).
    const win = s.shop.fixtures.find((x) => x.type === 'wallWindow' && x.x === f.x0 && x.rot === 2)!;
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: front.id, x: f.x0, z: f.z1 - 1, rot: 2 }).message).toMatch(/is there|wall is there/i);
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: win.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: front.id, x: f.x0, z: f.z1 - 1, rot: 2 }).ok).toBe(true);
    expect(s.shop.door.x).toBe(f.x0 + 0.5);
    // Shoppers come in there.
    expect(findPath(buildGrid(s.shop, 99), doorInside(s), toWorld(s.shop, f.x0 + 0.5, f.z1 + 1))).not.toBeNull();
    // Never out of the front wall, nor facing in.
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: front.id, x: f.x0, z: -3, rot: 1 }).message).toMatch(/front wall/);
    // The back door: in the back wall at another tile (a wall there taken down first).
    const at = s.shop.fixtures.find((x) => x.type === 'wall' && x.rot === 0 && x.z === f.z0 && x.x === f.x1 - 1)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: at.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: back.id, x: f.x1 - 1, z: f.z0, rot: 0 }).ok).toBe(true);
    expect(s.shop.backDoor).toEqual({ x: f.x1 - 0.5, z: f.z0 });
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: back.id, x: f.x1 - 1, z: -3, rot: 3 }).message).toMatch(/at the back/);
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
  it('buys a tile next to the floor: no wall goes up round it, and the one it was built against stays', () => {
    const s = shop();
    const f0 = { ...s.shop.floor };
    const cash = s.cash, price = tilePrice(s.shop);
    // Not next to the floor, in front of the front wall, or already floor: no.
    expect(canBuyTile(s, f0.x1 + 1, -3).reason).toMatch(/next to/i);
    expect(canBuyTile(s, f0.x0, f0.z1).reason).toMatch(/front wall/i);
    expect(canBuyTile(s, f0.x0, -3).reason).toMatch(/floor already/i);
    // One tile out to the east: the floor's rectangle grows and the rest of that column is a gap. The car park's
    // bays the building now stands on are sold back (the tarmac is built over).
    const bays = s.shop.bays.length;
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -3 }).ok).toBe(true);
    expect(bays - s.shop.bays.length).toBe(2);
    expect(s.cash).toBeCloseTo(cash - price + 2 * Math.round(BAY_PRICE * 0.6));
    expect(s.notices.some((n) => n.text.startsWith('The shop grew over 2 parking bays'))).toBe(true);
    expect(isFloor(s.shop, f0.x1, -3)).toBe(true);
    expect(isFloor(s.shop, f0.x1, -4)).toBe(false);
    expect(s.shop.floor.x1).toBe(f0.x1 + 1);
    expect(floorTileCount(s.shop)).toBe((f0.x1 - f0.x0) * (f0.z1 - f0.z0) + 1);
    // Open to the outside on three sides (no wall went up), walled off from the shop by the wall it was built against.
    expect(openEdges(s.shop).filter((g) => g.x === f0.x1 && g.z === -3).length).toBe(3);
    const old = s.shop.fixtures.find((x) => x.type === 'wall' && x.x === f0.x1 - 1 && x.z === -3 && x.rot === 3)!;
    expect(edgeSide(s.shop, old)).toBe('inner');
    // A shelf on it facing the shop is used from inside only with that wall down; the gap beside it is not floor.
    expect(canPlace(s, 'shelf', f0.x1, -3, 3).reason).toBe('Nobody could reach it from inside');
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: old.id }).ok).toBe(true);
    expect(canPlace(s, 'shelf', f0.x1, -3, 3).ok).toBe(true);
    expect(canPlace(s, 'shelf', f0.x1, -4, 3).reason).toMatch(/inside the shop/);
    // Filling a gap: it is floor now and the gap list shrinks.
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -4 }).ok).toBe(true);
    expect(isFloor(s.shop, f0.x1, -4)).toBe(true);
  });

  it('nobody walks through the wall a tile was built against, and the rest of the lot stays where it was', () => {
    const s = shop();
    const kept = s.shop.bays.filter((b) => b.z > -1.6).map((b) => ({ x: b.x, z: b.z }));
    const tiles = Object.keys(s.shop.lotTiles!).length;
    const f0 = { ...s.shop.floor };
    expect(applyCommand(s, { type: 'buyTile', x: f0.x1, z: -3 }).ok).toBe(true);
    for (const b of kept) expect(s.shop.bays.some((q) => q.x === b.x && q.z === b.z)).toBe(true);
    // Only what the building now stands on is gone (two tiles of the bays' row, and the tarmac a tile out of it).
    expect(Object.keys(s.shop.lotTiles!).length).toBeLessThan(tiles);
    expect(Object.keys(s.shop.lotTiles!).length).toBeGreaterThanOrEqual(tiles - 4);
    const g = buildGrid(s.shop, 99);
    // From the new tile into the shop beside it: out over its open side and round through the door, never through the wall.
    const inTile = toWorld(s.shop, f0.x1 + 0.5, -2.5);
    const len = (to: { x: number; z: number }) => { const path = findPath(g, inTile, to); expect(path).not.toBeNull(); let n = 0, at = inTile; for (const q of path!) { n += Math.hypot(q.x - at.x, q.z - at.z); at = q; } return n; };
    expect(len(toWorld(s.shop, f0.x1 - 0.5, -2.5))).toBeGreaterThan(5);
    // Out over the open side: straight there.
    expect(len(toWorld(s.shop, f0.x1 + 0.5, -4.5))).toBeLessThan(2.5);
  });

  // Nobody may be standing where a wall goes up, nor be boxed in by it. The manager was walled in by one (no key
  // moved them, every click was "You can't get there"); expandShop put a driver in one.
  it('never puts a wall up across the manager, or anyone', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'Walled', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, side = toWorld(s.shop, 3.75, -2.5);
    s.people = [o];
    o.x = o.px = side.x; o.z = o.pz = side.z; o.path = []; o.pathIdx = 0; o.state = 'idle';
    // A tile bought puts up no wall: out there is fine; the extension's walls would go up through them.
    expect(canBuyTile(s, 2.5, -3).ok).toBe(true);
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).message).toBe('You are standing there');
    // Stood on a line a wall would go up on, inside.
    const line = toWorld(s.shop, 0, -3.05);
    o.x = o.px = line.x; o.z = o.pz = line.z;
    expect(canPlace(s, 'wall', -0.5, -3, 0).reason).toBe('You are standing there');
    expect(canPlace(s, 'wall', -0.5, -3, 1).ok).toBe(true);
    // Someone else walking up the side.
    const out = toWorld(s.shop, 0, 1);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    const p = spawnCustomer(s, true)!;
    p.x = p.px = side.x; p.z = p.pz = side.z; p.xings = undefined; p.state = 'toDoor'; p.path = [toWorld(s.shop, 3.75, 1)]; p.pathIdx = 0;
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).message).toBe('Someone is standing there');
  });

  it('a wall pushed out takes its window and its lights with it, the back door with the back wall, and the ends close', () => {
    const s = shop();
    const f0 = { ...s.shop.floor };
    const right = (z: number) => s.shop.fixtures.find((x) => FIXTURES[x.type].edge && x.x === f0.x1 - 1 && x.z === z && x.rot === 3)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: right(-3).id }).ok).toBe(true);
    expect(place(s, 'wallWindow', f0.x1 - 1, -3, 3).ok).toBe(true);
    expect(place(s, 'wallLight', f0.x1 - 1, -4, 3).ok).toBe(true);
    const seg = wallSegments(s.shop).find((w) => w.dir === 'right' && w.t === -2.5)!;
    expect(applyCommand(s, { type: 'pushWall', key: seg.key }).ok).toBe(true);
    // The whole right wall a tile out, the window and the light with it; walled all round still.
    expect(s.shop.floor.x1).toBe(f0.x1 + 1);
    expect(s.shop.fixtures.find((x) => x.type === 'wallWindow' && x.rot === 3)!.x).toBe(f0.x1);
    expect(s.shop.fixtures.find((x) => x.type === 'wallLight')!.x).toBe(f0.x1);
    expect(openEdges(s.shop)).toEqual([]);
    // Pushed back: the back door with it.
    const bd = { ...s.shop.backDoor };
    const back = wallSegments(s.shop).find((w) => w.dir === 'back' && Math.abs(w.t - bd.x) < 0.01)!;
    expect(applyCommand(s, { type: 'pushWall', key: back.key }).ok).toBe(true);
    expect(s.shop.backDoor).toEqual({ x: bd.x, z: bd.z - 1 });
    expect(openEdges(s.shop)).toEqual([]);
    // A tile bought on its own behind it: the back door is in the way.
    expect(canBuyTile(s, bd.x - 0.5, bd.z - 2).reason).toMatch(/back door opens out here/);
    // Pulled in again: back where it was, the floor behind it sold.
    const back2 = wallSegments(s.shop).find((w) => w.dir === 'back' && Math.abs(w.t - bd.x) < 0.01)!;
    expect(applyCommand(s, { type: 'pullWall', key: back2.key }).ok).toBe(true);
    expect(s.shop.backDoor).toEqual(bd);
    expect(openEdges(s.shop)).toEqual([]);
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
    for (const t of ['shelf', 'plant'] as const) expect(canPlace(s, t, 1.5, -4, 0).reason, t).toBe('Would cut off the checkout counter');
    expect(canPlace(s, 'shelf', 1.5, -2, 0).reason).toBe('Would block the way behind the counter');
    // A wall across its front, or across its back: the same.
    expect(canPlace(s, 'wall', 1.5, -3, 0).reason).toBe('Would cut off the checkout counter');
    expect(canPlace(s, 'wall', 1.5, -3, 2).reason).toBe('Would block the way behind the counter');
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

  it('never cuts the back door or the pallet off from inside, nor boxes the manager in; a tile sold opens the shop instead', () => {
    const s = shop();
    // A wall across the shop but for one tile, the way through to the back half: nothing may stand on that tile.
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(place(s, 'wall', x, -4).ok, `wall at ${x}`).toBe(true);
    expect(canPlace(s, 'plant', 1.5, -4, 0).reason).toBe('Would cut the shop in two');
    expect(canPlace(s, 'wall', 1.5, -4, 0).reason).toBe('Would cut the shop in two');
    // Sold, it takes its wall round the shop with it and leaves the shop open there: no way is shut (out and round).
    expect(canSellTile(s, 1.5, -4).reason).toBe('Sell this tile, and the wall on it');
    // The manager in a nook: walled in on the last side, never.
    const o = s.people.find((p) => p.kind === 'owner')!, nook = toWorld(s.shop, 2, -4.5);
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(applyCommand(s, { type: 'removeFixture', fixtureId: s.shop.fixtures.find((f) => f.type === 'wall' && f.x === x && f.z === -4)!.id }).ok).toBe(true);
    o.x = o.px = nook.x; o.z = o.pz = nook.z;
    expect(place(s, 'wall', 1.5, -5, 0).ok).toBe(true);
    expect(place(s, 'wall', 1.5, -5, 1).ok).toBe(true);
    expect(canPlace(s, 'wall', 1.5, -5, 2).reason).toBe('Would box you in');
  });

  it("never sells the back door's tile, nor moves the back door onto something", () => {
    const s = shop(5), bd = { ...s.shop.backDoor }, door = s.shop.fixtures.find((f) => f.type === 'backDoor')!;
    expect(canSellTile(s, bd.x - 0.5, bd.z).reason).toBe('The back door opens onto it: move the back door first');
    // A tile along: a wall taken down there, and a plant on the tile in front of it.
    const along = s.shop.fixtures.find((f) => f.type === 'wall' && f.rot === 0 && f.z === bd.z && f.x === bd.x + 0.5)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: along.id }).ok).toBe(true);
    expect(place(s, 'plant', bd.x + 0.5, bd.z, 0).ok).toBe(true);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: door.id, x: bd.x + 0.5, z: bd.z, rot: 0 }).message).toBe('Keep the back door clear: something stands inside it');
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: s.shop.fixtures.find((f) => f.type === 'plant')!.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: door.id, x: bd.x + 0.5, z: bd.z, rot: 0 }).ok).toBe(true);
    expect(s.shop.backDoor).toEqual({ x: bd.x + 1, z: bd.z });
    // Moved off it, the old tile sells (its wall, and the gap the door left, go with it: open there now).
    expect(applyCommand(s, { type: 'sellTile', x: bd.x - 0.5, z: bd.z }).message).toBeUndefined();
  });

  it('builds on in a shop an older save left with the back half cut off from inside', () => {
    const s = shop();
    for (const x of [-2.5, -1.5, -0.5, 0.5]) expect(place(s, 'wall', x, -4).ok, `wall at ${x}`).toBe(true);
    // As an older build let it be: the one way through walled too.
    s.shop.fixtures.push({ id: s.nextId++, type: 'wall', x: 1.5, z: -4, rot: 0, slots: [] });
    s.shop.layoutVersion++;
    expect(findPath(buildGrid(s.shop, -1, true), doorInside(s), storeroomPoint(s))).toBeNull();
    expect(place(s, 'plant', -2.5, -1, 0).message).toBeUndefined();
    // Nothing more shut for it: the manager in the corner by the front wall is not walled in.
    const o = s.people.find((p) => p.kind === 'owner')!, corner = toWorld(s.shop, 2, -0.5);
    o.x = o.px = corner.x; o.z = o.pz = corner.z;
    expect(place(s, 'wall', 1.5, -1).ok).toBe(true);
    expect(canPlace(s, 'wall', 1.5, -1, 1).reason).toBe('Would box you in');
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
    // Their tile in the front corner: walled on its back edge, then on its last open side.
    expect(place(s, 'wall', -2.5, -1, 0).ok).toBe(true);
    expect(canPlace(s, 'wall', -2.5, -1, 3).reason).toBe('Would shut someone in');
  });
});

describe('growing out over the lot', () => {
  it('grows over the paving, the car park and the yard, right to the edges of the plot', () => {
    const s = shop();
    s.cash = 1e6;
    // East along one row, over the bays and the aisle, to the plot's edge.
    const z = -3;
    let x = s.shop.floor.x1;
    for (; x < MAX_FLOOR.x1; x++) expect(applyCommand(s, { type: 'buyTile', x, z }).ok, `east ${x}`).toBe(true);
    expect(canBuyTile(s, x, z).reason).toBe('The plot ends here');
    expect(s.shop.floor.x1 + WALL_T).toBeLessThanOrEqual(PLOT_RECT.x1);
    // Back, through the yard, to the plot's back edge.
    let bz = s.shop.floor.z0 - 1;
    for (; bz >= MAX_FLOOR.z0; bz--) expect(applyCommand(s, { type: 'buyTile', x: 0.5, z: bz }).ok, `back ${bz}`).toBe(true);
    expect(canBuyTile(s, 0.5, bz).reason).toBe('The plot ends here');
    expect(s.shop.floor.z0 - WALL_T).toBeGreaterThanOrEqual(PLOT_RECT.z0);
    // Nothing laid is left under the building, and the bays it grew over were sold back.
    for (const k of Object.keys(s.shop.lotTiles!)) {
      const [tx, tz] = k.split(',').map(Number) as [number, number];
      expect(onBuilding(s.shop, { x0: tx, z0: tz, x1: tx + 1, z1: tz + 1 }), k).toBe(false);
    }
    for (const f of s.shop.fixtures.filter((q) => q.type === 'parkingBay')) expect(onBuilding(s.shop, footprintOf(f.type, f.x, f.z, f.rot))).toBe(false);
    expect(s.shop.bays.length).toBe(s.shop.fixtures.filter((q) => q.type === 'parkingBay').length);
  });

  it('never walls up across a car driving on the lot', () => {
    const s = shop();
    const x = s.shop.floor.x1, z = -1;
    expect(canBuyTile(s, x, z).ok).toBe(true);
    // A car on its way across where the new tile's walls would stand.
    const from = toWorld(s.shop, x + 3.5, z + 0.5), to = toWorld(s.shop, x + 0.5, z + 0.5);
    s.cars.push({ id: 99999, model: 0, x: from.x, z: from.z, yaw: 0, px: from.x, pz: from.z, pyaw: 0, path: [from, to], pathIdx: 1, speed: 2, state: 'leaving', bay: null, ownerId: null, timer: 0 });
    expect(canBuyTile(s, x, z).reason).toBe('A car is driving through there: wait a moment');
    // Gone by: the tile can be bought.
    s.cars = [];
    expect(canBuyTile(s, x, z).ok).toBe(true);
  });
});

describe('reaching a shelf past what stands in front of it', () => {
  // A shelf in the corner, another beside it: the only way to it is the tile in front, where a chiller goes. A chiller
  // only fills the back half of its tile: turned so that half is away from the shelf, the half by it is a way through.
  it('takes a piece that leaves room to stand at the shelf, and refuses one that backs up against it', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const s = shop();
      expect(place(s, 'shelf', 1.5, -6, 0).ok).toBe(true);
      expect(place(s, 'shelf', 0.5, -6, 0).ok).toBe(true);
      const r = place(s, 'fridge', 1.5, -5, rot);
      // (Facing the shelf, or turned side on to it: room. Its back to the shelf: none.)
      if (rot === 0) expect(r.message, `rot ${rot}`).toBe('Would cut off the shelf');
      else expect(r.ok, `rot ${rot}: ${r.message}`).toBe(true);
    }
  });
});
