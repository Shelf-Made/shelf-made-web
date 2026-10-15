import type { BufferGeometry } from 'three';
import type { AssetLibrary } from './assets';
import type { FixtureType } from '@/sim/types';
import type { Scheme } from '@/sim/schemes';
import { box, cylinder, merge, place } from './geometry';
import { recolor, paintStrips } from './recolor';
import { WALL_COLOURS } from './storeArt';

/**
 * The pieces the Build card sells beyond shelves and tills: furniture, decor, walls inside the shop
 * and lights. Each is one geometry in tile space (the tile's centre at the origin, its front toward
 * +z), mostly Kenney's furniture composed into a set (a café table with its chairs, a help desk with
 * its screen), the rest made here in the same blocky style. Lights also have a glowing part, drawn
 * on its own so it can light up after dark.
 */

/** Furniture models the pieces are made from (loaded with the shop's other models). */
export const FITTING_MODELS = ['furniture/bench-cushion', 'furniture/side-table', 'furniture/chair', 'furniture/desk', 'furniture/computer-screen', 'furniture/trashcan',
  'furniture/speaker', 'furniture/cabinet-television', 'furniture/television-modern', 'furniture/bookcase-open', 'furniture/books', 'furniture/plant-small-1', 'furniture/plant-small-2',
  'furniture/plant-small-3', 'furniture/rug-rectangle', 'furniture/rug-doormat', 'furniture/lamp-wall', 'furniture/lamp-square-ceiling', 'market/fence', 'market/fence-door', 'food/cup-coffee'];

/** Where each new piece's geometry comes from: a Kenney model as it is, or one composed here ("gen:"). */
export const FITTING_MODEL: Partial<Record<FixtureType, string>> = {
  sofa: 'furniture/bench-cushion', cafe: 'gen:cafe', desk: 'gen:desk', bin: 'furniture/trashcan', trolleys: 'gen:trolleys', speaker: 'furniture/speaker',
  screen: 'gen:screen', bookcase: 'gen:bookcase', flowers: 'gen:flowers', rug: 'gen:rug', doormat: 'gen:doormat',
  wall: 'gen:wall', wallWindow: 'gen:wallWindow', doorway: 'gen:doorway', railing: 'gen:railing', gate: 'market/fence-door',
  floorLamp: 'gen:floorLamp', wallLight: 'gen:wallLight', pendant: 'gen:pendant', neon: 'gen:neon', window: 'gen:windowTrim', pallet: 'gen:pallet',
};

/** The walls among them: cut down to a ledge, like the shop's own walls, while the manager is inside. */
export const WALL_PIECES: ReadonlySet<string> = new Set(['gen:wall', 'gen:wallWindow', 'gen:doorway', 'gen:windowTrim']);
/** Pieces that vanish (rather than being cut down) with the walls: a window's frame has nothing left to frame. */
export const GONE_WITH_WALLS: ReadonlySet<string> = new Set(['gen:windowTrim']);

/** Tiles' floor finish sits 0.0125 up: flat things lie on top of it. */
const ON_FLOOR = 0.014;
/** The inside face of the shop's outer wall, from the centre of a tile against it. */
const WALL_FACE = -0.44;

/** The opening of a window in the shell's walls (Kenney's wall-window), across the wall and up it, from the tile's centre. */
export function windowOpening(assets: AssetLibrary): { w: number; y0: number; y1: number } {
  const g = assets.glassGeometry('market/wall-window');
  if (!g) return { w: 0.56, y0: 0.3, y1: 0.78 };
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return { w: b.max.x - b.min.x, y0: b.min.y, y1: b.max.y };
}

/** A window's frame and sill on the inside of the wall, in the shop's white trim. */
function windowTrim(assets: AssetLibrary): BufferGeometry {
  const pal = assets.palette;
  const o = windowOpening(assets), t = 0.035, z = WALL_FACE + 0.012, h = o.y1 - o.y0;
  return merge([
    box(pal, '#FFFFFF', o.w + 2 * t + 0.04, 0.028, 0.075, 0, o.y0 - 0.028, WALL_FACE + 0.035),
    box(pal, '#FFFFFF', t, h, 0.024, -o.w / 2 - t / 2, o.y0, z), box(pal, '#FFFFFF', t, h, 0.024, o.w / 2 + t / 2, o.y0, z),
    box(pal, '#FFFFFF', o.w + 2 * t, t, 0.024, 0, o.y1, z),
  ]);
}

/** Placing a window: its frame and a pane filling the opening, so the ghost reads as a window in the wall. */
export function windowGhost(assets: AssetLibrary): BufferGeometry {
  const o = windowOpening(assets);
  return merge([windowTrim(assets), box(assets.palette, '#FFFFFF', o.w, o.y1 - o.y0, 0.02, 0, o.y0, WALL_FACE + 0.004)]);
}

/** A composed piece. */
export function fittingGeometry(assets: AssetLibrary, id: string, sc: Scheme): BufferGeometry {
  const pal = assets.palette;
  const m = (model: string, x = 0, y = 0, z = 0, yaw = 0, s = 1, sy = s, sz = s) => place(assets.geometry(model).clone(), x, y, z, yaw, s, sy, sz);
  // Walls inside the shop wear the outside's paint: white with the stripe in the shop's colour.
  const wall = (model: string) => place(paintStrips(recolor(assets.geometry(model), WALL_COLOURS), pal, { '2:1': sc.primary }), 0, 0, 0, 0, 1, 1, 0.38);
  switch (id) {
    case 'gen:cafe': return merge([m('furniture/side-table', 0, 0, 0, 0, 1.15), m('furniture/chair', -0.34, 0, 0, Math.PI / 2), m('furniture/chair', 0.34, 0, 0, -Math.PI / 2), m('food/cup-coffee', -0.08, 0.354, 0.02, 0, 0.6), m('food/cup-coffee', 0.1, 0.354, -0.03, 1, 0.6)]);
    case 'gen:desk': return merge([m('furniture/desk', 0, 0, 0.05, 0, 1.3), m('furniture/computer-screen', 0.12, 0.4, -0.05, Math.PI + 0.3, 1.1), box(pal, sc.primary, 0.5, 0.12, 0.02, 0, 0.18, 0.26), box(pal, '#FFFFFF', 0.2, 0.03, 0.022, 0, 0.225, 0.262)]);
    case 'gen:trolleys': return merge([0, 1, 2].map((i) => m('market/shopping-cart', 0, 0, 0.18 - i * 0.13)).concat([box(pal, sc.primary, 0.05, 0.4, 0.05, -0.22, 0, -0.2), box(pal, sc.primary, 0.05, 0.4, 0.05, 0.22, 0, -0.2), box(pal, sc.primary, 0.5, 0.05, 0.05, 0, 0.38, -0.2)]));
    case 'gen:screen': return merge([m('furniture/cabinet-television', 0, 0, -0.05, 0, 1.1), m('furniture/television-modern', 0, 0.272, -0.05, 0, 1.2), box(pal, sc.primary, 0.56, 0.06, 0.012, 0, 0.3, 0.012)]);
    case 'gen:bookcase': return merge([m('furniture/bookcase-open', 0, 0, -0.05, 0, 1.4), ...[0.02, 0.33, 0.64].flatMap((y, i) => [m('furniture/books', -0.1, y, -0.04, 0.1 * i, 1.3), m('furniture/books', 0.11, y, -0.04, -0.1, 1.2)])]);
    case 'gen:flowers': return merge([m('furniture/side-table', 0, 0, 0, 0, 1.1), m('furniture/plant-small-1', -0.15, 0.338, 0, 0, 1.6), m('furniture/plant-small-2', 0, 0.338, 0.02, 0.6, 1.8), m('furniture/plant-small-3', 0.15, 0.338, -0.01, 1.2, 1.6)]);
    case 'gen:rug': return m('furniture/rug-rectangle', 0, ON_FLOOR, 0, 0, 0.74, 1, 0.74);
    case 'gen:doormat': return m('furniture/rug-doormat', 0, ON_FLOOR, 0, 0, 2.2, 1, 2.2);
    case 'gen:wall': return wall('market/wall');
    case 'gen:wallWindow': return wall('market/wall-window');
    case 'gen:doorway': return wall('market/wall-door');
    // Kenney's fence piece runs from one post to the middle: two of them, back to back, span the tile.
    case 'gen:railing': return merge([m('market/fence', 0, 0, 0), m('market/fence', 0, 0, 0, Math.PI)]);
    case 'gen:floorLamp': return merge([cylinder(pal, '#38383D', 0.07, 0.02, 0, 0, 0, 12), cylinder(pal, '#38383D', 0.012, 0.5, 0, 0.02, 0, 6), cylinder(pal, '#FFF3DC', 0.09, 0.12, 0, 0.5, 0, 14, 0.065)]);
    case 'gen:wallLight': return merge([m('furniture/lamp-wall', 0, 0.62, WALL_FACE + 0.06, 0, 1.6)]);
    case 'gen:pendant': return merge([box(pal, '#38383D', 0.008, 0.2, 0.008, 0, 0.8, 0), m('furniture/lamp-square-ceiling', 0, 0.64, 0, 0, 1.6)]);
    case 'gen:neon': return merge([box(pal, '#222226', 0.56, 0.3, 0.02, 0, 0.52, WALL_FACE + 0.01)]);
    case 'gen:windowTrim': return windowTrim(assets);
    case 'gen:pallet': {
      // Like the delivery pallet by the back door: a hazard border on the floor round a wooden pallet.
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 10; i++) {
        const c = i % 2 ? '#38383D' : '#FFC044', a = -0.5 + (i + 0.5) / 10;
        parts.push(box(pal, c, 0.1, 0.006, 0.05, a, ON_FLOOR, 0.465), box(pal, c, 0.1, 0.006, 0.05, a, ON_FLOOR, -0.465));
        parts.push(box(pal, c, 0.05, 0.006, 0.1, 0.465, ON_FLOOR, a), box(pal, c, 0.05, 0.006, 0.1, -0.465, ON_FLOOR, a));
      }
      for (const x of [-0.33, 0, 0.33]) parts.push(box(pal, '#A87B45', 0.1, 0.06, 0.8, x, ON_FLOOR, 0));
      for (const z of [-0.32, -0.16, 0, 0.16, 0.32]) parts.push(box(pal, '#C99A62', 0.82, 0.025, 0.11, 0, ON_FLOOR + 0.06, z));
      return merge(parts);
    }
  }
  return assets.geometry('market/column');
}

/** The part of a light that glows: the lamp's shade or bulb, the neon's tubes (tile space, like the piece). */
export function glowGeometry(type: FixtureType, pal: AssetLibrary['palette']): BufferGeometry | null {
  switch (type) {
    // Lit, the whole shade glows (seen from above, a bulb under it would not show).
    case 'floorLamp': return cylinder(pal, '#FFFFFF', 0.094, 0.126, 0, 0.497, 0, 14, 0.069);
    case 'wallLight': return box(pal, '#FFFFFF', 0.3, 0.13, 0.2, 0, 0.615, WALL_FACE + 0.06);
    case 'pendant': return box(pal, '#FFFFFF', 0.165, 0.3, 0.165, 0, 0.635, 0);
    case 'neon': {
      // A heart and "OPEN" are too fine for the tubes at this size: a bright frame and a zigzag.
      const t = 0.024, z = WALL_FACE + 0.03, y0 = 0.4, y1 = 0.64, x0 = -0.24, x1 = 0.24;
      const parts = [box(pal, '#FFFFFF', x1 - x0, t, t, 0, y0, z), box(pal, '#FFFFFF', x1 - x0, t, t, 0, y1, z), box(pal, '#FFFFFF', t, y1 - y0, t, x0, y0, z), box(pal, '#FFFFFF', t, y1 - y0, t, x1, y0, z)];
      for (let i = 0; i < 6; i++) { const a = x0 + 0.05 + i * 0.065; const g = box(pal, '#FFFFFF', 0.075, t, t, 0, 0, 0); g.rotateZ(i % 2 ? 0.9 : -0.9); g.translate(a + 0.03, 0.52, z); parts.push(g); }
      return merge(parts);
    }
    default: return null;
  }
}

/** Lights that come on after dark (the neon is on all the time). */
export const LAMPS: ReadonlySet<FixtureType> = new Set(['floorLamp', 'wallLight', 'pendant']);
