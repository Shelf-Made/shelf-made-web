/**
 * The town plan: where every static thing at the crossroads stands, generated deterministically
 * from the seed and the chosen corner. Pure data, so tests can check that nothing overlaps and the
 * renderer only has to draw it.
 *
 * One crossroads and nothing else: Main Road east–west, Elm Street north–south, a shop on each
 * corner (the player's and three rivals', drawn by StoreView and RivalsView). Beyond the corners
 * the ground runs on, empty and level, into the haze; both roads run out into it, and the traffic
 * drives in out of nowhere and away into nothing.
 *
 * Every corner is a Lot (a property rectangle). Lots never overlap and never touch a road.
 */
import { Rng } from '@/sim/rng';
import { ROAD_Z, ROAD_FAR, PLOT_RECT, CORNERS, CORNER_IDS, SIDE_HALF, ZEBRA, SIDEWALK_W_X, SIDEWALK_E_X, STREET_BAYS, BUS_STOP, MAP_X, MAP_Z, cornerOfPlot, rectToWorld, lotLayout, SHOP_SIZES, type Rect as SimRect } from '@/sim/layout';
import { rivalCorners, RIVAL_DEFS } from '@/sim/rivals';
import type { CornerId } from '@/sim/types';

export interface Placement { model: string; x: number; y?: number; z: number; yaw: number; scale?: number }
export type Rect = SimRect;
export interface RivalSite { id: string; name: string; corner: CornerId; kind: 'discount' | 'premium' | 'chain' }
export type LotKind = 'plot' | 'rival';
export interface Lot extends Rect { kind: LotKind; id?: string }
/** Small things drawn by the thousand: grass tufts, wild flowers, pebbles. */
export type ScatterKind = 'grass' | 'flower-red' | 'flower-yellow' | 'flower-purple' | 'flower-white' | 'flower-pink' | 'pebble';
export interface Scatter { kind: ScatterKind; x: number; z: number; yaw: number; scale: number }
export type AnimalKind = 'duck' | 'rabbit' | 'deer' | 'butterfly' | 'bird' | 'squirrel';
/** Where an animal lives: it wanders within `range` of (x, z). */
export interface AnimalHome { kind: AnimalKind; x: number; z: number; range: number; y?: number }

export interface TownPlan {
  /** Merged into the static mesh. */
  placements: Placement[];
  /** Grass, flowers and pebbles, merged into one still mesh. */
  scatter: Scatter[];
  animals: AnimalHome[];
  /** Flat painted areas: colour + rect + height. */
  slabs: { color: string; rect: Rect; y: number; h: number }[];
  /** Which rival stands on which corner. */
  rivals: RivalSite[];
  /** The four corner lots (world space). */
  corners: Record<CornerId, Rect>;
  /** Lamp positions for night lights. */
  lamps: { x: number; z: number }[];
  /** Property lines. Never overlap. */
  lots: Lot[];
}


/** A mix of trees for gardens and clumps: round, oak, conifer and tall shapes, some darker, a few in autumn colours. */
export const TREE_MIX = ['nature/tree-oak', 'nature/tree-default', 'nature/tree-detailed', 'nature/tree-fat', 'nature/tree-tall', 'nature/tree-cone', 'nature/tree-small',
  'nature/tree-oak-dark', 'nature/tree-default-dark', 'nature/tree-cone-dark', 'nature/tree-pineroundb', 'nature/tree-thin', 'nature/tree-oak-fall', 'nature/tree-small-fall', 'suburban/tree-large'];
export const BUSH_MIX = ['nature/plant-bush', 'nature/plant-bushdetailed', 'nature/plant-bushsmall', 'nature/plant-bushlarge', 'nature/plant-flattall'];
const GARDEN_TREES = ['nature/tree-default', 'nature/tree-oak', 'nature/tree-fat', 'nature/tree-small', 'nature/tree-tall', 'nature/tree-detailed', 'nature/tree-simple'];
const STREET_TREES = ['suburban/tree-large', 'suburban/tree-small'];
const BUSHES = ['nature/plant-bush', 'nature/plant-bushsmall', 'nature/plant-bushlarge', 'nature/plant-bushdetailed'];
const FLOWERS = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
const FLOWER_KINDS: ScatterKind[] = ['flower-red', 'flower-yellow', 'flower-purple', 'flower-white', 'flower-pink'];




// ---- Street geometry (world units). Roads are Kenney tiles two units wide.
export const SIDEWALK_W = 0.6;
/** North and south sidewalks of Main Road. */
export const MAIN_N: [number, number] = [ROAD_Z - 1.55, ROAD_Z - 0.95];
export const MAIN_S: [number, number] = [ROAD_Z + 0.95, ROAD_Z + 1.55];
export const PAVEMENT = '#C9CBD1';
/** The town area: level ground, everything that matters. */
export const TOWN = { x0: -MAP_X, z0: MAP_Z.north, x1: MAP_X, z1: MAP_Z.south };

/** The rectangle a corner owns in world space. */
export function cornerLot(c: CornerId): Rect { return rectToWorld(CORNERS[c], PLOT_RECT); }
/** The rectangle the player's plot owns. */
export function plotLot(plotId: string): Rect { return cornerLot(cornerOfPlot(plotId)); }

// ---- Noise for the verges' grass and flowers. Seed-independent.
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

/** How far outside the town area a point is (0 inside). */
export function outsideTown(x: number, z: number): number { return Math.max(TOWN.z0 - z, z - TOWN.z1, Math.abs(x) - TOWN.x1, 0); }

/** Height of the land: level everywhere, the town and the empty plain round it alike. */
export function groundHeight(_x: number, _z: number): number { return 0; }

function inRect(r: Rect, x: number, z: number, m = 0): boolean { return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
function overlaps(a: Rect, b: Rect): boolean { return a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6; }
export { overlaps as rectsOverlap };

/** The carriageways (with kerbs): nothing may stand on these. */
export function onRoad(x: number, z: number, m = 0): boolean { return Math.abs(z - ROAD_Z) < 1.0 + m || Math.abs(x) < SIDE_HALF + m; }
/** Sidewalks, zebras' landings and the parking lane: kept clear of props. */
export function onPaving(x: number, z: number, m = 0): boolean {
  if (onRoad(x, z, m)) return true;
  if ((z > MAIN_N[0] - m && z < MAIN_N[1] + m) || (z > MAIN_S[0] - m && z < MAIN_S[1] + m)) return true;
  return Math.abs(x) < 2.9 + m;
}

/** Every model the town can place, whatever the seed (loaded up front). */
export const TOWN_MODEL_IDS: string[] = [...new Set([
  ...GARDEN_TREES, ...STREET_TREES, ...BUSHES, ...FLOWERS, ...TREE_MIX, ...BUSH_MIX,
  'nature/flower-redb', 'nature/flower-yellowb', 'nature/rock-smallc',
  'roads/road-straight', 'roads/road-crossroad', 'roads/lamp', 'roads/dumpster', 'roads/sign-highway', 'roads/traffic-light', 'roads/sign-street', 'roads/electricity-pole',
  'suburban/fence', 'suburban/planter', 'nature/fence-simple', 'nature/sign', 'nature/log', 'nature/stump-old', 'nature/stump-round',
  'nature/grass-large', 'nature/plant-flattall', 'nature/mushroom-red', 'nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed', 'nature/rock-smalla', 'nature/rock-smallb',
  'furniture/bench', 'furniture/trashcan', 'commercial/parasol-a', 'commercial/parasol-b',
  'generated/hydrant', 'generated/recycling-bins', 'generated/bike-rack',
])];

export function buildTown(seed: number, plotId: string): TownPlan {
  const rng = new Rng(seed ^ 0x7a77);
  const mine = cornerOfPlot(plotId);
  const rc = rivalCorners(plotId);
  const plan: TownPlan = {
    placements: [], scatter: [], animals: [], slabs: [], lamps: [], lots: [],
    rivals: RIVAL_DEFS.map((d) => ({ id: d.id, name: d.name, kind: d.kind, corner: rc[d.id]! })),
    corners: { nw: cornerLot('nw'), ne: cornerLot('ne'), sw: cornerLot('sw'), se: cornerLot('se') },
  };
  const P = plan.placements;
  const slab = (color: string, rect: Rect, h = 0.04, y = 0) => plan.slabs.push({ color, rect, y, h });
  const lot = (l: Lot): number => { plan.lots.push(l); return plan.lots.length - 1; };
  for (const c of CORNER_IDS) lot({ ...plan.corners[c], kind: c === mine ? 'plot' : 'rival', id: c });

  // ---- The two roads, out into the haze; the crossroads tile in the middle and a zebra on every arm.
  const FAR = ROAD_FAR + 6;
  for (let x = -FAR; x <= FAR; x += 2) {
    if (x === 0) { P.push({ model: 'roads/road-crossroad', x: 0, y: 0.001, z: ROAD_Z, yaw: 0 }); continue; }
    P.push({ model: 'roads/road-straight', x, y: 0.001, z: ROAD_Z, yaw: 0 });
  }
  for (let k = -Math.ceil(FAR / 2); k <= Math.ceil(FAR / 2); k++) {
    if (k === 0) continue;
    P.push({ model: 'roads/road-straight', x: 0, y: 0.001, z: ROAD_Z + 2 * k, yaw: Math.PI / 2 });
  }
  // The zebras are painted, all four the same: slim bars along the traffic, in a soft off-white, where
  // the walkers actually cross (Kenney's crossing tile drew them bold on one road and sideways on the other).
  const BAR = 0.15, PITCH = 0.3, ZEBRA_PAINT = '#D8DADF', ZEBRA_Y = 0.045;
  for (const x of [ZEBRA.west, ZEBRA.east]) for (let z = MAIN_N[1] + 0.12; z + BAR <= MAIN_S[0] - 0.1; z += PITCH) slab(ZEBRA_PAINT, { x0: x - 0.42, z0: z, x1: x + 0.42, z1: z + BAR }, 0.003, ZEBRA_Y);
  for (const z of [ZEBRA.north, ZEBRA.south]) for (let x = -SIDE_HALF + 0.1; x + BAR <= SIDE_HALF - 0.08; x += PITCH) slab(ZEBRA_PAINT, { x0: x, z0: z - 0.42, x1: x + BAR, z1: z + 0.42 }, 0.003, ZEBRA_Y);
  // Sidewalks. The corner shops draw their own frontage (with driveway cuts); the town draws the rest.
  const span = (x0: number, x1: number) => { slab(PAVEMENT, { x0, z0: MAIN_N[0], x1, z1: MAIN_N[1] }, 0.06); slab(PAVEMENT, { x0, z0: MAIN_S[0], x1, z1: MAIN_S[1] }, 0.06); };
  // A corner lot reaches from |x| = 2.9 to 23.5; beyond it the town's own sidewalk runs on.
  const cornerX = PLOT_RECT.x1;
  span(-FAR, -(cornerX + 10.9)); span(cornerX + 10.9, FAR);
  // Corner squares between the kerbs and the lots, with the zebra landings.
  for (const sx of [-1, 1]) {
    slab(PAVEMENT, { x0: sx < 0 ? -2.9 : SIDE_HALF, z0: MAIN_N[0] - 1.0, x1: sx < 0 ? -SIDE_HALF : 2.9, z1: MAIN_N[1] }, 0.06);
    slab(PAVEMENT, { x0: sx < 0 ? -2.9 : SIDE_HALF, z0: MAIN_S[0], x1: sx < 0 ? -SIDE_HALF : 2.9, z1: MAIN_S[1] + 1.0 }, 0.06);
    // Elm Street's sidewalks, north and south, out of town.
    const x = sx < 0 ? SIDEWALK_W_X : SIDEWALK_E_X;
    slab(PAVEMENT, { x0: x - 0.3, z0: -FAR, x1: x + 0.3, z1: MAIN_N[0] - 1.0 }, 0.06);
    slab(PAVEMENT, { x0: x - 0.3, z0: MAIN_S[1] + 1.0, x1: x + 0.3, z1: FAR }, 0.06);
  }
  // Elm Street's shared bays: a parking lane on the east kerb, north of the crossing, with bay lines.
  { const zs = STREET_BAYS.map((b) => b.z);
    const z0 = Math.min(...zs) - 1.3, z1 = Math.max(...zs) + 1.3;
    slab('#5E616B', { x0: SIDE_HALF, z0, x1: SIDE_HALF + 0.9, z1 }, 0.012, 0.001);
    for (let z = z0; z <= z1 + 1e-6; z += 2.5) slab('#F2F2F2', { x0: SIDE_HALF + 0.05, z0: z - 0.03, x1: SIDE_HALF + 0.85, z1: z + 0.03 }, 0.004, 0.014); }
  // Traffic lights on the four corners (the lamps themselves are drawn live by the traffic view).
  for (const [x, z, yaw] of [[-SIDE_HALF - 0.25, MAIN_N[0] - 0.2, 0], [SIDE_HALF + 0.25, MAIN_N[0] - 0.2, 0], [-SIDE_HALF - 0.25, MAIN_S[1] + 0.2, Math.PI], [SIDE_HALF + 0.25, MAIN_S[1] + 0.2, Math.PI]] as const) P.push({ model: 'roads/traffic-light', x, z, yaw, scale: 1.4 });
  // Street name signs.
  P.push({ model: 'roads/sign-street', x: -2.7, z: MAIN_N[0] - 0.8, yaw: 0 }, { model: 'roads/sign-street', x: 2.7, z: MAIN_S[1] + 0.8, yaw: Math.PI });
  // The bus stop: the shelter itself is drawn with the structures; a bin beside it.
  P.push({ model: 'furniture/trashcan', x: BUS_STOP.x + 1.4, z: MAIN_S[1] - 0.15, yaw: 0 });

  // ---- Lamps along the sidewalks, clear of every driveway and service lane (they move as shops grow).
  const lampAt = (x: number, z: number, yaw: number) => { P.push({ model: 'roads/lamp', x, z, yaw }); plan.lamps.push({ x, z }); };
  const cuts: [number, number][] = [];
  for (const c of CORNER_IDS) {
    const fr = CORNERS[c];
    for (const size of SHOP_SIZES) for (const rows of [1, 2]) {
      const L = lotLayout({ floor: size.floor, storeroom: size.storeroom, lotRows: rows });
      for (const r of [L.driveway, L.serviceLane, { x0: -0.6, z0: 0, x1: 0.6, z1: 1 }]) { const w = rectToWorld(fr, r); cuts.push([w.x0 - 0.5, w.x1 + 0.5]); }
    }
  }
  const clear = (x: number) => !cuts.some(([a, b]) => x > a && x < b);
  for (let x = -60; x <= 60; x += 6) {
    if (Math.abs(x) < 4) continue;
    if (clear(x)) lampAt(x, MAIN_N[0] + 0.12, Math.PI);
    if (clear(x + 3)) lampAt(x + 3, MAIN_S[1] - 0.12, 0);
  }
  for (const z of [-8, -20, -32, 12, 24, 36]) { lampAt(SIDEWALK_W_X - 0.42, z, Math.PI / 2); lampAt(SIDEWALK_E_X + 0.42, z + 3, -Math.PI / 2); }

  // Hydrants on Elm Street's verge, bins and racks on the verges along Main Road out of town.
  for (const z of [-8.5, 16.5]) P.push({ model: 'generated/hydrant', x: -SIDE_HALF - 0.45, z, yaw: 0 });
  for (const sx of [-1, 1]) {
    P.push({ model: 'generated/hydrant', x: sx * 30, z: MAIN_N[0] - 0.4, yaw: 0 });
    P.push({ model: 'generated/recycling-bins', x: sx * 33, z: MAIN_S[1] + 0.45, yaw: 0 });
    P.push({ model: 'generated/bike-rack', x: sx * 36.5, z: MAIN_N[0] - 0.55, yaw: Math.PI / 2 });
  }
  // Street trees on Elm Street's west verge, both arms.
  for (const z of [-6, -11, -16, 9, 14, 19]) P.push({ model: rng.pick(STREET_TREES), x: -SIDE_HALF - 0.45, z, yaw: rng.range(0, 6.28), scale: 0.9 });

  // ---- Clumps of mixed trees and bushes round the corners' outer edges (not a forest, and nothing past the
  // edge of town: out there only the roads run on): a few species and sizes in each, never on paving or a corner.
  const trng = new Rng(seed ^ 0x7e3e);
  for (let cz = TOWN.z0 - 2; cz <= TOWN.z1 + 2; cz += 3.2) for (let cx = TOWN.x0 - 2; cx <= TOWN.x1 + 2; cx += 3.2) {
    const x0 = cx + trng.range(-1.2, 1.2), z0 = cz + trng.range(-1.2, 1.2);
    if (!trng.chance(0.55)) continue;
    const n = 1 + Math.floor(trng.range(0, 3));
    for (let i = 0; i <= n; i++) {
      const tree = i < n;
      const x = x0 + trng.range(-1.3, 1.3), z = z0 + trng.range(-1.3, 1.3);
      if (outsideTown(x, z) > 1.5 || onPaving(x, z, tree ? 1.1 : 0.6) || CORNER_IDS.some((c) => inRect(plan.corners[c], x, z, tree ? 0.9 : 0.5))) continue;
      P.push({ model: tree ? trng.pick(TREE_MIX) : trng.pick(BUSH_MIX), x, z, yaw: trng.range(0, 6.28), scale: tree ? trng.range(0.8, 1.45) : trng.range(0.8, 1.2) });
    }
  }

  // ---- Grass and flowers on the verges between the corners, thinning out at the edge of town (never on paving or a corner).
  const grng = new Rng(seed ^ 0x9a55);
  const blocked = (x: number, z: number) => onPaving(x, z, 0.08) || CORNER_IDS.some((c) => inRect(plan.corners[c], x, z, 0.2));
  for (let gz = TOWN.z0 - 6; gz < TOWN.z1 + 6; gz += 0.7) for (let gx = TOWN.x0 - 6; gx < TOWN.x1 + 6; gx += 0.7) {
    const x = gx + grng.range(-0.3, 0.3), z = gz + grng.range(-0.3, 0.3);
    if (blocked(x, z) || !grng.chance(1 - outsideTown(x, z) / 6)) continue;
    const n = vnoise(x / 3.5, z / 3.5);
    if (n > 0.66 && grng.chance(0.5)) plan.scatter.push({ kind: FLOWER_KINDS[Math.floor(vnoise(x / 6 + 9, z / 6) * 5) % 5]!, x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.9, 1.3) });
    else if (grng.chance(0.6)) plan.scatter.push({ kind: 'grass', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.7, 1.3) });
    else if (grng.chance(0.03)) plan.scatter.push({ kind: 'pebble', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.6, 1.2) });
  }

  // ---- Life: birds over the crossroads, butterflies on the verges, squirrels in the street trees, rabbits out on the plain.
  for (const [x, z] of [[-6, -4], [14, 8], [-16, 12]] as const) plan.animals.push({ kind: 'bird', x, z, range: 14, y: 9 });
  for (const [x, z] of [[-1.5, -12], [-1.5, 14], [-28, -2], [28, 7]] as const) plan.animals.push({ kind: 'butterfly', x, z, range: 1.6 });
  for (const [x, z] of [[-1.45, -6], [-1.45, 9]] as const) plan.animals.push({ kind: 'squirrel', x, z, range: 0.5 });
  for (const [x, z] of [[-14, -20], [16, -19.5], [-12, 25], [14, 24.5]] as const) plan.animals.push({ kind: 'rabbit', x, z, range: 2.0 });
  return plan;
}
