/**
 * Recolour Kenney geometry by moving triangles between colormap strips. Kenney's colormap is a
 * grid of gradient strips; a face's colour is which strip its UVs sit in, and its shading is
 * where in the strip. Moving the whole triangle to another strip keeps the gradient shading, so a
 * slate wall becomes a white wall that still looks hand-made by the same artist.
 *
 * Coordinates are for slot 0 of the atlas (Mini Market / Mini Characters colormap): 8 strips of
 * 64 px per row, 4 rows of 128 px. Row 2: cream, green, yellow, orange, red, blue, light blue,
 * purple. Row 3: charcoal, slate, dark slate, lavender grey, white, skin, brown, peach.
 */
import { Float32BufferAttribute, type BufferGeometry } from 'three';
import type { PaletteMap } from './palette';

export interface Strip { row: number; strip: number }
export type StripMap = (from: Strip) => Strip | null;

export const STRIP_HEX: Record<string, string> = {
  '1:0': '#F378F0', '2:0': '#FDE4C7', '2:1': '#3FA87A', '2:2': '#FFC044', '2:3': '#FF7E44', '2:4': '#CF534F', '2:5': '#6794D9', '2:6': '#D0E8FF', '2:7': '#A878E8',
  '3:0': '#38383D', '3:1': '#868BA1', '3:2': '#4F5260', '3:3': '#A0A8C9', '3:4': '#FFFFFF', '3:5': '#F1976C', '3:6': '#B06041', '3:7': '#F2BF99',
};

/** The colormap strip whose colour is nearest to a hex colour. */
export function nearestStrip(hex: string): Strip {
  const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r, g, b] = rgb(hex);
  let best = '2:0', bd = Infinity;
  for (const [k, h] of Object.entries(STRIP_HEX)) {
    const [cr, cg, cb] = rgb(h);
    const d = (cr! - r!) ** 2 + (cg! - g!) ** 2 + (cb! - b!) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  const [row, strip] = best.split(':').map(Number) as [number, number];
  return { row, strip };
}

/** Which strip a triangle's UV centroid falls in (slot 0 only), or null. */
export function stripOf(u: number, v: number): Strip | null {
  const ul = u * 4, vDown = v * 2;
  if (ul >= 1 || vDown >= 1 || ul < 0 || vDown < 0) return null;
  return { row: Math.floor(vDown * 4), strip: Math.floor(ul * 8) };
}

/** Return a recoloured copy of a geometry. Geometry UVs use glTF's v-down convention. */
export function recolor(geo: BufferGeometry, map: StripMap): BufferGeometry {
  const out = geo.clone();
  const uv = out.getAttribute('uv');
  if (!uv) return out;
  const n = uv.count;
  const src = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { src[i * 2] = uv.getX(i); src[i * 2 + 1] = uv.getY(i); }
  const dst = new Float32Array(src);
  const index = out.getIndex();
  const tris = index ? index.count / 3 : n / 3;
  const vid = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < tris; t++) {
    const a = vid(t, 0), b = vid(t, 1), c = vid(t, 2);
    const from = stripOf((src[a * 2]! + src[b * 2]! + src[c * 2]!) / 3, (src[a * 2 + 1]! + src[b * 2 + 1]! + src[c * 2 + 1]!) / 3);
    if (!from) continue;
    const to = map(from);
    if (!to || (to.row === from.row && to.strip === from.strip)) continue;
    const du = (to.strip - from.strip) / 8 / 4, dv = (to.row - from.row) / 4 / 2;
    for (const vtx of [a, b, c]) { dst[vtx * 2] = src[vtx * 2]! + du; dst[vtx * 2 + 1] = src[vtx * 2 + 1]! + dv; }
  }
  out.setAttribute('uv', new Float32BufferAttribute(dst, 2));
  return out;
}

/**
 * Repaint triangles by the colormap strip they sit in with flat palette colours ("row:strip" → hex),
 * for colours Kenney's strips do not have: the shop's scheme, honey wood, enamel. Every colour must
 * be baked into the palette (see tools/lib/palette.ts); others fall back to the nearest one.
 */
export function paintStrips(geo: BufferGeometry, pal: PaletteMap, map: Record<string, string>): BufferGeometry {
  const out = geo.index ? geo.toNonIndexed() : geo.clone();
  const uv = out.getAttribute('uv');
  if (!uv) return out;
  const dst = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { dst[i * 2] = uv.getX(i); dst[i * 2 + 1] = uv.getY(i); }
  for (let t = 0; t < uv.count / 3; t++) {
    const s = stripOf((dst[t * 6]! + dst[t * 6 + 2]! + dst[t * 6 + 4]!) / 3, (dst[t * 6 + 1]! + dst[t * 6 + 3]! + dst[t * 6 + 5]!) / 3);
    const hex = s && map[`${s.row}:${s.strip}`];
    if (!hex) continue;
    const [u, v] = pal.uv(hex);
    for (let k = 0; k < 3; k++) { dst[(t * 3 + k) * 2] = u; dst[(t * 3 + k) * 2 + 1] = v; }
  }
  out.setAttribute('uv', new Float32BufferAttribute(dst, 2));
  return out;
}

/** The strips a geometry uses, by triangle count (to find a product's main colour). */
export function stripCounts(geo: BufferGeometry): Map<string, number> {
  const uv = geo.getAttribute('uv');
  const out = new Map<string, number>();
  if (!uv) return out;
  const index = geo.getIndex();
  const tris = index ? index.count / 3 : uv.count / 3;
  const vid = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < tris; t++) {
    const a = vid(t, 0), b = vid(t, 1), c = vid(t, 2);
    const s = stripOf((uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3);
    if (s) { const k = `${s.row}:${s.strip}`; out.set(k, (out.get(k) ?? 0) + 1); }
  }
  return out;
}

/** Clamp every vertex above `h` down to `h`: a clean cut-down copy of a wall in the same style. */
export function cutDown(geo: BufferGeometry, h: number): BufferGeometry {
  const out = geo.clone();
  const pos = out.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = Math.min(h, pos.getY(i)); arr[i * 3 + 2] = pos.getZ(i); }
  out.setAttribute('position', new Float32BufferAttribute(arr, 3));
  out.computeVertexNormals();
  return out;
}

/**
 * A model standing taller than `h` pressed down to it: what is over `from` squeezed in between (its normals with it),
 * what is under left where it was (a shelf's boards, the stock on them). No taller than `h`: as it was.
 */
export function pressUnder(geo: BufferGeometry, h: number, from: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  if (top <= h) return geo;
  const out = geo.clone(), p = out.getAttribute('position'), n = out.getAttribute('normal'), k = (h - from) / (top - from);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= from) continue;
    p.setY(i, from + (y - from) * k);
    if (n) { const nx = n.getX(i), ny = n.getY(i) / k, nz = n.getZ(i), l = Math.hypot(nx, ny, nz); n.setXYZ(i, nx / l, ny / l, nz / l); }
  }
  return out;
}

/** Drop triangles matching a predicate on their centroid (e.g. the painted glass lid of a chest freezer). */
export function dropTriangles(geo: BufferGeometry, drop: (x: number, y: number, z: number) => boolean): BufferGeometry {
  const out = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = out.getAttribute('position');
  const keep: number[] = [];
  for (let t = 0; t < pos.count / 3; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(t * 3 + k); y += pos.getY(t * 3 + k); z += pos.getZ(t * 3 + k); }
    if (!drop(x / 3, y / 3, z / 3)) keep.push(t);
  }
  for (const name of Object.keys(out.attributes)) {
    const a = out.getAttribute(name);
    const size = a.itemSize;
    const arr = new Float32Array(keep.length * 3 * size);
    keep.forEach((t, i) => { for (let k = 0; k < 3; k++) for (let c = 0; c < size; c++) arr[(i * 3 + k) * size + c] = a.getComponent(t * 3 + k, c); });
    out.setAttribute(name, new Float32BufferAttribute(arr, size));
  }
  return out;
}
