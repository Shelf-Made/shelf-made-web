/**
 * Your own lot as tiles, and driving on it. The lot is a grid of tiles (corners on whole x and half z, so they sit
 * flush with the outside of the shop's walls) from the plot's edges to the frontage sidewalk. Each tile is grass or
 * has something laid on it (concrete, paving, brick, gravel, tarmac); parking bays are pieces laid on tarmac. Cars and
 * the delivery truck keep to the tarmac: in from the road over a dropped kerb at a tarmac tile in the front row, along
 * the tarmac to the open end of a bay (or the back door), and out again. Routes keep to the right-hand side of a lane
 * two tiles wide and save turns. A shop starts with the lot it always had, laid as tiles (see defaultLot).
 */
import type { GameState, Shop, Fixture, Vec2, LotSurface, Rot } from './types';
import { PLOT_RECT, LOT_FRONT, WALL_T, FIXTURES, footprintOf, onBuilding, lotKey, lotReserved, overlaps, toWorld, yawToWorld, paintedBays, pylonSpot, type Rect } from './layout';

// ---- The grid.

/** The lot's tiles: x from LOT_X0 (whole) for LOT_W tiles, z from LOT_Z0 (on the half) for LOT_D tiles, the front row last. */
export const LOT_X0 = Math.ceil(PLOT_RECT.x0);
export const LOT_W = Math.floor(PLOT_RECT.x1) - LOT_X0;
export const LOT_Z0 = Math.ceil(PLOT_RECT.z0 - 0.5) + 0.5;
export const LOT_D = Math.floor(LOT_FRONT - 1 - LOT_Z0 + 1e-6) + 1;
/** The row along the frontage sidewalk: tarmac there is a way in from the road. */
export const FRONT_ROW = LOT_Z0 + LOT_D - 1;

export const tileIndex = (x: number, z: number): number => Math.round(x - LOT_X0) + Math.round(z - LOT_Z0) * LOT_W;
export const tileAt = (i: number): { x: number; z: number } => ({ x: LOT_X0 + (i % LOT_W), z: LOT_Z0 + Math.floor(i / LOT_W) });
export function onLotGrid(x: number, z: number): boolean {
  const i = x - LOT_X0, j = z - LOT_Z0;
  return Math.abs(i - Math.round(i)) < 1e-6 && Math.abs(j - Math.round(j)) < 1e-6 && i > -0.5 && i < LOT_W - 0.5 && j > -0.5 && j < LOT_D - 0.5;
}
const tileRect = (x: number, z: number): Rect => ({ x0: x, z0: z, x1: x + 1, z1: z + 1 });

/** Headings on the grid: 0 toward the street (+z), 1 +x, 2 to the back (-z), 3 -x. */
export const DIRS: readonly Vec2[] = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }];
/** Right of a heading (traffic keeps right; a corner's frame only ever turns, so right stays right). */
const rightOf = (d: number) => (d + 3) % 4;

// ---- The lot a shop starts with (and an older save is laid out with): the paths, lanes, yard and bays it always had.

/** Room for this many bays a row down the side of a shop this deep (as there always was). */
function bayRowLength(shape: { floor: Rect; storeroom: Rect }): number {
  const depth = shape.floor.z1 - Math.min(shape.floor.z0, shape.storeroom.z0);
  return Math.min(8, Math.floor((depth - 1.2) / 1.1));
}

/** A place for a bay in the car park down the east side (`id` is row × 8 + its place in the row, front first). */
export interface LotSlot { id: number; row: number; x: number; z: number; rot: Rot }

/** The car park's places for bays, beside the shop's east wall and (a second row) across the aisle from them. */
export function defaultSlots(shape: { floor: Rect; storeroom: Rect }): LotSlot[] {
  const X1 = shape.floor.x1 + WALL_T, n = bayRowLength(shape), out: LotSlot[] = [];
  for (let row = 0; row < 2; row++) for (let k = 0; k < n; k++) out.push({ id: row * 8 + k, row, x: row ? X1 + 4 : X1 + 1, z: -1.5 - k, rot: row ? 3 : 1 });
  return out;
}

/**
 * The lot a shop of this shape starts with, as tiles: concrete in front of the shop, down its west side and two tiles
 * of path from the door to the sidewalk; tarmac for the car park down the east side (the bays' row against the wall,
 * the aisle and driveway beside it), the service lane down the west and the yard behind; and where the pylon sign
 * stands (on the lawn between the service lane and the path).
 */
export function defaultLot(shape: { floor: Rect; storeroom: Rect; door: Vec2; lotRows?: number; bayPlan?: number[] }, rows: number): { tiles: Record<string, LotSurface>; pylon: { x: number; z: number; w: number } } {
  const f = shape.floor, X0 = f.x0 - WALL_T, X1 = f.x1 + WALL_T, BZ = Math.min(f.z0, shape.storeroom.z0) - WALL_T;
  const tiles: Record<string, LotSurface> = {};
  const lay = (x0: number, z0: number, x1: number, z1: number, s: LotSurface) => {
    for (let z = z0; z < z1 - 1e-6; z++) for (let x = x0; x < x1 - 1e-6; x++) if (onLotGrid(x, z) && !onBuilding(shape, tileRect(x, z))) tiles[lotKey(x, z)] = s;
  };
  const front = FRONT_ROW + 1, yard = BZ - 2, east = X1 + (rows > 1 ? 6 : 4);
  lay(X0 - 1, 0.5, X1 + 2, 1.5, 'concrete');
  lay(X0 - 1, BZ, X0, 0.5, 'concrete');
  lay(shape.door.x - 1, 1.5, shape.door.x + 1, front, 'concrete');
  lay(X1, yard, east, 0.5, 'asphalt');
  lay(X1 + 2, 0.5, X1 + 4, front, 'asphalt');
  lay(X0 - 3, yard, X0 - 1, front, 'asphalt');
  lay(X0 - 3, yard, east, BZ, 'asphalt');
  const left = X0 - 1 + 0.2, right = shape.door.x - 1 - 0.2;
  const pylon = right - left >= 1 ? { x: (left + right) / 2, z: 1.85, w: Math.min(2.6, right - left) } : pylonSpot({ floor: shape.floor, storeroom: shape.storeroom });
  return { tiles, pylon };
}

// ---- Bays.

export const isBay = (f: { type: string }): boolean => f.type === 'parkingBay';
export function bayPieces(shop: Pick<Shop, 'fixtures'>): Fixture[] { return shop.fixtures.filter(isBay); }
/** A bay's middle (shop-relative), where a car stands in it. */
export function bayCentre(f: { x: number; z: number; rot: number }): Vec2 { const r = footprintOf('parkingBay', f.x, f.z, f.rot); return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }; }
/** Which way a car faces parked in a bay: nose in, away from its open end. */
export function bayHeading(f: { rot: number }): number { return (f.rot + 2) & 3; }
/** The tile in front of a bay's open end, where a car turns in from. */
export function bayMouth(f: { x: number; z: number; rot: number }): Vec2 { const d = DIRS[f.rot & 3]!; return { x: f.x + d.x, z: f.z + d.z }; }

/** The bays (world space) again from the Parking bay pieces, each keeping its car; cars in bays follow their bay's number. */
export function syncLotBays(state: GameState): void {
  const shop = state.shop;
  const before = shop.bays.map((b) => b.fid);
  const held = new Map(shop.bays.filter((b) => b.fid !== undefined).map((b) => [b.fid!, b.carId]));
  shop.bays = bayPieces(shop).map((f) => {
    const c = bayCentre(f), h = DIRS[bayHeading(f)]!;
    return { ...toWorld(shop, c.x, c.z), yaw: yawToWorld(shop, Math.atan2(h.x, h.z)), carId: held.get(f.id) ?? null, fid: f.id };
  });
  const now = new Map(shop.bays.map((b, i) => [b.fid!, i]));
  for (const car of state.cars) {
    if (car.lot !== undefined || car.bay === null) continue;
    const fid = before[car.bay];
    car.bay = fid === undefined ? null : now.get(fid) ?? null;
  }
}

/**
 * Lay an older lot out as tiles and pieces, once: the paths and lanes it had as tiles (anything already laid stays),
 * each bay painted a Parking bay in the same order (so every car keeps its bay), and the pylon where it stood.
 */
export function bakeLot(state: GameState, nextId: () => number): void {
  const shop = state.shop;
  if (shop.lotBaked) return;
  const { bays: painted, rows } = paintedBays(shop);
  const plan = defaultLot(shop, rows);
  const slots = defaultSlots(shop);
  const tiles: Record<string, LotSurface> = { ...plan.tiles, ...(shop.lotTiles ?? {}) };
  const kept: (number | undefined)[] = [];
  for (const b of painted) {
    const sl = slots.find((s) => s.id === b.id);
    if (!sl) { kept.push(undefined); continue; }
    const f: Fixture = { id: nextId(), type: 'parkingBay', x: sl.x, z: sl.z, rot: sl.rot, slots: [], bought: 0 };
    shop.fixtures.push(f);
    for (const t of tilesOf(f)) tiles[lotKey(t.x, t.z)] = 'asphalt';
    kept.push(f.id);
  }
  // Each car keeps its bay: the old list's order, now each bay's piece.
  shop.bays = shop.bays.map((b, i) => ({ ...b, fid: kept[i] }));
  shop.lotTiles = tiles;
  shop.pylon = plan.pylon;
  shop.lotBaked = true;
  syncLotBays(state);
  // Cars standing in a bay now stand in the middle of it.
  for (const car of state.cars) {
    if (car.lot !== undefined || car.bay === null || car.state !== 'parked') continue;
    const b = shop.bays[car.bay]; if (b) { car.x = b.x; car.z = b.z; car.yaw = b.yaw; }
  }
  dropCovered(shop);
  shop.layoutVersion++;
}

/** The lot tiles a piece stands on. */
export function tilesOf(f: { type: Fixture['type']; x: number; z: number; rot: number }): Vec2[] {
  const r = footprintOf(f.type, f.x, f.z, f.rot), out: Vec2[] = [];
  for (let z = r.z0; z < r.z1 - 1e-6; z++) for (let x = r.x0; x < r.x1 - 1e-6; x++) out.push({ x, z });
  return out;
}

/** What is laid under the building or the pylon sign is gone (the shop grew over it). */
export function dropCovered(shop: Shop): void {
  if (!shop.lotTiles) return;
  const reserved = lotReserved(shop);
  shop.lotTiles = Object.fromEntries(Object.entries(shop.lotTiles).filter(([k]) => {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const r = tileRect(x, z);
    return !onBuilding(shop, r) && !reserved.some((q) => overlaps(q, r));
  }));
}

// ---- Where cars can drive: the tarmac, less what stands on it.

export interface LotNet {
  /** 1 where a car may drive (tarmac nothing stands on, bays excepted: a bay is a place to stop, not a way through). */
  drive: Uint8Array;
  /** Front-row tarmac tiles: ways in from the road and out to it. */
  entrances: number[];
  /** Cost to reach each tile from the nearest way in (Infinity: no way there). */
  reach: Float32Array;
}
const nets = new WeakMap<object, { sig: string; net: LotNet }>();

export function lotNet(shop: Shop): LotNet {
  const sig = `${shop.layoutVersion}|${Object.keys(shop.lotTiles ?? {}).length}|${shop.fixtures.length}|${JSON.stringify(shop.floor)}`;
  const hit = nets.get(shop.fixtures);
  if (hit && hit.sig === sig) return hit.net;
  const drive = new Uint8Array(LOT_W * LOT_D);
  for (const [k, s] of Object.entries(shop.lotTiles ?? {})) {
    if (s !== 'asphalt') continue;
    const [x, z] = k.split(',').map(Number) as [number, number];
    if (onLotGrid(x, z)) drive[tileIndex(x, z)] = 1;
  }
  for (const f of shop.fixtures) if (FIXTURES[f.type].outdoor) for (const t of tilesOf(f)) if (onLotGrid(t.x, t.z)) drive[tileIndex(t.x, t.z)] = 0;
  const reserved = lotReserved(shop);
  for (let i = 0; i < drive.length; i++) {
    if (!drive[i]) continue;
    const t = tileAt(i), r = tileRect(t.x, t.z);
    if (onBuilding(shop, r) || reserved.some((q) => overlaps(q, r))) drive[i] = 0;
  }
  const entrances: number[] = [];
  for (let x = LOT_X0; x < LOT_X0 + LOT_W; x++) { const i = tileIndex(x, FRONT_ROW); if (drive[i]) entrances.push(i); }
  const net: LotNet = { drive, entrances, reach: new Float32Array(LOT_W * LOT_D).fill(Infinity) };
  const r = route(net, entrances.map((i) => ({ tile: i, dir: 2 })), null);
  if (r) net.reach.set(r.cost);
  nets.set(shop.fixtures, { sig, net });
  return net;
}

/** The step from a tile in a heading, or -1 off the grid. */
export function step(i: number, d: number): number {
  const t = tileAt(i), v = DIRS[d]!, x = t.x + v.x, z = t.z + v.z;
  return onLotGrid(x, z) ? tileIndex(x, z) : -1;
}

/**
 * The cheapest way over the tarmac from any of `from` (each with the heading the car has there) to a tile where
 * `done` says so: a step costs 1, a turn a little more, turning right round a lot more, and a lane two wide is driven
 * on its right. Returns the tiles and the heading at the end (null when there is no way), and what it cost to get to
 * each tile on the way (with `done` null: to every tile there is a way to).
 */
export function route(net: LotNet, from: { tile: number; dir: number; cost?: number }[], done: ((tile: number, dir: number) => boolean) | null): { tiles: number[]; dir: number; startDir: number; cost: Float32Array } | null {
  const n = LOT_W * LOT_D, dist = new Float32Array(n * 4).fill(Infinity), prev = new Int32Array(n * 4).fill(-1), closed = new Uint8Array(n * 4);
  const best = new Float32Array(n).fill(Infinity);
  const open: number[] = [];
  for (const s of from) { const k = s.tile * 4 + s.dir, c0 = s.cost ?? 0; if (dist[k]! > c0) { dist[k] = c0; open.push(k); } }
  let end = -1;
  while (open.length) {
    // (A few hundred tiles: picking the nearest by a scan is plenty.)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]!]! < dist[open[bi]!]!) bi = i;
    const k = open[bi]!; open[bi] = open[open.length - 1]!; open.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const tile = k >> 2, dir = k & 3, c = dist[k]!;
    if (c < best[tile]!) best[tile] = c;
    if (done && done(tile, dir)) { end = k; break; }
    for (let d = 0; d < 4; d++) {
      const j = step(tile, d);
      if (j < 0 || !net.drive[j]) continue;
      let cost = 1 + (d === dir ? 0 : d === (dir + 2) % 4 ? 6 : 0.4);
      // Keep to the right of a lane: a car with tarmac on its right is on the wrong side of it.
      const r = step(j, rightOf(d));
      if (r >= 0 && net.drive[r]) cost += 0.3;
      const nk = j * 4 + d;
      if (!closed[nk] && c + cost < dist[nk]!) { dist[nk] = c + cost; prev[nk] = k; open.push(nk); }
    }
  }
  if (!done) return { tiles: [], dir: -1, startDir: -1, cost: best };
  if (end < 0) return null;
  const tiles: number[] = [];
  let first = end;
  for (let k = end; k >= 0; k = prev[k]!) { tiles.push(k >> 2); first = k; }
  return { tiles: tiles.reverse(), dir: end & 3, startDir: first & 3, cost: best };
}

/** Tile centres (shop-relative) along a route. */
export const centres = (tiles: number[]): Vec2[] => tiles.map((i) => { const t = tileAt(i); return { x: t.x + 0.5, z: t.z + 0.5 }; });
/** The same, but only where the route turns (and its ends): a straight run is one stretch, as a lane always was. */
export function corners(tiles: number[]): Vec2[] {
  const c = centres(tiles);
  return c.filter((p, i) => {
    const a = c[i - 1], b = c[i + 1];
    return !a || !b || Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 1e-6 || (p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z) < 0;
  });
}

/** Can a car get to this bay from the road (its open end on tarmac a way in reaches)? */
export function bayReachable(shop: Shop, f: Fixture): boolean {
  const m = bayMouth(f);
  if (!onLotGrid(m.x, m.z)) return false;
  const net = lotNet(shop), i = tileIndex(m.x, m.z);
  return !!net.drive[i] && net.reach[i]! < Infinity;
}

/** Where the delivery truck stops: tarmac a way in reaches, as near the back door as can be (within a few tiles), or null. */
export function truckStop(shop: Shop): { tile: number; at: Vec2 } | null {
  const net = lotNet(shop);
  const door = { x: shop.backDoor.x, z: shop.backDoor.z - WALL_T - 0.5 };
  let best = -1, bd = 3.2;
  for (let i = 0; i < net.drive.length; i++) {
    if (!net.drive[i] || net.reach[i]! === Infinity) continue;
    const t = tileAt(i), d = Math.hypot(t.x + 0.5 - door.x, t.z + 0.5 - door.z);
    if (d < bd - 1e-6) { bd = d; best = i; }
  }
  if (best < 0) return null;
  const t = tileAt(best);
  return { tile: best, at: { x: t.x + 0.5, z: t.z + 0.5 } };
}

/**
 * A whole size up (as the balance bots and older tests move up): the lot moves out with the walls, as it always did.
 * Whatever lay beside the shop moves out as far as its walls did, and each strip that opens is laid as the tiles it
 * opened between (the concrete in front runs on, the yard and lanes join up again); the pieces out there move with it.
 */
export function relayLot(state: GameState, before: { floor: Rect; storeroom: Rect; door: Vec2 }): void {
  const shop = state.shop, old = shop.lotTiles ?? {};
  const oX0 = before.floor.x0 - WALL_T, oX1 = before.floor.x1 + WALL_T, oBZ = Math.min(before.floor.z0, before.storeroom.z0) - WALL_T;
  const nX0 = shop.floor.x0 - WALL_T, nX1 = shop.floor.x1 + WALL_T, nBZ = shop.floor.z0 - WALL_T;
  const dE = nX1 - oX1, dW = nX0 - oX0, dB = nBZ - oBZ;
  // Each new tile is laid as the old one it came from (or, in a strip that opened, the one just inside it).
  const from = (x: number, z: number) => ({
    x: x >= nX1 ? x - dE : x < nX0 ? x - dW : x >= oX1 ? oX1 - 1 : x < oX0 ? oX0 : x,
    z: z < nBZ ? z - dB : z < oBZ ? oBZ - 1 : z,
  });
  const tiles: Record<string, LotSurface> = {};
  for (let j = 0; j < LOT_D; j++) for (let i = 0; i < LOT_W; i++) {
    const x = LOT_X0 + i, z = LOT_Z0 + j, s = from(x, z), was = old[lotKey(s.x, s.z)];
    if (was && !onBuilding(shop, tileRect(x, z))) tiles[lotKey(x, z)] = was;
  }
  shop.lotTiles = tiles;
  // The pieces beside the shop move out with it.
  for (const f of shop.fixtures) {
    if (!FIXTURES[f.type].outdoor) continue;
    const r = footprintOf(f.type, f.x, f.z, f.rot);
    if (r.x0 >= oX1 - 1e-6) f.x += dE; else if (r.x1 <= oX0 + 1e-6) f.x += dW;
    if (r.z1 <= oBZ + 1e-6) f.z += dB;
  }
  shop.pylon = defaultLot({ floor: shop.floor, storeroom: { ...shop.floor, z1: shop.floor.z0 }, door: shop.door }, 1).pylon;
  syncLotBays(state);
  for (const car of state.cars) {
    if (car.lot !== undefined || car.bay === null || car.state !== 'parked') continue;
    const b = shop.bays[car.bay]; if (b) { car.x = b.x; car.z = b.z; car.yaw = b.yaw; }
  }
  dropCovered(shop);
  shop.layoutVersion++;
}
