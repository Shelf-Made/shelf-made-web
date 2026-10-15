import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, tick, TICK, resetGridCache, type GameState } from './index';
import { openGame } from './testUtil';
import { canPlace, canBuyTile } from './build';
import { canPave, canPaintBay, lotAppeal, standPoint } from './lot';
import { lotLayout, lotReserved, overlaps, toWorld, footprintOf, BAY_PRICE, LOT_FRONT } from './layout';
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

describe('building on the lot', () => {
  it('puts trees, flowers and benches on the grass, never on the shop, a lane or a bay', () => {
    const s = shop();
    expect(place(s, 'tree', LAWN.x, LAWN.z).ok).toBe(true);
    expect(place(s, 'flowerBed', LAWN.x, LAWN.z + 1).ok).toBe(true);
    expect(canPlace(s, 'parkBench', LAWN.x, LAWN.z + 1, 0).reason).toBe('Something is already there');
    // Off the lot's grid, on the shop, on the aisle, on a painted bay, past the sidewalk.
    expect(canPlace(s, 'tree', LAWN.x + 0.5, LAWN.z, 0).ok).toBe(false);
    expect(canPlace(s, 'tree', 0, -3.5, 0).reason).toBe('Out on the lot, not on the shop');
    const L = lotLayout(s.shop);
    const aisleX = Math.floor(L.aisle.x0) + 1;
    expect(canPlace(s, 'tree', aisleX, -3.5, 0).reason).toBe('Keep the paths, lanes and bays clear');
    expect(canPlace(s, 'tree', 3, Math.ceil(LOT_FRONT - 0.5) + 0.5 - 1 + 1, 0).reason).toBe('Keep it on your lot');
    // Every piece placed keeps clear of everything the shop needs.
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

  it('lays surfaces a tile at a time, people prefer them to grass, and takes them up for part of the price', () => {
    const s = shop();
    const before = s.cash;
    expect(applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: 'brick' }).ok).toBe(true);
    expect(s.cash).toBe(before - 12);
    expect(canPave(s, LAWN.x, LAWN.z, 'brick').reason).toBe('Laid already');
    // Swapping it: the new surface less part of the old one.
    expect(canPave(s, LAWN.x, LAWN.z, 'paving').price).toBe(8 - 7);
    expect(applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: null }).ok).toBe(true);
    expect(s.cash).toBe(before - 12 + 7);
    // Not on the shop or the aisle (paved already).
    expect(canPave(s, 0, -3.5, 'asphalt').ok).toBe(false);
    const L = lotLayout(s.shop);
    expect(canPave(s, Math.floor(L.aisle.x0) + 1, -3.5, 'asphalt').reason).toBe('Paved already');
    // A paved tile is cheaper to walk than grass.
    applyCommand(s, { type: 'pave', x: LAWN.x, z: LAWN.z, surface: 'paving' });
    const g = gridFor(s);
    const at = (x: number, z: number) => { const [cx, cz] = cellOf(g, toWorld(s.shop, x, z)); return g.cost[cz * g.w + cx]!; };
    expect(at(LAWN.x + 0.5, LAWN.z + 0.5)).toBe(1);
    expect(at(LAWN.x + 0.5, LAWN.z + 1.5)).toBeGreaterThan(2);
  });

  it('paints parking bays one at a time, up to as many as the car park takes, and paints them out again', () => {
    const s = shop();
    const L = lotLayout(s.shop);
    expect(s.shop.bays.length).toBe(4);
    expect(L.slots.length).toBe(8);
    const free = L.slots.filter((sl) => !s.shop.bayPlan!.includes(sl.id));
    const cash = s.cash;
    expect(applyCommand(s, { type: 'paintBay', slot: free[0]!.id }).ok).toBe(true);
    expect(s.cash).toBe(cash - BAY_PRICE);
    expect(s.shop.bays.length).toBe(5);
    expect(s.shop.lotRows).toBe(2);
    for (const sl of free.slice(1)) expect(applyCommand(s, { type: 'paintBay', slot: sl.id }).ok).toBe(true);
    expect(s.shop.bays.length).toBe(8);
    expect(canPaintBay(s, free[0]!.id).reason).toBe('Painted already');
    // A tree where a bay could go: that bay cannot be painted until it moves.
    const t = shop();
    const slot = lotLayout(t.shop).slots.find((sl) => sl.row === 1)!;
    expect(place(t, 'tree', Math.floor(slot.x), slot.z - 0.5 + 0.0 - ((slot.z - 0.5) % 1 === 0 ? 0 : 0)).ok || place(t, 'tree', Math.floor(slot.x), Math.floor(slot.z - 0.5) + 0.5).ok).toBe(true);
    expect(canPaintBay(t, slot.id).ok).toBe(false);
    // Painted out: part of the price back.
    const c2 = s.cash;
    expect(applyCommand(s, { type: 'eraseBay', slot: free[0]!.id }).ok).toBe(true);
    expect(s.cash).toBe(c2 + Math.round(BAY_PRICE * 0.6));
    expect(s.shop.bays.length).toBe(7);
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
