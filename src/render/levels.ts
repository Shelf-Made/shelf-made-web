/**
 * Upstairs, as drawn. The sim walks each floor above the ground in a region of its own (see LEVEL_DZ); here
 * everyone and everything is carried back over the ground floor and up a storey a floor, and whoever is on the
 * stairs, an escalator or in a lift is drawn on their way between floors.
 */
import type { GameState, Person } from '@/sim/types';
import { TICK, liftWorld, toWorld } from '@/sim/layout';

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
