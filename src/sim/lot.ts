/**
 * Building on the lot round the shop: laying surfaces a tile at a time, pieces out on the grass
 * (flower beds, trees, benches, bike racks, billboards) and parking bays painted one at a time.
 * Nothing goes on the paths, lanes and bays the shop needs (lotReserved), so nobody's way is ever cut.
 */
import type { GameState, FixtureType, Rot, LotSurface, Fixture, Shop } from './types';
import {
  FIXTURES, SURFACES, BAY_PRICE, RESALE, LOT_MAX, RACK_STANDS, lotKey, inLot, footprintOf, overlaps, onBuilding, lotReserved, bayRect, paintedBays, lotLayout,
  toWorld, yawToWorld, type Rect,
} from './layout';
import { dollars } from './money';
import { busStopRule, chargerReachesBay } from './frontage';

export interface LotCheck { ok: boolean; reason: string; price: number }

const isOut = (t: FixtureType): boolean => !!FIXTURES[t].outdoor;
/** The pieces standing out on the lot. */
export function lotPieces(shop: Shop): Fixture[] { return shop.fixtures.filter((f) => isOut(f.type)); }
/** The tile in front of a piece (where a bike is wheeled in to a rack). */
export function frontTile(f: { x: number; z: number; rot: number }): Rect {
  const d = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][f.rot & 3]!;
  return { x0: f.x + d.x, z0: f.z + d.z, x1: f.x + d.x + 1, z1: f.z + d.z + 1 };
}
const name = (t: FixtureType): string => FIXTURES[t].name.toLowerCase();

/** Can this piece stand here on the lot? */
export function canPlaceOutside(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): LotCheck {
  const shop = state.shop, price = FIXTURES[type].price;
  if (Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(z - 0.5 - Math.round(z - 0.5)) > 1e-6) return { ok: false, reason: 'Snap to a tile of the lot', price };
  const r = footprintOf(type, x, z, rot);
  if (!inLot(r)) return { ok: false, reason: 'Keep it on your lot', price };
  if (onBuilding(shop, r)) return { ok: false, reason: 'Out on the lot, not on the shop', price };
  if (lotReserved(shop).some((q) => overlaps(q, r))) return { ok: false, reason: 'Keep the paths, lanes and bays clear', price };
  const others = lotPieces(shop).filter((f) => f.id !== ignoreId);
  if (others.some((f) => overlaps(footprintOf(f.type, f.x, f.z, f.rot), r))) return { ok: false, reason: 'Something is already there', price };
  if (others.some((f) => f.type === 'bikeRack' && overlaps(frontTile(f), r))) return { ok: false, reason: 'Leave room in front of the bike rack', price };
  if (type === 'busStop') { const why = busStopRule(r, rot); if (why) return { ok: false, reason: why, price }; }
  if (type === 'evCharger' && !chargerReachesBay(shop, x, z)) return { ok: false, reason: 'Put it beside the car park, where a bay is in reach', price };
  if (type === 'bikeRack') {
    const ft = frontTile({ x, z, rot });
    if (!inLot(ft) || onBuilding(shop, ft) || others.some((f) => overlaps(footprintOf(f.type, f.x, f.z, f.rot), ft))) return { ok: false, reason: 'Needs room in front to wheel a bike in (R turns it)', price };
  }
  const max = LOT_MAX[type];
  if (max !== undefined && ignoreId === undefined && others.filter((f) => f.type === type).length >= max) return { ok: false, reason: `${max} is as many as the lot takes`, price };
  if (ignoreId === undefined && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: FIXTURES[type].name, price };
}

/**
 * The first piece on the lot that a new shape of shop would put under the building or on its paths
 * and bays (the shop grown or shrunk a tile, a bay painted), as a reason; null when nothing is in the way.
 */
export function lotClash(state: GameState, shape: Shop): string | null {
  const reserved = lotReserved(shape);
  for (const f of lotPieces(state.shop)) {
    const r = footprintOf(f.type, f.x, f.z, f.rot);
    if (onBuilding(shape, r) || reserved.some((q) => overlaps(q, r))) return `The ${name(f.type)} outside is in the way`;
  }
  return null;
}

// ---- Surfaces, a tile at a time.

/** What a lot tile is laid with (null: grass). */
export function surfaceAt(shop: Shop, x: number, z: number): LotSurface | null { return shop.lotTiles?.[lotKey(x, z)] ?? null; }

/**
 * Can this tile of the lot be laid with this surface (null takes it up, back to grass)? Priced as
 * floors are: the surface coming up sells back for part of what it cost.
 */
export function canPave(state: GameState, x: number, z: number, surface: LotSurface | null): LotCheck {
  const shop = state.shop, now = surfaceAt(shop, x, z);
  const per = (id: LotSurface | null) => SURFACES.find((s) => s.id === id)?.perTile ?? 0;
  const price = per(surface) - Math.round(RESALE * per(now));
  const r = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
  if (!inLot(r)) return { ok: false, reason: 'Keep it on your lot', price };
  if (onBuilding(shop, r)) return { ok: false, reason: 'Out on the lot, not on the shop', price };
  if (lotReserved(shop).some((q) => overlaps(q, r))) return { ok: false, reason: 'Paved already', price };
  if (now === surface) return { ok: false, reason: surface ? 'Laid already' : 'Grass already', price };
  if (price > 0 && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: surface ? SURFACES.find((s) => s.id === surface)!.name : 'Back to grass', price };
}

export function pave(state: GameState, x: number, z: number, surface: LotSurface | null): string | null {
  const check = canPave(state, x, z, surface);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const tiles = { ...state.shop.lotTiles };
  if (surface) tiles[lotKey(x, z)] = surface; else delete tiles[lotKey(x, z)];
  state.shop.lotTiles = tiles;
  // People take to paving: the walking grid weighs it.
  state.shop.layoutVersion++;
  return null;
}

/** Surfaces under the building or a path now (the shop grew, a bay was painted) are gone with it. */
export function pruneSurfaces(shop: Shop): void {
  if (!shop.lotTiles) return;
  const reserved = lotReserved(shop);
  const keep = Object.entries(shop.lotTiles).filter(([k]) => {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const r = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    return !onBuilding(shop, r) && !reserved.some((q) => overlaps(q, r));
  });
  shop.lotTiles = Object.fromEntries(keep);
}

// ---- Parking bays, painted one at a time.

/** The bay slot nearest a shop-relative point (null when none is near). */
export function nearestSlot(shop: Shop, x: number, z: number): { id: number; x: number; z: number; yaw: number; painted: boolean } | null {
  const { slots, bays } = paintedBays(shop);
  let best: (typeof slots)[number] | null = null, bd = 1.2;
  for (const s of slots) { const d = Math.max(Math.abs(s.x - x) - 0.85, Math.abs(s.z - z) - 0.55, 0); if (d < bd) { bd = d; best = s; } }
  return best ? { ...best, painted: bays.some((b) => b.id === best!.id) } : null;
}

/** The plan as it stands (old saves paint whole rows). */
function planOf(shop: Shop): number[] { return paintedBays(shop).bays.map((b) => b.id); }

export function canPaintBay(state: GameState, slotId: number): LotCheck {
  const shop = state.shop, price = BAY_PRICE;
  const { slots, bays } = paintedBays(shop);
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'Point at a place for a bay', price };
  if (bays.some((b) => b.id === slotId)) return { ok: false, reason: 'Painted already', price };
  const shape: Shop = { ...shop, bayPlan: [...planOf(shop), slotId] };
  if (lotPieces(shop).some((f) => overlaps(footprintOf(f.type, f.x, f.z, f.rot), bayRect(slot)))) return { ok: false, reason: 'Move what stands there first', price };
  const clash = lotClash(state, shape);
  if (clash) return { ok: false, reason: clash, price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: 'Paint a bay', price };
}

/** Rebuild the bays (world space) from the plan, keeping each car with its bay. */
function syncBays(shop: Shop, carIds: Map<number, number | null>): void {
  const { bays, rows } = paintedBays(shop);
  shop.bays = bays.map((b) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: carIds.get(b.id) ?? null }));
  shop.lotRows = rows;
  pruneSurfaces(shop);
  shop.layoutVersion++;
}
function carsBySlot(shop: Shop): Map<number, number | null> {
  const m = new Map<number, number | null>();
  paintedBays(shop).bays.forEach((b, i) => m.set(b.id, shop.bays[i]?.carId ?? null));
  return m;
}

export function paintBay(state: GameState, slotId: number): string | null {
  const check = canPaintBay(state, slotId);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop, cars = carsBySlot(shop);
  // A new bay goes on the end of the list: the cars already in bays keep their numbers.
  shop.bayPlan = [...planOf(shop), slotId];
  syncBays(shop, cars);
  return null;
}

export function canEraseBay(state: GameState, slotId: number): LotCheck {
  const shop = state.shop, price = -Math.round(RESALE * BAY_PRICE);
  const i = paintedBays(shop).bays.findIndex((b) => b.id === slotId);
  if (i < 0) return { ok: false, reason: 'Point at a painted bay', price };
  if (shop.bays[i]?.carId !== null && shop.bays[i]?.carId !== undefined) return { ok: false, reason: 'A car has that bay', price };
  return { ok: true, reason: 'Paint out this bay', price };
}

export function eraseBay(state: GameState, slotId: number): string | null {
  const check = canEraseBay(state, slotId);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop, cars = carsBySlot(shop);
  const i = paintedBays(shop).bays.findIndex((b) => b.id === slotId);
  shop.bayPlan = planOf(shop).filter((id) => id !== slotId);
  // Cars in the bays after it move up a number with them.
  for (const c of state.cars) if (c.lot === undefined && c.bay !== null && c.bay > i) c.bay--;
  syncBays(shop, cars);
  return null;
}

/** Paint every bay there is room for (the balance bots' and old tests' "double the lot"). */
export function paintAllBays(state: GameState): string | null {
  const free = lotLayout(state.shop).slots.filter((s) => canPaintBay({ ...state, cash: Infinity }, s.id).ok);
  if (!free.length) return 'The car park is as big as the plot allows.';
  if (state.cash < free.length * BAY_PRICE) return `Need ${dollars(free.length * BAY_PRICE)} for the extra bays.`;
  for (const s of free) paintBay(state, s.id);
  return null;
}

// ---- What the lot does for the shop.

/** How the lot looks from the street (0..1): its pieces, up to a few of each, and laid paving. */
export function lotAppeal(shop: Shop): number {
  let a = 0;
  for (const [type, def] of Object.entries(FIXTURES)) if (def.curb) a += Math.min(shop.fixtures.filter((f) => f.type === type).length, def.looksCap ?? 1) * def.curb;
  let paving = 0;
  for (const s of Object.values(shop.lotTiles ?? {})) paving += SURFACES.find((x) => x.id === s)?.curb ?? 0;
  return Math.min(1, a + Math.min(0.15, paving));
}

/** Your billboards on your own lot: awareness they add each day (the second adds half as much again). */
export function lotBillboardReach(shop: Shop): number {
  const n = shop.fixtures.filter((f) => f.type === 'billboard').length;
  return n >= 2 ? 0.045 : n === 1 ? 0.03 : 0;
}

/** Bike racks draw shoppers from further off than they would walk: a little more trade per rack (up to four). */
export function bikePull(shop: Shop): number {
  return 1 + 0.025 * Math.min(4, shop.fixtures.filter((f) => f.type === 'bikeRack').length);
}

/** A free stand at a rack: the rack and the stand. */
export function freeStand(shop: Shop): { rack: Fixture; slot: number } | null {
  for (const f of shop.fixtures) {
    if (f.type !== 'bikeRack') continue;
    const bikes = f.bikes ?? [];
    for (let i = 0; i < RACK_STANDS; i++) if (bikes[i] === null || bikes[i] === undefined) return { rack: f, slot: i };
  }
  return null;
}

/** Shop-relative point where a bike stands in a rack's stand (and where its rider stands to lock it). */
export function standPoint(f: Fixture, slot: number): { bike: { x: number; z: number }; rider: { x: number; z: number }; yaw: number } {
  const cx = f.x + 0.5, cz = f.z + 0.5;
  const fwd = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][f.rot & 3]!;
  const side = { x: fwd.z, z: -fwd.x };
  const off = (slot - (RACK_STANDS - 1) / 2) * 0.28;
  return {
    bike: { x: cx + side.x * off + fwd.x * 0.1, z: cz + side.z * off + fwd.z * 0.1 },
    rider: { x: cx + side.x * off + fwd.x * 0.75, z: cz + side.z * off + fwd.z * 0.75 },
    yaw: Math.atan2(fwd.x, fwd.z),
  };
}

/** Let go of the stands of people who have gone (a rider who ran off, say). */
export function freeStands(state: GameState): void {
  const here = new Set(state.people.map((p) => p.id));
  for (const f of state.shop.fixtures) if (f.bikes) f.bikes = f.bikes.map((id) => (id !== null && here.has(id) ? id : null));
}
