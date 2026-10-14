/**
 * The streets on foot: eight sidewalk legs running out from the four corners of the crossroads,
 * joined by the four zebras. Anyone walking in town (passers-by, shoppers heading for any store,
 * the bus crowd) gets a route over this network; at the kerb of each zebra they wait for the
 * walk light. Pure geometry plus a tiny router, no state.
 */
import type { Vec2, CornerId, Person } from './types';
import { SIDEWALK_N_Z, SIDEWALK_S_Z, SIDEWALK_W_X, SIDEWALK_E_X, ZEBRA, SIDE_HALF, ROAD_FAR, TICK, walkMayStart } from './layout';
import { followPath } from './movement';

export type Leg = 'mNW' | 'mNE' | 'mSW' | 'mSE' | 'sNW' | 'sNE' | 'sSW' | 'sSE';
export const LEGS: Leg[] = ['mNW', 'mNE', 'mSW', 'mSE', 'sNW', 'sNE', 'sSW', 'sSE'];

const W = SIDEWALK_W_X, E = SIDEWALK_E_X, N = SIDEWALK_N_Z, S = SIDEWALK_S_Z;
export const CORNER_POINT: Record<CornerId, Vec2> = { nw: { x: W, z: N }, ne: { x: E, z: N }, sw: { x: W, z: S }, se: { x: E, z: S } };
export const LEG_CORNER: Record<Leg, CornerId> = { mNW: 'nw', sNW: 'nw', mNE: 'ne', sNE: 'ne', mSW: 'sw', sSW: 'sw', mSE: 'se', sSE: 'se' };

/** Where each leg runs out of sight. */
export const LEG_END: Record<Leg, Vec2> = {
  mNW: { x: -ROAD_FAR, z: N }, mNE: { x: ROAD_FAR, z: N }, mSW: { x: -ROAD_FAR, z: S }, mSE: { x: ROAD_FAR, z: S },
  sNW: { x: W, z: -ROAD_FAR }, sNE: { x: E, z: -ROAD_FAR }, sSW: { x: W, z: ROAD_FAR }, sSE: { x: E, z: ROAD_FAR },
};

export function legCorner(l: Leg): CornerId { return LEG_CORNER[l]; }

/** The leg a sidewalk point lies on. */
export function legOf(p: Vec2): Leg {
  const onMain = Math.min(Math.abs(p.z - N), Math.abs(p.z - S)) < Math.min(Math.abs(p.x - W), Math.abs(p.x - E));
  if (onMain) return (p.z < (N + S) / 2 ? (p.x < 0 ? 'mNW' : 'mNE') : (p.x < 0 ? 'mSW' : 'mSE'));
  return (p.z < (N + S) / 2 ? (p.x < 0 ? 'sNW' : 'sNE') : (p.x < 0 ? 'sSW' : 'sSE'));
}

/**
 * Zebra walks between neighbouring corners: the points from one corner to the other, and which of
 * them is the kerb where walkers wait. Elm Street's zebras sit just back from Main Road.
 */
function zebra(a: CornerId, b: CornerId): { pts: Vec2[]; wait: number } | null {
  const k = SIDE_HALF + 0.25;
  const pair = `${a}-${b}`;
  switch (pair) {
    case 'nw-ne': return { pts: [{ x: W, z: ZEBRA.north }, { x: -k, z: ZEBRA.north }, { x: k, z: ZEBRA.north }, { x: E, z: ZEBRA.north }], wait: 1 };
    case 'ne-nw': return { pts: [{ x: E, z: ZEBRA.north }, { x: k, z: ZEBRA.north }, { x: -k, z: ZEBRA.north }, { x: W, z: ZEBRA.north }], wait: 1 };
    case 'sw-se': return { pts: [{ x: W, z: ZEBRA.south }, { x: -k, z: ZEBRA.south }, { x: k, z: ZEBRA.south }, { x: E, z: ZEBRA.south }], wait: 1 };
    case 'se-sw': return { pts: [{ x: E, z: ZEBRA.south }, { x: k, z: ZEBRA.south }, { x: -k, z: ZEBRA.south }, { x: W, z: ZEBRA.south }], wait: 1 };
    case 'nw-sw': return { pts: [{ x: ZEBRA.west, z: N + 0.2 }, { x: ZEBRA.west, z: S - 0.2 }], wait: 0 };
    case 'sw-nw': return { pts: [{ x: ZEBRA.west, z: S - 0.2 }, { x: ZEBRA.west, z: N + 0.2 }], wait: 0 };
    case 'ne-se': return { pts: [{ x: ZEBRA.east, z: N + 0.2 }, { x: ZEBRA.east, z: S - 0.2 }], wait: 0 };
    case 'se-ne': return { pts: [{ x: ZEBRA.east, z: S - 0.2 }, { x: ZEBRA.east, z: N + 0.2 }], wait: 0 };
    default: return null;
  }
}

const RING: CornerId[] = ['nw', 'ne', 'se', 'sw'];

/** Corners to visit from a to b, shortest way round (diagonals pick a side by `alt`). */
function cornerHops(a: CornerId, b: CornerId, alt: boolean): CornerId[] {
  const i = RING.indexOf(a), j = RING.indexOf(b);
  const fwd = (j - i + 4) % 4;
  if (fwd === 0) return [a];
  const step = fwd === 1 ? 1 : fwd === 3 ? -1 : alt ? 1 : -1;
  const out: CornerId[] = [a];
  let k = i;
  while (RING[k] !== b) { k = (k + step + 4) % 4; out.push(RING[k]!); }
  return out;
}

export interface Route { path: Vec2[]; xings: number[] }

/**
 * A walking route between two sidewalk points: along the leg to its corner, over the zebras, and
 * out along the other leg. `xings` are the path indices of the kerbs where the walker waits.
 */
export function route(from: Vec2, to: Vec2, alt = false): Route {
  const la = legOf(from), lb = legOf(to);
  const path: Vec2[] = [];
  const xings: number[] = [];
  if (la === lb) { path.push({ ...to }); return { path, xings }; }
  const hops = cornerHops(LEG_CORNER[la], LEG_CORNER[lb], alt);
  path.push({ ...CORNER_POINT[hops[0]!] });
  for (let h = 0; h < hops.length - 1; h++) {
    const z = zebra(hops[h]!, hops[h + 1]!)!;
    for (const [k, p] of z.pts.entries()) { if (k === z.wait) xings.push(path.length); path.push({ ...p }); }
    path.push({ ...CORNER_POINT[hops[h + 1]!] });
  }
  path.push({ ...to });
  return { path, xings };
}

/** Does this point lie on a zebra (out in the road)? For tests and for cars watching for walkers. */
export function onZebra(p: Vec2): boolean {
  const k = SIDE_HALF + 0.25;
  if (Math.abs(p.z - ZEBRA.north) < 0.5 && Math.abs(p.x) < k) return true;
  if (Math.abs(p.z - ZEBRA.south) < 0.5 && Math.abs(p.x) < k) return true;
  if ((Math.abs(p.x - ZEBRA.west) < 0.5 || Math.abs(p.x - ZEBRA.east) < 0.5) && p.z > N + 0.25 && p.z < S - 0.25) return true;
  return false;
}

/**
 * Walk a street route: stop at each zebra kerb until the walk light lets people start, then go.
 * Returns true at the end of the path.
 */
export function walkStreet(p: Person, speed: number, tick: number): boolean {
  const x = p.xings;
  if (x && x.length) {
    const kerb = x[0]!;
    if (p.pathIdx > kerb) {
      // At the kerb: wait for the green man, then step off.
      if (!walkMayStart(tick)) { if (p.anim !== 'idle') { p.heldAnim = p.anim; p.anim = 'idle'; } return false; }
      x.shift();
      if (p.heldAnim) { p.anim = p.heldAnim; p.heldAnim = undefined; }
      return walkStreet(p, speed, tick);
    } else {
      // Walk only as far as the kerb this step.
      const view = { x: p.x, z: p.z, yaw: p.yaw, path: p.path.slice(0, kerb + 1), pathIdx: p.pathIdx };
      followPath(view, speed, TICK);
      p.x = view.x; p.z = view.z; p.yaw = view.yaw; p.pathIdx = view.pathIdx;
      return false;
    }
  }
  return followPath(p, speed, TICK);
}
