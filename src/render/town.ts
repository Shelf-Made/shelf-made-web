/**
 * The town plan: where every static thing in the valley stands, generated deterministically from
 * the seed and the chosen plot. Pure data, so tests can check that nothing overlaps and the
 * renderer only has to draw it.
 *
 * The valley runs east–west. Main Street crosses it with the three shop plots on its north side;
 * Back Lane runs behind them. Two cross streets join the roads; to the south they cross the river
 * on stone bridges into farmland. Mountains close the valley to the north, wooded hills to the
 * east, west and south.
 *
 * Every building sits on a Lot (a property rectangle). Lots never overlap, and every house fits
 * inside its own lot with room for a front garden, so nothing steps on a neighbour or the shop.
 */
import { Rng } from '@/sim/rng';
import { PLOTS, ROAD_Z, CROSS_XS, BACK_Z, ROAD_FAR, RIVER_HALF_W, riverZ, PLOT_RECT, storeOrigin } from '@/sim/layout';

export interface Placement { model: string; x: number; y?: number; z: number; yaw: number; scale?: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface RivalSite { id: string; name: string; x: number; z: number; kind: 'discount' | 'premium' | 'chain' }
export type LotKind = 'house' | 'plot' | 'rival' | 'park' | 'green';
export interface Lot extends Rect { kind: LotKind; id?: string }

export interface TownPlan {
  /** Merged into the static mesh. */
  placements: Placement[];
  /** Forest trees: drawn instanced in chunks so far woods cost little. */
  forest: Placement[];
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
  /** Bridges where the cross streets cross the river. */
  bridges: { x: number; z0: number; z1: number }[];
  /** Farm fields south of the river. */
  fields: (Rect & { crop: 'wheat' | 'veg' | 'soil' })[];
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
/** Low-poly picks only: the woods hold thousands of these. */
const PINES = ['nature/tree-pinetalla', 'nature/tree-pinetallb', 'nature/tree-pinetallc', 'nature/tree-pinetalld', 'nature/tree-pinesmallc', 'nature/tree-pinetallc'];
const WOODLAND = ['nature/tree-default', 'nature/tree-tall', 'nature/tree-default-dark', 'nature/tree-tall-dark', 'nature/tree-fat'];
const ROCKS = ['nature/rock-largea', 'nature/rock-largeb', 'nature/rock-largec', 'nature/rock-larged', 'nature/rock-largee', 'nature/rock-largef'];

/** Every model the town can place, whatever the seed (loaded up front). */
export const TOWN_MODEL_IDS: string[] = [...new Set([
  ...Object.keys(HOUSE_SIZE).map((l) => `suburban/house-${l}`), ...Object.keys(SHOP_SIZE).map((l) => `commercial/shop-${l}`),
  ...GARDEN_TREES, ...STREET_TREES, ...BUSHES, ...FLOWERS, ...PINES, ...WOODLAND, ...ROCKS,
  'roads/road-straight', 'roads/road-crossroad', 'roads/road-intersection', 'roads/road-crossing', 'roads/lamp', 'roads/sign-street', 'roads/electricity-pole', 'roads/dumpster',
  'suburban/fence', 'nature/fence-simple', 'nature/sign', 'nature/lily-large', 'nature/lily-small', 'nature/canoe', 'nature/log', 'nature/log-large', 'nature/log-stack', 'nature/stump-old', 'nature/stump-round',
  'nature/grass', 'nature/grass-large', 'nature/grass-leafslarge', 'nature/plant-flattall', 'nature/crop-pumpkin', 'nature/crop-carrot', 'nature/tent-detailedopen', 'nature/campfire-stones',
  'nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed', 'furniture/bench', 'furniture/trashcan', 'commercial/shop-c', 'commercial/shop-d',
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
export const MAIN_S: [number, number] = [ROAD_Z + 0.95, ROAD_Z + 1.55];
export const BACK_N: [number, number] = [BACK_Z - 1.55, BACK_Z - 0.95];
export const BACK_S: [number, number] = [BACK_Z + 0.95, BACK_Z + 1.55];
/** Edge of the flat valley floor; the land rises beyond. */
export const BASIN = { x: 66, zN: -40, zS: 52 };
export const PAVEMENT = '#C9CBD1';

/** The rectangle a shop plot owns in world space. */
export function plotLot(plotX: number): Rect {
  const o = storeOrigin(plotX);
  return { x0: o.x + PLOT_RECT.x0, z0: o.z + PLOT_RECT.z0, x1: o.x + PLOT_RECT.x1, z1: o.z + PLOT_RECT.z1 };
}

// ---- Terrain: flat in the valley, mountains to the north, hills elsewhere. Seed-independent: it is the same valley every game.
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

/** Height of the land (before the river cuts its channel). Exactly 0 on the valley floor. */
export function groundHeight(x: number, z: number): number {
  const north = Math.max(0, BASIN.zN - z), south = Math.max(0, z - BASIN.zS), side = Math.max(0, Math.abs(x) - BASIN.x);
  if (north === 0 && south === 0 && side === 0) return 0;
  let h = 0;
  if (north > 0) {
    // Wooded foothills first, then the range itself further back.
    const ridge = 1 - Math.abs(vnoise(x / 19 + 40, z / 19) * 2 - 1);
    h = Math.max(h, north * 0.2 + fbm(x / 20, z / 20) * 6 * smooth(0, 14, north) + smooth(16, 52, north) * (12 + ridge * ridge * 16 + fbm(x / 30 + 9, z / 30) * 10));
  }
  if (south > 0) h = Math.max(h, south * 0.17 + fbm(x / 28 + 7, z / 28) * 7 * smooth(0, 18, south));
  if (side > 0) h = Math.max(h, side * 0.32 + fbm(x / 22 + 3, z / 22 + 5) * 10 * smooth(0, 16, side));
  // Roads and the river keep a level floor through the hills.
  const cross = z > 0 ? Math.min(Math.abs(x - CROSS_XS[0]), Math.abs(x - CROSS_XS[1])) : Infinity;
  const level = Math.min(Math.abs(z - ROAD_Z), Math.abs(z - BACK_Z), cross, Math.abs(z - riverZ(x)) - RIVER_HALF_W);
  return h * smooth(4.5, 18, level);
}

/** Inside a rectangle, with a margin. */
function inRect(r: Rect, x: number, z: number, m = 0): boolean { return x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m; }
function overlaps(a: Rect, b: Rect): boolean { return a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6; }
export { overlaps as rectsOverlap };

export function buildTown(seed: number, plotId: string, branchPlots: string[] = []): TownPlan {
  const rng = new Rng(seed ^ 0x7a77);
  const plan: TownPlan = { placements: [], forest: [], slabs: [], rivals: [], lamps: [], parked: [], branches: [], lots: [], footprints: [], bridges: [], fields: [] };
  const P = plan.placements;
  const chosen = PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!;
  const [WX, EX] = CROSS_XS;
  const slab = (color: string, rect: Rect, h = 0.04, y = 0) => plan.slabs.push({ color, rect, y, h });
  const lot = (l: Lot): number => { plan.lots.push(l); return plan.lots.length - 1; };

  // ---- Roads. Tile centres sit on odd x so both cross streets land on whole tiles.
  const FAR = ROAD_FAR + 8;
  const tileXs: number[] = [];
  for (let x = WX - 2 * Math.ceil((FAR + WX) / 2); x <= FAR; x += 2) tileXs.push(x);
  for (const x of tileXs) {
    const cross = CROSS_XS.some((cx) => cx === x);
    P.push({ model: cross ? 'roads/road-crossroad' : 'roads/road-straight', x, y: 0.001, z: ROAD_Z, yaw: 0 });
    P.push({ model: cross ? 'roads/road-intersection' : 'roads/road-straight', x, y: 0.001, z: BACK_Z, yaw: cross ? Math.PI : 0 });
  }
  // Zebra crossings beside each Main Street junction.
  for (const cx of CROSS_XS) { const i = P.findIndex((p) => p.x === cx - 2 && p.z === ROAD_Z); if (i >= 0) P[i] = { ...P[i]!, model: 'roads/road-crossing', yaw: Math.PI / 2 }; }
  for (const cx of CROSS_XS) {
    // North: Main Street up to Back Lane (11 whole tiles).
    for (let z = ROAD_Z - 2; z > BACK_Z + 1; z -= 2) P.push({ model: 'roads/road-straight', x: cx, y: 0.001, z, yaw: Math.PI / 2 });
    // South: over the river and away into the farmland.
    for (let z = ROAD_Z + 2; z <= FAR; z += 2) P.push({ model: 'roads/road-straight', x: cx, y: 0.001, z, yaw: Math.PI / 2 });
  }
  // Sidewalks with kerbs, broken at junctions. The chosen plot draws its own frontage (with its driveway cuts).
  const own = plotLot(chosen.x);
  const runX = (z: [number, number], x0: number, x1: number, skipOwn: boolean) => {
    const cuts: [number, number][] = CROSS_XS.map((cx) => [cx - 0.95, cx + 0.95]);
    if (skipOwn) cuts.push([own.x0, own.x1]);
    cuts.sort((a, b) => a[0] - b[0]);
    let s = x0;
    for (const [c0, c1] of cuts) { if (c1 <= s || c0 >= x1) continue; if (c0 > s) slab(PAVEMENT, { x0: s, z0: z[0], x1: c0, z1: z[1] }, 0.06); s = Math.max(s, c1); }
    if (s < x1) slab(PAVEMENT, { x0: s, z0: z[0], x1, z1: z[1] }, 0.06);
  };
  runX(MAIN_N, -FAR, FAR, true); runX(MAIN_S, -FAR, FAR, false); runX(BACK_N, -FAR, FAR, false); runX(BACK_S, -FAR, FAR, false);
  for (const cx of CROSS_XS) {
    for (const sx of [cx - 1.55, cx + 0.95]) {
      slab(PAVEMENT, { x0: sx, z0: BACK_S[1], x1: sx + SIDEWALK_W, z1: MAIN_N[0] }, 0.06);
      slab(PAVEMENT, { x0: sx, z0: MAIN_S[1], x1: sx + SIDEWALK_W, z1: FAR }, 0.06);
    }
    // Corner squares where the sidewalks meet.
    for (const [z0, z1] of [MAIN_N, MAIN_S, BACK_S]) for (const sx of [cx - 1.55, cx + 0.95]) slab(PAVEMENT, { x0: sx, z0, x1: sx + SIDEWALK_W, z1 }, 0.06);
  }

  // ---- Lots. North of Main Street: the three shop plots and the hedges between them.
  for (const p of PLOTS) lot({ ...plotLot(p.x), kind: 'plot', id: p.id });
  const plotRects = PLOTS.map((p) => plotLot(p.x)).sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < plotRects.length - 1; i++) lot({ x0: plotRects[i]!.x1, z0: plotRects[i]!.z0, x1: plotRects[i + 1]!.x0, z1: MAIN_N[0], kind: 'green' });
  const westEdge = WX + 1.55, eastEdge = EX - 1.55;
  lot({ x0: westEdge, z0: plotRects[0]!.z0, x1: plotRects[0]!.x0, z1: MAIN_N[0], kind: 'green' });
  lot({ x0: plotRects[plotRects.length - 1]!.x1, z0: plotRects[0]!.z0, x1: eastEdge, z1: MAIN_N[0], kind: 'green' });

  // Houses: each picks a model that fits its lot and stands behind a front garden.
  const houseIn = (L: Rect, facing: 'N' | 'S', opts: { drive?: boolean; maxDepth?: number } = {}) => {
    const li = lot({ ...L, kind: 'house' });
    const w = L.x1 - L.x0, deep = L.z1 - L.z0;
    const front = facing === 'S' ? L.z1 : L.z0;
    const sign = facing === 'S' ? -1 : 1; // from the front, into the lot
    const yard = 1.7;
    const drive = opts.drive !== false && w >= 7.4;
    const fitsW = w - (drive ? 2.3 : 0.9);
    const fitsD = Math.min(opts.maxDepth ?? 99, deep - yard - 0.6);
    const options = Object.entries(HOUSE_SIZE).filter(([, [hw, hd]]) => hw <= fitsW && hd <= fitsD);
    if (!options.length) return;
    const [letter, [hw, hd]] = options[rng.int(0, options.length - 1)]!;
    const cx = drive ? L.x0 + 0.45 + hw / 2 + (fitsW - hw) * 0.5 : (L.x0 + L.x1) / 2;
    const cz = front + sign * (yard + hd / 2);
    P.push({ model: `suburban/house-${letter}`, x: cx, z: cz, yaw: facing === 'S' ? 0 : Math.PI });
    plan.footprints.push({ x0: cx - hw / 2, x1: cx + hw / 2, z0: cz - hd / 2, z1: cz + hd / 2, lot: li });
    // Garden path from the door to the sidewalk.
    const doorZ = front + sign * yard;
    slab('#D6D2C8', { x0: cx - 0.33, z0: Math.min(front, doorZ), x1: cx + 0.33, z1: Math.max(front, doorZ) }, 0.035);
    let dx = 0;
    if (drive) {
      dx = Math.min(L.x1 - 0.85, cx + hw / 2 + 0.95);
      const dEnd = front + sign * (yard + hd * 0.8);
      slab('#A9ACB5', { x0: dx - 0.62, z0: Math.min(front, dEnd), x1: dx + 0.62, z1: Math.max(front, dEnd) }, 0.035);
      if (rng.chance(0.55)) plan.parked.push({ model: rng.int(0, 5), x: dx, z: front + sign * (yard + 0.4), yaw: facing === 'S' ? Math.PI : 0 });
    }
    // Low rail fence along the front property line (Kenney fence pieces run along x at yaw 0), with gaps for the path and drive.
    const fz = front + sign * 0.18;
    for (let x = L.x0 + 0.72; x <= L.x1 - 0.68; x += 1.4) {
      if (Math.abs(x - cx) < 1.15) continue;
      if (drive && Math.abs(x - dx) < 1.35) continue;
      P.push({ model: 'nature/fence-simple', x, z: fz, yaw: 0 });
    }
    // Garden: a tree at the back, bushes under the windows, flowers along the path.
    const back = L.z0 + L.z1 - front;
    P.push({ model: rng.pick(GARDEN_TREES), x: L.x0 + 1.0 + rng.range(0, Math.max(0, w - 2)), z: back + (facing === 'S' ? 1.0 : -1.0), yaw: rng.range(0, 6.28), scale: rng.range(0.85, 1.15) });
    for (let i = 0; i < 3; i++) P.push({ model: rng.pick(BUSHES), x: cx - hw / 2 + 0.4 + i * (hw - 0.8) / 2, z: front + sign * (yard - 0.45), yaw: rng.range(0, 6.28) });
    for (let i = 0; i < 4; i++) P.push({ model: rng.pick(FLOWERS), x: cx + (i % 2 ? 0.6 : -0.6), z: front + sign * (0.55 + Math.floor(i / 2) * 0.45), yaw: 0 });
  };
  /** Split [x0, x1] into n equal lots. */
  const strip = (x0: number, x1: number, n: number, z0: number, z1: number, facing: 'N' | 'S', opts?: { maxDepth?: number; drive?: boolean }) => {
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) houseIn({ x0: x0 + i * w, x1: x0 + (i + 1) * w, z0, z1 }, facing, opts);
  };
  const behindPlots = plotRects[0]!.z0; // -13.2
  // North side of Main Street, beyond the cross streets.
  strip(-62.05, WX - 1.55, 3, behindPlots, MAIN_N[0], 'S');
  strip(EX + 1.55, 66.05, 3, behindPlots, MAIN_N[0], 'S');
  // Back Lane, south side: small houses whose back gardens meet the shop plots.
  strip(westEdge, eastEdge, 8, BACK_S[1], behindPlots, 'N', { maxDepth: 3.5 });
  strip(-62.05, WX - 1.55, 3, BACK_S[1], behindPlots, 'N', { maxDepth: 3.5 });
  strip(EX + 1.55, 66.05, 3, BACK_S[1], behindPlots, 'N', { maxDepth: 3.5 });
  // Back Lane, north side: the last row before the woods.
  strip(-62.05, 66.05, 15, -29.6, BACK_N[0], 'S');
  // Back fences between the Back Lane gardens and the shop plots (the property line), panels along x.
  for (let x = westEdge + 0.72; x < eastEdge - 0.7; x += 1.43) P.push({ model: 'suburban/fence', x, z: behindPlots - 0.15, yaw: 0 });

  // South of Main Street: rivals, houses and the park.
  const S0 = MAIN_S[1], S1 = 13.0;
  const rivalLots: Record<RivalSite['kind'], Rect> = {
    discount: { x0: -24.6, z0: S0, x1: -15.4, z1: S1 }, premium: { x0: 15.4, z0: S0, x1: 24.6, z1: S1 }, chain: { x0: 41.4, z0: S0, x1: 50.6, z1: S1 },
  };
  for (const r of RIVAL_DEFS) {
    const L = rivalLots[r.kind];
    const li = lot({ ...L, kind: 'rival', id: r.id });
    const x = (L.x0 + L.x1) / 2;
    const letters = Object.keys(SHOP_SIZE);
    const a = letters[rng.int(0, letters.length - 1)]!, b = letters[rng.int(0, letters.length - 1)]!;
    const [aw, ad] = SHOP_SIZE[a]!, [bw, bd] = SHOP_SIZE[b]!;
    const fz = S0 + 3.2; // forecourt depth
    const az = fz + ad / 2, bz = fz + bd / 2;
    P.push({ model: `commercial/shop-${a}`, x: x - aw / 2 - 0.02, z: az, yaw: Math.PI });
    P.push({ model: `commercial/shop-${b}`, x: x + bw / 2 + 0.02, z: bz, yaw: Math.PI });
    plan.footprints.push({ x0: x - aw - 0.02, x1: x - 0.02, z0: az - ad / 2, z1: az + ad / 2, lot: li }, { x0: x + 0.02, x1: x + bw + 0.02, z0: bz - bd / 2, z1: bz + bd / 2, lot: li });
    plan.rivals.push({ ...r, x, z: fz + 1.4 });
    // Forecourt with two painted bays.
    slab('#6E717C', { x0: L.x0 + 0.4, z0: S0, x1: L.x1 - 0.4, z1: fz }, 0.035);
    for (const bx of [L.x0 + 1.4, L.x1 - 1.4]) {
      slab('#F2F2F2', { x0: bx - 0.55, z0: fz - 1.9, x1: bx - 0.5, z1: fz - 0.1 }, 0.04); slab('#F2F2F2', { x0: bx + 0.5, z0: fz - 1.9, x1: bx + 0.55, z1: fz - 0.1 }, 0.04);
      if (rng.chance(0.6)) plan.parked.push({ model: rng.int(0, 5), x: bx, z: fz - 1.0, yaw: 0 });
    }
    P.push({ model: 'roads/dumpster', x: L.x1 - 0.7, z: S1 - 1.0, yaw: Math.PI / 2 });
  }
  houseIn({ x0: -33.45, x1: -24.6, z0: S0, z1: S1 }, 'N');
  strip(-15.4, 15.4, 4, S0, S1, 'N');
  strip(-62.05, WX - 1.55, 3, S0, S1, 'N');
  houseIn({ x0: 50.6, x1: 58.3, z0: S0, z1: S1 }, 'N');
  houseIn({ x0: 58.3, x1: 66.05, z0: S0, z1: S1 }, 'N');
  lot({ x0: EX + 1.55, z0: S0, x1: 41.4, z1: S1, kind: 'green' });

  // The park opposite East End: lawns, a pond, paths, benches, trees.
  const park: Rect = { x0: 24.6, z0: S0, x1: eastEdge, z1: S1 };
  lot({ ...park, kind: 'park' });
  const pcx = (park.x0 + park.x1) / 2, pcz = (park.z0 + park.z1) / 2;
  slab('#D2B48C', { x0: pcx - 0.4, z0: park.z0, x1: pcx + 0.4, z1: park.z1 }, 0.03);
  slab('#D2B48C', { x0: park.x0 + 0.5, z0: pcz - 0.4, x1: park.x1, z1: pcz + 0.4 }, 0.03);
  slab('#ADAAA4', { x0: pcx + 1.6, z0: pcz + 1.0, x1: pcx + 5.2, z1: pcz + 3.6 }, 0.05);
  slab('#5AAFD8', { x0: pcx + 1.8, z0: pcz + 1.2, x1: pcx + 5.0, z1: pcz + 3.4 }, 0.06);
  P.push({ model: 'nature/lily-large', x: pcx + 3.0, y: 0.06, z: pcz + 2.1, yaw: 0.5 }, { model: 'nature/lily-small', x: pcx + 4.1, y: 0.06, z: pcz + 2.8, yaw: 1.2 });
  for (const [bx, bz, yaw] of [[pcx - 1.2, pcz - 1.0, 0], [pcx + 1.2, pcz - 1.0, 0], [pcx - 1.0, pcz + 1.5, Math.PI / 2]] as const) P.push({ model: 'furniture/bench', x: bx, z: bz, yaw });
  for (const [tx, tz] of [[park.x0 + 1.2, park.z0 + 1.4], [park.x0 + 1.4, park.z1 - 1.2], [park.x1 - 1.2, park.z0 + 1.3], [pcx - 3.4, pcz + 2.6], [pcx - 2.0, park.z1 - 1.0], [park.x1 - 1.0, park.z1 - 1.1]] as const) P.push({ model: rng.pick(['nature/tree-oak', 'nature/tree-default', 'nature/tree-detailed']), x: tx, z: tz, yaw: rng.range(0, 6.28), scale: rng.range(1.0, 1.3) });
  for (let i = 0; i < 10; i++) P.push({ model: rng.pick(FLOWERS), x: pcx - 4.5 + (i % 5) * 0.5, z: pcz - 2.6 + Math.floor(i / 5) * 0.5, yaw: 0 });

  // Hedge rows along the plot boundaries (sides and back), so each property reads clearly.
  for (const r of plotRects) {
    for (let z = r.z0 + 0.5; z < r.z1 - 1.6; z += 0.75) { P.push({ model: 'nature/plant-bushlarge', x: r.x0 + 0.3, z, yaw: z * 1.7 }); P.push({ model: 'nature/plant-bushlarge', x: r.x1 - 0.3, z, yaw: z * 2.3 }); }
    for (let x = r.x0 + 0.9; x < r.x1 - 0.6; x += 0.75) P.push({ model: 'nature/plant-bushlarge', x, z: r.z0 + 0.3, yaw: x * 1.3 });
  }
  // Pocket greens: a tree and some bushes.
  for (const g of plan.lots.filter((l) => l.kind === 'green')) {
    const w = g.x1 - g.x0;
    if (w >= 2) for (let z = g.z0 + 2; z < g.z1 - 1.2; z += 3.5) P.push({ model: rng.pick(GARDEN_TREES), x: (g.x0 + g.x1) / 2, z, yaw: rng.range(0, 6.28), scale: 0.9 });
    else for (let z = g.z0 + 0.6; z < g.z1 - 0.8; z += 0.8) P.push({ model: 'nature/plant-bush', x: (g.x0 + g.x1) / 2, z, yaw: z });
  }

  // Plots without our shop: a vacant lot for sale, or one of our branches.
  for (const p of PLOTS) {
    if (p.id === chosen.id) continue;
    const r = plotLot(p.x), li = plan.lots.findIndex((l) => l.id === p.id);
    slab(PAVEMENT, { x0: r.x0, z0: MAIN_N[0], x1: r.x1, z1: MAIN_N[1] }, 0.06);
    if (branchPlots.includes(p.id)) {
      const o = storeOrigin(p.x);
      P.push({ model: 'commercial/shop-c', x: o.x - 1.35, z: o.z - 2.4, yaw: 0 });
      P.push({ model: 'commercial/shop-d', x: o.x + 1.3, z: o.z - 2.2, yaw: 0 });
      plan.footprints.push({ x0: o.x - 2.68, x1: o.x - 0.02, z0: o.z - 4.04, z1: o.z - 0.76, lot: li }, { x0: o.x + 0.04, x1: o.x + 2.56, z0: o.z - 3.55, z1: o.z - 0.85, lot: li });
      slab('#6E717C', { x0: o.x - 4.2, z0: o.z - 0.6, x1: o.x + 5.2, z1: MAIN_N[0] }, 0.035);
      plan.parked.push({ model: rng.int(0, 5), x: o.x + 3.6, z: o.z + 0.6, yaw: Math.PI });
      plan.branches.push({ plotId: p.id, x: o.x, z: o.z + 1.2 });
    } else {
      P.push({ model: 'nature/sign', x: r.x0 + 3, z: MAIN_N[0] - 0.8, yaw: 0, scale: 1.6 });
      for (let i = 0; i < 5; i++) P.push({ model: rng.pick(['nature/tree-small', 'nature/tree-simple', 'nature/plant-bushdetailed']), x: r.x0 + 2 + rng.range(0, r.x1 - r.x0 - 4), z: r.z0 + 1.5 + rng.range(0, 6), yaw: rng.range(0, 6.28) });
      for (let i = 0; i < 14; i++) P.push({ model: rng.pick(['nature/grass-large', 'nature/grass', 'nature/flower-yellowb']), x: r.x0 + 1 + rng.range(0, r.x1 - r.x0 - 2), z: r.z0 + 1 + rng.range(0, r.z1 - r.z0 - 3), yaw: rng.range(0, 6.28) });
    }
  }

  // ---- Street furniture: lamps facing the road, street trees in front gardens, signs at junctions.
  const lampAt = (x: number, z: number, yaw: number) => { P.push({ model: 'roads/lamp', x, z, yaw }); plan.lamps.push({ x, z }); };
  const clearOfDrives = (x: number) => !plan.slabs.some((s) => (s.color === '#A9ACB5' || s.color === '#6E717C' || s.color === '#D6D2C8') && x > s.rect.x0 - 0.5 && x < s.rect.x1 + 0.5 && s.rect.z1 > MAIN_N[0] - 0.1 && s.rect.z0 < MAIN_S[1] + 0.1);
  for (let x = -62; x <= 66; x += 9) {
    if (CROSS_XS.some((cx) => Math.abs(x - cx) < 2.5)) continue;
    if (!inRect(own, x, MAIN_N[0], 0.5) && clearOfDrives(x)) lampAt(x, MAIN_N[0] + 0.25, Math.PI);
    if (clearOfDrives(x + 4.5)) lampAt(x + 4.5, MAIN_S[1] - 0.25, 0);
  }
  // The shop's own frontage gets two lamps either side of the plot.
  lampAt(own.x0 + 0.35, MAIN_N[0] + 0.25, Math.PI); lampAt(own.x1 - 0.35, MAIN_N[0] + 0.25, Math.PI);
  for (let x = -60; x <= 64; x += 12) { if (!CROSS_XS.some((cx) => Math.abs(x - cx) < 2.5)) lampAt(x, BACK_S[1] - 0.25, Math.PI); }
  for (const cx of CROSS_XS) {
    for (let z = MAIN_S[1] + 4; z < 48; z += 10) if (Math.abs(z - riverZ(cx)) > RIVER_HALF_W + 2) lampAt(cx + 1.3, z, -Math.PI / 2);
    for (let z = BACK_S[1] + 3; z < MAIN_N[0] - 2; z += 8) lampAt(cx - 1.3, z, Math.PI / 2);
    P.push({ model: 'roads/sign-street', x: cx + 1.3, z: MAIN_N[0] + 0.3, yaw: 0 }, { model: 'roads/sign-street', x: cx - 1.3, z: MAIN_S[1] - 0.3, yaw: Math.PI });
  }
  // Power poles along Back Lane, on the north verge.
  for (let x = -58; x <= 62; x += 10) P.push({ model: 'roads/electricity-pole', x, z: BACK_N[0] - 0.35, yaw: 0 });

  // ---- The river and its banks. Bridges carry the cross streets.
  for (const cx of CROSS_XS) {
    const rz = riverZ(cx);
    plan.bridges.push({ x: cx, z0: rz - RIVER_HALF_W - 1.4, z1: rz + RIVER_HALF_W + 1.4 });
  }
  // Riverside path along the north bank, with benches looking at the water.
  const pathZ = (x: number) => riverZ(x) - RIVER_HALF_W - 2.6;
  for (let x = -62; x < 66; x += 2) {
    if (CROSS_XS.some((cx) => Math.abs(x + 1 - cx) < 2.6)) continue;
    const z = pathZ(x + 1);
    slab('#D2B48C', { x0: x, z0: z - 0.35, x1: x + 2.05, z1: z + 0.35 }, 0.02);
  }
  for (let x = -55; x < 62; x += 13) if (!CROSS_XS.some((cx) => Math.abs(x - cx) < 4)) P.push({ model: 'furniture/bench', x, z: pathZ(x) + 0.75, yaw: 0 });
  // Willows and reeds on the banks, boulders and lily pads in the water.
  for (let x = -90; x < 92; x += 1.7) {
    const rz = riverZ(x);
    if (CROSS_XS.some((cx) => Math.abs(x - cx) < 3.2)) continue;
    const r = hash2(Math.round(x * 10), 7);
    if (r < 0.32) P.push({ model: rng.pick(['nature/grass-large', 'nature/grass-leafslarge', 'nature/plant-flattall']), x, z: rz + (r < 0.16 ? -1 : 1) * (RIVER_HALF_W + 0.55), yaw: r * 40 });
    else if (r < 0.38) P.push({ model: rng.pick(ROCKS), x, y: -0.25, z: rz + (r < 0.35 ? -1 : 1) * (RIVER_HALF_W - 0.3), yaw: r * 30, scale: 0.6 });
    else if (r < 0.43) P.push({ model: rng.pick(['nature/lily-large', 'nature/lily-small']), x, y: -0.115, z: rz + (r < 0.405 ? -1 : 1) * (RIVER_HALF_W - 0.7), yaw: r * 50 });
    else if (r > 0.9 && Math.abs(x) < 70) P.push({ model: rng.pick(['nature/tree-default', 'nature/tree-tall', 'nature/tree-oak']), x, z: rz + (r > 0.95 ? -1 : 1) * (RIVER_HALF_W + 1.6), yaw: r * 20, scale: 1.2 });
  }
  P.push({ model: 'nature/canoe', x: -8, y: 0.01, z: riverZ(-8) - RIVER_HALF_W - 0.9, yaw: 1.45 });
  P.push({ model: 'nature/log-large', x: 12, z: riverZ(12) + RIVER_HALF_W + 1.2, yaw: 0.3 });

  // ---- Farmland south of the river: strip fields with fences, a campsite on the edge of the woods.
  const fieldZ0 = 33, fieldZ1 = 49;
  const fieldXs: [number, number, 'wheat' | 'veg' | 'soil'][] = [[-62, -48, 'wheat'], [-46, -37.5, 'veg'], [-32.5, -14, 'wheat'], [-12, 6, 'soil'], [8, 24, 'wheat'], [26, 36.5, 'veg'], [41.5, 56, 'wheat'], [58, 66, 'soil']];
  for (const [x0, x1, crop] of fieldXs) {
    const f = { x0, z0: fieldZ0, x1, z1: fieldZ1, crop };
    plan.fields.push(f);
    slab(crop === 'wheat' ? '#C9A24E' : '#9C6B47', { x0, z0: fieldZ0, x1, z1: fieldZ1 }, 0.02);
    for (let x = x0 + 0.6; x < x1 - 0.4; x += 1.2) slab(crop === 'wheat' ? '#E9C46A' : crop === 'veg' ? '#63A854' : '#B58A5C', { x0: x - 0.3, z0: fieldZ0 + 0.5, x1: x + 0.3, z1: fieldZ1 - 0.5 }, 0.08);
    // A rail fence along the riverside edge of each field.
    for (let x = x0 + 0.7; x < x1 - 0.6; x += 1.4) P.push({ model: 'nature/fence-simple', x, z: fieldZ0 - 0.2, yaw: 0 });
    if (crop === 'veg') for (let i = 0; i < 6; i++) P.push({ model: rng.pick(['nature/crop-pumpkin', 'nature/crop-carrot']), x: x0 + 1 + rng.range(0, x1 - x0 - 2), z: fieldZ0 + 1 + rng.range(0, fieldZ1 - fieldZ0 - 2), yaw: rng.range(0, 6) });
  }
  P.push({ model: 'nature/tent-detailedopen', x: -20, z: 55, yaw: 0.4 }, { model: 'nature/campfire-stones', x: -18.6, z: 55.8, yaw: 0 }, { model: 'nature/log-stack', x: -21.6, z: 56, yaw: 1.2 });

  // ---- Woods and mountains: pines on the slopes, woodland near the valley floor, crags up high.
  const developed = (x: number, z: number): boolean => {
    if (Math.abs(z - ROAD_Z) < 3 || Math.abs(z - BACK_Z) < 3) return true;
    if (CROSS_XS.some((cx) => Math.abs(x - cx) < 3) && z > BACK_Z) return true;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF_W + 2.2) return true;
    if (Math.abs(z - pathZ(x)) < 1) return true;
    for (const l of plan.lots) if (inRect(l, x, z, 0.8)) return true;
    for (const f of plan.fields) if (inRect(f, x, z, 1)) return true;
    return false;
  };
  const trng = new Rng(0x5eed);
  /** How far outside the valley floor a point is. */
  const outside = (x: number, z: number) => Math.max(BASIN.zN - z, z - BASIN.zS, Math.abs(x) - BASIN.x, 0);
  const plant = (x: number, z: number, p: number, scale: number) => {
    if (developed(x, z)) return;
    const h = groundHeight(x, z);
    if (h > 21 || trng.next() > p) return;
    const pine = h > 2 || z < BASIN.zN ? trng.chance(0.9) : trng.chance(0.35);
    plan.forest.push({ model: pine ? trng.pick(PINES) : trng.pick(WOODLAND), x, y: h - 0.05, z, yaw: trng.range(0, 6.28), scale: scale * trng.range(0.8, 1.25) });
  };
  // The valley floor: a few trees on the meadows. The first rise: thick woods. Further out: big trees, spaced wider.
  for (let gz = -140; gz < 120; gz += 2.6) for (let gx = -160; gx < 160; gx += 2.6) {
    const x = gx + trng.range(-1.1, 1.1), z = gz + trng.range(-1.1, 1.1);
    const o = outside(x, z);
    if (o === 0) plant(x, z, 0.06, 1.1);
    else if (o < 26) plant(x, z, 0.82, 1.35);
  }
  for (let gz = -140; gz < 120; gz += 4.6) for (let gx = -160; gx < 160; gx += 4.6) {
    const x = gx + trng.range(-2, 2), z = gz + trng.range(-2, 2);
    if (outside(x, z) >= 26 && Math.hypot(x / 1.3, z) < 165) plant(x, z, 0.75, 2.3);
  }
  // Boulders and logs on the valley edges.
  for (let i = 0; i < 70; i++) {
    const x = trng.range(-100, 100), z = trng.range(-40, 70);
    if (developed(x, z)) continue;
    P.push({ model: trng.chance(0.75) ? trng.pick(ROCKS) : trng.pick(['nature/log', 'nature/stump-old', 'nature/stump-round']), x, y: groundHeight(x, z) - 0.05, z, yaw: trng.range(0, 6.28), scale: trng.range(0.7, 1.4) });
  }
  return plan;
}
