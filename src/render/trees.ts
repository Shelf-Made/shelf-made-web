/**
 * Detailed low-poly trees, generated at load in the town's own faceted style and palette, standing in
 * for Kenney's simplest tree models under the same ids (so every garden, verge and clump uses them).
 * Each has a tapered trunk with a root flare and bark in two browns, real branches out to its crown,
 * and a crown of several faceted leaf clusters, lit faces lighter and the undersides darker. Conifers
 * stack jagged tiers; a birch has white bark with dark marks. Every id is its own seeded tree.
 */
import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, CylinderGeometry, ConeGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import type { PaletteMap } from './palette';

type Shades = readonly [dark: string, mid: string, light: string];

const GREEN: Shades = ['#2E6B4F', '#3C8F4E', '#6FB25C'];
const GREEN_B: Shades = ['#2F7D4F', '#4FAE62', '#7CC26B'];
const DARK: Shades = ['#22513B', '#24603D', '#2F7D4F'];
const YOUNG: Shades = ['#3C8F4E', '#7CC26B', '#8CCB72'];
const FALL: Shades = ['#C9541C', '#E8903F', '#FFC044'];
const FALL_B: Shades = ['#F2702E', '#D99A2B', '#E9C46A'];
const PINE: Shades = ['#22513B', '#2E6B4F', '#2E8560'];
const BARK = ['#6E4630', '#8B5A3C'] as const;

type Kind = 'broadleaf' | 'round' | 'conifer' | 'poplar' | 'birch' | 'young';
interface Spec { kind: Kind; seed: number; h: number; w: number; leaves: Shades }

/** Which tree stands in for which Kenney id: about the same size, so spacing and shadows still fit. */
const SPECS: Record<string, Spec> = {
  'nature/tree-oak': { kind: 'broadleaf', seed: 11, h: 1.75, w: 1.05, leaves: GREEN },
  'nature/tree-oak-dark': { kind: 'broadleaf', seed: 12, h: 1.8, w: 1.05, leaves: DARK },
  'nature/tree-oak-fall': { kind: 'broadleaf', seed: 13, h: 1.7, w: 1.0, leaves: FALL },
  'nature/tree-default': { kind: 'round', seed: 21, h: 2.3, w: 1.0, leaves: GREEN_B },
  'nature/tree-default-dark': { kind: 'round', seed: 22, h: 2.3, w: 1.0, leaves: DARK },
  'nature/tree-detailed': { kind: 'broadleaf', seed: 23, h: 1.9, w: 1.15, leaves: GREEN_B },
  'nature/tree-fat': { kind: 'round', seed: 24, h: 1.65, w: 1.05, leaves: GREEN },
  'suburban/tree-large': { kind: 'round', seed: 25, h: 2.25, w: 0.85, leaves: GREEN },
  'nature/tree-tall': { kind: 'poplar', seed: 31, h: 2.35, w: 0.6, leaves: GREEN_B },
  'nature/tree-tall-dark': { kind: 'poplar', seed: 32, h: 2.35, w: 0.6, leaves: DARK },
  'nature/tree-simple': { kind: 'poplar', seed: 33, h: 2.1, w: 0.55, leaves: GREEN },
  'nature/tree-thin': { kind: 'birch', seed: 41, h: 2.1, w: 0.85, leaves: YOUNG },
  'nature/tree-small': { kind: 'young', seed: 51, h: 1.55, w: 0.6, leaves: YOUNG },
  'nature/tree-small-fall': { kind: 'young', seed: 52, h: 1.55, w: 0.6, leaves: FALL_B },
  'suburban/tree-small': { kind: 'young', seed: 53, h: 1.7, w: 0.65, leaves: GREEN_B },
  'nature/tree-cone': { kind: 'conifer', seed: 61, h: 2.0, w: 0.78, leaves: PINE },
  'nature/tree-cone-dark': { kind: 'conifer', seed: 62, h: 2.05, w: 0.78, leaves: DARK },
  'nature/tree-pineroundb': { kind: 'conifer', seed: 63, h: 1.7, w: 0.85, leaves: GREEN },
};
export const DETAILED_TREE_IDS = Object.keys(SPECS);

/** Small seeded generator (mulberry32): the same trees every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Collects flat-shaded triangles, each painted one palette colour. */
class Faces {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  constructor(private readonly pal: PaletteMap) {}
  /** Add a (non-indexed) geometry after `m`, choosing each face's colour from its world normal and centre. */
  add(src: BufferGeometry, m: Matrix4, colour: (ny: number, cy: number, i: number) => string, warp?: (v: Vector3) => void): void {
    const g = src.index ? src.toNonIndexed() : src;
    const p = g.getAttribute('position');
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e = new Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      if (warp) { warp(a); warp(b); warp(c); }
      a.applyMatrix4(m); b.applyMatrix4(m); c.applyMatrix4(m);
      n.subVectors(c, b).cross(e.subVectors(a, b)).normalize();
      const [u, v] = this.pal.uv(colour(n.y, (a.y + b.y + c.y) / 3, i / 3));
      this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      this.uv.push(u, v, u, v, u, v);
    }
    if (g !== src) g.dispose();
    src.dispose();
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

const UP = new Vector3(0, 1, 0);
const at = (x: number, y: number, z: number, q = new Quaternion(), s = new Vector3(1, 1, 1)) => new Matrix4().compose(new Vector3(x, y, z), q, s);

/** A tapered limb from `a` to `b` (trunk or branch), its faces in two barks so it reads as bark. */
function limb(f: Faces, a: Vector3, b: Vector3, r0: number, r1: number, sides: number, bark: readonly [string, string]): void {
  const d = new Vector3().subVectors(b, a), len = d.length();
  const q = new Quaternion().setFromUnitVectors(UP, d.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  f.add(new CylinderGeometry(r1, r0, len, sides, 1), at(mid.x, mid.y, mid.z, q), (_ny, _cy, i) => bark[(i >> 1) % 2]!);
}

/** A faceted leaf cluster: a lumpy icosahedron, lighter where the sun falls and darker underneath. */
function cluster(f: Faces, r: () => number, x: number, y: number, z: number, rad: number, leaves: Shades, detail = 1, squash = 0.86): void {
  const seed = r() * 1000;
  const lump = (v: Vector3) => {
    // The same corner always moves the same way, so the facets stay closed.
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
    v.multiplyScalar(1 + ((h - Math.floor(h)) - 0.5) * 0.32);
  };
  f.add(new IcosahedronGeometry(rad, detail), at(x, y, z, new Quaternion().setFromAxisAngle(UP, r() * 6.28), new Vector3(1, squash, 1)), (ny, _cy, i) => {
    const shade = ny > 0.42 ? 2 : ny < -0.25 ? 0 : 1;
    // A few faces a shade off, as leaves catch the light unevenly.
    const k = ((i * 7919 + Math.floor(seed)) % 9) === 0 ? Math.max(0, shade - 1) : shade;
    return leaves[k]!;
  }, lump);
}

function trunk(f: Faces, r: () => number, h: number, rad: number, bark: readonly [string, string]): Vector3 {
  const lean = new Vector3((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
  const top = new Vector3(lean.x, h, lean.z);
  limb(f, new Vector3(0, 0, 0), top, rad, rad * 0.62, 6, bark);
  // Root flare.
  f.add(new CylinderGeometry(rad * 0.95, rad * 1.55, 0.1, 6, 1), at(0, 0.05, 0), (_ny, _cy, i) => bark[i % 2]!);
  return top;
}

function build(pal: PaletteMap, s: Spec): BufferGeometry {
  const f = new Faces(pal), r = rng(s.seed), W = s.w, H = s.h;
  switch (s.kind) {
    case 'round': {
      // A tall egg of a crown over a short trunk: a ring of clusters low, a smaller ring higher, a top.
      const th = H * 0.3;
      const top = trunk(f, r, th, 0.075 * W + 0.02, BARK);
      const rad = W * 0.36;
      const rings = [{ y: H * 0.46, out: W * 0.26, n: 4, k: 1 }, { y: H * 0.66, out: W * 0.2, n: 3, k: 0.9 }];
      for (const ring of rings) for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + r() * 0.8 + ring.y;
        const end = new Vector3(Math.cos(ang) * ring.out, ring.y + (r() - 0.5) * H * 0.05, Math.sin(ang) * ring.out);
        if (ring.k === 1) limb(f, new Vector3(top.x * 0.8, th * (0.8 + r() * 0.15), top.z * 0.8), end, 0.035 * W + 0.01, 0.02, 5, BARK);
        cluster(f, r, end.x, end.y, end.z, rad * ring.k * (0.85 + r() * 0.3), s.leaves, ring.k === 1 ? 1 : 0);
      }
      cluster(f, r, top.x, H - rad * 0.95, top.z, rad * 0.95, s.leaves);
      break;
    }
    case 'broadleaf': {
      // A short trunk under a full crown of overlapping clusters; the branches show only where they
      // leave the trunk.
      const round = false;
      const th = H * (round ? 0.3 : 0.26);
      const top = trunk(f, r, th, 0.075 * W + 0.02, BARK);
      const crownR = W * (round ? 0.4 : 0.44), crownY = H - crownR * (round ? 1.15 : 1.0);
      const n = round ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + r() * 0.9, out = W * (round ? 0.26 : 0.32) * (0.85 + r() * 0.3);
        const end = new Vector3(Math.cos(ang) * out, crownY - crownR * (0.15 + r() * 0.35), Math.sin(ang) * out);
        limb(f, new Vector3(top.x * 0.8, th * (0.8 + r() * 0.15), top.z * 0.8), end, 0.035 * W + 0.01, 0.02, 5, BARK);
        cluster(f, r, end.x, end.y + 0.05, end.z, crownR * (0.62 + r() * 0.18), s.leaves);
      }
      // The crown's dome on top, and smaller clusters filling the gaps round its waist.
      cluster(f, r, top.x, crownY + crownR * 0.25, top.z, crownR * 0.82, s.leaves);
      for (let i = 0; i < 3; i++) {
        const ang = r() * 6.28, out = W * 0.34;
        cluster(f, r, Math.cos(ang) * out, crownY + crownR * (r() * 0.4 - 0.1), Math.sin(ang) * out, crownR * 0.42, s.leaves, 0);
      }
      break;
    }
    case 'poplar': {
      const top = trunk(f, r, H * 0.28, 0.055 * W + 0.025, BARK);
      // A column of overlapping clusters, widest a third of the way up.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), y = H * 0.36 + t * H * 0.5;
        const rad = W * (0.5 - Math.abs(t - 0.3) * 0.36);
        cluster(f, r, top.x * t + (r() - 0.5) * 0.08, y, top.z * t + (r() - 0.5) * 0.08, rad, s.leaves, i === n - 1 ? 0 : 1, 0.9);
      }
      break;
    }
    case 'birch': {
      // White bark with dark marks; a light, open crown of small clusters on slender branches.
      const th = H * 0.55;
      const lean = new Vector3((r() - 0.5) * 0.1, th, (r() - 0.5) * 0.1);
      limb(f, new Vector3(0, 0, 0), lean, 0.065, 0.04, 6, ['#F2F2F2', '#D8D8DC']);
      for (let i = 0; i < 4; i++) {
        const y = 0.25 + i * th * 0.2, a = r() * 6.28;
        f.add(new CylinderGeometry(0.069, 0.069, 0.035, 6, 1), at(Math.cos(a) * 0.002 + lean.x * (y / th), y, lean.z * (y / th)), () => '#38383D');
      }
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + r(), out = W * (0.2 + r() * 0.14);
        const end = new Vector3(Math.cos(ang) * out, th + H * (0.05 + r() * 0.2), Math.sin(ang) * out);
        limb(f, new Vector3(lean.x * 0.9, th * (0.75 + r() * 0.2), lean.z * 0.9), end, 0.022, 0.012, 4, ['#F2F2F2', '#D8D8DC']);
        cluster(f, r, end.x, end.y + 0.05, end.z, W * 0.27, s.leaves, i % 2 ? 0 : 1);
      }
      cluster(f, r, lean.x, H - W * 0.3, lean.z, W * 0.32, s.leaves);
      break;
    }
    case 'young': {
      // A slim trunk and a round crown that takes up nearly half the tree.
      const top = trunk(f, r, H * 0.34, 0.045, BARK);
      const crownR = Math.max(W * 0.5, H * 0.21), crownY = H - crownR * 1.05;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + r(), out = crownR * 0.6;
        const end = new Vector3(Math.cos(ang) * out + top.x, crownY - crownR * (0.15 + r() * 0.25), Math.sin(ang) * out + top.z);
        if (i < 3) limb(f, new Vector3(top.x * 0.7, H * 0.34, top.z * 0.7), end, 0.022, 0.012, 4, BARK);
        cluster(f, r, end.x, end.y + 0.04, end.z, crownR * 0.68, s.leaves, i < 2 ? 1 : 0);
      }
      cluster(f, r, top.x, crownY + crownR * 0.3, top.z, crownR * 0.8, s.leaves);
      break;
    }
    case 'conifer': {
      trunk(f, r, H * 0.22, 0.06, BARK);
      // Jagged tiers, each turned a little and drooping at the tips, narrowing to a spire.
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers, base = H * (0.14 + t * 0.64), th = H * (0.3 - t * 0.04);
        const rad = W * 0.52 * (1 - t * 0.72);
        const jag = (v: Vector3) => {
          if (v.y < 0) { const a = Math.atan2(v.z, v.x), k = 1 + Math.sin(a * 5 + i * 1.7) * 0.13; v.x *= k; v.z *= k; v.y -= 0.035 * k; }
        };
        f.add(new ConeGeometry(rad, th, 11, 1), at(0, base + th / 2, 0, new Quaternion().setFromAxisAngle(UP, i * 0.6 + r())), (ny, cy) => {
          if (ny < -0.3) return s.leaves[0];
          return ny > 0.55 || cy > base + th * 0.55 ? s.leaves[2] : s.leaves[1];
        }, jag);
      }
      break;
    }
  }
  return f.build();
}

/** Every detailed tree, by the Kenney id it stands in for. */
export function detailedTrees(pal: PaletteMap): Map<string, BufferGeometry> {
  const out = new Map<string, BufferGeometry>();
  for (const [id, spec] of Object.entries(SPECS)) {
    const g = build(pal, spec);
    // Indexed like every Kenney model, so a tree merges into the town's chunks with the rest (a
    // non-indexed piece makes the whole chunk fail to merge, and none of it is drawn).
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
    out.set(id, g);
  }
  return out;
}
