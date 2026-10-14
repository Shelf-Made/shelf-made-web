import type { Vec2 } from './types';

interface Mover { x: number; z: number; yaw: number; path: Vec2[]; pathIdx: number }

/**
 * Advance along the path at `speed`; returns true when the end is reached this step.
 * `arrive` is how close counts as reaching the final waypoint (people in a crowd never land on the exact point).
 */
export function followPath(m: Mover, speed: number, dt: number, turnRate = 12, arrive = 0): boolean {
  let budget = speed * dt;
  while (budget > 0 && m.pathIdx < m.path.length) {
    const t = m.path[m.pathIdx]!;
    const dx = t.x - m.x, dz = t.z - m.z;
    const d = Math.hypot(dx, dz);
    const last = m.pathIdx === m.path.length - 1;
    if (d < 1e-4 || (last && arrive > 0 && d <= arrive)) { m.pathIdx++; continue; }
    const targetYaw = Math.atan2(dx, dz);
    m.yaw = turnToward(m.yaw, targetYaw, turnRate * dt);
    if (d <= budget) { m.x = t.x; m.z = t.z; budget -= d; m.pathIdx++; }
    else { m.x += (dx / d) * budget; m.z += (dz / d) * budget; budget = 0; }
  }
  return m.pathIdx >= m.path.length;
}

export function turnToward(yaw: number, target: number, maxStep: number): number {
  let d = target - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return yaw + Math.sign(d) * maxStep;
}

/** Replace sharp corners with short arcs so cars sweep round turns. */
export function roundPath(pts: Vec2[], radius = 0.9, segments = 4): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const out: Vec2[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
    const ab = { x: b.x - a.x, z: b.z - a.z }, bc = { x: c.x - b.x, z: c.z - b.z };
    const lab = Math.hypot(ab.x, ab.z), lbc = Math.hypot(bc.x, bc.z);
    const r = Math.min(radius, lab / 2, lbc / 2);
    if (r < 0.05 || lab < 1e-6 || lbc < 1e-6) { out.push(b); continue; }
    const p1 = { x: b.x - (ab.x / lab) * r, z: b.z - (ab.z / lab) * r };
    const p2 = { x: b.x + (bc.x / lbc) * r, z: b.z + (bc.z / lbc) * r };
    out.push(p1);
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const q = (1 - t) * (1 - t);
      const w = 2 * (1 - t) * t;
      const e = t * t;
      out.push({ x: q * p1.x + w * b.x + e * p2.x, z: q * p1.z + w * b.z + e * p2.z });
    }
    out.push(p2);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
