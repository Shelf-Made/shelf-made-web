/**
 * Small generated pieces in Kenney's flat, chunky style, shared by the game and `tools/gen-models.ts`
 * (which writes them out as GLBs so the art audit covers them).
 */
import type { BufferGeometry } from 'three';
import type { PaletteMap } from './palette';
import { box, merge } from './geometry';

/**
 * A paper carrier bag hanging from a hand at the origin: the body in the store's colour, a folded
 * white top and two dark handles. About a fifth of a person tall, so the colour reads from far off.
 */
export function bagGeometry(pal: PaletteMap, hex: string): BufferGeometry {
  return merge([
    box(pal, hex, 0.09, 0.11, 0.055, 0, -0.145, 0),
    box(pal, '#FFFFFF', 0.092, 0.022, 0.057, 0, -0.057, 0),
    box(pal, '#38383D', 0.008, 0.035, 0.008, -0.024, -0.035, 0),
    box(pal, '#38383D', 0.008, 0.035, 0.008, 0.024, -0.035, 0),
    box(pal, '#38383D', 0.056, 0.008, 0.008, 0, -0.004, 0),
  ]);
}

/** One, two or three bags in one hand, fanned out a little. */
export function bagsGeometry(pal: PaletteMap, hex: string, n: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) parts.push(bagGeometry(pal, hex).translate((i - (n - 1) / 2) * 0.02, -i * 0.012, (i - (n - 1) / 2) * 0.06));
  return merge(parts);
}
