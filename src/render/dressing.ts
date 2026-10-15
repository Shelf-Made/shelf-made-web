/**
 * Street dressing for a corner: where the bins, bikes, boards, crates and planters stand, in the
 * shop's own coordinates (the root carries the corner's frame). Pure data, so tests can check that no
 * prop ever stands on a path, the paving or a parking bay: props only go on the lawn between them.
 * A bigger shop gets more of them; opening days get bunting (drawn by the views).
 */
import { lotLayout, WALL_T, PLOT_RECT, pylonSpot as simPylonSpot, type Rect } from '@/sim/layout';
import type { Vec2 } from '@/sim/types';
import { MAIN_N, TREE_MIX, BUSH_MIX } from './town';

export interface Prop { model: string; x: number; z: number; yaw: number; scale?: number; r: number }

/** The z of a north corner's shop origin: frontage maths is done as if every shop faced south. */
const NORTH_Z = -1.6;

/** A corner's shape: its floor, lot and door; the player's also its painted bays and what the player built on the lot (props and the garden keep off it). */
export interface CornerShape { floor: Rect; storeroom: Rect; lotRows?: number; bayPlan?: number[]; door: Vec2; extra?: Rect[] }

/**
 * Where the pylon sign stands, shop-relative: on the lawn by the sidewalk, between the service lane
 * (where the delivery truck turns in) and the walkway to the door, never on either. `w` is the board's width.
 */
export function pylonSpot(shape: Pick<CornerShape, 'floor' | 'storeroom' | 'lotRows' | 'bayPlan'>): { x: number; z: number; w: number } { return simPylonSpot(shape); }

/** Everything a prop must keep off, shop-relative: the building, every paved path and the bays (each grown by a margin when tested). */
export function pavedRects(shape: CornerShape): Rect[] {
  const L = lotLayout({ floor: shape.floor, storeroom: shape.storeroom, lotRows: shape.lotRows, bayPlan: shape.bayPlan });
  const f = shape.floor, backZ = Math.min(f.z0, shape.storeroom.z0);
  const py = pylonSpot(shape);
  return [
    // The driveway and the service lane are paved right out to the kerb, across the lawn and the sidewalk.
    { x0: f.x0 - WALL_T, z0: backZ - WALL_T, x1: f.x1 + WALL_T, z1: f.z1 + WALL_T }, L.apron, L.aisle, { ...L.driveway, z1: SIDEWALK_IN + 1 }, { ...L.serviceLane, z1: SIDEWALK_IN + 1 }, L.backYard,
    { x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3 },
    { x0: py.x - py.w / 2 - 0.1, z0: py.z - 0.3, x1: py.x + py.w / 2 + 0.1, z1: py.z + 0.3 }, // pylon sign
    ...L.bays.map((b) => ({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 })),
    ...(shape.extra ?? []),
  ];
}

/** The frontage sidewalk's inner edge, shop-relative: the lawn stops there. */
export const SIDEWALK_IN = MAIN_N[0] - NORTH_Z;

/**
 * Props for one corner. tier 0 is the starter shop, 1 medium, 2 large (rivals pick theirs). `colour`
 * is the store's own (trolley shelter canopy). Each prop takes the free lawn spot nearest its anchor.
 */
export function cornerProps(shape: CornerShape, tier: number, opts: { trolleys?: boolean; noBikes?: boolean } = {}): Prop[] {
  const L = lotLayout({ floor: shape.floor, storeroom: shape.storeroom, lotRows: shape.lotRows, bayPlan: shape.bayPlan });
  const f = shape.floor, backZ = Math.min(f.z0, shape.storeroom.z0);
  const paved = pavedRects(shape);
  const out: Prop[] = [];
  const free = (x: number, z: number, r: number) =>
    x > PLOT_RECT.x0 + r + 0.2 && x < PLOT_RECT.x1 - r - 0.2 && z > PLOT_RECT.z0 + r + 0.2 && z < SIDEWALK_IN - r - 0.1
    && !paved.some((q) => x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r)
    && !out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.1);
  const put = (model: string, ax: number, az: number, r: number, yaw = 0, scale?: number) => {
    for (let ring = 0; ring <= 14; ring++) {
      const steps = Math.max(1, ring * 6);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2, d = ring * 0.25;
        const x = ax + Math.cos(a) * d, z = az + Math.sin(a) * d;
        if (free(x, z, r)) { out.push({ model, x, z, yaw, scale, r }); return; }
      }
    }
  };
  const doorZ = f.z1 + WALL_T;
  // Always: a bench and a bin beside the apron, a sandwich board by the walkway, bikes, recycling and a pallet of crates out back.
  put('furniture/bench', shape.door.x - 2.4, doorZ + 0.6, 0.45);
  put('furniture/trashcan', shape.door.x - 1.6, doorZ + 0.9, 0.18);
  put('generated/sandwich-board', L.walkwayX + 0.85, SIDEWALK_IN - 0.45, 0.2, 0.3);
  // (The player builds their own bike racks; rivals come with theirs.)
  if (!opts.noBikes) put('generated/bike-rack', L.walkwayX + 3.1, SIDEWALK_IN - 0.6, 0.32, Math.PI / 2);
  put('generated/recycling-bins', L.backYard.x0 - 0.6, L.backYard.z0 + 0.6, 0.38, Math.PI / 2);
  put('roads/dumpster', L.backYard.x1 + 0.9, L.backYard.z0 + 0.5, 0.55, Math.PI / 2);
  put('generated/pallet', L.serviceLane.x0 - 0.6, backZ + 0.8, 0.35);
  // Medium: planters by the walkway, a hydrant at the frontage, a stray trolley left by the bays.
  if (tier >= 1) {
    put('suburban/planter', L.walkwayX - 0.85, SIDEWALK_IN - 0.4, 0.3);
    put('suburban/planter', L.walkwayX + 1.6, SIDEWALK_IN - 0.4, 0.3);
    put('generated/hydrant', PLOT_RECT.x0 + 0.9, SIDEWALK_IN - 0.35, 0.12);
    const b = L.bays[L.bays.length - 1];
    if (b) put('market/shopping-cart', b.x, b.z - 0.9, 0.2, 0.7);
  }
  // Large: a second rack, more crates, a parasol and bench to sit out under.
  if (tier >= 2) {
    if (!opts.noBikes) put('generated/bike-rack', L.walkwayX - 2.2, SIDEWALK_IN - 0.6, 0.32, Math.PI / 2);
    put('generated/pallet', L.serviceLane.x0 - 0.6, backZ + 1.8, 0.35, 0.4);
    put('commercial/parasol-a', shape.door.x + 2.8, doorZ + 0.9, 0.5);
  }
  if (opts.trolleys) put('generated/trolley-shelter', L.walkwayX + 2.4, SIDEWALK_IN - 0.9, 0.55);
  return out;
}

const FLOWER_MIX = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
const ROCK_MIX = ['nature/rock-smalla', 'nature/rock-smallb', 'nature/rock-smallc', 'nature/stump-round'];

export interface GardenItem { model: string; x: number; z: number; yaw: number; scale: number }
export type TuftKind = 'grass' | 'flower-red' | 'flower-yellow' | 'flower-purple' | 'flower-white' | 'flower-pink';
export interface Tuft { kind: TuftKind; x: number; z: number; yaw: number; scale: number }

/** A repeatable 0..1 hash of a point (no random stream: the garden is the same every time the corner is drawn). */
function hash(x: number, z: number, salt: number): number { const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453; return s - Math.floor(s); }

/**
 * The garden on the parts of a corner the shop and its lot leave free: a mix of trees in different
 * shapes and sizes, bushes, flower patches and the odd rock, and grass tufts all over the lawn. Never on
 * paving, a path, a bay or a prop (tests walk every corner). `salt` makes each corner its own garden.
 */
export function cornerGarden(shape: CornerShape, props: Prop[], salt = 0): { items: GardenItem[]; tufts: Tuft[] } {
  const paved = pavedRects(shape);
  const items: (GardenItem & { r: number })[] = [], tufts: Tuft[] = [];
  const onPaved = (x: number, z: number, m: number) => paved.some((q) => x > q.x0 - m && x < q.x1 + m && z > q.z0 - m && z < q.z1 + m);
  const free = (x: number, z: number, r: number) =>
    x > PLOT_RECT.x0 + r && x < PLOT_RECT.x1 - r && z > PLOT_RECT.z0 + r && z < SIDEWALK_IN - r - 0.05
    && !onPaved(x, z, r) && !props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.05)
    && !items.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
  const add = (model: string, x: number, z: number, r: number, scale: number) => { items.push({ model, x, z, yaw: hash(x, z, salt + 5) * 6.283, scale, r }); };
  // Trees first, on a loose jittered grid, then bushes and flowers round them, then rocks.
  for (let gz = PLOT_RECT.z0 + 1.2; gz < SIDEWALK_IN; gz += 1.7) for (let gx = PLOT_RECT.x0 + 1.2; gx < PLOT_RECT.x1; gx += 1.7) {
    const x = gx + (hash(gx, gz, salt) - 0.5) * 0.9, z = gz + (hash(gz, gx, salt + 1) - 0.5) * 0.9;
    if (hash(x, z, salt + 2) < 0.34 && free(x, z, 0.85)) {
      const s = 0.8 + hash(x, z, salt + 3) * 0.55;
      add(TREE_MIX[Math.floor(hash(z, x, salt + 4) * TREE_MIX.length)]!, x, z, 0.75 * s, s);
    }
  }
  for (let gz = PLOT_RECT.z0 + 0.8; gz < SIDEWALK_IN; gz += 1.0) for (let gx = PLOT_RECT.x0 + 0.8; gx < PLOT_RECT.x1; gx += 1.0) {
    const x = gx + (hash(gx, gz, salt + 6) - 0.5) * 0.6, z = gz + (hash(gz, gx, salt + 7) - 0.5) * 0.6;
    const h = hash(x, z, salt + 8);
    if (h < 0.1 && free(x, z, 0.38)) add(BUSH_MIX[Math.floor(hash(z, x, salt + 9) * BUSH_MIX.length)]!, x, z, 0.38, 0.85 + hash(x, z, salt + 10) * 0.4);
    else if (h < 0.15 && free(x, z, 0.3)) for (let i = 0; i < 3; i++) add(FLOWER_MIX[Math.floor(hash(i, x, salt) * FLOWER_MIX.length)]!, x + (i - 1) * 0.26, z + (i % 2) * 0.18, 0.12, 1);
    else if (h < 0.17 && free(x, z, 0.2)) add(ROCK_MIX[Math.floor(hash(z, x, salt + 11) * ROCK_MIX.length)]!, x, z, 0.2, 0.8 + hash(x, z, salt + 12) * 0.5);
  }
  // Grass tufts all over the lawn, thicker in some patches than others, with a flower here and there.
  const FLOWERS: TuftKind[] = ['flower-red', 'flower-yellow', 'flower-purple', 'flower-white', 'flower-pink'];
  for (let gz = PLOT_RECT.z0 + 0.2; gz < SIDEWALK_IN; gz += 0.42) for (let gx = PLOT_RECT.x0 + 0.2; gx < PLOT_RECT.x1; gx += 0.42) {
    const x = gx + (hash(gx, gz, salt + 13) - 0.5) * 0.36, z = gz + (hash(gz, gx, salt + 14) - 0.5) * 0.36;
    const patch = hash(Math.floor(x / 2.3), Math.floor(z / 2.3), salt + 15);
    if (hash(x, z, salt + 16) > 0.35 + patch * 0.45) continue;
    if (x < PLOT_RECT.x0 + 0.1 || x > PLOT_RECT.x1 - 0.1 || z < PLOT_RECT.z0 + 0.1 || z > SIDEWALK_IN - 0.12 || onPaved(x, z, 0.1)) continue;
    if (props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.05)) continue;
    const fl = hash(x, z, salt + 17);
    tufts.push({ kind: fl < 0.035 ? FLOWERS[Math.floor(fl * 1000) % FLOWERS.length]! : 'grass', x, z, yaw: hash(z, x, salt + 18) * 6.283, scale: 0.75 + hash(x, z, salt + 19) * 0.6 });
  }
  return { items: items.map(({ r: _r, ...it }) => it), tufts };
}
