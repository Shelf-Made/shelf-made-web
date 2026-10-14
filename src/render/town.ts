/**
 * The town plan: where every static thing at the crossroads stands, generated deterministically
 * from the seed and the chosen corner. Pure data, so tests can check that nothing overlaps and the
 * renderer only has to draw it.
 *
 * One crossroads: Main Road east–west, Elm Street north–south, a shop on each corner (the
 * player's and three rivals', drawn by StoreView and RivalsView). Around it, a backdrop ring seen
 * from behind: house backs and apartment blocks behind fences along the roads leading out, then
 * trees, then the hills and mountains. Nothing in the ring is walkable; the roads run on into the haze.
 *
 * Every building sits on a Lot (a property rectangle). Lots never overlap, never touch a road,
 * and every house fits inside its own lot.
 */
import { Rng } from '@/sim/rng';
import { ROAD_Z, ROAD_FAR, PLOT_RECT, CORNERS, CORNER_IDS, SIDE_HALF, SIDEWALK_W_X, SIDEWALK_E_X, STREET_BAYS, BUS_STOP, MAP_X, MAP_Z, cornerOfPlot, rectToWorld, lotLayout, SHOP_SIZES, type Rect as SimRect } from '@/sim/layout';
import { rivalCorners, RIVAL_DEFS } from '@/sim/rivals';
import type { CornerId } from '@/sim/types';

export interface Placement { model: string; x: number; y?: number; z: number; yaw: number; scale?: number }
export type Rect = SimRect;
export interface RivalSite { id: string; name: string; corner: CornerId; kind: 'discount' | 'premium' | 'chain' }
export type LotKind = 'house' | 'plot' | 'rival' | 'apartment';
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
  /** Trees in the backdrop ring: drawn instanced. */
  forest: Placement[];
  /** Grass, flowers and pebbles: instanced, swaying in the wind. */
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
  /** Parked cars in the backdrop's driveways. */
  parked: { model: number; x: number; z: number; yaw: number }[];
  /** Property lines. Never overlap. */
  lots: Lot[];
  /** Building footprints (houses and blocks), each inside its lot. */
  footprints: (Rect & { lot: number })[];
}

/** House models and their footprints at yaw 0 (width along x, depth along z), measured from the converted GLBs. */
const HOUSE_SIZE: Record<string, [number, number]> = {
  a: [3.90, 3.08], b: [5.48, 3.42], c: [3.86, 3.08], d: [5.27, 3.08], e: [3.90, 3.08], f: [4.28, 4.22], g: [4.35, 3.53], h: [3.90, 2.75], i: [3.86, 3.08], j: [4.11, 2.75],
  k: [2.76, 3.06], l: [3.10, 3.06], m: [4.28, 4.28], n: [5.35, 4.13], o: [3.81, 3.08], p: [3.72, 2.97], q: [3.72, 2.66], r: [3.08, 3.06], s: [4.22, 3.26], t: [3.94, 4.22], u: [4.28, 3.26],
};

const GARDEN_TREES = ['nature/tree-default', 'nature/tree-oak', 'nature/tree-fat', 'nature/tree-small', 'nature/tree-tall', 'nature/tree-detailed', 'nature/tree-simple'];
const STREET_TREES = ['suburban/tree-large', 'suburban/tree-small'];
const BUSHES = ['nature/plant-bush', 'nature/plant-bushsmall', 'nature/plant-bushlarge', 'nature/plant-bushdetailed'];
const FLOWERS = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
/** Low-poly picks only: the woods hold hundreds of these. */
const PINES = ['nature/tree-pinetalla', 'nature/tree-pinetallb', 'nature/tree-pinetallc', 'nature/tree-pinetalld', 'nature/tree-pinesmallc'];
const WOODLAND = ['nature/tree-default', 'nature/tree-tall', 'nature/tree-default-dark', 'nature/tree-tall-dark', 'nature/tree-fat'];
const ROCKS = ['nature/rock-largea', 'nature/rock-largeb', 'nature/rock-largec', 'nature/rock-larged', 'nature/rock-largee', 'nature/rock-largef'];
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

// ---- Terrain. Seed-independent: it is the same pocket every game.
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
function fbm(x: number, z: number): number { return vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 17, z * 2.1 - 9) * 0.3 + vnoise(x * 4.3 - 5, z * 4.3 + 31) * 0.15; }
function smooth(e0: number, e1: number, v: number): number { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }


/** How far outside the level town area a point is (0 inside). */
export function outsideTown(x: number, z: number): number { return Math.max(TOWN.z0 - 10 - z, z - TOWN.z1 - 10, Math.abs(x) - TOWN.x1 - 10, 0); }

/**
 * Height of the land. Level across the town and its backdrop ring, and along both roads all the
 * way out; beyond, rolling wooded hills, and a snowy range far off to the north.
 */
export function groundHeight(x: number, z: number): number {
  const o = outsideTown(x, z);
  if (o === 0) return 0;
  // Both roads stay level with a wide verge, out into the haze.
  const road = Math.min(Math.abs(z - ROAD_Z), Math.abs(x));
  const keep = smooth(6, 16, road);
  const hills = smooth(0, 30, o) * (2.5 + fbm(x / 16 + 3, z / 16 + 5) * 7);
  const range = smooth(-60, -105, z) * (16 + (1 - Math.abs(vnoise(x / 19 + 40, z / 19) * 2 - 1)) ** 2 * 22 + fbm(x / 26, z / 26) * 10);
  return (hills + range) * keep;
}

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

const APARTMENTS = ['commercial/far-a', 'commercial/far-b', 'commercial/far-c', 'commercial/far-d', 'commercial/far-e', 'commercial/far-f', 'commercial/far-g', 'commercial/far-h'];

/** Every model the town can place, whatever the seed (loaded up front). */
export const TOWN_MODEL_IDS: string[] = [...new Set([
  ...Object.keys(HOUSE_SIZE).map((l) => `suburban/house-${l}`), ...APARTMENTS,
  ...GARDEN_TREES, ...STREET_TREES, ...BUSHES, ...FLOWERS, ...PINES, ...WOODLAND, ...ROCKS,
  'roads/road-straight', 'roads/road-crossing', 'roads/road-crossroad', 'roads/lamp', 'roads/dumpster', 'roads/sign-highway', 'roads/traffic-light', 'roads/sign-street', 'roads/electricity-pole',
  'suburban/fence', 'suburban/planter', 'nature/fence-simple', 'nature/sign', 'nature/log', 'nature/stump-old', 'nature/stump-round',
  'nature/grass-large', 'nature/plant-flattall', 'nature/mushroom-red', 'nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed', 'nature/rock-smalla', 'nature/rock-smallb',
  'furniture/bench', 'furniture/trashcan', 'commercial/parasol-a', 'commercial/parasol-b',
])];

export function buildTown(seed: number, plotId: string): TownPlan {
  const rng = new Rng(seed ^ 0x7a77);
  const mine = cornerOfPlot(plotId);
  const rc = rivalCorners(plotId);
  const plan: TownPlan = {
    placements: [], forest: [], scatter: [], animals: [], slabs: [], lamps: [], parked: [], lots: [], footprints: [],
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
    const zebra = Math.abs(x) === 2;
    P.push({ model: zebra ? 'roads/road-crossing' : 'roads/road-straight', x, y: 0.001, z: ROAD_Z, yaw: zebra ? Math.PI / 2 : 0 });
  }
  for (let k = -Math.ceil(FAR / 2); k <= Math.ceil(FAR / 2); k++) {
    if (k === 0) continue;
    const z = ROAD_Z + 2 * k, zebra = Math.abs(k) === 1;
    P.push({ model: zebra ? 'roads/road-crossing' : 'roads/road-straight', x: 0, y: 0.001, z, yaw: zebra ? 0 : Math.PI / 2 });
  }
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

  // ---- The backdrop ring. House backs behind fences along every road out of town, then blocks.
  const houseBack = (L: Rect, facing: 'N' | 'S' | 'E' | 'W') => {
    const w = L.x1 - L.x0, d = L.z1 - L.z0;
    const along = facing === 'N' || facing === 'S' ? w : d, deep = facing === 'N' || facing === 'S' ? d : w;
    const options = Object.entries(HOUSE_SIZE).filter(([, [hw, hd]]) => hw <= along - 1.0 && hd <= deep - 1.6);
    if (!options.length) return;
    const li = lot({ ...L, kind: 'house' });
    const [letter, [hw, hd]] = options[rng.int(0, options.length - 1)]!;
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    const yaw = facing === 'S' ? 0 : facing === 'N' ? Math.PI : facing === 'E' ? Math.PI / 2 : -Math.PI / 2;
    // Pushed toward its own front garden, so the back garden (with its fence) faces our roads.
    const off = (deep - (facing === 'N' || facing === 'S' ? hd : hd)) / 2 - 0.6;
    const px = facing === 'E' ? cx + off : facing === 'W' ? cx - off : cx, pz = facing === 'S' ? cz + off : facing === 'N' ? cz - off : cz;
    P.push({ model: `suburban/house-${letter}`, x: px, z: pz, yaw });
    const fw = facing === 'N' || facing === 'S' ? hw : hd, fd = facing === 'N' || facing === 'S' ? hd : hw;
    plan.footprints.push({ x0: px - fw / 2, x1: px + fw / 2, z0: pz - fd / 2, z1: pz + fd / 2, lot: li });
    // Back garden: a tree or two, a shed of bushes.
    for (let i = 0; i < 2; i++) {
      const bx = facing === 'E' ? L.x0 + 1.0 : facing === 'W' ? L.x1 - 1.0 : L.x0 + 1 + rng.range(0, Math.max(0.1, w - 2));
      const bz = facing === 'S' ? L.z0 + 1.0 : facing === 'N' ? L.z1 - 1.0 : L.z0 + 1 + rng.range(0, Math.max(0.1, d - 2));
      P.push({ model: rng.pick(i ? BUSHES : GARDEN_TREES), x: bx, z: bz, yaw: rng.range(0, 6.28), scale: rng.range(0.9, 1.2) });
    }
  };
  /** A fence line along x (yaw 0) or along z (yaw π/2) from a to b. */
  const fenceX = (z: number, a: number, b: number) => { for (let x = a + 0.71; x <= b - 0.7; x += 1.42) P.push({ model: 'suburban/fence', x, z, yaw: 0 }); };
  const fenceZ = (x: number, a: number, b: number) => { for (let z = a + 0.71; z <= b - 0.7; z += 1.42) P.push({ model: 'suburban/fence', x, z, yaw: Math.PI / 2 }); };
  // Main Road, both ways out of town: a row of house lots each side, backs to the road.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const a = 25 + k * 7.2, b = a + 7.0;
      const x0 = sx < 0 ? -b : a, x1 = sx < 0 ? -a : b;
      houseBack({ x0, z0: MAIN_N[0] - 9.5, x1, z1: MAIN_N[0] - 0.9 }, 'N');
      houseBack({ x0, z0: MAIN_S[1] + 0.9, x1, z1: MAIN_S[1] + 9.5 }, 'S');
    }
    const a = 25, b = 25 + 6 * 7.2;
    fenceX(MAIN_N[0] - 0.9, sx < 0 ? -b : a, sx < 0 ? -a : b);
    fenceX(MAIN_S[1] + 0.9, sx < 0 ? -b : a, sx < 0 ? -a : b);
  }
  // Elm Street, north and south out of town: houses both sides, backs to the street.
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      // Beyond the rows of house backs behind the corners.
      const a = sz < 0 ? -(24 + (k + 1) * 7.2) : 28.6 + k * 7.2, b = a + 7.0;
      houseBack({ x0: -12.5, z0: a, x1: -3.3, z1: b }, 'W');
      houseBack({ x0: 3.3, z0: a, x1: 12.5, z1: b }, 'E');
    }
    const a = sz < 0 ? -(24 + 4 * 7.2) : 28.6, b = sz < 0 ? -24 : 28.6 + 4 * 7.2;
    fenceZ(-3.3, a, b); fenceZ(3.3, a, b);
  }
  // Behind the corners: a fence on each back line, then a row of house backs facing away.
  fenceX(MAP_Z.north + 2.6, -23.5, -2.9); fenceX(MAP_Z.north + 2.6, 2.9, 23.5);
  fenceX(MAP_Z.south - 2.6, -23.5, -2.9); fenceX(MAP_Z.south - 2.6, 2.9, 23.5);
  for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) {
    const a = 3.3 + k * 6.8, b = a + 6.6;
    houseBack({ x0: sx < 0 ? -b : a, z0: MAP_Z.north - 7.5, x1: sx < 0 ? -a : b, z1: MAP_Z.north + 2.3 }, 'N');
    houseBack({ x0: sx < 0 ? -b : a, z0: MAP_Z.south - 2.3, x1: sx < 0 ? -a : b, z1: MAP_Z.south + 7.5 }, 'S');
  }
  // Apartment blocks: the town goes on beyond, stacked up on the four diagonals and down Main Road.
  const block = (x: number, z: number, s: number) => {
    const half = 0.75 * s;
    const li = lot({ x0: x - half - 0.4, z0: z - half - 0.4, x1: x + half + 0.4, z1: z + half + 0.4, kind: 'apartment' });
    P.push({ model: rng.pick(APARTMENTS), x, z, yaw: rng.int(0, 3) * (Math.PI / 2), scale: s });
    plan.footprints.push({ x0: x - half, z0: z - half, x1: x + half, z1: z + half, lot: li });
  };
  for (const [x, z] of [[-34, -27], [-27, -31], [34, -27], [28, -31], [-33, 33], [33, 33], [-70, -12], [-78, 16], [72, -13], [80, 17], [-10, -62], [11, -66], [-11, 66], [9, 70]] as const) block(x, z, rng.range(1.8, 2.4));

  // ---- Trees: everywhere in the ring that is not a road, a lot or the town.
  const trng = new Rng(0x5eed);
  for (let gz = -120; gz < 110; gz += 2.6) for (let gx = -130; gx < 130; gx += 2.6) {
    const x = gx + trng.range(-1, 1), z = gz + trng.range(-1, 1);
    if (inRect(TOWN, x, z, 3) || onRoad(x, z, 3.2)) { trng.next(); continue; }
    if (plan.lots.some((l) => inRect(l, x, z, 0.8))) { trng.next(); continue; }
    if (Math.hypot(x / 1.3, z) > 125) continue;
    const h = groundHeight(x, z);
    if (h > 24) continue;
    const near = outsideTown(x, z) < 22;
    if (!trng.chance(near ? 0.55 : 0.35)) continue;
    const pine = trng.chance(h > 4 ? 0.85 : 0.35);
    plan.forest.push({ model: pine ? trng.pick(PINES) : trng.pick(WOODLAND), x, y: h - 0.05, z, yaw: trng.range(0, 6.28), scale: (near ? 1.3 : 2.0) * trng.range(0.8, 1.25) });
  }
  // Street trees on Elm Street's west verge, both arms.
  for (const z of [-6, -11, -16, 9, 14, 19]) P.push({ model: rng.pick(STREET_TREES), x: -SIDE_HALF - 0.45, z, yaw: rng.range(0, 6.28), scale: 0.9 });

  // ---- Grass and flowers on the verges and in the ring's gardens (never on paving or a corner).
  const grng = new Rng(seed ^ 0x9a55);
  const blocked = (x: number, z: number) => onPaving(x, z, 0.08) || CORNER_IDS.some((c) => inRect(plan.corners[c], x, z, 0.2)) || plan.footprints.some((f) => inRect(f, x, z, 0.25));
  for (let gz = MAP_Z.north - 14; gz < MAP_Z.south + 14; gz += 0.7) for (let gx = -50; gx < 50; gx += 0.7) {
    const x = gx + grng.range(-0.3, 0.3), z = gz + grng.range(-0.3, 0.3);
    if (blocked(x, z)) continue;
    const n = vnoise(x / 3.5, z / 3.5);
    if (n > 0.66 && grng.chance(0.5)) plan.scatter.push({ kind: FLOWER_KINDS[Math.floor(vnoise(x / 6 + 9, z / 6) * 5) % 5]!, x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.9, 1.3) });
    else if (grng.chance(0.6)) plan.scatter.push({ kind: 'grass', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.7, 1.3) });
    else if (grng.chance(0.03)) plan.scatter.push({ kind: 'pebble', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.6, 1.2) });
  }

  // ---- Life: birds over the crossroads, butterflies on the verges, squirrels in the street trees, rabbits out back.
  for (const [x, z] of [[-6, -4], [14, 8], [-16, 12]] as const) plan.animals.push({ kind: 'bird', x, z, range: 14, y: 9 });
  for (const [x, z] of [[-1.5, -12], [-1.5, 14], [-28, -2], [28, 7]] as const) plan.animals.push({ kind: 'butterfly', x, z, range: 1.6 });
  for (const [x, z] of [[-1.45, -6], [-1.45, 9]] as const) plan.animals.push({ kind: 'squirrel', x, z, range: 0.5 });
  for (const [x, z] of [[-14, -20], [16, -19.5], [-12, 25], [14, 24.5]] as const) plan.animals.push({ kind: 'rabbit', x, z, range: 2.0 });
  return plan;
}
