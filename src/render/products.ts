/** Product block shapes: body painted with the white cell so an instance colour tints it; accent band separate. */
import type { BufferGeometry } from 'three';
import { box, cylinder, sphere, merge, chunk } from './geometry';
import type { PaletteMap } from './palette';
import type { Shape } from '@/sim/products';

export interface ShapeGeo { body: BufferGeometry; accent: BufferGeometry; w: number; h: number; d: number }

const WHITE = '#FFFFFF';

export function buildShapes(pal: PaletteMap): Record<Shape, ShapeGeo> {
  const S = (body: BufferGeometry, accent: BufferGeometry, w: number, h: number, d: number): ShapeGeo => ({ body, accent, w, h, d });
  return {
    box: S(chunk(pal, WHITE, 0.16, 0.22, 0.1), box(pal, WHITE, 0.165, 0.06, 0.105, 0, 0.1, 0), 0.16, 0.22, 0.1),
    bottle: S(merge([cylinder(pal, WHITE, 0.05, 0.2, 0, 0, 0, 8), cylinder(pal, WHITE, 0.025, 0.07, 0, 0.2, 0, 6)]), cylinder(pal, WHITE, 0.052, 0.05, 0, 0.09, 0, 8), 0.1, 0.27, 0.1),
    can: S(cylinder(pal, WHITE, 0.05, 0.16, 0, 0, 0, 10), cylinder(pal, WHITE, 0.052, 0.05, 0, 0.055, 0, 10), 0.1, 0.16, 0.1),
    bag: S(chunk(pal, WHITE, 0.2, 0.3, 0.1, 0, 0, 0, 0, 0.04), box(pal, WHITE, 0.205, 0.08, 0.105, 0, 0.13, 0), 0.2, 0.3, 0.1),
    carton: S(merge([box(pal, WHITE, 0.12, 0.22, 0.12), box(pal, WHITE, 0.12, 0.05, 0.08, 0, 0.22, 0)]), box(pal, WHITE, 0.125, 0.07, 0.125, 0, 0.08, 0), 0.12, 0.27, 0.12),
    fruit: S(sphere(pal, WHITE, 0.055, 0, 0.055, 0), cylinder(pal, WHITE, 0.012, 0.03, 0, 0.1, 0, 5), 0.11, 0.12, 0.11),
    bread: S(merge([box(pal, WHITE, 0.22, 0.1, 0.12), cylinder(pal, WHITE, 0.06, 0.22, 0, 0.1, 0, 8).rotateZ(Math.PI / 2).translate(0, -0.0, 0)]), box(pal, WHITE, 0.08, 0.02, 0.125, 0, 0.1, 0), 0.22, 0.16, 0.12),
    tray: S(box(pal, WHITE, 0.2, 0.06, 0.14), box(pal, WHITE, 0.21, 0.015, 0.15, 0, 0.06, 0), 0.2, 0.08, 0.14),
    jar: S(cylinder(pal, WHITE, 0.055, 0.14, 0, 0, 0, 8), cylinder(pal, WHITE, 0.05, 0.03, 0, 0.14, 0, 8), 0.11, 0.17, 0.11),
    jug: S(merge([box(pal, WHITE, 0.12, 0.2, 0.1), cylinder(pal, WHITE, 0.03, 0.04, 0.02, 0.2, 0, 6)]), box(pal, WHITE, 0.125, 0.05, 0.105, 0, 0.06, 0), 0.12, 0.24, 0.1),
  };
}
