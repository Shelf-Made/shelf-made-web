import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, tick, TICK, resetGridCache, type GameState } from './index';
import { openGame } from './testUtil';
import { canPlace, canBuyTile } from './build';
import { canPave, canPaintBay, lotAppeal, standPoint, surfaceAt } from './lot';
import { lotLayout, lotReserved, overlaps, toWorld, footprintOf, onBuilding, BAY_PRICE, LOT_FRONT, WALL_T } from './layout';
import { onLotGrid, bayReachable } from './drive';
import { gridFor } from './state';
import { cellOf, isBlocked } from './grid';
import { findPath } from './pathfinding';
import { spawnCustomer } from './people';
import { looksOf } from './reviews';

function shop(seed = 5): GameState {
  const s = newGame({ seed, plotId: 'main', name: 'Lot' });
  resetGridCache();
  s.cash = 20000;
  return s;
}
const place = (s: GameState, fixtureType: Parameters<typeof canPlace>[1], x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
/** A free lawn tile out east of the car park (on the lot's grid: whole x, half z). */
const LAWN = { x: 10, z: -4.5 };
/** The aisle's tile beside the bays (the first tile of tarmac past them). */
const AISLE = (s: GameState) => s.shop.floor.x1 + WALL_T + 2;

describe('building on the lot', () => {
  it('puts trees, flowers and benches on the grass, never on the shop or the tarmac', () => {
    const s = shop();
    expect(place(s, 'tree', LAWN.x, LAWN.z).ok).toBe(true);
    expect(place(s, 'flowerBed', LAWN.x, LAWN.z + 1).ok).toBe(true);
    expect(canPlace(s, 'parkBench', LAWN.x, LAWN.z + 1, 0).reason).toBe('Something is already there');
    // Off the lot's grid, on the shop, on the aisle, past the sidewalk.
    expect(canPlace(s, 'tree', LAWN.x + 0.5, LAWN.z, 0).ok).toBe(false);
    expect(canPlace(s, 'tree', 0, -3.5, 0).reason).toBe('Out on the lot, not on the shop');
    expect(canPlace(s, 'tree', AISLE(s), -3.5, 0).reason).toBe('Not on the tarmac: cars drive there');
    expect(canPlace(s, 'tree', 3, Math.ceil(LOT_FRONT - 0.5) + 0.5 - 1 + 1, 0).reason).toBe('Keep it on your lot');
    // Dig the tarmac up and the tree can go there.
    expect(applyCommand(s, { type: 'pave', x: AISLE(s) + 1, z: -9.5 + 1, surface: null }).ok).toBe(true);
    expect(canPlace(s, 'tree', AISLE(s) + 1, -8.5, 0).ok).toBe(true);
    // Every piece placed keeps clear of the pylon sign.
    for (const f of s.shop.fixtures.filter((x) => x.type === 'tree' || x.type === 'flowerBed')) {
      expect(lotReserved(s.shop).some((q) => overlaps(q, footprintOf(f.type, f.x, f.z, f.rot)))).toBe(false);
    }
    // A billboard is two tiles wide; two is the most the lot takes.
    expect(place(s, 'billboard', LAWN.x, LAWN.z - 3).ok).toBe(true);
    expect(place(s, 'billboard', LAWN.x, LAWN.z - 5).ok).toBe(true);
    expect(canPlace(s, 'billboard', LAWN.x - 2, -9.5, 0).reason).toMatch(/as many as the lot takes/);
    expect(canPlace(s, 'tree', LAWN.x + 1, LAWN.z - 3, 0).reason).toBe('Something is already there');
    // The pieces make the frontage nicer, and get in nobody's way: the door is still reached from the street.
    expect(lotAppeal(s.shop)).toBeGreaterThan(0.1);
    expect(looksOf(s).curb).toBeGreaterThan(0.1);
  });

  it('lays surfaces a tile at a time, digs up what the lot came with, people prefer paving to grass', () => {
    const s = shop();
    const before = s.cash;
    expect(applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: 'brick' }).ok).toBe(true);
    expect(s.cash).toBe(before - 12);
    expect(canPave(s, LAWN.x, LAWN.z, 'brick').reason).toBe('Laid already');
    // Swapping it: the new surface less part of the old one.
    expect(canPave(s, LAWN.x, LAWN.z, 'paving').price).toBe(8 - 7);
    expect(applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: null }).ok).toBe(true);
    expect(s.cash).toBe(before - 12 + 7);
    // Not on the shop; the aisle is tarmac already, and can be dug up like anything else.
    expect(canPave(s, 0, -3.5, 'asphalt').ok).toBe(false);
    expect(canPave(s, AISLE(s), -3.5, 'asphalt').reason).toBe('Laid already');
    expect(canPave(s, AISLE(s), -3.5, null).ok).toBe(true);
    // The concrete in front of the shop and the path to the door come up too (and go down again as anything).
    const front = { x: s.shop.door.x + 2, z: 0.5 };
    expect(surfaceAt(s.shop, front.x, front.z)).toBe('concrete');
    expect(applyCommand(s, { type: 'pave', ...front, surface: null }).ok).toBe(true);
    expect(surfaceAt(s.shop, front.x, front.z)).toBe(null);
    expect(applyCommand(s, { type: 'pave', ...front, surface: 'brick' }).ok).toBe(true);
    // Only the pylon sign's patch stays as it is.
    const p = s.shop.pylon!;
    expect(canPave(s, Math.floor(p.x), Math.floor(p.z - 0.5) + 0.5, 'brick').reason).toBe('The pylon sign stands there');
    // A paved tile is cheaper to walk than grass.
    applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: 'paving' });
    const g = gridFor(s);
    const at = (x: number, z: number) => { const [cx, cz] = cellOf(g, toWorld(s.shop, x, z)); return g.cost[cz * g.w + cx]!; };
    expect(at(LAWN.x + 0.5, LAWN.z + 0.5)).toBe(1);
    expect(at(LAWN.x + 0.5, LAWN.z + 1.5)).toBeGreaterThan(2);
  });

  it('every tile of the lot sits on one grid, flush with the walls, and nothing laid is under the shop', () => {
    for (const plotId of ['main', 'elm', 'bus']) {
      const s = openGame({ seed: 3, plotId, name: 'Grid' });
      for (const k of Object.keys(s.shop.lotTiles ?? {})) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        expect(onLotGrid(x, z), `${plotId} ${k}`).toBe(true);
        expect(onBuilding(s.shop, { x0: x, z0: z, x1: x + 1, z1: z + 1 }), `${plotId} ${k}`).toBe(false);
      }
      // The walls' outside faces are on the grid's lines: the tile beside a wall touches it, with no gap.
      const f = s.shop.floor;
      for (const edge of [f.x0 - WALL_T, f.x1 + WALL_T]) expect(Math.abs(edge - Math.round(edge))).toBeLessThan(1e-9);
      expect(Math.abs(f.z1 + WALL_T - 0.5 - Math.round(f.z1 + WALL_T - 0.5))).toBeLessThan(1e-9);
    }
  });

  it('puts a parking bay anywhere, with its tarmac, and cars use it once tarmac runs to it from the road', () => {
    const s = shop();
    expect(s.shop.bays.length).toBe(4);
    const cash = s.cash;
    // Out on the grass east of the car park, a tile clear of the aisle: it comes with two tiles of tarmac.
    const x = AISLE(s) + 3, z = -4.5;
    expect(canPlace(s, 'parkingBay', x, z, 3).price).toBe(BAY_PRICE + 2 * 6);
    expect(place(s, 'parkingBay', x, z, 3).ok).toBe(true);
    expect(s.cash).toBe(cash - BAY_PRICE - 12);
    expect(s.shop.bays.length).toBe(5);
    const bay = s.shop.fixtures.find((f) => f.type === 'parkingBay' && f.x === x && f.z === z)!;
    expect(surfaceAt(s.shop, x, z)).toBe('asphalt');
    expect(surfaceAt(s.shop, x + 1, z)).toBe('asphalt');
    // Nothing joins it to the road yet: no car can get there.
    expect(bayReachable(s.shop, bay)).toBe(false);
    // One tile of tarmac from the aisle to its open end.
    expect(applyCommand(s, { type: 'pave', x: x - 1, z, surface: 'asphalt' }).ok).toBe(true);
    expect(bayReachable(s.shop, bay)).toBe(true);
    // Not on another piece, not over the tarmac a bay stands on, and the tarmac under a bay stays while it does.
    expect(canPlace(s, 'parkingBay', x, z, 1).ok).toBe(false);
    expect(canPave(s, x, z, null).reason).toBe('A parking bay is on it: move or sell the bay first');
    // Sold straight back (a change of mind): all of it, and the tarmac it brought comes up again.
    let c2 = s.cash;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: bay.id }).ok).toBe(true);
    expect(s.cash).toBe(c2 + BAY_PRICE + 12);
    expect(s.shop.bays.length).toBe(4);
    expect(surfaceAt(s.shop, x, z)).toBe(null);
    expect(surfaceAt(s.shop, x - 1, z)).toBe('asphalt');
    // Sold once it has been used: part of the bay's price back, and its tarmac stays (it is the lot's now).
    expect(place(s, 'parkingBay', x, z, 3).ok).toBe(true);
    const again = s.shop.fixtures.find((f) => f.type === 'parkingBay' && f.x === x && f.z === z)!;
    again.bought = s.day - 1;
    c2 = s.cash;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: again.id }).ok).toBe(true);
    expect(s.cash).toBe(c2 + Math.round(BAY_PRICE * 0.6));
    expect(surfaceAt(s.shop, x, z)).toBe('asphalt');
    // The car park's own places (as the balance bots paint them) still work.
    expect(applyCommand(s, { type: 'paintBay', slot: 8 }).ok).toBe(true);
    expect(s.shop.bays.length).toBe(5);
    expect(canPaintBay(s, 8).reason).toBe('Painted already');
    expect(applyCommand(s, { type: 'eraseBay', slot: 8 }).ok).toBe(true);
    expect(s.shop.bays.length).toBe(4);
  });

  it('never strands a car: a bay with a car in it stays, and the tarmac under a car stays', () => {
    const s = openGame({ seed: 11, plotId: 'main', name: 'Busy', tutorial: false });
    for (let i = 0; i < 300 / TICK && !s.cars.some((c) => c.state === 'parked' && c.lot === undefined); i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
    const car = s.cars.find((c) => c.state === 'parked' && c.lot === undefined)!;
    expect(car).toBeTruthy();
    const fid = s.shop.bays[car.bay!]!.fid!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: fid }).ok).toBe(false);
    const f = s.shop.fixtures.find((x) => x.id === fid)!;
    expect(canPlace(s, 'parkingBay', f.x, f.z - 6, f.rot, f.id).ok).toBe(false);
  });
  it('will not grow the shop under a tree out on the lot', () => {
    const s = shop();
    // Right by the west wall, where the service lane would move to if the shop grew a tile west.
    const L = lotLayout(s.shop);
    const x = Math.floor(L.serviceLane.x0) - 1;
    expect(place(s, 'tree', x, -9.5).ok).toBe(true);
    expect(canBuyTile(s, s.shop.floor.x0 - 1, -3).ok).toBe(true);
    expect(place(s, 'tree', -5, -9.5).ok || place(s, 'tree', -5, -10.5).ok).toBe(true);
  });

  it('brings shoppers by bike to a rack: they ride in, lock up, shop and ride home', () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'Bikes', tutorial: false });
    s.cash = 5000;
    // A rack on the grass in front of the shop, facing the street.
    let rack = null as GameState['shop']['fixtures'][number] | null;
    for (let x = 1; x < 6 && !rack; x++) if (place(s, 'bikeRack', x, 1.5 - 1, 0).ok || place(s, 'bikeRack', x, 1.5, 2).ok) rack = s.shop.fixtures.find((f) => f.type === 'bikeRack')!;
    if (!rack) for (let x = 8; x < 12 && !rack; x++) if (place(s, 'bikeRack', x, -2.5, 0).ok) rack = s.shop.fixtures.find((f) => f.type === 'bikeRack')!;
    expect(rack).toBeTruthy();
    applyCommand(s, { type: 'openTomorrow' });
    s.phase = 'open';
    let rode = 0, locked = 0, home = 0;
    for (let i = 0; i < 400 / TICK; i++) {
      tick(s);
      if (i % 40 === 0 && s.people.filter((p) => p.kind === 'customer').length < 6) spawnCustomer(s, true);
      for (const p of s.people) {
        if (p.riding && p.state === 'walking') rode = Math.max(rode, 1);
        if (p.bike && !p.riding && (p.state === 'shopping' || p.state === 'browsing')) locked = Math.max(locked, 1);
        if (p.riding && p.state === 'toCar') home = Math.max(home, 1);
      }
      if (rode && locked && home) break;
    }
    expect(rode).toBe(1);
    expect(locked).toBe(1);
    expect(home).toBe(1);
    // The stand point is in front of the rack, on the lot.
    const sp = standPoint(rack!, 0);
    expect(findPath(gridFor(s), toWorld(s.shop, sp.rider.x, sp.rider.z), toWorld(s.shop, 0, 1.2))).toBeTruthy();
    expect(s.stuckRescues).toBe(0);
  });
});

describe('walking round the shop', () => {
  it('leaves the front of a chiller open: two facing each other a tile apart have a walkway between', () => {
    const s = shop();
    // Chillers along z = -3 facing +z, and along z = -2 facing back at them.
    expect(place(s, 'fridge', -1.5, -4, 0).ok).toBe(true);
    expect(place(s, 'fridge', -1.5, -3, 2).ok).toBe(true);
    const blocked = (x: number, z: number) => { const g = gridFor(s); const [cx, cz] = cellOf(g, toWorld(s.shop, x, z)); return isBlocked(g, cx, cz); };
    expect(blocked(-1, -3.75)).toBe(true); // the first one's back half
    expect(blocked(-1, -3.25)).toBe(false); // open floor in front of it
    expect(blocked(-1, -2.75)).toBe(false); // and in front of the other
    expect(blocked(-1, -2.25)).toBe(true);
    // A shelf still fills its tile.
    expect(place(s, 'shelf', 1.5, -4, 0).ok).toBe(true);
    expect(blocked(2, -3.25)).toBe(true);
  });
});

describe('hiring', () => {
  it('has no cap on staff: someone new answers the ad each time, and spare cashiers help out', () => {
    const s = openGame({ seed: 41, plotId: 'main', name: 'Crew', tutorial: false });
    s.cash = 100000;
    for (let i = 0; i < 9; i++) {
      const c = s.staffPool.find((x) => x.role === 'cashier') ?? s.staffPool[0]!;
      expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
    }
    expect(s.people.filter((p) => p.kind === 'staff').length).toBe(9);
    expect(s.staffPool.length).toBe(5);
    expect(s.shop.fixtures.filter((f) => f.staffId).length).toBe(1);
  });
});
