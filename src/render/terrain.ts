import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import type { PaletteMap } from './palette';
import { box, merge } from './geometry';
import { groundHeight } from './town';
import { BUS_STOP, BILLBOARDS } from '@/sim/layout';

/**
 * The land: one low-poly mesh with shared vertices, so colour blends softly from vertex to vertex
 * (no blotchy triangles) while flat shading still gives the cliffs their facets. Rows run east–west
 * and are finest over the pocket; six of them follow the creek so its channel is cut cleanly
 * wherever it bends. Colour comes from height, slope and a little noise: mottled lawn on the floor,
 * banded rock with moss on the cliffs, forest floor on the plateau, rock and snow on the far range.
 */
type Row = { z: number };

export function terrainGeometry(): BufferGeometry {
  const rows: Row[] = [];
  for (let z = -130; z < -40; z += 3) rows.push({ z });
  for (let z = -40; z < 46; z += 1.5) rows.push({ z });
  for (let z = 46; z <= 110.01; z += 3) rows.push({ z });
  const cols: number[] = [];
  for (let x = -150; x < -60; x += 3) cols.push(x);
  for (let x = -60; x < 60; x += 1.5) cols.push(x);
  for (let x = 60; x <= 150.01; x += 3) cols.push(x);
  const nx = cols.length;
  const vp: [number, number, number][] = [], vc: Color[] = [];
  for (const r of rows) for (const x of cols) {
    const z = r.z, y = groundHeight(x, z);
    vp.push([x, y, z]);
    const c = new Color(); colourAt(c, x, y, z); vc.push(c);
  }
  // Lawns and meadows blend from vertex to vertex; steep rock takes one colour per face, so the
  // cliffs keep crisp low-poly facets.
  const pos: number[] = [], col: number[] = [];
  const face = new Color();
  const tri = (i: number, j: number, k: number) => {
    const a = vp[i]!, b = vp[j]!, c = vp[k]!;
    const lo = Math.min(a[1], b[1], c[1]), hi = Math.max(a[1], b[1], c[1]);
    const steep = lo > -0.05 && (hi - lo) / 1.5 > 0.7;
    if (steep) rockFace(face, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3);
    for (const [v, p] of [[i, a], [j, b], [k, c]] as const) {
      pos.push(...p);
      const cc = steep ? face : vc[v]!;
      col.push(cc.r, cc.g, cc.b);
    }
  };
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if ((i + j) % 2) { tri(a, d, b); tri(b, d, e); } else { tri(a, d, e); tri(a, e, b); }
  }
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
const ROCK_A = K('#8C877F'), ROCK_B = K('#6F6A63'), ROCK_C = K('#A39B8D'), ROCK_WARM = K('#9A8572'), MOSS = K('#6E9A58');
const FOREST = K('#4C9A50'), FOREST_DARK = K('#3B7F45'), MEADOW = K('#6FB25C'), SNOW = K('#F4F7FA'), BANK = K('#8A6A4A'), BED = K('#6E5440');

function slopeAt(x: number, z: number): number {
  const e = 0.75;
  return Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
}

/** One face of cliff: banded strata, a warm or pale block here and there, moss on the low ledges. */
function rockFace(out: Color, x: number, y: number, z: number): void {
  if (y > 27) { out.copy(SNOW); return; }
  const r = h01(Math.round(x * 2), Math.round(z * 2 + y * 3));
  const band = Math.sin(y * 1.7 + vn(x / 7, z / 7) * 3) * 0.5 + 0.5;
  out.copy(ROCK_B).lerp(ROCK_A, band);
  if (r > 0.82) out.lerp(ROCK_C, 0.7); else if (r < 0.12) out.lerp(ROCK_WARM, 0.6);
  if (y < 2.2 && r > 0.4 && r < 0.6) out.lerp(MOSS, 0.6);
}

function colourAt(out: Color, x: number, y: number, z: number): void {
  if (y < -0.05) { out.copy(BANK).lerp(BED, Math.min(1, (-y - 0.05) / 0.4)); return; }
  const n1 = vn(x / 3.2, z / 3.2), n2 = vn(x / 9 + 11, z / 9 - 4), n3 = vn(x / 1.3 - 7, z / 1.3 + 3);
  const slope = y > 0.02 ? slopeAt(x, z) : 0;
  if (y > 27) { out.copy(ROCK_A).lerp(SNOW, Math.min(1, (y - 27) / 3 + n1 * 0.6)); return; }
  if (slope > 0.55) {
    // Banded rock: strata wobble with the noise; moss creeps over the gentler faces.
    const band = Math.sin(y * 1.9 + n2 * 4) * 0.5 + 0.5;
    out.copy(ROCK_B).lerp(ROCK_A, band).lerp(ROCK_C, Math.max(0, n3 - 0.6) * 1.8);
    out.lerp(MOSS, Math.max(0, Math.min(0.75, (1.3 - slope) * 0.9)) * n1);
    return;
  }
  if (y > 20) { out.copy(ROCK_A).lerp(FOREST_DARK, n1 * 0.6); return; }
  if (y > 1.2) { out.copy(FOREST).lerp(FOREST_DARK, n1).lerp(MEADOW, Math.max(0, n2 - 0.55) * 2); return; }
  if (y > 0.05) { out.copy(MEADOW).lerp(MOSS, n1 * 0.5); return; }
  // The floor of the pocket: soft mottled lawn, a little warmer in sunny patches.
  out.copy(LAWN).lerp(LAWN_LIGHT, n1 * 0.7).lerp(LAWN_DARK, Math.max(0, n2 - 0.5) * 1.2).lerp(LAWN_WARM, Math.max(0, n3 - 0.72) * 2.2);
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
  // Billboard frames: two legs and a dark back; the face (whatever ad is up) is drawn live.
  for (const b of BILLBOARDS) {
    const g: BufferGeometry[] = [];
    if (b.y === 0) for (const dx of [-1.1, 1.1]) g.push(box(pal, '#4A4A52', 0.12, 1.4, 0.12, dx, 0, -0.05));
    else for (const dx of [-1.0, 1.0]) g.push(box(pal, '#4A4A52', 0.1, 0.5, 0.5, dx, 0, 0));
    g.push(box(pal, '#38383D', 2.7, 1.2, 0.08, 0, b.y === 0 ? 1.3 : 0.45, -0.1));
    for (const p of g) { p.rotateY(b.yaw); p.translate(b.x, b.y, b.z); lit.push(p); }
  }
  return { lit: merge(lit), dark: merge(dark), glow: merge(glow) };
}
