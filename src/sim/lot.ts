/**
 * Building on the lot round the shop: it is all tiles (see drive.ts), each grass or laid with something (concrete,
 * paving, brick, gravel, tarmac), any of it dug up or laid again a tile at a time; pieces stand on it (flower beds,
 * trees, benches, bike racks, billboards...) and parking bays go wherever there is tarmac to drive to them. Only the
 * pylon sign stays put (lotReserved).
 */
import type { GameState, FixtureType, Rot, LotSurface, Fixture, Shop } from './types';
import {
  FIXTURES, SURFACES, BAY_PRICE, RESALE, LOT_MAX, RACK_STANDS, lotKey, inLot, footprintOf, overlaps, onBuilding, lotReserved, bayRect, paintedBays, lotLayout,
  toWorld, toLocal, yawToWorld, justBought, floorTileList, isFloor, WALL_T, type Rect,
} from './layout';
import { dollars } from './money';
import { busStopRule, chargerReachesBay, dockByDoor } from './frontage';
import { tilesOf, syncLotBays, defaultSlots, bayPieces, dropCovered, type LotSlot } from './drive';

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
  if (lotReserved(shop).some((q) => overlaps(q, r))) return { ok: false, reason: shop.lotBaked ? 'The pylon sign stands there' : 'Keep the paths, lanes and bays clear', price };
  const others = lotPieces(shop).filter((f) => f.id !== ignoreId);
  const on = tilesOf({ type, x, z, rot });
  if (type === 'parkingBay') {
    // A bay comes with its tarmac: the price of the lines, and of tarmac where there is none. Not over a car.
    const moving = ignoreId !== undefined ? shop.bays.find((b) => b.fid === ignoreId) : undefined;
    if (moving && moving.carId !== null) return { ok: false, reason: 'A car is parked in it: wait till it drives off', price };
    const strands = ignoreId !== undefined ? bayHoldsCharger(shop, ignoreId, { x, z, rot }) : null;
    if (strands) return { ok: false, reason: strands, price };
    const lay = on.filter((t) => surfaceAt(shop, t.x, t.z) !== 'asphalt').length * (SURFACES.find((q) => q.id === 'asphalt')!.perTile);
    const total = price + lay;
    if (others.some((f) => overlaps(footprintOf(f.type, f.x, f.z, f.rot), r))) return { ok: false, reason: 'Something is already there', price: total };
    if (carOn(state, r)) return { ok: false, reason: 'A car is in the way', price: total };
    if (ignoreId === undefined && state.cash < total) return { ok: false, reason: `Need ${dollars(total)}`, price: total };
    return { ok: true, reason: FIXTURES[type].name, price: total };
  }
  // (A loading dock is painted on the tarmac, where the truck stands; nothing else goes where cars drive.)
  if (type === 'loadingDock') { if (!dockByDoor(shop, x, z, rot)) return { ok: false, reason: 'Put it by the door deliveries come in at', price }; }
  else if (shop.lotBaked && on.some((t) => surfaceAt(shop, t.x, t.z) === 'asphalt')) return { ok: false, reason: 'Not on the tarmac: cars drive there', price };
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
 * and bays (the shop grown or shrunk a tile, a bay painted or painted out), or leave a car charger with
 * no bay in reach, as a reason; null when nothing is in the way.
 */
export function lotClash(state: GameState, shape: Shop): string | null {
  const reserved = lotReserved(shape);
  // Never walls up across a car driving on the lot (its way from here would run into them).
  if (state.shop.lotBaked) {
    const fresh = floorTileList(shape).filter((t) => !isFloor(state.shop, t.x, t.z)).map((t) => ({ x0: t.x - WALL_T, z0: t.z - WALL_T, x1: t.x + 1 + WALL_T, z1: t.z + 1 + WALL_T }));
    if (fresh.length && carThrough(state, fresh)) return 'A car is driving through there: wait a moment';
  }
  for (const f of lotPieces(state.shop)) {
    const r = footprintOf(f.type, f.x, f.z, f.rot);
    // An empty bay the shop grows over goes (its lines sold back); one with a car in it waits for the car.
    if (f.type === 'parkingBay' && state.shop.lotBaked) {
      if (onBuilding(shape, r) && state.shop.bays.some((b) => b.fid === f.id && b.carId !== null)) return 'A car is parked where the shop would go: wait till it drives off';
      continue;
    }
    if (onBuilding(shape, r) || reserved.some((q) => overlaps(q, r))) return `The ${name(f.type)} outside is in the way`;
    // A charger with no bay in reach is never used, but still costs its upkeep.
    if (f.type === 'evCharger' && chargerReachesBay(state.shop, f.x, f.z) && !chargerReachesBay(shape, f.x, f.z)) return 'A car charger would have no bay in reach: move or sell it first';
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
  if (lotReserved(shop).some((q) => overlaps(q, r))) return { ok: false, reason: shop.lotBaked ? 'The pylon sign stands there' : 'Paved already', price };
  if (now === surface) return { ok: false, reason: surface ? 'Laid already' : 'Grass already', price };
  if (shop.lotBaked) {
    const piece = lotPieces(shop).find((f) => overlaps(footprintOf(f.type, f.x, f.z, f.rot), r));
    if (piece?.type === 'parkingBay') return { ok: false, reason: 'A parking bay is on it: move or sell the bay first', price };
    if (piece && surface === 'asphalt') return { ok: false, reason: `Not under the ${name(piece.type)}: cars drive on tarmac`, price };
    if (now === 'asphalt' && carOn(state, r)) return { ok: false, reason: 'A car is on it: wait till it drives off', price };
    if (now === 'asphalt' && carThrough(state, [r])) return { ok: false, reason: 'A car is about to drive over it: wait a moment', price };
  }
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

/** Would taking this bay away (or moving it to `to`) leave a car charger with no bay in reach? Why not, or null. */
export function bayHoldsCharger(shop: Shop, fid: number, to?: { x: number; z: number; rot: Rot }): string | null {
  const after: Shop = { ...shop, fixtures: shop.fixtures.flatMap((f) => (f.id !== fid ? [f] : to ? [{ ...f, ...to }] : [])) };
  for (const c of shop.fixtures) {
    if (c.type === 'evCharger' && chargerReachesBay(shop, c.x, c.z) && !chargerReachesBay(after, c.x, c.z)) return 'A car charger would have no bay in reach: move or sell it first';
  }
  return null;
}

/** A car on your lot (not parked) whose way on from where it is runs over any of these patches (a car's half width round them). */
function carThrough(state: GameState, rects: Rect[]): boolean {
  const near = (x: number, z: number) => { const l = toLocal(state.shop, x, z); return rects.some((r) => l.x > r.x0 - 0.45 && l.x < r.x1 + 0.45 && l.z > r.z0 - 0.45 && l.z < r.z1 + 0.45); };
  for (const c of state.cars) {
    if (c.lot !== undefined || c.state === 'parked' || c.state === 'passing' || c.state === 'turnedAway' || c.state === 'gone') continue;
    const pts = [{ x: c.x, z: c.z }, ...c.path.slice(c.pathIdx), ...(c.reversing ? c.next ?? [] : [])];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1] ?? a, d = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t <= d; t += 0.5) if (near(a.x + ((b.x - a.x) * t) / (d || 1), a.z + ((b.z - a.z) * t) / (d || 1))) return true;
    }
  }
  return false;
}

/** A car on (or partly on) this patch of the lot. */
function carOn(state: GameState, r: Rect): boolean {
  return state.cars.some((c) => {
    if (c.lot !== undefined || c.state === 'passing' || c.state === 'turnedAway') return false;
    const l = toLocal(state.shop, c.x, c.z);
    return l.x > r.x0 - 0.45 && l.x < r.x1 + 0.45 && l.z > r.z0 - 0.45 && l.z < r.z1 + 0.45;
  });
}

/** Surfaces under the building or a path now (the shop grew, a bay was painted) are gone with it. */
export function pruneSurfaces(shop: Shop): void {
  if (shop.lotBaked) { dropCovered(shop); return; }
  if (!shop.lotTiles) return;
  const reserved = lotReserved(shop);
  const keep = Object.entries(shop.lotTiles).filter(([k]) => {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const r = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    return !onBuilding(shop, r) && !reserved.some((q) => overlaps(q, r));
  });
  shop.lotTiles = Object.fromEntries(keep);
}

// ---- Parking bays. On a lot laid as tiles they are pieces (anywhere there is tarmac to them); the slots down the side
// of the shop are where the car park always had them (the balance bots, older tests and saves paint them there).

/** A Parking bay just put down: its tiles become tarmac (that came with it) and the bays are listed again. */
export function bayLaid(state: GameState, f: Fixture): void {
  const tiles = { ...state.shop.lotTiles }, laid: string[] = [];
  for (const t of tilesOf(f)) { const k = lotKey(t.x, t.z); if (tiles[k] !== 'asphalt') laid.push(k); tiles[k] = 'asphalt'; }
  f.laid = laid;
  state.shop.lotTiles = tiles;
  syncLotBays(state);
  state.shop.layoutVersion++;
}

/**
 * A Parking bay sold back just after it went down (you changed your mind): the tarmac it brought comes up again, all
 * of it paid back, as if it was never there. Returns what that gives back. (Later on, the tarmac stays: it is the lot's.)
 */
export function bayTakenBack(state: GameState, f: Fixture): number {
  const shop = state.shop;
  if (!f.laid?.length || !justBought(f, state)) return 0;
  const tiles = { ...shop.lotTiles };
  let back = 0;
  for (const k of f.laid) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const r = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    if (tiles[k] !== 'asphalt' || lotPieces(shop).some((o) => o.id !== f.id && overlaps(footprintOf(o.type, o.x, o.z, o.rot), r))) continue;
    delete tiles[k];
    back += SURFACES.find((q) => q.id === 'asphalt')!.perTile;
  }
  shop.lotTiles = tiles;
  return back;
}

/** The car park's places for bays, and which have one. */
export function lotSlots(shop: Shop): (LotSlot & { fid?: number })[] {
  const pieces = bayPieces(shop);
  return defaultSlots(shop).map((sl) => ({ ...sl, fid: pieces.find((p) => p.x === sl.x && p.z === sl.z && p.rot === sl.rot)?.id }));
}

/** The plan as it stands (old saves paint whole rows). */
function planOf(shop: Shop): number[] { return paintedBays(shop).bays.map((b) => b.id); }

export function canPaintBay(state: GameState, slotId: number): LotCheck {
  const shop = state.shop, price = BAY_PRICE;
  if (shop.lotBaked) {
    const sl = lotSlots(shop).find((x) => x.id === slotId);
    if (!sl) return { ok: false, reason: 'Point at a place for a bay', price };
    if (sl.fid !== undefined) return { ok: false, reason: 'Painted already', price };
    return canPlaceOutside(state, 'parkingBay', sl.x, sl.z, sl.rot);
  }
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
  if (state.shop.lotBaked) {
    const sl = lotSlots(state.shop).find((x) => x.id === slotId)!;
    const f: Fixture = { id: state.nextId++, type: 'parkingBay', x: sl.x, z: sl.z, rot: sl.rot, slots: [], bought: state.day, boughtAt: state.time };
    state.shop.fixtures.push(f);
    bayLaid(state, f);
    return null;
  }
  const shop = state.shop, cars = carsBySlot(shop);
  // A new bay goes on the end of the list: the cars already in bays keep their numbers.
  shop.bayPlan = [...planOf(shop), slotId];
  syncBays(shop, cars);
  return null;
}

export function canEraseBay(state: GameState, slotId: number): LotCheck {
  const shop = state.shop, price = -Math.round(RESALE * BAY_PRICE);
  if (shop.lotBaked) {
    const sl = lotSlots(shop).find((x) => x.id === slotId);
    if (!sl || sl.fid === undefined) return { ok: false, reason: 'Point at a painted bay', price };
    if (shop.bays.some((b) => b.fid === sl.fid && b.carId !== null)) return { ok: false, reason: 'A car has that bay', price };
    const strands = bayHoldsCharger(shop, sl.fid);
    if (strands) return { ok: false, reason: strands, price };
    return { ok: true, reason: 'Paint out this bay', price };
  }
  const i = paintedBays(shop).bays.findIndex((b) => b.id === slotId);
  if (i < 0) return { ok: false, reason: 'Point at a painted bay', price };
  if (shop.bays[i]?.carId !== null && shop.bays[i]?.carId !== undefined) return { ok: false, reason: 'A car has that bay', price };
  const clash = lotClash(state, { ...shop, bayPlan: planOf(shop).filter((id) => id !== slotId) });
  if (clash) return { ok: false, reason: clash, price };
  return { ok: true, reason: 'Paint out this bay', price };
}

export function eraseBay(state: GameState, slotId: number): string | null {
  const check = canEraseBay(state, slotId);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  if (state.shop.lotBaked) {
    const fid = lotSlots(state.shop).find((x) => x.id === slotId)!.fid;
    state.shop.fixtures = state.shop.fixtures.filter((f) => f.id !== fid);
    syncLotBays(state);
    state.shop.layoutVersion++;
    return null;
  }
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
  if (state.shop.lotBaked) {
    const open = lotSlots(state.shop).filter((sl) => sl.fid === undefined && canPaintBay({ ...state, cash: Infinity }, sl.id).ok);
    if (!open.length) return 'The car park is as big as the plot allows.';
    const cost = open.reduce((a, sl) => a + canPaintBay({ ...state, cash: Infinity }, sl.id).price, 0);
    if (state.cash < cost) return `Need ${dollars(cost)} for the extra bays.`;
    for (const sl of open) paintBay(state, sl.id);
    return null;
  }
  const free = lotLayout(state.shop).slots.filter((s) => canPaintBay({ ...state, cash: Infinity }, s.id).ok);
  if (!free.length) return 'The car park is as big as the plot allows.';
  if (state.cash < free.length * BAY_PRICE) return `Need ${dollars(free.length * BAY_PRICE)} for the extra bays.`;
  for (const s of free) paintBay(state, s.id);
  return null;
}

// ---- What the lot does for the shop.

/** How the lot looks from the street (0..1): its pieces, up to a few of each, and laid paving. */
export function lotAppeal(shop: Shop): number {
  // (Asked for every shopper's choice: worked out again only when the lot changes.)
  const sig = `${shop.layoutVersion}|${shop.fixtures.length}`, hit = appeal.get(shop);
  if (hit && hit.sig === sig && hit.tiles === shop.lotTiles) return hit.value;
  const count = new Map<string, number>();
  for (const f of shop.fixtures) if (FIXTURES[f.type].curb) count.set(f.type, (count.get(f.type) ?? 0) + 1);
  let a = 0;
  for (const [type, n] of count) { const def = FIXTURES[type as FixtureType]; a += Math.min(n, def.looksCap ?? 1) * def.curb!; }
  let paving = 0;
  for (const s of Object.values(shop.lotTiles ?? {})) paving += CURB.get(s) ?? 0;
  const value = Math.min(1, a + Math.min(0.15, paving));
  appeal.set(shop, { sig, tiles: shop.lotTiles, value });
  return value;
}
const appeal = new WeakMap<Shop, { sig: string; tiles: Shop['lotTiles']; value: number }>();
const CURB = new Map(SURFACES.map((x) => [x.id, x.curb]));

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
