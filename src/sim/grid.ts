/**
 * Walkability grid for the player's plot, in store-relative coordinates at 0.5-unit cells.
 * Walls block the edge between two cells (they lie on tile boundaries), fixtures and
 * parked cars block cells. Cells carry a cost so people prefer paving over gardens.
 */
import type { Shop, Vec2, Fixture } from './types';
import { lotLayout } from './layout';

export const CELL = 0.5;

export interface Grid {
  x0: number; z0: number; w: number; h: number;
  /** 0 = blocked, otherwise movement cost multiplier (1 = paved). */
  cost: Float32Array;
  /** Blocked edges between neighbouring cells, keyed by edgeKey(). */
  edges: Set<number>;
  /** Cells that are inside the shop building (floor or storeroom). */
  inside: Uint8Array;
  version: number;
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

/** Block the edge along a wall segment. Horizontal wall at z = zw from xa to xb, or vertical at x = xw from za to zb. */
function blockWall(g: Grid, a: Vec2, b: Vec2, gaps: { at: number; width: number }[] = []): void {
  if (a.z === b.z) {
    const zc = Math.round((a.z - g.z0) / CELL);
    const xa = Math.round((Math.min(a.x, b.x) - g.x0) / CELL), xb = Math.round((Math.max(a.x, b.x) - g.x0) / CELL);
    for (let x = xa; x < xb; x++) {
      const wx = g.x0 + (x + 0.5) * CELL;
      if (gaps.some((gp) => Math.abs(wx - gp.at) < gp.width / 2)) continue;
      if (zc - 1 >= 0 && zc < g.h && x < g.w) g.edges.add(edgeKey(cellIndex(g, x, zc - 1), cellIndex(g, x, zc)));
    }
  } else {
    const xc = Math.round((a.x - g.x0) / CELL);
    const za = Math.round((Math.min(a.z, b.z) - g.z0) / CELL), zb = Math.round((Math.max(a.z, b.z) - g.z0) / CELL);
    for (let z = za; z < zb; z++) {
      const wz = g.z0 + (z + 0.5) * CELL;
      if (gaps.some((gp) => Math.abs(wz - gp.at) < gp.width / 2)) continue;
      if (xc - 1 >= 0 && xc < g.w && z < g.h) g.edges.add(edgeKey(cellIndex(g, xc - 1, z), cellIndex(g, xc, z)));
    }
  }
}

export function fixtureFootprint(f: Fixture): { x0: number; z0: number; x1: number; z1: number } {
  return { x0: f.x, z0: f.z, x1: f.x + 1, z1: f.z + 1 };
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

/** Direction the fixture faces, unit vector. */
export function fixtureFacing(rot: number): Vec2 {
  switch (rot & 3) { case 0: return { x: 0, z: 1 }; case 1: return { x: 1, z: 0 }; case 2: return { x: 0, z: -1 }; default: return { x: -1, z: 0 }; }
}

/** Grid in world coordinates: store-relative rects are offset by the shop origin. */
export function buildGrid(shop: Shop, version: number): Grid {
  const L = lotLayout(shop);
  const ox = shop.originX, oz = shop.originZ;
  const x0 = ox + L.plot.x0, z0 = oz + L.plot.z0, x1 = ox + L.plot.x1, z1 = oz + 3.5;
  const w = Math.round((x1 - x0) / CELL), h = Math.round((z1 - z0) / CELL);
  const g: Grid = { x0, z0, w, h, cost: new Float32Array(w * h), edges: new Set(), inside: new Uint8Array(w * h), version };
  const R = (r: { x0: number; z0: number; x1: number; z1: number }, cost: number, inside = false) => fillRect(g, ox + r.x0, oz + r.z0, ox + r.x1, oz + r.z1, cost, inside);
  // Gardens: walkable but slow.
  fillRect(g, x0, z0, x1, z1, 2.5);
  // Paving.
  R(L.apron, 1);
  R({ x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3.5 }, 1);
  R(L.aisle, 1.2); R(L.driveway, 1.2); R(L.serviceLane, 1.2); R(L.backYard, 1.2);
  // Sidewalk strip along the whole plot.
  fillRect(g, x0, oz + 2.6, x1, oz + 3.5, 1);
  // Parking bays are walkable when empty (cars block them later).
  for (const b of L.bays) R({ x0: b.x - 0.85, z0: b.z - 0.5, x1: b.x + 0.85, z1: b.z + 0.5 }, 1.3);
  // Shop floors.
  const f = shop.floor, s = shop.storeroom;
  R(f, 1, true); R(s, 1, true);
  // Walls: outer ring plus the partition, with door gaps.
  const W = (a: Vec2, b: Vec2, gaps: { at: number; width: number }[] = []) =>
    blockWall(g, { x: ox + a.x, z: oz + a.z }, { x: ox + b.x, z: oz + b.z }, gaps.map((gp) => ({ at: (a.z === b.z ? ox : oz) + gp.at, width: gp.width })));
  W({ x: f.x0, z: f.z1 }, { x: f.x1, z: f.z1 }, [{ at: shop.door.x, width: 1 }]);          // front
  W({ x: f.x0, z: s.z0 }, { x: f.x1, z: s.z0 }, [{ at: shop.backDoor.x, width: 1 }]);      // back
  W({ x: f.x0, z: s.z0 }, { x: f.x0, z: f.z1 });                                            // west
  W({ x: f.x1, z: s.z0 }, { x: f.x1, z: f.z1 });                                            // east
  W({ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, [{ at: f.x1 - 1, width: 1 }]);             // partition, door at the east end
  // Fixtures.
  for (const fx of shop.fixtures) {
    const fp = fixtureFootprint(fx);
    fillRect(g, ox + fp.x0, oz + fp.z0, ox + fp.x1, oz + fp.z1, 0);
  }
  return g;
}

/** World-space centre of a fixture. */
export function fixtureCentre(shop: Shop, f: Fixture): Vec2 {
  return { x: shop.originX + f.x + 0.5, z: shop.originZ + f.z + 0.5 };
}

/** World-space standing point in front of a fixture. */
export function fixtureFrontWorld(shop: Shop, f: Fixture): Vec2 {
  const p = fixtureFront(f);
  return { x: shop.originX + p.x, z: shop.originZ + p.z };
}

/** World-space point behind a fixture (where staff stand at a register). */
export function fixtureBackWorld(shop: Shop, f: Fixture): Vec2 {
  const c = fixtureCentre(shop, f);
  const d = fixtureFacing(f.rot);
  return { x: c.x - d.x, z: c.z - d.z };
}

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
