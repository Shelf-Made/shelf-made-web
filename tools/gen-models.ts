/**
 * Writes Shelf Made's own generated pieces (product blocks, sign letters, awning segment,
 * pylon sign, dog) as GLBs into public/assets/models/generated so the art audit covers them.
 * The game builds the same geometry at runtime from the same code.
 *   npm run gen:models
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import type { BufferGeometry } from 'three';
import { PaletteMap } from '../src/render/palette';
import { buildShapes } from '../src/render/products';
import { textGeometry } from '../src/render/letters';
import { box, merge } from '../src/render/geometry';
import { bagGeometry, BAG_HEIGHT, hydrantGeometry, recyclingGeometry, bikeRackGeometry, sandwichBoardGeometry, palletGeometry, trolleyShelterGeometry, posterGeometry, buntingGeometry } from '../src/render/props';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'public', 'assets', 'models', 'generated');
const pal = new PaletteMap(JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'textures', 'palette.json'), 'utf8')));
const io = new NodeIO();

async function writeGlb(name: string, geo: BufferGeometry): Promise<{ name: string; tris: number; size: number[] }> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array as ArrayLike<number>)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor.array as ArrayLike<number>)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv.array as ArrayLike<number>)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('atlas').setRoughnessFactor(1).setMetallicFactor(0));
  if (geo.index) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(geo.index.array as ArrayLike<number>)).setBuffer(buffer));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene('scene').addChild(node);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.glb`), await io.writeBinary(doc));
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return { name, tris: (geo.index ? geo.index.count : pos.count) / 3, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => +v.toFixed(3)) };
}

async function main(): Promise<void> {
  const out: { name: string; tris: number; size: number[] }[] = [];
  const shapes = buildShapes(pal);
  for (const [shape, g] of Object.entries(shapes)) out.push(await writeGlb(`product-${shape}`, merge([g.body.clone(), g.accent.clone()])));
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&') out.push(await writeGlb(`letter-${ch === '&' ? 'amp' : ch}`, textGeometry(pal, ch, 0.42, 0.08, '#FFF3DC', '#FFC044')));
  const awning: BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) { const g = box(pal, k % 2 ? '#FFFFFF' : '#3FA87A', 0.3, 0.04, 0.46, 0, 0, 0); g.rotateX(0.38); g.translate(-0.45 + k * 0.3, 0.3, 0.2); awning.push(g); }
  out.push(await writeGlb('awning-segment', merge(awning)));
  out.push(await writeGlb('pylon-sign', merge([box(pal, '#38383D', 0.12, 0.95, 0.12, -1.3, 0, 0), box(pal, '#38383D', 0.12, 0.95, 0.12, 1.3, 0, 0), box(pal, '#38383D', 3.0, 0.62, 0.14, 0, 0.9, 0), box(pal, '#3FA87A', 3.06, 0.06, 0.18, 0, 1.5, 0)])));
  const B = '#8B5A3C', D = '#5A3A28';
  out.push(await writeGlb('dog', merge([box(pal, B, 0.12, 0.11, 0.26, 0, 0.1, 0), box(pal, B, 0.12, 0.11, 0.11, 0, 0.17, 0.16), box(pal, D, 0.035, 0.1, 0.035, -0.04, 0, 0.09), box(pal, D, 0.035, 0.1, 0.035, 0.04, 0, 0.09), box(pal, D, 0.035, 0.1, 0.035, -0.04, 0, -0.09), box(pal, D, 0.035, 0.1, 0.035, 0.04, 0, -0.09), box(pal, D, 0.03, 0.03, 0.1, 0, 0.17, -0.16)])));
  // The shopping bag every customer carries home, in the store's colour (written here in the brand green).
  out.push(await writeGlb('shopping-bag', bagGeometry(pal, '#3FA87A').translate(0, BAG_HEIGHT, 0)));
  // Street dressing Kenney does not have, in the same flat style.
  out.push(await writeGlb('hydrant', hydrantGeometry(pal)));
  out.push(await writeGlb('recycling-bins', recyclingGeometry(pal)));
  out.push(await writeGlb('bike-rack', bikeRackGeometry(pal)));
  out.push(await writeGlb('sandwich-board', sandwichBoardGeometry(pal)));
  out.push(await writeGlb('pallet', palletGeometry(pal)));
  out.push(await writeGlb('trolley-shelter', trolleyShelterGeometry(pal, '#3FA87A')));
  out.push(await writeGlb('poster', posterGeometry(pal, '#3FA87A')));
  out.push(await writeGlb('bunting', buntingGeometry(pal, 2, ['#E8573F', '#FFC044', '#4F8FE0', '#3FA87A']).translate(-1, 0.2, 0)));
  out.push(await writeGlb('wall-ledge', merge([box(pal, '#FFFFFF', 1, 0.3, 0.14, 0, 0, 0), box(pal, '#38383D', 1.002, 0.06, 0.152, 0, 0, 0), box(pal, '#3FA87A', 1.002, 0.05, 0.16, 0, 0.25, 0)])));
  // Register them in the index so the audit sees them.
  const indexPath = join(ROOT, 'public', 'assets', 'models', 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { models: { pack: string; name: string; file: string; size: number[]; min: number[]; tris: number; skinned: boolean; clips: string[] }[] };
  index.models = index.models.filter((m) => m.pack !== 'generated');
  for (const m of out) index.models.push({ pack: 'generated', name: m.name, file: `models/generated/${m.name}.glb`, size: m.size, min: [0, 0, 0], tris: m.tris, skinned: false, clips: [] });
  index.models.sort((a, b) => (a.pack + a.name).localeCompare(b.pack + b.name));
  writeFileSync(indexPath, JSON.stringify(index, null, 1));
  console.log(`${out.length} generated models written`);
}

main().catch((e) => { console.error(e); process.exit(1); });
