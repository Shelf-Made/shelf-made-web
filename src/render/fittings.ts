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
  'furniture/plant-small-3', 'furniture/rug-rectangle', 'furniture/rug-doormat', 'furniture/lamp-wall', 'furniture/lamp-square-ceiling', 'market/fence', 'market/fence-door', 'food/cup-coffee',
  'furniture/bench', 'furniture/potted-plant', 'nature/tree-oak', 'nature/tree-default', 'nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb', 'suburban/planter'];

/** Where each new piece's geometry comes from: a Kenney model as it is, or one composed here ("gen:"). */
export const FITTING_MODEL: Partial<Record<FixtureType, string>> = {
  sofa: 'gen:sofa', cafe: 'gen:cafe', desk: 'gen:desk', bin: 'gen:bin', trolleys: 'gen:trolleys', speaker: 'gen:speaker', plant: 'gen:plant',
  screen: 'gen:screen', bookcase: 'gen:bookcase', flowers: 'gen:flowers', rug: 'gen:rug', doormat: 'gen:doormat',
  wall: 'gen:wall', wallWindow: 'gen:wallWindow', doorway: 'gen:doorway', railing: 'gen:railing', gate: 'market/fence-door',
  floorLamp: 'gen:floorLamp', wallLight: 'gen:wallLight', pendant: 'gen:pendant', neon: 'gen:neon', window: 'gen:windowTrim', pallet: 'gen:pallet',
  bench: 'gen:bench',
  flowerBed: 'gen:flowerBed', tree: 'gen:tree', planter: 'gen:planter', parkBench: 'gen:parkBench', bikeRack: 'gen:bikeRack', billboard: 'gen:billboard',
  stairs: 'gen:stairs', escalator: 'gen:escalator', elevator: 'gen:elevator', tallWall: 'gen:tallWall',
  camera: 'gen:camera', dome: 'gen:dome', smartCam: 'gen:smartCam', tagGate: 'gen:tagGate', storeRack: 'gen:storeRack',
  iceChest: 'gen:iceChest', coolProduce: 'gen:coolProduce', wallShelf: 'gen:wallShelf', glassCase: 'gen:glassCase', displayTable: 'gen:displayTable',
  bakeryCase: 'gen:bakeryCase', clothesRail: 'gen:clothesRail', vending: 'gen:vending', queueRail: 'gen:queueRail',
};

/** The walls among them: cut down to a ledge, like the shop's own walls, while the manager is inside. */
export const WALL_PIECES: ReadonlySet<string> = new Set(['gen:wall', 'gen:wallWindow', 'gen:doorway', 'gen:windowTrim', 'gen:tallWall']);
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
    // Kenney's park bench is doll's-house size next to the shop's shelves: one a grown-up can sit on.
    case 'gen:bench': case 'gen:parkBench': return m('furniture/bench', 0, 0, 0, 0, 2.6, 1.35, 2.4);
    case 'gen:sofa': return m('furniture/bench-cushion', 0, 0, 0, 0, 2.6, 1.35, 2.4);
    // A little bigger than Kenney's, to sit with the shop's shelves.
    case 'gen:bin': return m('furniture/trashcan', 0, 0, 0, 0, 1.35);
    case 'gen:speaker': return m('furniture/speaker', 0, 0, 0, 0, 1.4);
    case 'gen:plant': return m('furniture/potted-plant', 0, 0, 0, 0, 1.45);
    // Out on the lot.
    case 'gen:flowerBed': {
      // A low timber edge round dark soil, planted in rows.
      const parts: BufferGeometry[] = [box(pal, '#6B4A35', 0.84, 0.05, 0.84, 0, 0, 0)];
      for (const [x, z, w, d] of [[0, -0.41, 0.88, 0.06], [0, 0.41, 0.88, 0.06], [-0.41, 0, 0.06, 0.88], [0.41, 0, 0.06, 0.88]] as const) parts.push(box(pal, '#A87B45', w, 0.09, d, x, 0, z));
      const kinds = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) parts.push(m(kinds[(i * 3 + j * 2) % kinds.length]!, -0.24 + i * 0.24, 0.05, -0.24 + j * 0.24, (i + j) * 0.9, 0.85));
      return merge(parts);
    }
    case 'gen:tree': return merge([m('nature/tree-oak', 0, 0, 0, 0.4, 1.05), box(pal, '#6B4A35', 0.5, 0.02, 0.5, 0, 0, 0)]);
    case 'gen:planter': return m('suburban/planter', 0, 0, 0, 0, 1.2);
    case 'gen:bikeRack': {
      // Three steel hoops side by side; bikes are wheeled in from the front (drawn as they come and go).
      const parts: BufferGeometry[] = [box(pal, '#9AA0A8', 0.84, 0.02, 0.06, 0, 0, -0.1)];
      for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.28; parts.push(box(pal, '#9AA0A8', 0.025, 0.24, 0.025, x, 0, -0.22), box(pal, '#9AA0A8', 0.025, 0.24, 0.025, x, 0, 0.02), box(pal, '#9AA0A8', 0.025, 0.025, 0.27, x, 0.23, -0.1)); }
      return merge(parts);
    }
    case 'gen:billboard': {
      // Two legs and a board across both tiles, in the shop's colours (the name goes on in the store view).
      const parts: BufferGeometry[] = [];
      for (const x of [-0.75, 0.75]) parts.push(box(pal, '#4A4A52', 0.09, 1.0, 0.09, x, 0, -0.32));
      parts.push(box(pal, '#38383D', 1.86, 0.86, 0.06, 0, 0.82, -0.36), box(pal, sc.primary, 1.78, 0.78, 0.02, 0, 0.86, -0.32), box(pal, sc.accent, 1.78, 0.1, 0.022, 0, 0.9, -0.318));
      return merge(parts);
    }
    case 'gen:tallWall': return place(wall('market/wall'), 0, 0, 0, 0, 1, 2, 1);
    // The displays (tile space, the back against the tile's back edge at z −0.45; their stock goes in SLOT_BOXES).
    // An ice-cream chest: a white well with a sky-blue rim and glass edge, open on top.
    case 'gen:iceChest': return merge([
      box(pal, '#F7F7F5', 0.86, 0.2, 0.6, 0, 0, -0.15), box(pal, '#F7F7F5', 0.86, 0.22, 0.04, 0, 0.2, 0.13), box(pal, '#F7F7F5', 0.86, 0.22, 0.04, 0, 0.2, -0.43),
      box(pal, '#F7F7F5', 0.04, 0.22, 0.6, -0.41, 0.2, -0.15), box(pal, '#F7F7F5', 0.04, 0.22, 0.6, 0.41, 0.2, -0.15), box(pal, '#4F8FE0', 0.87, 0.05, 0.61, 0, 0.12, -0.15),
      box(pal, '#BFEFFF', 0.87, 0.02, 0.05, 0, 0.42, 0.13), box(pal, '#BFEFFF', 0.87, 0.02, 0.05, 0, 0.42, -0.43), box(pal, '#9AA0A8', 0.82, 0.01, 0.56, 0, 0.19, -0.15),
    ]);
    // Chilled produce: a stepped stand of crates under a canopy with a light bar, misted greens on the back board.
    case 'gen:coolProduce': return merge([
      box(pal, '#F7F7F5', 0.88, 0.28, 0.6, 0, 0, -0.15), box(pal, '#3FA87A', 0.89, 0.04, 0.61, 0, 0.26, -0.15),
      ...[-0.29, 0, 0.29].map((x) => box(pal, '#C8925A', 0.27, 0.06, 0.5, x, 0.3, -0.17)),
      box(pal, '#F7F7F5', 0.88, 0.6, 0.06, 0, 0.3, -0.45), box(pal, '#3FA87A', 0.92, 0.04, 0.24, 0, 0.88, -0.34), box(pal, '#FFFFFF', 0.8, 0.02, 0.05, 0, 0.86, -0.3),
    ]);
    // A wall shelf: two boards on brackets against the wall.
    case 'gen:wallShelf': return merge([
      box(pal, '#D9A066', 0.82, 0.03, 0.22, 0, 0.33, WALL_FACE + 0.11), box(pal, '#D9A066', 0.82, 0.03, 0.22, 0, 0.6, WALL_FACE + 0.11),
      ...[-0.36, 0.36].flatMap((x) => [box(pal, '#38383D', 0.02, 0.36, 0.02, x, 0.28, WALL_FACE + 0.01), box(pal, '#38383D', 0.02, 0.02, 0.18, x, 0.31, WALL_FACE + 0.1), box(pal, '#38383D', 0.02, 0.02, 0.18, x, 0.58, WALL_FACE + 0.1)]),
    ]);
    // A glass counter: a wooden base, a shelf of goods behind the glass, the glass top and corner posts.
    case 'gen:glassCase': return merge([
      box(pal, '#B8824C', 0.86, 0.28, 0.56, 0, 0, -0.17), box(pal, '#E9DCC4', 0.84, 0.02, 0.54, 0, 0.28, -0.17),
      ...[[-0.42, 0.1], [0.42, 0.1], [-0.42, -0.44], [0.42, -0.44]].map(([x, z]) => box(pal, '#D8D8DC', 0.02, 0.2, 0.02, x!, 0.3, z!)),
      box(pal, '#CFEFFF', 0.86, 0.015, 0.56, 0, 0.5, -0.17), box(pal, '#FFC044', 0.86, 0.02, 0.01, 0, 0.26, 0.115),
    ]);
    // A display table two tiles long: a pale top on four legs, a skirt in the shop's colour.
    case 'gen:displayTable': return merge([
      box(pal, '#F3E6CF', 1.86, 0.04, 0.74, 0, 0.32, 0), box(pal, sc.primary, 1.86, 0.06, 0.745, 0, 0.27, 0),
      ...[[-0.88, 0.32], [0.88, 0.32], [-0.88, -0.32], [0.88, -0.32]].map(([x, z]) => box(pal, '#B8824C', 0.05, 0.27, 0.05, x!, 0, z!)),
    ]);
    // A bakery case: a cream base, a stepped shelf behind a curved glass front, a striped awning.
    case 'gen:bakeryCase': return merge([
      box(pal, '#F3E6CF', 0.88, 0.3, 0.58, 0, 0, -0.16), box(pal, '#B8824C', 0.89, 0.03, 0.59, 0, 0.3, -0.16),
      box(pal, '#CFEFFF', 0.88, 0.2, 0.015, 0, 0.32, 0.12), box(pal, '#CFEFFF', 0.88, 0.015, 0.3, 0, 0.53, -0.02),
      ...[-0.43, 0.43].map((x) => box(pal, '#B8824C', 0.02, 0.24, 0.58, x, 0.3, -0.16)),
      box(pal, '#E8573F', 0.9, 0.05, 0.16, 0, 0.62, -0.38), box(pal, '#FFFFFF', 0.3, 0.051, 0.161, 0, 0.62, -0.38),
    ]);
    // A clothes rail: a bar between two uprights, shirts hanging on it, folded ones on the base.
    case 'gen:clothesRail': {
      const parts: BufferGeometry[] = [box(pal, '#D9A066', 0.86, 0.03, 0.4, 0, 0.08, -0.2), ...[-0.42, 0.42].flatMap((x) => [box(pal, '#9AA0A8', 0.03, 0.72, 0.03, x, 0.08, -0.2), box(pal, '#9AA0A8', 0.04, 0.02, 0.4, x, 0, -0.2)]), box(pal, '#9AA0A8', 0.86, 0.02, 0.02, 0, 0.78, -0.2)];
      const tops = ['#E8573F', '#4F8FE0', '#FFFFFF', '#3FA87A', '#FFC044', '#9B6FE0'];
      tops.forEach((c, i) => { const x = -0.33 + i * 0.13; parts.push(box(pal, c, 0.03, 0.28, 0.24, x, 0.48, -0.2), box(pal, c, 0.032, 0.05, 0.3, x, 0.71, -0.2), box(pal, '#38383D', 0.008, 0.04, 0.008, x, 0.76, -0.2)); });
      return merge(parts);
    }
    // A vending machine: a tall red-and-white cabinet, a window onto four shelves, a keypad, a lit header and a tray at the bottom.
    case 'gen:vending': return merge([
      box(pal, '#F7F7F5', 0.74, 0.04, 0.56, 0, 0, -0.17), box(pal, sc.primary, 0.74, 0.92, 0.04, 0, 0.04, -0.43),
      box(pal, sc.primary, 0.05, 0.92, 0.56, -0.345, 0.04, -0.17), box(pal, sc.primary, 0.17, 0.92, 0.56, 0.285, 0.04, -0.17), box(pal, sc.primary, 0.74, 0.06, 0.56, 0, 0.9, -0.17),
      box(pal, sc.primary, 0.58, 0.16, 0.56, -0.06, 0.04, -0.17), box(pal, '#222226', 0.4, 0.06, 0.02, -0.06, 0.08, 0.11),
      ...[0.2, 0.38, 0.56, 0.74].map((y) => box(pal, '#D8D8DC', 0.52, 0.012, 0.5, -0.06, y, -0.17)),
      box(pal, '#38383D', 0.1, 0.18, 0.012, 0.285, 0.55, 0.112), box(pal, '#FFFFFF', 0.13, 0.08, 0.02, 0.285, 0.8, 0.112), box(pal, '#FFC044', 0.58, 0.04, 0.012, -0.06, 0.92, 0.112),
    ]);
    // Belt barrier posts: a chrome post at each side of the tile (neighbours share the look of one line), a red belt between.
    case 'gen:queueRail': return merge([
      ...[-0.46, 0.46].flatMap((x) => [cylinder(pal, '#38383D', 0.07, 0.02, x, 0, 0, 12), cylinder(pal, '#D8D8DC', 0.018, 0.48, x, 0.02, 0, 8), cylinder(pal, '#D8D8DC', 0.028, 0.03, x, 0.48, 0, 10)]),
      box(pal, '#C8203A', 0.9, 0.05, 0.012, 0, 0.42, 0),
    ]);
    // Grey steel racking two tiles long, three shelves of brown boxes and the odd shrink-wrapped pallet load.
    case 'gen:storeRack': {
      const parts: BufferGeometry[] = [];
      const z0 = -0.45, depth = 0.62, zc = z0 + depth / 2;
      for (const x of [-0.95, 0, 0.95]) for (const z of [z0 + 0.02, z0 + depth - 0.02]) parts.push(box(pal, '#4E6A8C', 0.035, 0.98, 0.035, x, 0, z));
      for (const y of [0.04, 0.36, 0.68]) {
        parts.push(box(pal, '#F59E0B', 1.94, 0.03, 0.035, 0, y + 0.03, z0 + depth - 0.02), box(pal, '#F59E0B', 1.94, 0.03, 0.035, 0, y + 0.03, z0 + 0.02), box(pal, '#9AA0A8', 1.92, 0.012, depth - 0.04, 0, y + 0.045, zc));
        for (let i = 0; i < 6; i++) {
          const w = 0.22 + ((i * 7 + y * 10) % 3) * 0.03, h = 0.16 + ((i * 3 + y * 7) % 4) * 0.025;
          parts.push(box(pal, i % 3 === 2 ? '#C99A62' : '#D9B07A', w, h, 0.36, -0.78 + i * 0.31, y + 0.058, zc));
          parts.push(box(pal, '#B08350', w + 0.004, 0.02, 0.07, -0.78 + i * 0.31, y + 0.058 + h - 0.019, zc));
        }
      }
      return merge(parts);
    }
    // Security. A camera on a bracket high on the wall, looking out and down into the shop, its red light on.
    case 'gen:camera': {
      const body = merge([box(pal, '#F2F2F0', 0.1, 0.085, 0.2, 0, -0.0425, -0.1), box(pal, '#38383D', 0.075, 0.06, 0.02, 0, -0.03, 0.005), box(pal, '#38383D', 0.12, 0.012, 0.22, 0, 0.042, -0.1), box(pal, '#FF3B30', 0.014, 0.014, 0.01, 0.032, 0.008, 0.008)]);
      body.rotateX(0.45);
      body.translate(0, 0.8, WALL_FACE + 0.2);
      return merge([box(pal, '#9AA0A8', 0.08, 0.08, 0.02, 0, 0.83, WALL_FACE + 0.01), box(pal, '#9AA0A8', 0.025, 0.025, 0.12, 0, 0.855, WALL_FACE + 0.07), body]);
    }
    // A smoked dome on a white ring, up on the ceiling.
    case 'gen:dome': return merge([cylinder(pal, '#F2F2F0', 0.13, 0.025, 0, 0.92, 0, 16), cylinder(pal, '#2A2D33', 0.075, 0.05, 0, 0.87, 0, 16, 0.11), box(pal, '#FF3B30', 0.012, 0.01, 0.012, 0.09, 0.915, 0)]);
    // The smart one: a bigger dome with a ring of blue light round it.
    case 'gen:smartCam': return merge([cylinder(pal, '#F2F2F0', 0.17, 0.025, 0, 0.92, 0, 18), cylinder(pal, '#38A3E8', 0.165, 0.012, 0, 0.908, 0, 18), cylinder(pal, '#1E2228', 0.1, 0.065, 0, 0.845, 0, 18, 0.15)]);
    // Two pedestals either side of the way through, in white with a band of the shop's colour.
    case 'gen:tagGate': return merge([-1, 1].flatMap((k) => [box(pal, '#F2F2F0', 0.05, 0.56, 0.3, k * 0.42, 0, 0), box(pal, sc.primary, 0.054, 0.05, 0.304, k * 0.42, 0.42, 0), box(pal, '#9AA0A8', 0.09, 0.02, 0.34, k * 0.42, 0, 0)]));
    // Up to the next floor: each runs from its front (+z, on the floor) back and up a storey, through the opening above.
    case 'gen:stairs': {
      const parts: BufferGeometry[] = [];
      const n = 8, run = 2 / n, rise = 1 / n;
      for (let i = 0; i < n; i++) {
        const z = 1 - (i + 0.5) * run, top = (i + 1) * rise;
        parts.push(box(pal, '#C99A62', 0.86, top, run, 0, 0, z), box(pal, '#A87B45', 0.86, 0.02, 0.04, 0, top - 0.01, z + run / 2 - 0.02));
        // The strings either side, white, a little proud of the treads.
        for (const x of [-0.45, 0.45]) parts.push(box(pal, '#FFFFFF', 0.06, top + 0.06, run, x, 0, z));
      }
      // Handrails on posts, rising with the flight.
      for (const x of [-0.45, 0.45]) {
        parts.push(beam(pal, '#38383D', 0.04, x, 0.5, 1, 1.5, -1));
        for (const z of [0.95, 0, -0.95]) parts.push(box(pal, '#38383D', 0.03, 0.46, 0.03, x, (1 - z) / 2 + 0.03, z));
      }
      return merge(parts);
    }
    case 'gen:escalator': {
      const parts: BufferGeometry[] = [
        // Landing plates top and bottom, the moving steps between, a steel skirt and the truss under it.
        box(pal, '#9AA0A8', 0.8, 0.04, 0.3, 0, 0, 0.85), box(pal, '#9AA0A8', 0.8, 0.04, 0.3, 0, 0.98, -0.85),
        beam(pal, '#6E717C', 0.7, 0, 0.04, 0.7, 1.0, -0.7, 0.06),
        beam(pal, '#38383D', 0.84, 0, -0.12, 0.6, 0.86, -0.85, 0.2),
      ];
      for (let i = 0; i < 9; i++) { const t = (i + 0.5) / 9, z = 0.7 - 1.4 * t, y = 0.04 + 0.96 * t; parts.push(box(pal, '#B9BCC4', 0.68, 0.012, 0.02, 0, y + 0.03, z)); }
      for (const x of [-0.4, 0.4]) {
        // Glass balustrades with a black rubber handrail along the top.
        parts.push(beam(pal, '#BFEFFF', 0.03, x, 0.3, 0.75, 1.3, -0.85, 0.5), beam(pal, '#38383D', 0.06, x, 0.56, 0.8, 1.56, -0.9, 0.05));
        parts.push(beam(pal, '#9AA0A8', 0.05, x, 0.04, 0.85, 1.0, -0.85, 0.1));
      }
      return merge(parts);
    }
    case 'gen:elevator': {
      // A lift shaft two storeys tall: a steel frame round glass, doors on the front at each floor, the shop's colour above them.
      const parts: BufferGeometry[] = [];
      const H = 1.9;
      for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as const) parts.push(box(pal, '#9AA0A8', 0.08, H, 0.08, x, 0, z));
      parts.push(box(pal, '#BFEFFF', 0.03, H, 0.78, -0.42, 0, 0), box(pal, '#BFEFFF', 0.03, H, 0.78, 0.42, 0, 0), box(pal, '#BFEFFF', 0.78, H, 0.03, 0, 0, -0.42));
      parts.push(box(pal, '#9AA0A8', 0.92, 0.06, 0.92, 0, H, 0), box(pal, '#38383D', 0.76, 0.04, 0.76, 0, 0, 0));
      for (const y of [0, 1]) {
        parts.push(box(pal, '#B9BCC4', 0.37, 0.76, 0.03, -0.19, y + 0.02, 0.43), box(pal, '#B9BCC4', 0.37, 0.76, 0.03, 0.19, y + 0.02, 0.43));
        parts.push(box(pal, '#6E717C', 0.012, 0.76, 0.035, 0, y + 0.02, 0.43), box(pal, sc.primary, 0.84, 0.14, 0.04, 0, y + 0.8, 0.43));
        parts.push(box(pal, '#FFC044', 0.06, 0.06, 0.03, 0.3, y + 0.83, 0.455));
      }
      // The car, waiting at the bottom: a floor and a handrail seen through the glass.
      parts.push(box(pal, '#C99A62', 0.74, 0.03, 0.74, 0, 0.02, 0), box(pal, '#38383D', 0.7, 0.03, 0.03, 0, 0.45, -0.36));
      return merge(parts);
    }
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

/**
 * A bar between two points on the piece's centre line (x across it): from (y0, z0) to (y1, z1), `w` wide
 * and `h` thick, square to the slope.
 */
function beam(pal: AssetLibrary['palette'], hex: string, w: number, x: number, y0: number, z0: number, y1: number, z1: number, h = 0.04): BufferGeometry {
  const len = Math.hypot(y1 - y0, z1 - z0);
  const g = box(pal, hex, w, h, len, 0, -h / 2, 0);
  g.rotateX(Math.atan2(y1 - y0, z0 - z1));
  g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
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
