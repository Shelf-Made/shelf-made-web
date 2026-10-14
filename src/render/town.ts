/**
 * The town plan: where every static thing in the pocket stands, generated deterministically from
 * the seed and the chosen plot. Pure data, so tests can check that nothing overlaps and the
 * renderer only has to draw it.
 *
 * The pocket is a small green hollow ringed by cliffs with woods on top. Main Street runs straight
 * through it and leaves by a tunnel at each end, out to the rest of the town. North of the road:
 * the three shop plots, a house at each end and an orchard meadow under the cliff. South of the
 * road: the three rivals, a house, and the park around a fountain and a duck pond. A creek runs
 * along the foot of the south cliff, fed by a waterfall.
 *
 * Every building sits on a Lot (a property rectangle). Lots never overlap, and every house fits
 * inside its own lot with room for a front garden, so nothing steps on a neighbour or the shop.
 */
import { Rng } from '@/sim/rng';
import { PLOTS, ROAD_Z, ROAD_FAR, RIVER_HALF_W, riverZ, PLOT_RECT, storeOrigin, TUNNEL_X } from '@/sim/layout';

export interface Placement { model: string; x: number; y?: number; z: number; yaw: number; scale?: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface RivalSite { id: string; name: string; x: number; z: number; kind: 'discount' | 'premium' | 'chain' }
export type LotKind = 'house' | 'plot' | 'rival' | 'park' | 'green';
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
  /** Woods on the cliff tops: drawn instanced. */
  forest: Placement[];
  /** Grass, flowers and pebbles: instanced, swaying in the wind. */
  scatter: Scatter[];
  animals: AnimalHome[];
  /** Flat painted areas: colour + rect + height. */
  slabs: { color: string; rect: Rect; y: number; h: number }[];
  rivals: RivalSite[];
  branches: { plotId: string; x: number; z: number }[];
  /** Lamp positions for night lights. */
  lamps: { x: number; z: number }[];
  /** Parked cars in driveways and forecourts. */
  parked: { model: number; x: number; z: number; yaw: number }[];
  /** Property lines. Never overlap. */
  lots: Lot[];
  /** Building footprints (houses and shops), each inside its lot. */
  footprints: (Rect & { lot: number })[];
  /** Road tunnels out of the pocket (x of each portal) and the footbridge over the creek. */
  tunnels: number[];
  footbridges: { x: number; z0: number; z1: number }[];
  /** The park's pond and fountain, and the waterfall that feeds the creek. */
  pond: Rect;
  fountain: { x: number; z: number };
  waterfall: { x: number; z: number };
}

/** House models and their footprints at yaw 0 (width along x, depth along z), measured from the converted GLBs. */
const HOUSE_SIZE: Record<string, [number, number]> = {
  a: [3.90, 3.08], b: [5.48, 3.42], c: [3.86, 3.08], d: [5.27, 3.08], e: [3.90, 3.08], f: [4.28, 4.22], g: [4.35, 3.53], h: [3.90, 2.75], i: [3.86, 3.08], j: [4.11, 2.75],
  k: [2.76, 3.06], l: [3.10, 3.06], m: [4.28, 4.28], n: [5.35, 4.13], o: [3.81, 3.08], p: [3.72, 2.97], q: [3.72, 2.66], r: [3.08, 3.06], s: [4.22, 3.26], t: [3.94, 4.22], u: [4.28, 3.26],
};
/** Small shop buildings used in pairs at the rival sites. */
const SHOP_SIZE: Record<string, [number, number]> = { a: [2.65, 2.82], b: [2.91, 2.82], c: [2.65, 3.27], d: [2.52, 2.70], f: [2.52, 3.09], g: [2.91, 2.77], h: [2.65, 3.02] };

const GARDEN_TREES = ['nature/tree-default', 'nature/tree-oak', 'nature/tree-fat', 'nature/tree-small', 'nature/tree-tall', 'nature/tree-detailed', 'nature/tree-simple'];
const STREET_TREES = ['suburban/tree-large', 'suburban/tree-small'];
const BUSHES = ['nature/plant-bush', 'nature/plant-bushsmall', 'nature/plant-bushlarge', 'nature/plant-bushdetailed'];
const FLOWERS = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
/** Low-poly picks only: the woods hold hundreds of these. */
const PINES = ['nature/tree-pinetalla', 'nature/tree-pinetallb', 'nature/tree-pinetallc', 'nature/tree-pinetalld', 'nature/tree-pinesmallc'];
const WOODLAND = ['nature/tree-default', 'nature/tree-tall', 'nature/tree-default-dark', 'nature/tree-tall-dark', 'nature/tree-fat'];
const ROCKS = ['nature/rock-largea', 'nature/rock-largeb', 'nature/rock-largec', 'nature/rock-larged', 'nature/rock-largee', 'nature/rock-largef'];
const FLOWER_KINDS: ScatterKind[] = ['flower-red', 'flower-yellow', 'flower-purple', 'flower-white', 'flower-pink'];

/** Every model the town can place, whatever the seed (loaded up front). */
export const TOWN_MODEL_IDS: string[] = [...new Set([
  ...Object.keys(HOUSE_SIZE).map((l) => `suburban/house-${l}`), ...Object.keys(SHOP_SIZE).map((l) => `commercial/shop-${l}`),
  ...GARDEN_TREES, ...STREET_TREES, ...BUSHES, ...FLOWERS, ...PINES, ...WOODLAND, ...ROCKS,
  'roads/road-straight', 'roads/road-crossing', 'roads/lamp', 'roads/dumpster', 'roads/sign-highway',
  'suburban/fence', 'nature/fence-simple', 'nature/sign', 'nature/lily-large', 'nature/lily-small', 'nature/canoe', 'nature/log', 'nature/log-large', 'nature/stump-old', 'nature/stump-round',
  'nature/grass-large', 'nature/plant-flattall', 'nature/mushroom-red', 'nature/mushroom-tangroup', 'nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed', 'nature/rock-smalla', 'nature/rock-smallb', 'nature/rock-talla', 'nature/rock-tallb',
  'furniture/bench', 'furniture/trashcan', 'commercial/shop-c', 'commercial/shop-d', 'commercial/parasol-a', 'commercial/parasol-b',
])];

export const RIVAL_DEFS: Omit<RivalSite, 'x' | 'z'>[] = [
  { id: 'discount', name: 'Cheapo', kind: 'discount' },
  { id: 'premium', name: 'Fresh & Fine', kind: 'premium' },
  { id: 'chain', name: 'MegaMart', kind: 'chain' },
];

// ---- Street geometry (world units). Roads are Kenney tiles two units wide.
export const SIDEWALK_W = 0.6;
/** North and south sidewalks of Main Street. */
export const MAIN_N: [number, number] = [ROAD_Z - 1.55, ROAD_Z - 0.95];
export const MAIN_S: [number, number] = [ROAD_Z + 1.55 - SIDEWALK_W, ROAD_Z + 1.55];
/** Edge of the flat floor of the pocket; cliffs rise beyond. */
export const BASIN = { x: 48, zN: -19.5, zS: 21.5 };
export const PAVEMENT = '#C9CBD1';

/** The rectangle a shop plot owns in world space. */
export function plotLot(plotX: number): Rect {
  const o = storeOrigin(plotX);
  return { x0: o.x + PLOT_RECT.x0, z0: o.z + PLOT_RECT.z0, x1: o.x + PLOT_RECT.x1, z1: o.z + PLOT_RECT.z1 };
}

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

/** How far outside the flat floor a point is (0 inside). */
export function outsideBasin(x: number, z: number): number { return Math.max(BASIN.zN - z, z - BASIN.zS, Math.abs(x) - BASIN.x, 0); }

/**
 * Height of the land. Exactly 0 on the floor of the pocket. Beyond it a cliff rises in two or
 * three metres to a wooded plateau, and a snowy range stands far off to the north. The road
 * stays level right up to the tunnel portals.
 */
export function groundHeight(x: number, z: number): number {
  // The road and its verges stay level right up to (and just behind) the tunnel portals.
  if (Math.abs(z - ROAD_Z) < 3.6 && Math.abs(x) < TUNNEL_X + 2) return 0;
  const o = outsideBasin(x, z);
  if (o === 0) return 0;
  const cliff = smooth(0, 2.4, o) * (6.2 + fbm(x / 6, z / 6) * 3.2);
  const plateau = smooth(2, 30, o) * (3 + fbm(x / 18 + 3, z / 18 + 5) * 6);
  const range = smooth(-48, -95, z) * (16 + (1 - Math.abs(vnoise(x / 19 + 40, z / 19) * 2 - 1)) ** 2 * 22 + fbm(x / 26, z / 26) * 10);
  return cliff + plateau + range;
}

function inRect(r: Rect, x: number, z: number, m = 0): boolean { return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
function overlaps(a: Rect, b: Rect): boolean { return a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6; }
export { overlaps as rectsOverlap };

export function buildTown(seed: number, plotId: string, branchPlots: string[] = []): TownPlan {
  const rng = new Rng(seed ^ 0x7a77);
  const W = TUNNEL_X;
  const plan: TownPlan = {
    placements: [], forest: [], scatter: [], animals: [], slabs: [], rivals: [], lamps: [], parked: [], branches: [], lots: [], footprints: [],
    tunnels: [-W, W], footbridges: [], pond: { x0: 7, z0: 7.2, x1: 17, z1: 12 }, fountain: { x: -4, z: 9.6 }, waterfall: { x: -BASIN.x - 0.6, z: riverZ(-BASIN.x) },
  };
  const P = plan.placements;
  const chosen = PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!;
  const slab = (color: string, rect: Rect, h = 0.04, y = 0) => plan.slabs.push({ color, rect, y, h });
  const lot = (l: Lot): number => { plan.lots.push(l); return plan.lots.length - 1; };

  // ---- Main Street, tunnel to tunnel; tiles run on into the dark.
  const FAR = ROAD_FAR + 6;
  for (let x = -FAR + 1; x <= FAR; x += 2) P.push({ model: Math.abs(x - 7) < 0.1 || Math.abs(x + 15) < 0.1 ? 'roads/road-crossing' : 'roads/road-straight', x, y: 0.001, z: ROAD_Z, yaw: Math.abs(x - 7) < 0.1 || Math.abs(x + 15) < 0.1 ? Math.PI / 2 : 0 });
  // Sidewalks along both sides, into the tunnels. The chosen plot draws its own frontage (with its driveway cuts).
  const own = plotLot(chosen.x);
  slab(PAVEMENT, { x0: -FAR, z0: MAIN_N[0], x1: own.x0, z1: MAIN_N[1] }, 0.06);
  slab(PAVEMENT, { x0: own.x1, z0: MAIN_N[0], x1: FAR, z1: MAIN_N[1] }, 0.06);
  slab(PAVEMENT, { x0: -FAR, z0: MAIN_S[0], x1: FAR, z1: MAIN_S[1] }, 0.06);
  // A road sign at each portal: "Town centre" pointing into the tunnel.
  P.push({ model: 'roads/sign-highway', x: -W + 2.2, z: ROAD_Z - 1.95, yaw: Math.PI / 2 }, { model: 'roads/sign-highway', x: W - 2.2, z: ROAD_Z + 1.95, yaw: -Math.PI / 2 });

  // ---- North of Main Street: the three plots with hedges between, a house at each end.
  for (const p of PLOTS) lot({ ...plotLot(p.x), kind: 'plot', id: p.id });
  const plotRects = PLOTS.map((p) => plotLot(p.x)).sort((a, b) => a.x0 - b.x0);
  const back = plotRects[0]!.z0;
  for (let i = 0; i < plotRects.length - 1; i++) lot({ x0: plotRects[i]!.x1, z0: back, x1: plotRects[i + 1]!.x0, z1: MAIN_N[0], kind: 'green' });

  // Houses: each picks a model that fits its lot and stands behind a front garden.
  const houseIn = (L: Rect, facing: 'N' | 'S') => {
    const li = lot({ ...L, kind: 'house' });
    const w = L.x1 - L.x0, deep = L.z1 - L.z0;
    const front = facing === 'S' ? L.z1 : L.z0;
    const sign = facing === 'S' ? -1 : 1;
    const yard = 1.9;
    const drive = w >= 7.4;
    const fitsW = Math.min(w - (drive ? 2.3 : 0.9), 5.5);
    const fitsD = deep - yard - 0.8;
    const options = Object.entries(HOUSE_SIZE).filter(([, [hw, hd]]) => hw <= fitsW && hd <= fitsD);
    const [letter, [hw, hd]] = options[rng.int(0, options.length - 1)]!;
    const cx = drive ? L.x0 + 1.0 + hw / 2 : (L.x0 + L.x1) / 2;
    const cz = front + sign * (yard + hd / 2);
    P.push({ model: `suburban/house-${letter}`, x: cx, z: cz, yaw: facing === 'S' ? 0 : Math.PI });
    plan.footprints.push({ x0: cx - hw / 2, x1: cx + hw / 2, z0: cz - hd / 2, z1: cz + hd / 2, lot: li });
    const doorZ = front + sign * yard;
    slab('#D6D2C8', { x0: cx - 0.33, z0: Math.min(front, doorZ), x1: cx + 0.33, z1: Math.max(front, doorZ) }, 0.035);
    let dx = 0;
    if (drive) {
      dx = cx + hw / 2 + 1.0;
      const dEnd = front + sign * (yard + hd * 0.8);
      slab('#A9ACB5', { x0: dx - 0.62, z0: Math.min(front, dEnd), x1: dx + 0.62, z1: Math.max(front, dEnd) }, 0.035);
      plan.parked.push({ model: rng.int(0, 5), x: dx, z: front + sign * (yard + 0.4), yaw: facing === 'S' ? Math.PI : 0 });
    }
    // Low rail fence along the front property line (Kenney fence pieces run along x at yaw 0), gaps for the path and drive.
    const fz = front + sign * 0.18;
    for (let x = L.x0 + 0.72; x <= L.x1 - 0.68; x += 1.4) {
      if (Math.abs(x - cx) < 1.15 || (drive && Math.abs(x - dx) < 1.35)) continue;
      P.push({ model: 'nature/fence-simple', x, z: fz, yaw: 0 });
    }
    // Garden: trees at the back, bushes under the windows, a flower border along the fence.
    const backZ = L.z0 + L.z1 - front;
    for (let i = 0; i < 2; i++) P.push({ model: rng.pick(GARDEN_TREES), x: L.x0 + 1.2 + rng.range(0, Math.max(0, w - 2.4)), z: backZ - sign * rng.range(1.0, 2.0), yaw: rng.range(0, 6.28), scale: rng.range(0.9, 1.2) });
    for (let i = 0; i < 3; i++) P.push({ model: rng.pick(BUSHES), x: cx - hw / 2 + 0.4 + i * (hw - 0.8) / 2, z: front + sign * (yard - 0.45), yaw: rng.range(0, 6.28) });
    for (let x = L.x0 + 0.5; x < L.x1 - 0.4; x += 0.42) {
      if (Math.abs(x - cx) < 0.6 || (drive && Math.abs(x - dx) < 0.9)) continue;
      plan.scatter.push({ kind: FLOWER_KINDS[Math.floor(Math.abs(x * 7)) % FLOWER_KINDS.length]!, x, z: front + sign * 0.45, yaw: x, scale: 1.1 });
    }
    // A washing line, a swing? Keep it simple: a bench by the back door.
    P.push({ model: 'furniture/bench', x: cx - hw / 2 + 0.6, z: backZ - sign * 0.9, yaw: facing === 'S' ? Math.PI : 0 });
  };
  houseIn({ x0: -46.5, x1: plotRects[0]!.x0 - 1.5, z0: back, z1: MAIN_N[0] }, 'S');
  houseIn({ x0: plotRects[2]!.x1 + 1.5, x1: 46.5, z0: back, z1: MAIN_N[0] }, 'S');
  lot({ x0: plotRects[0]!.x0 - 1.5, z0: back, x1: plotRects[0]!.x0, z1: MAIN_N[0], kind: 'green' });
  lot({ x0: plotRects[2]!.x1, z0: back, x1: plotRects[2]!.x1 + 1.5, z1: MAIN_N[0], kind: 'green' });

  // ---- South of Main Street: a house, the rivals and the park.
  const S0 = MAIN_S[1], S1 = 13.0;
  houseIn({ x0: -46.5, x1: -36.5, z0: S0, z1: S1 }, 'N');
  const rivalLots: Record<RivalSite['kind'], Rect> = {
    discount: { x0: -34.6, z0: S0, x1: -25.4, z1: S1 }, premium: { x0: 25.4, z0: S0, x1: 34.6, z1: S1 }, chain: { x0: 36.5, z0: S0, x1: 46.5, z1: S1 },
  };
  for (const r of RIVAL_DEFS) {
    const L = rivalLots[r.kind];
    const li = lot({ ...L, kind: 'rival', id: r.id });
    const x = (L.x0 + L.x1) / 2;
    const letters = Object.keys(SHOP_SIZE);
    const a = letters[rng.int(0, letters.length - 1)]!, b = letters[rng.int(0, letters.length - 1)]!;
    const [aw, ad] = SHOP_SIZE[a]!, [bw, bd] = SHOP_SIZE[b]!;
    const fz = S0 + 3.2;
    const az = fz + ad / 2, bz = fz + bd / 2;
    P.push({ model: `commercial/shop-${a}`, x: x - aw / 2 - 0.02, z: az, yaw: Math.PI });
    P.push({ model: `commercial/shop-${b}`, x: x + bw / 2 + 0.02, z: bz, yaw: Math.PI });
    plan.footprints.push({ x0: x - aw - 0.02, x1: x - 0.02, z0: az - ad / 2, z1: az + ad / 2, lot: li }, { x0: x + 0.02, x1: x + bw + 0.02, z0: bz - bd / 2, z1: bz + bd / 2, lot: li });
    plan.rivals.push({ ...r, x, z: fz + 1.4 });
    slab('#6E717C', { x0: L.x0 + 0.4, z0: S0, x1: L.x1 - 0.4, z1: fz }, 0.035);
    for (const bx of [L.x0 + 1.4, L.x1 - 1.4]) {
      slab('#F2F2F2', { x0: bx - 0.55, z0: fz - 1.9, x1: bx - 0.5, z1: fz - 0.1 }, 0.04); slab('#F2F2F2', { x0: bx + 0.5, z0: fz - 1.9, x1: bx + 0.55, z1: fz - 0.1 }, 0.04);
      if (rng.chance(0.6)) plan.parked.push({ model: rng.int(0, 5), x: bx, z: fz - 1.0, yaw: 0 });
    }
    P.push({ model: 'roads/dumpster', x: L.x1 - 0.7, z: S1 - 1.0, yaw: Math.PI / 2 });
    for (let x2 = L.x0 + 0.8; x2 < L.x1 - 1.4; x2 += 1.6) P.push({ model: rng.pick(BUSHES), x: x2, z: S1 - 0.5, yaw: x2 });
  }
  lot({ x0: -36.5, z0: S0, x1: -34.6, z1: S1, kind: 'green' });
  lot({ x0: 34.6, z0: S0, x1: 36.5, z1: S1, kind: 'green' });

  // The park, opposite the shops: lawns, a fountain plaza, a duck pond, flower beds, shade trees, benches, lamps.
  const park: Rect = { x0: -25.4, z0: S0, x1: 25.4, z1: 14.0 };
  lot({ ...park, kind: 'park' });
  const PATH = '#D9C49A';
  const f = plan.fountain;
  slab(PATH, { x0: -0.5, z0: park.z0, x1: 0.5, z1: park.z1 + 0.6 }, 0.03); // main walk to the footbridge
  slab(PATH, { x0: park.x0 + 0.6, z0: f.z - 0.45, x1: park.x1 - 0.6, z1: f.z + 0.45 }, 0.03); // cross walk
  slab(PATH, { x0: f.x - 2.4, z0: f.z - 2.4, x1: f.x + 2.4, z1: f.z + 2.4 }, 0.032); // plaza
  { const q = plan.pond; // a stone rim round the pond; the water itself is drawn by the terrain
    slab('#ADAAA4', { x0: q.x0 - 0.3, z0: q.z0 - 0.3, x1: q.x1 + 0.3, z1: q.z0 }, 0.07); slab('#ADAAA4', { x0: q.x0 - 0.3, z0: q.z1, x1: q.x1 + 0.3, z1: q.z1 + 0.3 }, 0.07);
    slab('#ADAAA4', { x0: q.x0 - 0.3, z0: q.z0, x1: q.x0, z1: q.z1 }, 0.07); slab('#ADAAA4', { x0: q.x1, z0: q.z0, x1: q.x1 + 0.3, z1: q.z1 }, 0.07); }
  for (const [bx, bz, yaw] of [[f.x - 2.0, f.z - 2.9, 0], [f.x + 2.0, f.z - 2.9, 0], [f.x - 2.0, f.z + 2.9, Math.PI], [f.x + 2.0, f.z + 2.9, Math.PI], [12, plan.pond.z0 - 1.0, 0], [-14, f.z - 1.1, 0], [-18, f.z + 1.1, Math.PI]] as const) P.push({ model: 'furniture/bench', x: bx, z: bz, yaw });
  P.push({ model: 'furniture/trashcan', x: f.x + 2.9, z: f.z - 2.9, yaw: 0 }, { model: 'furniture/trashcan', x: -0.9, z: park.z0 + 1.2, yaw: 0 });
  // Shade trees along the edges, a ring of flower beds round the plaza, wild corners.
  for (const tx of [-23.5, -19.5, -9.5, 20.5, 23.5]) P.push({ model: rng.pick(['nature/tree-oak', 'nature/tree-default', 'nature/tree-detailed']), x: tx, z: 13.8, yaw: rng.range(0, 6.28), scale: rng.range(1.2, 1.5) });
  for (const [tx, tz] of [[-23.5, 6.2], [23.5, 6.0], [-11, 13.2], [3.5, 13.4], [19.5, 7.2], [-16.5, 6.3]] as const) P.push({ model: rng.pick(['nature/tree-oak', 'nature/tree-default', 'nature/tree-fat']), x: tx, z: tz, yaw: rng.range(0, 6.28), scale: rng.range(1.1, 1.4) });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) > 0.92 || Math.abs(Math.cos(a)) > 0.92) continue; // leave the four walks open
    for (let k = 0; k < 3; k++) plan.scatter.push({ kind: FLOWER_KINDS[(i + k) % FLOWER_KINDS.length]!, x: f.x + Math.cos(a) * (2.8 + k * 0.25), z: f.z + Math.sin(a) * (2.8 + k * 0.25), yaw: a, scale: 1.3 });
  }
  // Two long flower beds on the west lawn.
  for (const bz of [7.0, 12.2]) {
    slab('#8A5A3C', { x0: -22, z0: bz - 0.45, x1: -8, z1: bz + 0.45 }, 0.05);
    for (let x = -21.7; x < -8.2; x += 0.3) for (const dz of [-0.2, 0.2]) plan.scatter.push({ kind: FLOWER_KINDS[Math.floor((x + 30) * 2.3 + (bz > 10 ? 2 : 0)) % FLOWER_KINDS.length]!, x: x + rng.range(-0.05, 0.05), z: bz + dz, yaw: x * 3, scale: 1.4 });
  }
  // Pond life: lilies, reeds, rocks, a canoe on the bank.
  const pd = plan.pond;
  for (let i = 0; i < 9; i++) P.push({ model: rng.pick(['nature/lily-large', 'nature/lily-small']), x: rng.range(pd.x0 + 0.6, pd.x1 - 0.6), y: 0.035, z: rng.range(pd.z0 + 0.6, pd.z1 - 0.6), yaw: rng.range(0, 6.28) });
  for (let x = pd.x0; x < pd.x1; x += 0.9) { P.push({ model: 'nature/plant-flattall', x, z: pd.z1 + 0.55, yaw: x * 2 }); if (rng.chance(0.4)) P.push({ model: 'nature/grass-large', x: x + 0.4, z: pd.z0 - 0.55, yaw: x }); }
  P.push({ model: 'nature/rock-largea', x: pd.x1 + 0.6, z: pd.z0 + 0.4, yaw: 0.4, scale: 0.55 }, { model: 'nature/rock-smallb', x: pd.x0 - 0.5, z: pd.z1 - 0.3, yaw: 1, scale: 1.1 });
  for (let i = 0; i < 5; i++) plan.animals.push({ kind: 'duck', x: (pd.x0 + pd.x1) / 2 + rng.range(-2, 2), z: (pd.z0 + pd.z1) / 2 + rng.range(-1, 1), range: 1.8, y: 0.04 });
  // A café corner with parasols by the cross walk.
  P.push({ model: 'commercial/parasol-a', x: 20.5, z: f.z + 1.6, yaw: 0 }, { model: 'commercial/parasol-b', x: 22.6, z: f.z + 1.6, yaw: 0.5 });

  // ---- Plots without our shop: a vacant lot for sale, or one of our branches.
  for (const p of PLOTS) {
    if (p.id === chosen.id) continue;
    const r = plotLot(p.x), li = plan.lots.findIndex((l) => l.id === p.id);
    slab(PAVEMENT, { x0: r.x0, z0: MAIN_N[0], x1: r.x1, z1: MAIN_N[1] }, 0.06);
    if (branchPlots.includes(p.id)) {
      const o = storeOrigin(p.x);
      P.push({ model: 'commercial/shop-c', x: o.x - 1.35, z: o.z - 2.4, yaw: 0 }, { model: 'commercial/shop-d', x: o.x + 1.3, z: o.z - 2.2, yaw: 0 });
      plan.footprints.push({ x0: o.x - 2.68, x1: o.x - 0.02, z0: o.z - 4.04, z1: o.z - 0.76, lot: li }, { x0: o.x + 0.04, x1: o.x + 2.56, z0: o.z - 3.55, z1: o.z - 0.85, lot: li });
      slab('#6E717C', { x0: o.x - 4.2, z0: o.z - 0.6, x1: o.x + 5.2, z1: MAIN_N[0] }, 0.035);
      plan.parked.push({ model: rng.int(0, 5), x: o.x + 3.6, z: o.z + 0.6, yaw: Math.PI });
      plan.branches.push({ plotId: p.id, x: o.x, z: o.z + 1.2 });
    } else {
      P.push({ model: 'nature/sign', x: r.x0 + 3, z: MAIN_N[0] - 0.8, yaw: 0, scale: 1.6 });
      for (let i = 0; i < 6; i++) P.push({ model: rng.pick(['nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed', 'nature/tree-oak']), x: r.x0 + 2 + rng.range(0, r.x1 - r.x0 - 4), z: r.z0 + 1.5 + rng.range(0, 7), yaw: rng.range(0, 6.28) });
    }
  }
  // Hedges along every plot's sides and back.
  for (const r of plotRects) {
    for (let z = r.z0 + 0.5; z < r.z1 - 1.6; z += 0.75) { P.push({ model: 'nature/plant-bushlarge', x: r.x0 + 0.3, z, yaw: z * 1.7 }); P.push({ model: 'nature/plant-bushlarge', x: r.x1 - 0.3, z, yaw: z * 2.3 }); }
    for (let x = r.x0 + 0.9; x < r.x1 - 0.6; x += 0.75) P.push({ model: 'nature/plant-bushlarge', x, z: r.z0 + 0.3, yaw: x * 1.3 });
  }

  // ---- Street furniture: lamps facing the road, street trees on the south verge.
  const lampAt = (x: number, z: number, yaw: number) => { P.push({ model: 'roads/lamp', x, z, yaw }); plan.lamps.push({ x, z }); };
  for (let x = -44; x <= 44; x += 8) {
    if (!inRect(own, x, MAIN_N[0], 0.6) && !plan.slabs.some((s) => (s.color === '#A9ACB5' || s.color === '#6E717C' || s.color === '#D6D2C8') && x > s.rect.x0 - 0.5 && x < s.rect.x1 + 0.5 && s.rect.z1 > MAIN_N[0] - 0.1 && s.rect.z0 < MAIN_N[1])) lampAt(x, MAIN_N[0] + 0.25, Math.PI);
    const sx = x + 4;
    if (sx < 46 && !plan.slabs.some((s) => (s.color === '#6E717C' || s.color === '#D6D2C8' || s.color === '#A9ACB5') && sx > s.rect.x0 - 0.5 && sx < s.rect.x1 + 0.5 && s.rect.z0 < MAIN_S[1] + 0.1 && s.rect.z1 > MAIN_S[1] - 0.1)) lampAt(sx, MAIN_S[1] - 0.25, 0);
  }
  lampAt(own.x0 + 0.35, MAIN_N[0] + 0.25, Math.PI); lampAt(own.x1 - 0.35, MAIN_N[0] + 0.25, Math.PI);
  for (const [x, z] of [[f.x, f.z - 3.4], [f.x, f.z + 3.4], [-0.9, park.z1 - 0.6], [10, f.z - 0.9]] as const) lampAt(x, z, 0);

  // ---- The creek along the foot of the south cliff, a footbridge from the park, a waterfall at the west end.
  plan.footbridges.push({ x: 0, z0: riverZ(0) - RIVER_HALF_W - 0.9, z1: riverZ(0) + RIVER_HALF_W + 0.9 });
  const pathZ = (x: number) => riverZ(x) - RIVER_HALF_W - 1.5;
  for (let x = -46; x < 46; x += 1.6) {
    if (Math.abs(x + 0.8) < 1.2) continue;
    slab(PATH, { x0: x, z0: pathZ(x + 0.8) - 0.32, x1: x + 1.7, z1: pathZ(x + 0.8) + 0.32 }, 0.02);
  }
  for (const x of [-30, -12, 14, 32]) P.push({ model: 'furniture/bench', x, z: pathZ(x) + 0.7, yaw: 0 });
  for (let x = -47; x < 47; x += 1.1) {
    const rz = riverZ(x), r = hash2(Math.round(x * 10), 7);
    if (Math.abs(x) < 1.6) continue;
    if (r < 0.3) P.push({ model: r < 0.15 ? 'nature/grass-large' : 'nature/plant-flattall', x, z: rz + (r < 0.08 || r > 0.22 ? -1 : 1) * (RIVER_HALF_W + 0.45), yaw: r * 40 });
    else if (r < 0.37) P.push({ model: rng.pick(ROCKS), x, y: -0.22, z: rz + (r < 0.34 ? -1 : 1) * (RIVER_HALF_W - 0.2), yaw: r * 30, scale: 0.42 });
    else if (r < 0.43) P.push({ model: rng.pick(['nature/lily-large', 'nature/lily-small']), x, y: -0.115, z: rz + (r < 0.4 ? -1 : 1) * (RIVER_HALF_W - 0.45), yaw: r * 50 });
    else if (r > 0.9) P.push({ model: rng.pick(['nature/tree-default', 'nature/tree-tall', 'nature/tree-oak']), x, z: rz + RIVER_HALF_W + 1.4, yaw: r * 20, scale: 1.25 });
  }
  for (const x of [-26, 22]) for (let i = 0; i < 3; i++) plan.animals.push({ kind: 'duck', x: x + i * 1.2, z: riverZ(x + i * 1.2), range: 2.5, y: -0.11 });
  P.push({ model: 'nature/canoe', x: 24, y: 0.01, z: pathZ(24) + 0.5, yaw: 1.5 });

  // ---- The orchard meadow behind the plots, under the north cliff.
  for (let x = -44; x <= 44; x += 4.4) for (const z of [-15.6, -18.2]) {
    if (rng.chance(0.25)) continue;
    P.push({ model: rng.pick(['nature/tree-oak', 'nature/tree-default', 'nature/tree-fat', 'nature/tree-detailed']), x: x + rng.range(-0.6, 0.6), z: z + rng.range(-0.4, 0.4), yaw: rng.range(0, 6.28), scale: rng.range(0.95, 1.25) });
  }
  for (let i = 0; i < 14; i++) P.push({ model: rng.pick(['nature/mushroom-red', 'nature/mushroom-tangroup', 'nature/stump-old', 'nature/log', 'nature/rock-smalla']), x: rng.range(-46, 46), z: rng.range(-19, -14), yaw: rng.range(0, 6.28) });
  for (const [x, z] of [[-38, -16.5], [-8, -17], [16, -16], [40, -17.5]] as const) plan.animals.push({ kind: 'deer', x, z, range: 3.5 });
  for (const [x, z] of [[-24, -15], [6, -18], [30, -15.5], [-42, 16], [38, 15.5], [-16, 15.8]] as const) plan.animals.push({ kind: 'rabbit', x, z, range: 2.5 });
  for (const [x, z] of [[-15, 9.6], [-4, 12.5], [-40, -2], [41, -3], [12, -17]] as const) plan.animals.push({ kind: 'butterfly', x, z, range: 2.2 });
  for (const [x, z] of [[-6, 6], [10, -10], [30, 10]] as const) plan.animals.push({ kind: 'bird', x, z, range: 14, y: 9 });
  for (const [x, z] of [[-19.5, 13.8], [20.5, 13.8]] as const) plan.animals.push({ kind: 'squirrel', x, z, range: 1.6 });

  // ---- Grass and wild flowers on every lawn of the pocket.
  const blocked = (x: number, z: number): boolean => {
    if (Math.abs(z - ROAD_Z) < 1.75) return true;
    if (inRect(own, x, z, 0.2)) return true;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF_W + 0.25) return true;
    if (inRect(pd, x, z, 0.4)) return true;
    for (const fp of plan.footprints) if (inRect(fp, x, z, 0.25)) return true;
    for (const s of plan.slabs) if (inRect(s.rect, x, z, 0.08)) return true;
    return false;
  };
  const grng = new Rng(seed ^ 0x9a55);
  for (let gz = BASIN.zN + 0.3; gz < BASIN.zS - 0.2; gz += 0.62) for (let gx = -BASIN.x + 0.3; gx < BASIN.x - 0.3; gx += 0.62) {
    const x = gx + grng.range(-0.28, 0.28), z = gz + grng.range(-0.28, 0.28);
    if (blocked(x, z)) continue;
    // The plots nobody has built on yet have gone to wildflowers.
    const wild = plotRects.some((r) => !inRect(own, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) && inRect(r, x, z, -0.8));
    const meadow = wild || z < back - 0.5 || z > S1 + 2.2;
    const n = vnoise(x / 3.5, z / 3.5);
    if (wild && n > 0.4 && grng.chance(0.6)) plan.scatter.push({ kind: FLOWER_KINDS[Math.floor(vnoise(x / 4 + 3, z / 4) * 5) % 5]!, x, z, yaw: grng.range(0, 6.28), scale: grng.range(1.3, 2.0) });
    else if (meadow && n > 0.62 && grng.chance(0.55)) plan.scatter.push({ kind: FLOWER_KINDS[Math.floor(vnoise(x / 6 + 9, z / 6) * 5) % 5]!, x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.9, 1.3) });
    else if (grng.chance(meadow ? 0.95 : 0.55)) plan.scatter.push({ kind: 'grass', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.7, meadow ? 1.6 : 1.1) });
    else if (grng.chance(0.03)) plan.scatter.push({ kind: 'pebble', x, z, yaw: grng.range(0, 6.28), scale: grng.range(0.6, 1.2) });
  }

  // ---- Woods on the cliff tops all round, the far range bare above the tree line.
  const trng = new Rng(0x5eed);
  for (let gz = -110; gz < 90; gz += 2.4) for (let gx = -130; gx < 130; gx += 2.4) {
    const x = gx + trng.range(-1, 1), z = gz + trng.range(-1, 1);
    const o = outsideBasin(x, z);
    // Clear of the cliff edge, the tunnel mouths, and the stream running off the west plateau.
    if (o < 2.6 || (Math.abs(z - ROAD_Z) < 4 && Math.abs(x) < W + 4) || (x < -BASIN.x && x > -92 && Math.abs(z - riverZ(x)) < 2.4)) { trng.next(); continue; }
    const h = groundHeight(x, z);
    if (h > 24 || Math.hypot(x / 1.3, z) > 125) continue;
    const near = o < 22;
    if (!trng.chance(near ? 0.82 : 0.35)) continue;
    const pine = trng.chance(near ? 0.55 : 0.9);
    plan.forest.push({ model: pine ? trng.pick(PINES) : trng.pick(WOODLAND), x, y: h - 0.05, z, yaw: trng.range(0, 6.28), scale: (near ? 1.3 : 2.2) * trng.range(0.8, 1.25) });
  }
  // Boulders at the foot of the cliffs.
  for (let i = 0; i < 70; i++) {
    const side = trng.int(0, 3);
    const x = side < 2 ? trng.range(-BASIN.x, BASIN.x) : (side === 2 ? -1 : 1) * (BASIN.x - trng.range(0.2, 0.9));
    const z = side === 0 ? BASIN.zN + trng.range(0.2, 0.9) : side === 1 ? BASIN.zS - trng.range(0.1, 0.4) : trng.range(BASIN.zN, BASIN.zS);
    if (Math.abs(z - ROAD_Z) < 5 || Math.abs(z - riverZ(x)) < RIVER_HALF_W + 0.8) continue;
    P.push({ model: trng.chance(0.3) ? trng.pick(['nature/rock-talla', 'nature/rock-tallb']) : trng.pick(ROCKS), x, z, yaw: trng.range(0, 6.28), scale: trng.range(0.8, 1.6) });
  }
  return plan;
}
