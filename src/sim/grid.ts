/**
 * Walkability grid for the player's plot, in store-relative coordinates at 0.5-unit cells.
 * Walls block the edge between two cells (they lie on tile boundaries), fixtures and
 * parked cars block cells. Cells carry a cost so people prefer paving over gardens.
 */
import type { Shop, Vec2, Fixture } from './types';
import { lotLayout, WALL_T, rectToWorld, toWorld, toLocal, dirToWorld, FIXTURES, isFloor, floorTileList, footprintOf, blockedRect, PLOT_RECT, SURFACES, storeysOf, levelTileList, levelOfZ, levelOf, zOnLevel, rideEnds, RIDE, VERTICAL, MAX_FLOOR, LEVEL_DZ } from './layout';

export const CELL = 0.5;

/** A ride between floors from a cell: the cell it comes off at, its cost on a path, and its ends (world). */
export interface Portal { to: number; cost: number; ride: number; via: number; yaw: number; from: Vec2; at: Vec2 }

export interface Grid {
  x0: number; z0: number; w: number; h: number;
  /** 0 = blocked, otherwise movement cost multiplier (1 = paved). */
  cost: Float32Array;
  /** Blocked edges between neighbouring cells, keyed by edgeKey(). */
  edges: Set<number>;
  /** Cells that are inside the shop building (floor or storeroom). */
  inside: Uint8Array;
  version: number;
  /** Upstairs: the rides (stairs, escalators, lifts) from each cell that has one. */
  portals?: Map<number, Portal[]>;
  /** Upstairs: each row's floor, and how many rows a floor's region is shifted from the ground's (for estimating distances across floors). */
  rowLevel?: Uint8Array; levelRows?: number;
}

export function cellOf(g: Grid, p: Vec2): [number, number] {
  return [Math.floor((p.x - g.x0) / CELL), Math.floor((p.z - g.z0) / CELL)];
}
export function cellCentre(g: Grid, cx: number, cz: number): Vec2 {
  return { x: g.x0 + (cx + 0.5) * CELL, z: g.z0 + (cz + 0.5) * CELL };
}
export function cellIndex(g: Grid, cx: number, cz: number): number { return cz * g.w + cx; }
export function inBounds(g: Grid, cx: number, cz: number): boolean { return cx >= 0 && cz >= 0 && cx < g.w && cz < g.h; }
export function edgeKey(a: number, b: number): number { return a < b ? a * 1_000_003 + b : b * 1_000_003 + a; }

function fillRect(g: Grid, x0: number, z0: number, x1: number, z1: number, cost: number, inside = false): void {
  const cx0 = Math.max(0, Math.round((x0 - g.x0) / CELL)), cz0 = Math.max(0, Math.round((z0 - g.z0) / CELL));
  const cx1 = Math.min(g.w, Math.round((x1 - g.x0) / CELL)), cz1 = Math.min(g.h, Math.round((z1 - g.z0) / CELL));
  for (let z = cz0; z < cz1; z++) for (let x = cx0; x < cx1; x++) {
    g.cost[cellIndex(g, x, z)] = cost;
    if (inside) g.inside[cellIndex(g, x, z)] = 1;
  }
}

export function fixtureFootprint(f: Fixture): { x0: number; z0: number; x1: number; z1: number } {
  return footprintOf(f.type, f.x, f.z, f.rot);
}

/** The tile centre a person stands on to use a fixture (in front of it). */
export function fixtureFront(f: Fixture): Vec2 {
  const cx = f.x + 0.5, cz = f.z + 0.5;
  switch (f.rot) {
    case 0: return { x: cx, z: cz + 1 };
    case 1: return { x: cx + 1, z: cz };
    case 2: return { x: cx, z: cz - 1 };
    default: return { x: cx - 1, z: cz };
  }
}

/**
 * Where someone stands to use a fixture: its front tile if that is free shop floor, otherwise its back
 * or a side (a shelf pushed against the wall is used from the room side). Always on the shop floor,
 * never outside the walls, and only a tile someone coming in at the door can walk to (by `grid`, the
 * shop's walking grid); the nearest to `from` wins, the front by half a tile. Null when no side will do.
 */
export function fixtureStandWorld(shop: Shop, f: Fixture, from?: Vec2, grid: Grid = shopGrid(shop)): Vec2 | null {
  const cx = f.x + 0.5, cz = f.z + 0.5;
  const front = fixtureFront(f);
  const tiles = [front, { x: 2 * cx - front.x, z: 2 * cz - front.z }, { x: cx + (front.z - cz), z: cz + (front.x - cx) }, { x: cx - (front.z - cz), z: cz - (front.x - cx) }];
  // Reachable cells are already off the walls, the pallet and every fixture; the floor keeps it indoors.
  const reach = reachableCells(shop, grid);
  let best: Vec2 | null = null, bestD = Infinity;
  tiles.forEach((t, i) => {
    if (!isFloor(shop, t.x - 0.5, t.z - 0.5)) return;
    const w = toWorld(shop, t.x, t.z);
    const [gx, gz] = cellOf(grid, w);
    if (!inBounds(grid, gx, gz) || !reach[cellIndex(grid, gx, gz)]) return;
    const dd = (from ? Math.hypot(w.x - from.x, w.z - from.z) : i) + (i === 0 ? -0.5 : 0);
    if (dd < bestD) { bestD = dd; best = w; }
  });
  return best;
}

const reachCache = new WeakMap<Grid, Uint8Array>();
const shopGrids = new WeakMap<Shop, { sig: string; grid: Grid }>();

/** The walking grid for a shop layout, built once per layout (for callers that do not have it to hand). */
function shopGrid(shop: Shop): Grid {
  const sig = `${shop.layoutVersion}|${shop.fixtures.length}`;
  const hit = shopGrids.get(shop);
  if (hit && hit.sig === sig) return hit.grid;
  const grid = buildGrid(shop, shop.layoutVersion);
  shopGrids.set(shop, { sig, grid });
  return grid;
}

/**
 * Cells someone coming in at the front door can walk to, by the grid's own steps (walls, the pallet
 * and fixtures block). A tile can be free floor and still sealed off (behind a fridge against the back
 * wall, say): nobody is sent to stand there.
 */
function reachableCells(shop: Shop, g: Grid): Uint8Array {
  const hit = reachCache.get(g);
  if (hit) return hit;
  const r = new Uint8Array(g.w * g.h);
  const [sx, sz] = cellOf(g, toWorld(shop, shop.door.x, shop.floor.z1 - 0.25));
  if (!isBlocked(g, sx, sz)) {
    r[cellIndex(g, sx, sz)] = 1;
    const todo = [sx, sz];
    while (todo.length) {
      const z = todo.pop()!, x = todo.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz;
        if (!inBounds(g, nx, nz) || r[cellIndex(g, nx, nz)] || !canStep(g, x, z, nx, nz)) continue;
        r[cellIndex(g, nx, nz)] = 1;
        todo.push(nx, nz);
      }
      // Up or down the stairs.
      for (const pt of g.portals?.get(cellIndex(g, x, z)) ?? []) {
        if (r[pt.to] || isBlocked(g, pt.to % g.w, (pt.to / g.w) | 0)) continue;
        r[pt.to] = 1;
        todo.push(pt.to % g.w, (pt.to / g.w) | 0);
      }
    }
  }
  reachCache.set(g, r);
  return r;
}

/** As `fixtureStandWorld`, falling back to the front when nothing is free (placement keeps that from happening). */
export function fixtureAccessWorld(shop: Shop, f: Fixture, from: Vec2, grid?: Grid): Vec2 {
  return fixtureStandWorld(shop, f, from, grid) ?? fixtureFrontWorld(shop, f);
}

/** Is a fixture's front tile on the shop floor (not through a wall)? */
export function frontInside(shop: Shop, f: Fixture): boolean {
  const t = fixtureFront(f);
  return isFloor(shop, t.x - 0.5, t.z - 0.5);
}

/** Direction the fixture faces, unit vector. */
export function fixtureFacing(rot: number): Vec2 {
  switch (rot & 3) { case 0: return { x: 0, z: 1 }; case 1: return { x: 1, z: 0 }; case 2: return { x: 0, z: -1 }; default: return { x: -1, z: 0 }; }
}

/** Grid in world coordinates: store-relative rects are carried into the world by the shop's frame. */
export function buildGrid(shop: Shop, version: number, backDoorShut = false): Grid {
  const L = lotLayout(shop);
  const st = storeysOf(shop);
  // The whole plot (pieces out on the lot can stand anywhere on it), to the far side of the frontage sidewalk.
  // Edges on the half-tile, so cells line up with tiles on every corner (the south ones are turned round).
  // With floors open upstairs, on back over each one's region.
  const plotZ0 = Math.floor(PLOT_RECT.z0 * 2) / 2;
  const bounds = rectToWorld(shop, { x0: Math.floor(PLOT_RECT.x0 * 2) / 2, z0: st.top ? zOnLevel(MAX_FLOOR.z0, st.top) - 1 : plotZ0, x1: Math.floor(PLOT_RECT.x1 * 2) / 2, z1: 3.5 });
  const { x0, z0, x1, z1 } = bounds;
  const w = Math.round((x1 - x0) / CELL), h = Math.round((z1 - z0) / CELL);
  const g: Grid = { x0, z0, w, h, cost: new Float32Array(w * h), edges: new Set(), inside: new Uint8Array(w * h), version };
  const R = (r: { x0: number; z0: number; x1: number; z1: number }, cost: number, inside = false) => { const q = rectToWorld(shop, r); fillRect(g, q.x0, q.z0, q.x1, q.z1, cost, inside); };
  // Gardens: walkable but slow.
  fillRect(g, x0, z0, x1, z1, 2.5);
  if (st.top) {
    // Upstairs is nothing but its floors.
    R({ x0: PLOT_RECT.x0 - 1, z0: zOnLevel(MAX_FLOOR.z0, st.top) - 2, x1: PLOT_RECT.x1 + 1, z1: plotZ0 }, 0);
    g.rowLevel = new Uint8Array(h);
    for (let cz = 0; cz < h; cz++) g.rowLevel[cz] = levelOfZ(toLocal(shop, x0, z0 + (cz + 0.5) * CELL).z);
    g.levelRows = (shop.flip ? -LEVEL_DZ : LEVEL_DZ) / CELL;
  }
  // Paving.
  R(L.apron, 1);
  R({ x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3.5 }, 1);
  R(L.aisle, 1.2); R(L.driveway, 1.2); R(L.serviceLane, 1.2); R(L.backYard, 1.2);
  // Surfaces laid on the lot: people take to paving over the grass.
  for (const [k, sf] of Object.entries(shop.lotTiles ?? {})) { const [x, z] = k.split(',').map(Number) as [number, number]; R({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, SURFACES.find((q) => q.id === sf)?.walk ?? 1); }
  // Sidewalk strip along the whole plot.
  R({ x0: PLOT_RECT.x0, z0: 2.6, x1: PLOT_RECT.x1, z1: 3.5 }, 1);
  // Parking bays are walkable when empty (cars block them later).
  for (const b of L.bays) R({ x0: b.x - 0.85, z0: b.z - 0.5, x1: b.x + 0.85, z1: b.z + 0.5 }, 1.3);
  // Shop floor, tile by tile (`storeroom` only exists in old saves).
  const f = shop.floor, s = shop.storeroom;
  const tiles = floorTileList(shop);
  for (const t of tiles) R({ x0: t.x, z0: t.z, x1: t.x + 1, z1: t.z + 1 }, 1, true);
  if (s.z1 > s.z0) R(s, 1, true);
  // Walls: WALL_T thick just outside every edge of the floor (and round its corners), with door gaps.
  const T = WALL_T;
  for (const t of tiles) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || isFloor(shop, t.x + dx, t.z + dz)) continue;
      R({ x0: dx < 0 ? t.x - T : dx > 0 ? t.x + 1 : t.x, z0: dz < 0 ? t.z - T : dz > 0 ? t.z + 1 : t.z, x1: dx < 0 ? t.x : dx > 0 ? t.x + 1 + T : t.x + 1, z1: dz < 0 ? t.z : dz > 0 ? t.z + 1 + T : t.z + 1 }, 0);
    }
  }
  // The door openings are paved and walkable.
  R({ x0: shop.door.x - 0.5, z0: f.z1, x1: shop.door.x + 0.5, z1: f.z1 + T }, 1);
  R({ x0: shop.backDoor.x - 0.5, z0: shop.backDoor.z - T, x1: shop.backDoor.x + 0.5, z1: shop.backDoor.z }, backDoorShut ? 0 : 1.1);
  // Upstairs: each open floor, with the building's walls round it, its openings and double-height spaces closed off.
  for (let lv = 1; lv <= st.top; lv++) for (const t of levelTileList(shop, lv)) R({ x0: t.x, z0: t.z, x1: t.x + 1, z1: t.z + 1 }, 1, true);
  // Delivered boxes stand here.
  if (shop.delivery) R(shop.delivery, 0);
  // Fixtures.
  // Fixtures: a shallow one (a chiller, a produce stand) only blocks the back of its tile, so people can
  // walk right up to it and between two that face each other.
  for (const fx of shop.fixtures) {
    if (FIXTURES[fx.type].walkable) continue;
    R(blockedRect(fx), 0);
  }
  if (st.top) addPortals(shop, g);
  return g;
}

/** The rides between floors: from the foot of each flight of stairs, escalator and lift to where it comes off upstairs, and back down. */
function addPortals(shop: Shop, g: Grid): void {
  const st = storeysOf(shop);
  g.portals = new Map();
  const add = (from: number, p: Portal) => { const list = g.portals!.get(from) ?? []; list.push(p); g.portals!.set(from, list); };
  for (const f of shop.fixtures) {
    if (!VERTICAL.has(f.type) || !st.built[levelOf(f) + 1]) continue;
    const e = rideEnds(f), r = RIDE[f.type]!;
    const a = toWorld(shop, e.bottom.x, e.bottom.z), b = toWorld(shop, e.top.x, e.top.z);
    const [ax, az] = cellOf(g, a), [bx, bz] = cellOf(g, b);
    if (isBlocked(g, ax, az) || isBlocked(g, bx, bz)) continue;
    const ia = cellIndex(g, ax, az), ib = cellIndex(g, bx, bz);
    const fw = fixtureFacingWorld(shop, f.rot);
    const into = Math.atan2(-fw.x, -fw.z), out = Math.atan2(fw.x, fw.z);
    add(ia, { to: ib, cost: r.cost, ride: r.secs, via: f.id, yaw: into, from: a, at: b });
    add(ib, { to: ia, cost: r.cost, ride: r.secs, via: f.id, yaw: f.type === 'elevator' ? into : out, from: b, at: a });
  }
}

/** World-space centre of a fixture (of its footprint: a billboard is two tiles wide). */
export function fixtureCentre(shop: Shop, f: Fixture): Vec2 { const r = footprintOf(f.type, f.x, f.z, f.rot); return toWorld(shop, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2); }

/** World-space standing point in front of a fixture. */
export function fixtureFrontWorld(shop: Shop, f: Fixture): Vec2 { const p = fixtureFront(f); return toWorld(shop, p.x, p.z); }

/** World-space point behind a fixture (where staff stand at a register). */
export function fixtureBackWorld(shop: Shop, f: Fixture): Vec2 {
  const c = fixtureCentre(shop, f);
  const d = dirToWorld(shop, fixtureFacing(f.rot));
  return { x: c.x - d.x, z: c.z - d.z };
}

/** A fixture's facing in world space. */
export function fixtureFacingWorld(shop: Shop, rot: number): Vec2 { return dirToWorld(shop, fixtureFacing(rot)); }

/** Is a cell blocked, including dynamic blockers? */
export function isBlocked(g: Grid, cx: number, cz: number, dyn?: Set<number>): boolean {
  if (!inBounds(g, cx, cz)) return true;
  const i = cellIndex(g, cx, cz);
  if (g.cost[i] === 0) return true;
  return dyn ? dyn.has(i) : false;
}

export function canStep(g: Grid, ax: number, az: number, bx: number, bz: number, dyn?: Set<number>): boolean {
  if (isBlocked(g, bx, bz, dyn)) return false;
  const a = cellIndex(g, ax, az), b = cellIndex(g, bx, bz);
  const dx = bx - ax, dz = bz - az;
  if (dx !== 0 && dz !== 0) {
    // Diagonal: both orthogonal neighbours must be open and neither edge walled (no corner cutting).
    if (isBlocked(g, ax + dx, az, dyn) || isBlocked(g, ax, az + dz, dyn)) return false;
    const c1 = cellIndex(g, ax + dx, az), c2 = cellIndex(g, ax, az + dz);
    if (g.edges.has(edgeKey(a, c1)) || g.edges.has(edgeKey(a, c2)) || g.edges.has(edgeKey(c1, b)) || g.edges.has(edgeKey(c2, b))) return false;
    return true;
  }
  return !g.edges.has(edgeKey(a, b));
}

/** Walkable cell nearest to a point (for rescuing stuck people and snapping targets). */
export function nearestWalkable(g: Grid, p: Vec2, dyn?: Set<number>, maxR = 6): Vec2 {
  const [cx, cz] = cellOf(g, p);
  if (!isBlocked(g, cx, cz, dyn)) return p;
  for (let r = 1; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      if (!isBlocked(g, cx + dx, cz + dz, dyn)) return cellCentre(g, cx + dx, cz + dz);
    }
  }
  return p;
}

/** Straight-line walkability test between two points (samples cells and crossed edges). */
export function lineClear(g: Grid, a: Vec2, b: Vec2, dyn?: Set<number>): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.5)));
  let [pcx, pcz] = cellOf(g, a);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const [cx, cz] = cellOf(g, p);
    if (cx !== pcx || cz !== pcz) {
      if (!canStep(g, pcx, pcz, cx, cz, dyn)) return false;
      pcx = cx; pcz = cz;
    }
  }
  return true;
}
