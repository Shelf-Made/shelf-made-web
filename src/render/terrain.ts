import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import type { PaletteMap } from './palette';
import { box, merge } from './geometry';
import { BUS_STOP, BILLBOARDS } from '@/sim/layout';

/**
 * The land: one flat plain. Mottled lawn over the town, fading to a single even green further out,
 * where the fog takes it: the roads run off into empty space. A fine grid over the town carries the
 * mottling (colour blends from vertex to vertex); four big quads carry the plain out past the fog.
 */
const INNER = { x0: -48, x1: 48, z0: -40, z1: 46 };
const STEP = 2, FAR = 320;

export function terrainGeometry(): BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const c = new Color();
  const push = (x: number, z: number) => { pos.push(x, 0, z); colourAt(c, x, z); col.push(c.r, c.g, c.b); };
  for (let z = INNER.z0; z < INNER.z1; z += STEP) for (let x = INNER.x0; x < INNER.x1; x += STEP) {
    const flip = ((x - INNER.x0) / STEP + (z - INNER.z0) / STEP) % 2;
    const a: [number, number] = [x, z], b: [number, number] = [x + STEP, z], d: [number, number] = [x, z + STEP], e: [number, number] = [x + STEP, z + STEP];
    for (const v of flip ? [a, d, b, b, d, e] : [a, d, e, a, e, b]) push(v[0], v[1]);
  }
  // The plain beyond, in four quads round the inner grid.
  const quad = (x0: number, z0: number, x1: number, z1: number) => { for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]] as const) push(x, z); };
  quad(-FAR, -FAR, FAR, INNER.z0); quad(-FAR, INNER.z1, FAR, FAR);
  quad(-FAR, INNER.z0, INNER.x0, INNER.z1); quad(INNER.x1, INNER.z0, FAR, INNER.z1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.translate(0, -0.02, 0);
  return g;
}

function h01(x: number, z: number): number { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
function vn(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h01(xi, zi), b = h01(xi + 1, zi), c = h01(xi, zi + 1), d = h01(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const K = (hex: string) => new Color(hex);
const LAWN = K('#7CC26B'), LAWN_LIGHT = K('#97D27A'), LAWN_DARK = K('#62AB57'), LAWN_WARM = K('#A9C96C');

/** Soft mottled lawn in town, a little warmer in sunny patches; even green by the edge of the grid. */
function colourAt(out: Color, x: number, z: number): void {
  const n1 = vn(x / 3.2, z / 3.2), n2 = vn(x / 9 + 11, z / 9 - 4), n3 = vn(x / 1.3 - 7, z / 1.3 + 3);
  const edge = Math.min(x - INNER.x0, INNER.x1 - x, z - INNER.z0, INNER.z1 - z);
  const k = Math.max(0, Math.min(1, edge / 14));
  out.copy(LAWN).lerp(LAWN_LIGHT, n1 * 0.7 * k).lerp(LAWN_DARK, Math.max(0, n2 - 0.5) * 1.2 * k).lerp(LAWN_WARM, Math.max(0, n3 - 0.72) * 2.2 * k);
}

/**
 * Street furniture that is easier to build than to find: the bus shelter, the billboard frames
 * (their faces are drawn live by the town view) and the corner signal boxes.
 */
export function structuresGeometry(pal: PaletteMap): { lit: BufferGeometry; dark: BufferGeometry; glow: BufferGeometry } {
  const lit: BufferGeometry[] = [], dark: BufferGeometry[] = [], glow: BufferGeometry[] = [];
  // The bus shelter: two posts, a glass back, a canopy and a bench, facing the road.
  { const x = BUS_STOP.x, z = BUS_STOP.z + 0.15;
    for (const dx of [-0.8, 0.8]) lit.push(box(pal, '#38383D', 0.06, 1.15, 0.06, x + dx, 0, z + 0.2));
    lit.push(box(pal, '#38383D', 1.8, 0.06, 0.62, x, 1.15, z));
    lit.push(box(pal, '#4F8FE0', 1.82, 0.08, 0.64, x, 1.21, z));
    lit.push(box(pal, '#CFE9F7', 1.6, 0.9, 0.03, x, 0.2, z + 0.22));
    lit.push(box(pal, '#D9A066', 1.2, 0.05, 0.22, x, 0.28, z + 0.1), box(pal, '#38383D', 0.05, 0.28, 0.05, x - 0.5, 0, z + 0.1), box(pal, '#38383D', 0.05, 0.28, 0.05, x + 0.5, 0, z + 0.1));
    // The stop sign on its pole: a blue disc with a white bar.
    lit.push(box(pal, '#9AA0A8', 0.05, 1.5, 0.05, x - 1.2, 0, z - 0.1), box(pal, '#4F8FE0', 0.32, 0.32, 0.04, x - 1.2, 1.45, z - 0.1), box(pal, '#FFFFFF', 0.22, 0.06, 0.05, x - 1.2, 1.58, z - 0.1)); }
  // Billboard frames: two legs down to the ground and a dark back; the face (whatever ad is up) is drawn live.
  for (const b of BILLBOARDS) {
    const g: BufferGeometry[] = [];
    for (const dx of [-1.1, 1.1]) g.push(box(pal, '#4A4A52', 0.12, 1.4 + b.y, 0.12, dx, -b.y, -0.05));
    if (b.y > 0) g.push(box(pal, '#4A4A52', 2.3, 0.06, 0.06, 0, 0.6 - b.y, -0.05));
    g.push(box(pal, '#38383D', 2.7, 1.2, 0.08, 0, 1.3, -0.1));
    for (const p of g) { p.rotateY(b.yaw); p.translate(b.x, b.y, b.z); lit.push(p); }
  }
  return { lit: merge(lit), dark: merge(dark), glow: merge(glow) };
}
