/**
 * Street dressing for a corner: where the bins, bikes, boards, crates and planters stand, in the
 * shop's own coordinates (the root carries the corner's frame). Pure data, so tests can check that no
 * prop ever stands on a path, the paving or a parking bay: props only go on the lawn between them.
 * A bigger shop gets more of them; opening days get bunting (drawn by the views).
 */
import { lotLayout, WALL_T, PLOT_RECT, type Rect } from '@/sim/layout';
import type { Vec2 } from '@/sim/types';
import { MAIN_N } from './town';

export interface Prop { model: string; x: number; z: number; yaw: number; scale?: number; r: number }

/** The z of a north corner's shop origin: frontage maths is done as if every shop faced south. */
const NORTH_Z = -1.6;

export interface CornerShape { floor: Rect; storeroom: Rect; lotRows?: number; door: Vec2 }

/** Everything a prop must keep off, shop-relative: the building, every paved path and the bays (each grown by a margin when tested). */
export function pavedRects(shape: CornerShape): Rect[] {
  const L = lotLayout({ floor: shape.floor, storeroom: shape.storeroom, lotRows: shape.lotRows });
  const f = shape.floor, backZ = Math.min(f.z0, shape.storeroom.z0);
  return [
    { x0: f.x0 - WALL_T, z0: backZ - WALL_T, x1: f.x1 + WALL_T, z1: f.z1 + WALL_T }, L.apron, L.aisle, L.driveway, L.serviceLane, L.backYard,
    { x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3 },
    { x0: -L.halfW - 2.0, z0: 0, x1: -L.halfW + 0.8, z1: 1.2 }, // pylon sign
    ...L.bays.map((b) => ({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 })),
  ];
}

/** The frontage sidewalk's inner edge, shop-relative: the lawn stops there. */
export const SIDEWALK_IN = MAIN_N[0] - NORTH_Z;

/**
 * Props for one corner. tier 0 is the starter shop, 1 medium, 2 large (rivals pick theirs). `colour`
 * is the store's own (trolley shelter canopy). Each prop takes the free lawn spot nearest its anchor.
 */
export function cornerProps(shape: CornerShape, tier: number, opts: { trolleys?: boolean } = {}): Prop[] {
  const L = lotLayout({ floor: shape.floor, storeroom: shape.storeroom, lotRows: shape.lotRows });
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
  put('generated/bike-rack', L.walkwayX - 1.2, SIDEWALK_IN - 0.6, 0.32, Math.PI / 2);
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
    put('generated/bike-rack', L.walkwayX - 2.2, SIDEWALK_IN - 0.6, 0.32, Math.PI / 2);
    put('generated/pallet', L.serviceLane.x0 - 0.6, backZ + 1.8, 0.35, 0.4);
    put('commercial/parasol-a', shape.door.x + 2.8, doorZ + 0.9, 0.5);
  }
  if (opts.trolleys) put('generated/trolley-shelter', L.walkwayX + 2.4, SIDEWALK_IN - 0.9, 0.55);
  return out;
}
