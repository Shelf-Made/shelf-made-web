import { type Grid, type Portal, cellOf, cellCentre, cellIndex, canStep, inBounds, isBlocked, lineClear, nearestWalkable } from './grid';
import type { Vec2, Waypoint } from './types';

/** Binary heap keyed on f. */
class Heap {
  private items: { i: number; f: number }[] = [];
  get size(): number { return this.items.length; }
  push(i: number, f: number): void {
    const a = this.items; a.push({ i, f });
    let n = a.length - 1;
    while (n > 0) { const p = (n - 1) >> 1; if (a[p]!.f <= a[n]!.f) break; const t = a[p]!; a[p] = a[n]!; a[n] = t; n = p; }
  }
  pop(): number {
    const a = this.items; const top = a[0]!; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let n = 0;
      for (;;) {
        const l = n * 2 + 1, r = l + 1; let m = n;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === n) break; const t = a[m]!; a[m] = a[n]!; a[n] = t; n = m;
      }
    }
    return top.i;
  }
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * A* over the grid, returning a smoothed list of waypoints from `from` to `to` (both
 * continuous positions). Returns null when unreachable. Targets inside blocked cells are
 * snapped to the nearest walkable cell. Between floors the path rides the stairs (a waypoint with `ride`).
 */
export function findPath(g: Grid, from: Vec2, to: Vec2, dyn?: Set<number>): Waypoint[] | null {
  const start = nearestWalkable(g, from, dyn);
  const goal = nearestWalkable(g, to, dyn);
  const [sx, sz] = cellOf(g, start);
  const [gx, gz] = cellOf(g, goal);
  if (!inBounds(g, sx, sz) || !inBounds(g, gx, gz)) return null;
  if (isBlocked(g, gx, gz, dyn)) return null;
  const n = g.w * g.h;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const si = cellIndex(g, sx, sz), gi = cellIndex(g, gx, gz);
  gScore[si] = 0;
  const open = new Heap();
  // Across floors, distances are taken as if each floor stood over the ground one. A ride costs at least 7 and
  // carries you at most 6 cells across (stairs come up three tiles on from their foot), so a floor between adds
  // at least 1 to the distance, and costs 7 at the least: never more than the way really costs, or a dearer
  // flight nearer the start (the stairs by the door) would win over a cheaper one (the escalator a tile on).
  const lv = g.rowLevel, shift = g.levelRows ?? 0, gl = lv ? lv[gz]! : 0;
  const h = lv
    ? (cx: number, cz: number) => { const l = lv[cz]!, dx = Math.abs(cx - gx), dz = Math.abs(cz - l * shift - (gz - gl * shift)), n = Math.abs(l - gl); return Math.max(Math.max(dx, dz) + 0.4142 * Math.min(dx, dz) + n, 7 * n); }
    : (cx: number, cz: number) => { const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
  const via = new Map<number, Portal>();
  open.push(si, h(sx, sz));
  let found = false;
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === gi) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > 20000) break;
    const cx = cur % g.w, cz = (cur / g.w) | 0;
    for (const [dx, dz] of NB) {
      const nx = cx + dx, nz = cz + dz;
      if (!inBounds(g, nx, nz)) continue;
      const ni = cellIndex(g, nx, nz);
      if (closed[ni]) continue;
      if (!canStep(g, cx, cz, nx, nz, dyn)) continue;
      const step = (dx !== 0 && dz !== 0 ? 1.4142 : 1) * g.cost[ni]!;
      const tentative = gScore[cur]! + step;
      if (tentative < gScore[ni]!) {
        gScore[ni] = tentative; came[ni] = cur; via.delete(ni);
        open.push(ni, tentative + h(nx, nz));
      }
    }
    // Up or down a floor.
    for (const pt of g.portals?.get(cur) ?? []) {
      if (closed[pt.to] || isBlocked(g, pt.to % g.w, (pt.to / g.w) | 0, dyn)) continue;
      const tentative = gScore[cur]! + pt.cost;
      if (tentative < gScore[pt.to]!) {
        gScore[pt.to] = tentative; came[pt.to] = cur; via.set(pt.to, pt);
        open.push(pt.to, tentative + h(pt.to % g.w, (pt.to / g.w) | 0));
      }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = gi; c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  if (!via.size) {
    const pts: Vec2[] = cells.map((c) => cellCentre(g, c % g.w, (c / g.w) | 0));
    if (pts.length) pts[pts.length - 1] = goal;
    return smooth(g, start, pts, dyn);
  }
  // Each floor's stretch smoothed on its own, joined by the rides: to the foot of the stairs, then up them.
  const out: Waypoint[] = [];
  let foot = start, seg: Vec2[] = [];
  cells.forEach((c, k) => {
    const pt = k > 0 ? via.get(c) : undefined;
    if (pt && came[c] === cells[k - 1]) {
      if (seg.length) seg[seg.length - 1] = pt.from; else seg.push(pt.from);
      out.push(...smooth(g, foot, seg, dyn));
      out.push({ x: pt.at.x, z: pt.at.z, ride: pt.ride, via: pt.via, yaw: pt.yaw });
      foot = pt.at; seg = [];
      return;
    }
    seg.push(cellCentre(g, c % g.w, (c / g.w) | 0));
  });
  if (seg.length) { seg[seg.length - 1] = goal; out.push(...smooth(g, foot, seg, dyn)); }
  else if (Math.hypot(goal.x - foot.x, goal.z - foot.z) > 0.01) out.push(goal);
  return out;
}

/** String-pulling: drop waypoints that can be skipped in a straight line. */
function smooth(g: Grid, start: Vec2, pts: Vec2[], dyn?: Set<number>): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [];
  let anchor = start;
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineClear(g, anchor, pts[j]!, dyn)) j--;
    out.push(pts[j]!);
    anchor = pts[j]!;
    i = j;
  }
  if (out.length === 0) out.push(pts[pts.length - 1]!);
  return out;
}
