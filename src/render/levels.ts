/**
 * Upstairs, as drawn. The sim walks each floor above the ground in a region of its own (see LEVEL_DZ); here
 * everyone and everything is carried back over the ground floor and up a storey a floor, and whoever is on the
 * stairs, an escalator or in a lift is drawn on their way between floors.
 */
import type { GameState, Person, Shop } from '@/sim/types';
import { TICK, STOREY, liftWorld, toWorld, toLocal, storeysOf, tileKey } from '@/sim/layout';

export interface Pose { x: number; y: number; z: number; level: number; ride: 'stairs' | 'escalator' | 'elevator' | null }

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Where a person is drawn this frame: between the last two ticks, on the floor they are on, or partway up a ride. */
export function poseOf(state: GameState, p: Person, alpha: number): Pose {
  const shop = state.shop;
  const w = p.climb !== undefined ? p.path[p.pathIdx] : undefined;
  if (w && w.ride !== undefined) {
    const f = shop.fixtures.find((x) => x.id === w.via);
    const a = liftWorld(shop, p.x, p.z), b = liftWorld(shop, w.x, w.z);
    const t = clamp01((p.climb! - TICK + alpha * TICK) / w.ride);
    const kind = f?.type === 'elevator' ? 'elevator' : f?.type === 'escalator' ? 'escalator' : 'stairs';
    if (kind === 'elevator' && f) {
      // In through the doors, up (or down) the shaft, out on the other floor.
      const c = toWorld(shop, f.x + 0.5, f.z + 0.5), cab = liftWorld(shop, c.x, c.z);
      if (t < 0.25) { const k = t / 0.25; return { x: a.x + (cab.x - a.x) * k, y: a.y, z: a.z + (cab.z - a.z) * k, level: a.level, ride: kind }; }
      if (t < 0.75) { const k = (t - 0.25) / 0.5; return { x: cab.x, y: a.y + (b.y - a.y) * k, z: cab.z, level: k < 0.5 ? a.level : b.level, ride: kind }; }
      const k = (t - 0.75) / 0.25;
      return { x: cab.x + (b.x - cab.x) * k, y: b.y, z: cab.z + (b.z - cab.z) * k, level: b.level, ride: kind };
    }
    // Stairs and escalators: half a tile on the level, two tiles of flight, half a tile off at the other end.
    const k = clamp01((t * 3 - 0.5) / 2);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * t, level: k < 0.5 ? a.level : b.level, ride: kind };
  }
  // Just off a ride (or any jump between floors): no sliding across the gap.
  const jump = Math.abs(p.x - p.px) + Math.abs(p.z - p.pz) > 2;
  const x = jump ? p.x : p.px + (p.x - p.px) * alpha, z = jump ? p.z : p.pz + (p.z - p.pz) * alpha;
  const l = liftWorld(shop, x, z);
  return { x: l.x, y: l.y, z: l.z, level: l.level, ride: null };
}

/**
 * Is a point as drawn (world x, y, z) of something on floor `on` out of sight from `eye`, under the floors over it up
 * to the one in view (null: every open floor)? Looking down through each floor between, a tile people stand on is in
 * the way; an opening (where the stairs come up) or a double-height space is not. Floor `on` says which floors are over
 * it, not y: the top of a piece a storey tall is flush with the boards over it, and as hidden.
 */
export function underFloors(shop: Shop, eye: { x: number; y: number; z: number }, x: number, y: number, z: number, on: number, view: number | null): boolean {
  const st = storeysOf(shop);
  for (let L = on + 1; L <= (view ?? st.top); L++) {
    const h = L * STOREY;
    // Up through that floor's opening (a flight's rail), it is over those boards, not under them.
    if (eye.y <= h || y > h + 0.01) continue;
    const t = (eye.y - h) / (eye.y - y), l = toLocal(shop, eye.x + (x - eye.x) * t, eye.z + (z - eye.z) * t);
    if (st.floors[L]?.has(tileKey(Math.floor(l.x + 0.5) - 0.5, Math.floor(l.z)))) return true;
  }
  return false;
}

/**
 * The floor a look along `dir` from `eye` meets first, with the whole building drawn (none lifted off): the boards of
 * the highest floor under it, down through openings and double-height spaces; the ground (and the lawn) under them all.
 */
export function floorMet(shop: Shop, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): number {
  const st = storeysOf(shop);
  if (dir.y >= 0) return 0;
  for (let L = st.top; L > 0; L--) {
    const h = L * STOREY;
    if (eye.y <= h) continue;
    const t = (h - eye.y) / dir.y, l = toLocal(shop, eye.x + dir.x * t, eye.z + dir.z * t);
    if (st.floors[L]?.has(tileKey(Math.floor(l.x + 0.5) - 0.5, Math.floor(l.z)))) return L;
  }
  return 0;
}
