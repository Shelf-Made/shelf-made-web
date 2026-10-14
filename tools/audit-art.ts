/**
 * Art audit: checks every shipped GLB against docs/STYLE_GUIDE.md.
 *   npm run audit:art
 * Exits non-zero on any failure.
 */
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));

interface Rule { tris: number; height: [number, number]; }
const RULES: Record<string, Rule> = {
  market: { tris: 1000, height: [0.02, 1.2] },
  people: { tris: 1000, height: [0.6, 0.85] },
  suburban: { tris: 2100, height: [0.01, 3.8] },
  commercial: { tris: 5300, height: [0.1, 10] },
  roads: { tris: 700, height: [0.02, 3.0] },
  cars: { tris: 3200, height: [0.5, 1.2] },
  food: { tris: 1500, height: [0.01, 0.5] },
  nature: { tris: 550, height: [0.05, 3.5] },
  furniture: { tris: 900, height: [0.004, 1.8] },
  generated: { tris: 450, height: [0.01, 1.6] },
};
const PIVOT_EXCEPTIONS = new Set(['market/wall', 'market/wall-door', 'market/wall-window', 'market/wall-corner', 'market/fence', 'market/fence-door', 'roads/road-side', 'commercial/awning', 'commercial/awning-wide', 'commercial/overhang', 'commercial/overhang-wide', 'commercial/parasol-a', 'commercial/parasol-b', 'generated/awning-segment']);
const ALLOWED_MATERIALS = new Set(['atlas', 'glass']);

async function main(): Promise<void> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const indexPath = join(ASSETS, 'models', 'index.json');
  if (!existsSync(indexPath)) { console.error('no models/index.json: run npm run assets'); process.exit(1); }
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { models: { pack: string; name: string; file: string }[] };
  let count = 0, bytes = 0;
  const seenPairs = new Set<string>();
  for (const m of index.models) {
    const path = join(ASSETS, m.file);
    const id = `${m.pack}/${m.name}`;
    if (!existsSync(path)) { failures.push(`${id}: file missing`); continue; }
    count++; bytes += statSync(path).size;
    const doc = await io.read(path);
    const root = doc.getRoot();
    const rule = RULES[m.pack];
    if (!rule) { failures.push(`${id}: unknown pack`); continue; }
    const b = getBounds(root.listScenes()[0]!);
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    if (!PIVOT_EXCEPTIONS.has(id) && !m.name.startsWith('road-') && root.listSkins().length === 0) {
      if (Math.abs(b.min[1]) > 0.08) failures.push(`${id}: pivot not on the ground (min.y=${b.min[1].toFixed(3)})`);
      if (Math.abs(cx) > 0.08 || Math.abs(cz) > 0.08) warnings.push(`${id}: pivot off centre (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
    }
    if (size[1]! < rule.height[0] || size[1]! > rule.height[1]) failures.push(`${id}: height ${size[1]!.toFixed(2)} outside ${rule.height.join('–')}`);
    let tris = 0;
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      tris += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
      if (!p.getAttribute('TEXCOORD_0')) failures.push(`${id}: primitive without UVs`);
      if (!p.getAttribute('NORMAL')) failures.push(`${id}: primitive without normals`);
    }
    if (tris > rule.tris) failures.push(`${id}: ${tris} triangles > ${rule.tris}`);
    for (const mat of root.listMaterials()) if (!ALLOWED_MATERIALS.has(mat.getName())) failures.push(`${id}: material '${mat.getName()}' not in {atlas, glass}`);
    if (root.listTextures().length > 0) failures.push(`${id}: embeds a texture (should use the shared atlas)`);
    if (seenPairs.has(id)) failures.push(`${id}: duplicate entry`);
    seenPairs.add(id);
  }
  // Atlas and palette must exist and have the documented size.
  const atlas = join(ASSETS, 'textures', 'atlas.png');
  if (!existsSync(atlas)) failures.push('textures/atlas.png missing');
  else {
    const buf = readFileSync(atlas);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== 2048 || h !== 1024) failures.push(`atlas is ${w}x${h}, expected 2048x1024`);
  }
  // Audio must be CC0/generated: every file in public/assets/audio must be listed in ASSET_LICENSES.md.
  const audioDir = join(ASSETS, 'audio');
  if (existsSync(audioDir)) {
    const licences = existsSync(join(ROOT, 'ASSET_LICENSES.md')) ? readFileSync(join(ROOT, 'ASSET_LICENSES.md'), 'utf8') : '';
    for (const f of readdirSync(audioDir)) if (!licences.includes(f)) failures.push(`audio/${f} not listed in ASSET_LICENSES.md`);
  }
  console.log(`audited ${count} models, ${(bytes / 1024 / 1024).toFixed(2)} MB of GLB`);
  for (const w of warnings) console.log('  warn  ' + w);
  for (const f of failures) console.log('  FAIL  ' + f);
  if (failures.length) { console.log(`${failures.length} failure(s)`); process.exit(1); }
  console.log('art audit passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
