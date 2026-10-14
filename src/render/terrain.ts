import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { PaletteMap } from './palette';
import { box, merge } from './geometry';
import { groundHeight, BASIN, type TownPlan } from './town';
import { riverZ, RIVER_HALF_W } from '@/sim/layout';

/**
 * The land: one flat-shaded low-poly mesh. Rows run east–west; six of them follow the river so
 * its channel and banks are cut cleanly wherever it bends. Colour comes from height and slope:
 * lawn in the valley, meadow and forest floor on the hills, rock and snow on the peaks.
 */
const X0 = -164, X1 = 164, DX = 2.5;
type Row = { z: number } | { off: number; y: number };

export function terrainGeometry(pal: PaletteMap): BufferGeometry {
  const rows: Row[] = [];
  for (let z = -136; z <= 16.01; z += 3) rows.push({ z });
  const W = RIVER_HALF_W;
  rows.push({ off: -(W + 0.8), y: 0 }, { off: -(W - 0.15), y: -0.3 }, { off: -W * 0.45, y: -0.55 }, { off: W * 0.45, y: -0.55 }, { off: W - 0.15, y: -0.3 }, { off: W + 0.8, y: 0 });
  for (let z = 32; z <= 122.01; z += 3) rows.push({ z });
  const cols: number[] = [];
  for (let x = X0; x <= X1 + 1e-6; x += DX) cols.push(x);
  const vx = (i: number, j: number): [number, number, number] => {
    const x = cols[i]!, r = rows[j]!;
    if ('z' in r) return [x, groundHeight(x, r.z), r.z];
    const z = riverZ(x) + r.off;
    return [x, r.y === 0 ? groundHeight(x, z) : r.y, z];
  };
  const pos: number[] = [], uv: number[] = [];
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    const [u, v] = pal.uv(colourFor(a, b, c));
    pos.push(...a, ...b, ...c);
    uv.push(u, v, u, v, u, v);
  };
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols.length - 1; i++) {
    const a = vx(i, j), b = vx(i + 1, j), c = vx(i, j + 1), d = vx(i + 1, j + 1);
    // Alternate the diagonal for a less regular facet pattern.
    if ((i + j) % 2) { tri(a, c, b); tri(b, c, d); } else { tri(a, c, d); tri(a, d, b); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.translate(0, -0.02, 0);
  return g;
}

function h01(x: number, z: number): number { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

function colourFor(a: number[], b: number[], c: number[]): string {
  const lo = Math.min(a[1]!, b[1]!, c[1]!), hi = Math.max(a[1]!, b[1]!, c[1]!), avg = (a[1]! + b[1]! + c[1]!) / 3;
  const cx = (a[0]! + b[0]! + c[0]!) / 3, cz = (a[2]! + b[2]! + c[2]!) / 3;
  const n = h01(Math.round(cx * 3), Math.round(cz * 3));
  if (lo < -0.05) return avg < -0.45 ? '#3F8DBF' : '#B58A5C';
  const slope = (hi - lo) / 3;
  if (avg > 31) return '#F4F7FA';
  if (avg > 26) return n < 0.55 ? '#F4F7FA' : '#ADAAA4';
  if (avg > 20 || slope > 1.4) return n < 0.4 ? '#8E8C88' : n < 0.75 ? '#7D8C7A' : '#ADAAA4';
  if (avg > 2.2) return n < 0.45 ? '#3C8F4E' : n < 0.85 ? '#4FAE62' : '#6FB25C';
  if (avg > 0.05) return n < 0.5 ? '#6FB25C' : '#8CCB72';
  const inBasin = Math.abs(cx) < BASIN.x && cz > BASIN.zN && cz < BASIN.zS;
  return inBasin ? '#7CC26B' : (n < 0.5 ? '#7CC26B' : '#8CCB72');
}

/** The river's surface: a ribbon a little below the banks, deeper blue down the middle, pale edges. */
export function waterGeometry(pal: PaletteMap): BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  const band = (o0: number, o1: number, y: number, hex: string) => {
    const [u, v] = pal.uv(hex);
    for (let x = X0; x < X1; x += 1.25) {
      const x1 = x + 1.25, z0 = riverZ(x), z1 = riverZ(x1);
      const p = [x, y, z0 + o0], q = [x1, y, z1 + o0], r = [x, y, z0 + o1], s = [x1, y, z1 + o1];
      pos.push(...p, ...r, ...q, ...q, ...r, ...s);
      for (let k = 0; k < 6; k++) uv.push(u, v);
    }
  };
  // The banks slope from 0.3 below the bank top; the water meets them about 0.45 beyond the half width.
  const W = RIVER_HALF_W + 0.45;
  band(-W, W, -0.12, '#5AAFD8');
  band(-W * 0.35, W * 0.35, -0.116, '#4F9FD0');
  band(-W, -W + 0.16, -0.114, '#CDEBF7');
  band(W - 0.16, W, -0.114, '#CDEBF7');
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Stone road bridges: a solid deck under the road and sidewalks, parapets with a pale coping. */
export function bridgeGeometry(pal: PaletteMap, plan: TownPlan): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const b of plan.bridges) {
    const len = b.z1 - b.z0, cz = (b.z0 + b.z1) / 2;
    parts.push(box(pal, '#8E8C88', 3.2, 0.6, len, b.x, -0.6, cz));
    for (const side of [-1, 1]) {
      parts.push(box(pal, '#ADAAA4', 0.26, 1.0, len + 0.2, b.x + side * 1.68, -0.62, cz));
      parts.push(box(pal, '#D8D8DC', 0.32, 0.05, len + 0.26, b.x + side * 1.68, 0.38, cz));
      // End posts.
      for (const ez of [b.z0 - 0.05, b.z1 + 0.05]) parts.push(box(pal, '#D8D8DC', 0.36, 0.52, 0.36, b.x + side * 1.68, 0, ez));
    }
    // Two piers in the water.
    for (const pz of [riverZ(b.x) - 1.0, riverZ(b.x) + 1.0]) parts.push(box(pal, '#6F6D6A', 3.0, 0.5, 0.45, b.x, -0.62, pz));
  }
  return merge(parts);
}
