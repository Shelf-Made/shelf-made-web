import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { PaletteMap } from './palette';
import { fittingGeometry, RUG_RED, RUG_RED_EDGE, BENCH_WOOD } from './fittings';
import { schemeById } from '@/sim/schemes';
import type { AssetLibrary } from './assets';

const pal = new PaletteMap(JSON.parse(readFileSync('public/assets/textures/palette.json', 'utf8')));

/** A model's UVs as they are in its .glb (Kenney's are 16-bit, normalised). */
function modelUvs(model: string): number[] {
  const b = readFileSync(`public/assets/models/${model}.glb`);
  const jsonLen = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = 20 + jsonLen + 8, out: number[] = [];
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    const a = json.accessors[p.attributes.TEXCOORD_0], v = json.bufferViews[a.bufferView];
    const at = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), short = a.componentType === 5123, size = short ? 2 : 4, stride = v.byteStride ?? size * 2;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < 2; k++) out.push(short ? b.readUInt16LE(at + i * stride + k * size) / 65535 : b.readFloatLE(at + i * stride + k * size));
  }
  return out;
}
/** The palette colour each UV sits on. */
const colours = (uv: ArrayLike<number>) => {
  const all = [RUG_RED, RUG_RED_EDGE, BENCH_WOOD, '#4F8FE0', '#285795', '#7CC26B', '#3C8F4E', '#3FA87A'];
  const out = new Set<string>();
  for (let i = 0; i < uv.length; i += 2) out.add(all.find((h) => { const [u, v] = pal.uv(h); return Math.abs(uv[i]! - u) < 1e-3 && Math.abs(uv[i + 1]! - v) < 1e-3; }) ?? 'other');
  return [...out].sort();
};

describe('the other looks of a piece', () => {
  it('a blue or green rug and a painted bench really are another colour', () => {
    // The models as they come: one rug's two colours, one bench's wood (what the looks repaint).
    expect(colours(modelUvs('furniture/rug-rectangle'))).toEqual([RUG_RED, RUG_RED_EDGE].sort());
    expect(colours(modelUvs('furniture/bench'))).toEqual([BENCH_WOOD]);
    const assets = {
      palette: pal,
      geometry: (model: string) => {
        const g = new BufferGeometry(), uv = modelUvs(model);
        g.setAttribute('position', new Float32BufferAttribute(new Float32Array((uv.length / 2) * 3), 3));
        g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
        return g;
      },
    } as unknown as AssetLibrary;
    const look = (id: string) => colours(fittingGeometry(assets, id, schemeById('green')).getAttribute('uv').array);
    expect(look('gen:rug')).toEqual([RUG_RED, RUG_RED_EDGE].sort());
    expect(look('gen:rugBlue')).toEqual(['#285795', '#4F8FE0']);
    expect(look('gen:rugGreen')).toEqual(['#3C8F4E', '#7CC26B']);
    expect(look('gen:parkBench')).toEqual([BENCH_WOOD]);
    expect(look('gen:parkBenchPainted')).toEqual(['#3FA87A']);
  });
});
