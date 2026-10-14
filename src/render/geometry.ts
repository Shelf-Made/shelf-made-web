/** Palette-coloured geometry helpers for generated pieces (walls, floors, sign, products). */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Euler, Vector3, Quaternion, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PaletteMap } from './palette';

/** Set every UV of a geometry to one palette cell (flat colour). */
export function paint(geo: BufferGeometry, pal: PaletteMap, hex: string): BufferGeometry {
  const [u, v] = pal.uv(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { arr[i * 2] = u; arr[i * 2 + 1] = v; }
  geo.setAttribute('uv', new Float32BufferAttribute(arr, 2));
  return geo;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpS = new Vector3();
const tmpP = new Vector3();

export function place(geo: BufferGeometry, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): BufferGeometry {
  tmpE.set(0, yaw, 0);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  geo.applyMatrix4(tmpM);
  return geo;
}

export function box(pal: PaletteMap, hex: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, yaw = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  paint(g, pal, hex);
  return place(g, x, y + h / 2, z, yaw);
}

export function cylinder(pal: PaletteMap, hex: string, r: number, h: number, x = 0, y = 0, z = 0, segments = 10, rTop = r): BufferGeometry {
  const g = new CylinderGeometry(rTop, r, h, segments);
  paint(g, pal, hex);
  return place(g, x, y + h / 2, z);
}

export function sphere(pal: PaletteMap, hex: string, r: number, x = 0, y = 0, z = 0, w = 8, h = 6): BufferGeometry {
  const g = new SphereGeometry(r, w, h);
  paint(g, pal, hex);
  return place(g, x, y, z);
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.filter((p) => p.getAttribute('position') && p.getAttribute('position').count > 0);
  if (clean.length === 0) return new BufferGeometry();
  // mergeGeometries needs identical attribute sets; drop extras.
  for (const g of clean) {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  const out = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  return out ?? new BufferGeometry();
}

/** Rounded-top block: a box with a smaller cap, reading as a soft pillow shape from the game camera. */
export function chunk(pal: PaletteMap, hex: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, yaw = 0, inset = 0.03): BufferGeometry {
  const body = box(pal, hex, w, h - inset, d, 0, 0, 0);
  const cap = box(pal, hex, w - inset * 2, inset, d - inset * 2, 0, h - inset, 0);
  const g = merge([body, cap]);
  return place(g, x, y, z, yaw);
}
