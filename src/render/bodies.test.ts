import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { PaletteMap } from './palette';
import { fittingGeometry, FITTING_MODEL, VARIANT_MODEL } from './fittings';
import { FIXTURE_MODEL } from './storeArt';
import { detailedTrees } from './trees';
import { FIXTURES, VERTICAL, solidRect, footprintOf } from '@/sim/layout';
import { DEFAULT_SCHEME, schemeById } from '@/sim/schemes';
import type { FixtureType } from '@/sim/types';

/** A model's vertices as its .glb has them (node transforms applied; Kenney's are quantised). */
function glb(id: string): BufferGeometry {
  const b = readFileSync(`public/assets/models/${id}.glb`);
  const jsonLen = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = 20 + jsonLen + 8, pos: number[] = [];
  const read = (ai: number) => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView], at = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = ({ 5126: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 } as Record<number, number>)[a.componentType]!, stride = v.byteStride ?? size * 3;
    const get = (o: number) => {
      switch (a.componentType) {
        case 5126: return b.readFloatLE(o);
        case 5123: return a.normalized ? b.readUInt16LE(o) / 65535 : b.readUInt16LE(o);
        case 5122: return a.normalized ? Math.max(b.readInt16LE(o) / 32767, -1) : b.readInt16LE(o);
        case 5121: return a.normalized ? b.readUInt8(o) / 255 : b.readUInt8(o);
        default: return a.normalized ? Math.max(b.readInt8(o) / 127, -1) : b.readInt8(o);
      }
    };
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) out.push(get(at + i * stride + k * size));
    return out;
  };
  const walk = (ni: number, parent: Matrix4) => {
    const n = json.nodes[ni], m = new Matrix4();
    if (n.matrix) m.fromArray(n.matrix); else m.compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(m);
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      const ps = read(p.attributes.POSITION);
      for (let i = 0; i < ps.length; i += 3) { const v = new Vector3(ps[i], ps[i + 1], ps[i + 2]).applyMatrix4(w); pos.push(v.x, v.y, v.z); }
    }
    for (const c of n.children ?? []) walk(c, w);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, new Matrix4());
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

const pal = new PaletteMap(JSON.parse(readFileSync('public/assets/textures/palette.json', 'utf8')));
const trees = detailedTrees(pal);
const assets = { palette: pal, geometry: (id: string) => trees.get(id) ?? glb(id) } as never;
const sc = schemeById(DEFAULT_SCHEME);
const geometry = (id: string) => (id.startsWith('gen:') ? fittingGeometry(assets, id, sc) : glb(id));
// The pieces StoreView draws round the middle of their tile (the rest have their backs to its back edge).
const view = readFileSync('src/render/StoreView.ts', 'utf8'), from = view.indexOf('const CENTRED');
const CENTRED = new Set([...view.slice(from, view.indexOf(']);', from)).matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));

describe('what the manager bumps into', () => {
  // Every piece that stands on the floor or the lot (a way up and the pallet are the grid's; a bay is driven onto).
  const types = (Object.keys(FIXTURES) as FixtureType[]).filter((t) => !FIXTURES[t].walkable && !FIXTURES[t].edge && !VERTICAL.has(t) && t !== 'pallet' && t !== 'parkingBay');

  it("is each piece as drawn, down at body height (a tree's trunk, not its canopy), however it is turned", () => {
    for (const t of types) {
      const base = (FITTING_MODEL as Record<string, string>)[t] ?? FIXTURE_MODEL[t];
      const g = geometry(base); g.computeBoundingBox();
      // Drawn as StoreView draws it: forward of the middle of its footprint (unless it stands in the middle), turned.
      const dz = CENTRED.has(t) ? 0 : -0.49 - g.boundingBox!.min.z;
      for (const rot of [0, 1, 2, 3]) {
        const fp = footprintOf(t, 4, -3, rot), yaw = (rot * Math.PI) / 2;
        const m = new Matrix4().compose(new Vector3((fp.x0 + fp.x1) / 2 + Math.sin(yaw) * dz, 0, (fp.z0 + fp.z1) / 2 + Math.cos(yaw) * dz), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1));
        const drawn = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
        for (const id of [base, ...(VARIANT_MODEL[t] ?? [])]) {
          const p = geometry(id).getAttribute('position');
          for (let i = 0; i < p.count; i++) {
            if (p.getY(i) > 0.6) continue;
            const v = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
            drawn.x0 = Math.min(drawn.x0, v.x); drawn.x1 = Math.max(drawn.x1, v.x); drawn.z0 = Math.min(drawn.z0, v.z); drawn.z1 = Math.max(drawn.z1, v.z);
          }
        }
        const s = solidRect({ type: t, x: 4, z: -3, rot });
        expect(s, `${t} has a body`).not.toBeNull();
        for (const k of ['x0', 'x1', 'z0', 'z1'] as const) expect(Math.abs(s![k] - drawn[k]), `${t} turned ${rot}: ${k}`).toBeLessThan(0.03);
      }
    }
  });
});
