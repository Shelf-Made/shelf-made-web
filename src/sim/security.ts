/**
 * Security: cameras, tag gates and guards. A camera watches part of a floor (one on a wall a quarter
 * turn out from it, a dome on the ceiling all round, a smart dome further and it can hold a running
 * thief still a moment). Fewer shoplifters try their luck where they are watched, and one who bolts
 * on camera is seen by every free hand at once. Tag gates by the door beep at a thief running out
 * and stop most of them. Guards stand by the door, put thieves off and run them down.
 */
import type { GameState, Person, FixtureType, Shop } from './types';
import { toLocal, levelOfZ, zOnLevel, levelTileList, tileKey, footprintOf } from './layout';
import { onShift } from './staff';

/** How far each camera sees (tiles), how wide (radians, whole cone), and how much a thief in view is put off and found. */
export const CAMERAS: Partial<Record<FixtureType, { range: number; cone: number; watch: number }>> = {
  camera: { range: 5.5, cone: Math.PI / 2, watch: 0.6 },
  dome: { range: 3.6, cone: Math.PI * 2, watch: 0.8 },
  smartCam: { range: 4.6, cone: Math.PI * 2, watch: 1 },
};
/** A smart camera holds a running thief still this long (seconds), once. */
export const FREEZE = 3;
/** Tag gates stop this share of thieves running through them (more on camera). */
export const GATE_STOP = 0.55;

const coverCache = new WeakMap<object, { sig: string; tiles: Map<string, { watch: number; smart: boolean }> }>();

/**
 * Every floor tile a camera sees, keyed by its corner (shop-relative, in its floor's region), with the best
 * watch over it and whether a smart camera is on it.
 */
export function cameraCover(shop: Shop): Map<string, { watch: number; smart: boolean }> {
  const cams = shop.fixtures.filter((f) => CAMERAS[f.type]);
  const sig = `${shop.layoutVersion ?? ''}|${cams.map((f) => `${f.type}${f.x},${f.z},${f.rot}`).join(';')}`;
  const hit = coverCache.get(shop.fixtures);
  if (hit && hit.sig === sig) return hit.tiles;
  const tiles = new Map<string, { watch: number; smart: boolean }>();
  for (const f of cams) {
    const c = CAMERAS[f.type]!, L = levelOfZ(f.z + 0.5);
    const cx = f.x + 0.5, cz = zOnLevel(f.z + 0.5, -L);
    // A wall camera looks out from the wall it hangs on, the way the piece faces.
    const face = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][f.rot & 3]!;
    const from = c.cone < Math.PI * 2 ? { x: cx - face.x * 0.45, z: cz - face.z * 0.45 } : { x: cx, z: cz };
    for (const t of levelTileList(shop, L)) {
      const tx = t.x + 0.5, tz = zOnLevel(t.z + 0.5, -L);
      const dx = tx - from.x, dz = tz - from.z, d = Math.hypot(dx, dz);
      if (d > c.range) continue;
      if (c.cone < Math.PI * 2 && d > 0.3 && (dx * face.x + dz * face.z) / d < Math.cos(c.cone / 2)) continue;
      const k = tileKey(t.x, t.z), was = tiles.get(k);
      tiles.set(k, { watch: Math.max(was?.watch ?? 0, c.watch), smart: (was?.smart ?? false) || f.type === 'smartCam' });
    }
  }
  coverCache.set(shop.fixtures, { sig, tiles });
  return tiles;
}

/** The camera watch over where someone stands (0: nobody sees them). */
export function watchAt(state: GameState, p: { x: number; z: number }): { watch: number; smart: boolean } | null {
  const cover = cameraCover(state.shop);
  if (!cover.size) return null;
  // (Tiles run from the floor's corner, which may sit on a half: a narrow shop is centred on the door.)
  const l = toLocal(state.shop, p.x, p.z), f = state.shop.floor;
  return cover.get(tileKey(f.x0 + Math.floor(l.x - f.x0), f.z0 + Math.floor(l.z - f.z0))) ?? null;
}

/** Guards on shift (and not on a break). */
export function guardsOnDuty(state: GameState): Person[] {
  return state.people.filter((p) => p.kind === 'staff' && p.role === 'guard' && !p.onBreak && onShift(p, state.time));
}

/**
 * How much the shop's security puts shoplifters off: cameras by how much of the floor they watch, and each
 * guard on duty a good deal more.
 */
export function securityFactor(state: GameState): number {
  const cover = cameraCover(state.shop);
  let k = 1;
  if (cover.size) {
    const all = levelTileList(state.shop, 0).length || 1;
    let w = 0; for (const t of cover.values()) w += t.watch;
    k *= 1 - 0.5 * Math.min(1, w / all);
  }
  const guards = guardsOnDuty(state).length;
  if (guards) k *= Math.max(0.3, Math.pow(0.6, guards));
  return k;
}

/** Tag gates a running thief is passing through now (on the tile of one), if any. */
export function gateAt(state: GameState, p: { x: number; z: number }): boolean {
  const gates = state.shop.fixtures.filter((f) => f.type === 'tagGate');
  if (!gates.length) return false;
  const l = toLocal(state.shop, p.x, p.z);
  return gates.some((g) => { const r = footprintOf(g.type, g.x, g.z, g.rot); return l.x > r.x0 - 0.1 && l.x < r.x1 + 0.1 && l.z > r.z0 - 0.1 && l.z < r.z1 + 0.1; });
}

/** Things a thief says when caught (one, picked from the 'quips' stream). */
export const QUIPS = ['"I was going to pay!"', '"I want to speak to the manager!"', '"It fell in my bag!"', '"This is a mistake!"', '"Not in front of everyone!"', '"I thought it was free!"', '"My mum will hear about this!"'];

/** Pieces that are about security (the Build card's Security tab, and the overlay). */
export const SECURITY: ReadonlySet<FixtureType> = new Set(['camera', 'dome', 'smartCam', 'tagGate']);
