/**
 * Small generated pieces in Kenney's flat, chunky style, shared by the game and `tools/gen-models.ts`
 * (which writes them out as GLBs so the art audit covers them).
 */
import type { BufferGeometry } from 'three';
import type { PaletteMap } from './palette';
import { box, cylinder, merge } from './geometry';

/**
 * A paper carrier bag hanging from a hand at the origin: the body in the store's colour, a folded
 * white top and two dark handles. Short and wide like a toy's (Kenney's people hold their hands low),
 * so it clears the ground and the colour still reads from afar. 0.125 tall.
 */
export const BAG_HEIGHT = 0.125;
export function bagGeometry(pal: PaletteMap, hex: string): BufferGeometry {
  return merge([
    box(pal, hex, 0.15, 0.095, 0.08, 0, -0.125, 0),
    box(pal, '#FFFFFF', 0.152, 0.02, 0.082, 0, -0.05, 0),
    box(pal, '#38383D', 0.009, 0.03, 0.009, -0.036, -0.03, 0),
    box(pal, '#38383D', 0.009, 0.03, 0.009, 0.036, -0.03, 0),
    box(pal, '#38383D', 0.081, 0.009, 0.009, 0, -0.004, 0),
  ]);
}

/**
 * A red shop basket hanging from a hand at the origin, as shoppers carry it round before the till:
 * the body with a dark rim, a handle to the hand, and what they have picked so far poking out of the
 * top (one to three goods). The same height as a bag, so it hangs from the hand the same way.
 */
const GOODS = ['#FFC044', '#4F8FE0', '#F4F7FA', '#3FA87A', '#E8573F', '#C88A4A'];
export function basketGeometry(pal: PaletteMap, n: number, seed = 0): BufferGeometry {
  const parts = [
    box(pal, '#D8453A', 0.16, 0.07, 0.1, 0, -0.125, 0),
    box(pal, '#A8322B', 0.164, 0.012, 0.104, 0, -0.058, 0),
    box(pal, '#A8322B', 0.009, 0.05, 0.009, -0.05, -0.05, 0),
    box(pal, '#A8322B', 0.009, 0.05, 0.009, 0.05, -0.05, 0),
    box(pal, '#38383D', 0.11, 0.01, 0.012, 0, -0.004, 0),
  ];
  for (let i = 0; i < n; i++) {
    const hex = GOODS[(seed + i * 2) % GOODS.length]!;
    const tall = i === 1 ? 0.05 : 0.035;
    parts.push(box(pal, hex, i === 1 ? 0.03 : 0.045, tall, 0.04, (i - (n - 1) / 2) * 0.045, -0.07, (i % 2 ? 0.015 : -0.015)));
  }
  return merge(parts);
}

/** One, two or three bags in one hand, fanned out a little. */
export function bagsGeometry(pal: PaletteMap, hex: string, n: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) parts.push(bagGeometry(pal, hex).translate((i - (n - 1) / 2) * 0.025, -i * 0.006, (i - (n - 1) / 2) * 0.085));
  return merge(parts);
}

/** Every model the corners' dressing can place (generated ones are written by tools/gen-models.ts). */
export const PROP_MODELS = ['furniture/bench', 'furniture/trashcan', 'roads/dumpster', 'suburban/planter', 'market/shopping-cart', 'commercial/parasol-a',
  'generated/sandwich-board', 'generated/bike-rack', 'generated/recycling-bins', 'generated/pallet', 'generated/hydrant', 'generated/trolley-shelter'];

/** A red fire hydrant: body, cap and two side nozzles. */
export function hydrantGeometry(pal: PaletteMap): BufferGeometry {
  return merge([
    cylinder(pal, '#E8573F', 0.06, 0.2, 0, 0, 0, 8), cylinder(pal, '#CF534F', 0.07, 0.03, 0, 0, 0, 8),
    cylinder(pal, '#E8573F', 0.045, 0.05, 0, 0.2, 0, 8, 0.02), box(pal, '#FFC044', 0.17, 0.035, 0.035, 0, 0.12, 0),
  ]);
}

/** Three wheelie bins side by side: blue for paper, green for glass, yellow for cans. */
export function recyclingGeometry(pal: PaletteMap): BufferGeometry {
  const parts: BufferGeometry[] = [];
  ['#4F8FE0', '#3FA87A', '#FFC044'].forEach((hex, i) => {
    const x = (i - 1) * 0.21;
    parts.push(box(pal, hex, 0.18, 0.26, 0.2, x, 0, 0), box(pal, '#38383D', 0.19, 0.025, 0.21, x, 0.26, 0), box(pal, '#38383D', 0.03, 0.04, 0.04, x - 0.06, 0, -0.1), box(pal, '#38383D', 0.03, 0.04, 0.04, x + 0.06, 0, -0.1));
  });
  return merge(parts);
}

/** A little bicycle, side on along x: two thin wheels, a frame in a colour, a saddle and bars. */
export function bikeGeometry(pal: PaletteMap, hex: string): BufferGeometry {
  const wheel = (x: number) => { const g = cylinder(pal, '#38383D', 0.09, 0.02, 0, 0, 0, 8); g.rotateX(Math.PI / 2); g.translate(x, 0.09, 0); return g; };
  const bar = (x0: number, y0: number, x1: number, y1: number) => { const len = Math.hypot(x1 - x0, y1 - y0); const g = box(pal, hex, len, 0.018, 0.018, 0, -0.009, 0); g.rotateZ(Math.atan2(y1 - y0, x1 - x0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); return g; };
  return merge([wheel(-0.13), wheel(0.13), bar(-0.13, 0.09, 0, 0.1), bar(0, 0.1, 0.1, 0.19), bar(-0.04, 0.19, 0.1, 0.19), bar(-0.13, 0.09, -0.04, 0.19), bar(0.13, 0.09, 0.1, 0.19), bar(0, 0.1, -0.04, 0.19),
    box(pal, '#38383D', 0.06, 0.02, 0.03, -0.05, 0.2, 0), box(pal, '#38383D', 0.015, 0.015, 0.1, 0.1, 0.21, 0)]);
}

/** A bike at full size for a rider (the street-dressing one is half scale): along z, its front toward +z. */
export function rideBikeGeometry(pal: PaletteMap, hex: string): BufferGeometry {
  const g = bikeGeometry(pal, hex);
  g.rotateY(-Math.PI / 2); g.scale(1.7, 1.7, 1.7);
  return g;
}

/** A steel bike rack (three hoops) with two bikes in it. */
export function bikeRackGeometry(pal: PaletteMap): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) { const z = (i - 1) * 0.16; parts.push(box(pal, '#9AA0A8', 0.02, 0.16, 0.02, -0.08, 0, z), box(pal, '#9AA0A8', 0.02, 0.16, 0.02, 0.08, 0, z), box(pal, '#9AA0A8', 0.18, 0.02, 0.02, 0, 0.16, z)); }
  parts.push(bikeGeometry(pal, '#E8573F').translate(0, 0, -0.08), bikeGeometry(pal, '#4F8FE0').translate(0, 0, 0.08));
  return merge(parts);
}

/** An A-frame sandwich board: a chalkboard each side in a wooden frame. */
export function sandwichBoardGeometry(pal: PaletteMap): BufferGeometry {
  const side = (s: 1 | -1) => {
    const g = merge([box(pal, '#B8824C', 0.22, 0.3, 0.02, 0, 0, 0), box(pal, '#38383D', 0.18, 0.22, 0.022, 0, 0.05, 0), box(pal, '#FFFFFF', 0.12, 0.015, 0.024, 0, 0.21, 0), box(pal, '#FFC044', 0.1, 0.015, 0.024, 0, 0.16, 0), box(pal, '#FFFFFF', 0.13, 0.015, 0.024, 0, 0.11, 0)]);
    g.rotateX(s * 0.2); g.translate(0, 0, s * 0.03);
    if (s < 0) g.rotateY(Math.PI);
    return g;
  };
  return merge([side(1), side(-1)]);
}

/** A wooden pallet with three crates of produce on it, waiting by the back door. */
export function palletGeometry(pal: PaletteMap): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) parts.push(box(pal, '#C8925A', 0.5, 0.02, 0.08, 0, 0.06, -0.18 + i * 0.12));
  for (const x of [-0.2, 0, 0.2]) parts.push(box(pal, '#9C6B47', 0.06, 0.06, 0.44, x, 0, 0));
  const crate = (x: number, z: number, y: number, fruit: string) => { parts.push(box(pal, '#D9A066', 0.2, 0.12, 0.16, x, y, z), box(pal, '#B8824C', 0.205, 0.025, 0.165, x, y + 0.05, z), box(pal, fruit, 0.17, 0.02, 0.13, x, y + 0.12, z)); };
  crate(-0.11, -0.08, 0.08, '#E8573F'); crate(0.11, -0.08, 0.08, '#FFC044'); crate(0, 0.1, 0.08, '#7CC26B');
  return merge(parts);
}

/** A trolley shelter: a slim canopy on two posts in a colour, over a row of trolleys (placed apart). */
export function trolleyShelterGeometry(pal: PaletteMap, hex: string): BufferGeometry {
  return merge([box(pal, '#9AA0A8', 0.04, 0.5, 0.04, -0.45, 0, -0.18), box(pal, '#9AA0A8', 0.04, 0.5, 0.04, 0.45, 0, -0.18), box(pal, hex, 1.0, 0.04, 0.45, 0, 0.5, 0), box(pal, '#FFFFFF', 0.9, 0.08, 0.02, 0, 0.42, -0.2)]);
}

/** A window poster: a coloured sheet with a white band and a price-tag circle, flat against glass. */
export function posterGeometry(pal: PaletteMap, bg: string, band = '#FFFFFF', tag = '#FFC044'): BufferGeometry {
  return merge([box(pal, bg, 0.26, 0.34, 0.006, 0, 0, 0), box(pal, band, 0.2, 0.05, 0.008, 0, 0.22, 0), box(pal, tag, 0.09, 0.09, 0.009, 0.05, 0.06, 0)]);
}

/** Bunting: little triangle flags in alternating colours along a cord from (0,0,0) to (len,0,0), sagging in the middle. */
export function buntingGeometry(pal: PaletteMap, len: number, colours: string[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const sag = (t: number) => -0.12 * 4 * t * (1 - t);
  const n = Math.max(3, Math.round(len / 0.18));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = t * len, y = sag(t);
    const f = box(pal, colours[i % colours.length]!, 0.1, 0.1, 0.004, 0, -0.05, 0);
    f.rotateZ(Math.PI / 4); f.scale(1, 1.2, 1); f.translate(x, y - 0.02, 0);
    parts.push(f);
    parts.push(box(pal, '#FFFFFF', len / n, 0.008, 0.008, x, y, 0));
  }
  return merge(parts);
}
