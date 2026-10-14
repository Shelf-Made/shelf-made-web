/**
 * Converts the Kenney packs in third_party/kenney into the optimised GLBs the game
 * ships in public/assets/models, plus one shared colour atlas.
 *
 *   npm run assets
 *
 * - Every pack keeps its own colormap, packed into one 2048 x 1024 atlas, so all static
 *   geometry can share a single material (one draw call per merged group).
 * - Packs without textures (Nature, Furniture) get their material colours baked into a
 *   palette slot of the same atlas.
 * - Each pack is rescaled so 1 world unit = 1 Mini Market floor tile.
 * - Products baked onto Mini Market shelves are split off as separate "product-*" meshes
 *   so the game can show full, half and empty shelves.
 * - Characters keep only the animation clips the game uses.
 */
import { NodeIO, Document, Logger, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, flatten, clearNodeTransform, transformMesh, getBounds, join, cloneDocument, quantize } from '@gltf-transform/functions';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join as pjoin, dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { PACKS, ATLAS_COLS, ATLAS_ROWS, ATLAS_SLOT, ATLAS_SLOTS, PALETTE_SLOT, PALETTE_CELLS, type PackSpec } from './lib/manifest';
import { readZip, findEntry } from './lib/zip';
import { tmpdir } from 'node:os';
import { Palette, rgbToHex, linearToSrgb } from './lib/palette';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = pjoin(ROOT, 'public', 'assets');
const KEEP_CLIPS = new Set(['static', 'idle', 'walk', 'sprint', 'pick-up', 'holding-both', 'holding-right', 'holding-left', 'interact-right', 'interact-left', 'sit', 'drive', 'emote-yes', 'emote-no']);
/** Child nodes of Mini Market fixtures that are really products. */
const PRODUCT_NODES = new Set(['carton', 'box', 'bag', 'bottle', 'bread']);

export interface ModelInfo {
  pack: string;
  name: string;
  file: string;
  size: [number, number, number];
  min: [number, number, number];
  tris: number;
  skinned: boolean;
  clips: string[];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const palette = new Palette();

function slotOffset(slot: number): [number, number] {
  return [slot % ATLAS_COLS, Math.floor(slot / ATLAS_COLS)];
}

function remapUVs(prim: Primitive, slot: number): void {
  const uv = prim.getAttribute('TEXCOORD_0');
  if (!uv) return;
  const [sc, sr] = slotOffset(slot);
  const arr = uv.getArray()!;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 2) {
    out[i] = (arr[i]! + sc) / ATLAS_COLS;
    out[i + 1] = (arr[i + 1]! + sr) / ATLAS_ROWS;
  }
  uv.setArray(out);
}

/** Give every vertex of a flat-coloured primitive the UV of its palette cell. */
function bakeFlatColour(prim: Primitive): void {
  const mat = prim.getMaterial();
  const base = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
  const hex = rgbToHex(linearToSrgb(base[0]), linearToSrgb(base[1]), linearToSrgb(base[2]));
  const cell = palette.cell(hex);
  const [u, v] = Palette.uv(cell);
  const pos = prim.getAttribute('POSITION')!;
  const n = pos.getCount();
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { arr[i * 2] = u; arr[i * 2 + 1] = v; }
  const existing = prim.getAttribute('TEXCOORD_0');
  if (existing) existing.setArray(arr);
  else {
    const doc = prim.getGraph() as unknown as { getRoot?: unknown };
    void doc;
    const acc = (prim as unknown as { _document?: Document })._document; // unused
    void acc;
    throw new Error('expected TEXCOORD_0 to exist; create it with document.createAccessor instead');
  }
}

function ensureUVs(doc: Document, prim: Primitive): void {
  if (prim.getAttribute('TEXCOORD_0')) return;
  const pos = prim.getAttribute('POSITION')!;
  const acc = doc.createAccessor('uv').setType('VEC2').setArray(new Float32Array(pos.getCount() * 2));
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  acc.setBuffer(buffer);
  prim.setAttribute('TEXCOORD_0', acc);
}

function unifyMaterials(doc: Document, pack: PackSpec): void {
  const root = doc.getRoot();
  const atlasMat = doc.createMaterial('atlas').setRoughnessFactor(1).setMetallicFactor(0);
  let glassMat: ReturnType<Document['createMaterial']> | null = null;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const name = (mat?.getName() ?? '').toLowerCase();
      if (pack.colormap) {
        if (name.includes('glass')) {
          glassMat ??= doc.createMaterial('glass').setAlphaMode('BLEND').setBaseColorFactor([0.8, 0.93, 1, 0.45]).setRoughnessFactor(0.3).setMetallicFactor(0);
          prim.setMaterial(glassMat);
        } else prim.setMaterial(atlasMat);
      } else {
        ensureUVs(doc, prim);
        bakeFlatColour(prim);
        prim.setMaterial(atlasMat);
      }
    }
  }
  for (const tex of root.listTextures()) tex.dispose();
  for (const mat of root.listMaterials()) if (mat !== atlasMat && mat !== glassMat) mat.dispose();
}

function scaleDocument(doc: Document, s: number): void {
  if (s === 1) return;
  const m: number[] = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m as unknown as Parameters<typeof transformMesh>[1]);
  for (const node of doc.getRoot().listNodes()) {
    const t = node.getTranslation();
    node.setTranslation([t[0] * s, t[1] * s, t[2] * s]);
  }
}

function dropIgnoredNodes(doc: Document): void {
  for (const node of doc.getRoot().listNodes()) {
    if (node.getName().startsWith('(%')) node.dispose();
  }
}

function pruneClips(doc: Document): string[] {
  const kept: string[] = [];
  for (const anim of doc.getRoot().listAnimations()) {
    if (KEEP_CLIPS.has(anim.getName())) kept.push(anim.getName());
    else anim.dispose();
  }
  return kept;
}

function triCount(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return Math.round(tris);
}

async function finalize(doc: Document, pack: PackSpec, name: string, skinned: boolean, clips: string[], infos: ModelInfo[]): Promise<void> {
  const slot = pack.colormap ? ATLAS_SLOTS[pack.id]! : PALETTE_SLOT;
  unifyMaterials(doc, pack);
  if (pack.colormap) for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) remapUVs(p, slot);
  if (!skinned) {
    await doc.transform(flatten());
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
    scaleDocument(doc, pack.scale);
    await doc.transform(join({ keepNamed: false }), dedup(), prune({ keepAttributes: true }));
    if (pack.recentre) {
      const b0 = getBounds(doc.getRoot().listScenes()[0]!);
      const cx = (b0.min[0] + b0.max[0]) / 2, cz = (b0.min[2] + b0.max[2]) / 2;
      const m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -b0.min[1], -cz, 1];
      for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m as unknown as Parameters<typeof transformMesh>[1]);
    }
  } else {
    await doc.transform(dedup(), prune({ keepAttributes: true }));
  }
  // 16-bit positions / UVs and 8-bit normals roughly halve the download (KHR_mesh_quantization).
  // Skinned characters are left as floats: they are small and quantization would move the bind pose.
  if (!skinned) await doc.transform(quantize({ quantizePosition: 14, quantizeTexcoord: 12, quantizeNormal: 8, quantizeColor: 8, quantizeGeneric: 12 }));
  const scene = doc.getRoot().listScenes()[0]!;
  const b = getBounds(scene);
  const file = `models/${pack.id}/${name}.glb`;
  const outPath = pjoin(OUT, file);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, await io.writeBinary(doc));
  infos.push({
    pack: pack.id, name, file,
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(4)) as [number, number, number],
    min: b.min.map((v) => +v.toFixed(4)) as [number, number, number],
    tris: triCount(doc), skinned, clips,
  });
}

/** Split product child nodes off a Mini Market fixture into their own documents. */
async function splitProducts(doc: Document, pack: PackSpec, infos: ModelInfo[], seen: Set<string>): Promise<void> {
  const root = doc.getRoot();
  const productNodes = root.listNodes().filter((n) => PRODUCT_NODES.has(n.getName()));
  for (const node of productNodes) {
    const pname = `product-${node.getName()}`;
    if (!seen.has(pname)) {
      seen.add(pname);
      const copy = cloneDocument(doc);
      const copyRoot = copy.getRoot();
      const scene = copyRoot.listScenes()[0]!;
      // Find the matching node in the clone by name + order.
      const idx = root.listNodes().indexOf(node);
      const target = copyRoot.listNodes()[idx]!;
      for (const child of scene.listChildren()) scene.removeChild(child);
      const parent = target.getParentNode();
      if (parent) parent.removeChild(target);
      scene.addChild(target);
      target.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
      for (const other of copyRoot.listNodes()) if (other !== target && !isDescendant(target, other)) other.dispose();
      await copy.transform(prune({ keepAttributes: true }));
      // Re-centre on bottom-centre.
      const b = getBounds(scene);
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -b.min[1], -cz, 1];
      for (const mesh of copyRoot.listMeshes()) transformMesh(mesh, m as unknown as Parameters<typeof transformMesh>[1]);
      await finalize(copy, pack, pname, false, [], infos);
    }
    node.dispose();
  }
}

function isDescendant(ancestor: Node, node: Node): boolean {
  let p = node.getParentNode();
  while (p) { if (p === ancestor) return true; p = p.getParentNode(); }
  return false;
}

async function convertPack(pack: PackSpec, infos: ModelInfo[], atlasLayers: sharp.OverlayOptions[]): Promise<void> {
  const zipPath = pjoin(ROOT, 'third_party', 'kenney', pack.zip);
  if (!existsSync(zipPath)) throw new Error(`missing ${zipPath}`);
  const files = readZip(zipPath);
  if (pack.colormap) {
    const png = findEntry(files, pack.colormap);
    if (!png) throw new Error(`${pack.id}: colormap not found`);
    const slot = ATLAS_SLOTS[pack.id]!;
    const [sc, sr] = slotOffset(slot);
    if (!atlasLayers.some((l) => l.left === sc * ATLAS_SLOT && l.top === sr * ATLAS_SLOT)) {
      const buf = await sharp(Buffer.from(png)).resize(ATLAS_SLOT, ATLAS_SLOT, { kernel: 'nearest' }).png().toBuffer();
      atlasLayers.push({ input: buf, left: sc * ATLAS_SLOT, top: sr * ATLAS_SLOT });
    }
  }
  // The GLBs reference their colormap as an external file, so unpack to a cache dir and read from disk.
  const cache = pjoin(tmpdir(), 'shelf-made-assets', pack.id);
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(pack.modelDir) || path.endsWith('/')) continue;
    const dest = pjoin(cache, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  const seenProducts = new Set<string>();
  for (const [name, src] of Object.entries(pack.models)) {
    const bytes = findEntry(files, `${pack.modelDir}/${src}.glb`);
    if (!bytes) { console.warn(`  ! ${pack.id}/${src}.glb not in zip`); continue; }
    const doc = await io.read(pjoin(cache, pack.modelDir, `${src}.glb`));
    dropIgnoredNodes(doc);
    const skinned = doc.getRoot().listSkins().length > 0;
    const clips = skinned ? pruneClips(doc) : (doc.getRoot().listAnimations().forEach((a) => a.dispose()), []);
    if (pack.id === 'market') await splitProducts(doc, pack, infos, seenProducts);
    await finalize(doc, pack, name, skinned, clips, infos);
  }
}

async function writeAtlas(layers: sharp.OverlayOptions[]): Promise<void> {
  // Palette slot: PALETTE_CELLS x PALETTE_CELLS cells.
  const cell = ATLAS_SLOT / PALETTE_CELLS;
  const raw = Buffer.alloc(ATLAS_SLOT * ATLAS_SLOT * 4, 0);
  palette.colors.forEach((hex, i) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const col = i % PALETTE_CELLS, row = Math.floor(i / PALETTE_CELLS);
    for (let y = row * cell; y < (row + 1) * cell; y++) for (let x = col * cell; x < (col + 1) * cell; x++) {
      const o = (y * ATLAS_SLOT + x) * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  });
  const [pc, pr] = slotOffset(PALETTE_SLOT);
  layers.push({ input: raw, raw: { width: ATLAS_SLOT, height: ATLAS_SLOT, channels: 4 }, left: pc * ATLAS_SLOT, top: pr * ATLAS_SLOT });
  mkdirSync(pjoin(OUT, 'textures'), { recursive: true });
  await sharp({ create: { width: ATLAS_COLS * ATLAS_SLOT, height: ATLAS_ROWS * ATLAS_SLOT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } })
    .composite(layers).png({ compressionLevel: 9, palette: false }).toFile(pjoin(OUT, 'textures', 'atlas.png'));
  writeFileSync(pjoin(OUT, 'textures', 'palette.json'), JSON.stringify({ cells: PALETTE_CELLS, slot: PALETTE_SLOT, cols: ATLAS_COLS, rows: ATLAS_ROWS, colors: palette.colors }, null, 2));
}

async function main(): Promise<void> {
  const infos: ModelInfo[] = [];
  const layers: sharp.OverlayOptions[] = [];
  const t0 = Date.now();
  for (const pack of PACKS) {
    console.log(`pack ${pack.id} (${pack.title} ${pack.version}) x${pack.scale}`);
    await convertPack(pack, infos, layers);
  }
  await writeAtlas(layers);
  infos.sort((a, b) => (a.pack + a.name).localeCompare(b.pack + b.name));
  writeFileSync(pjoin(OUT, 'models', 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), models: infos }, null, 1));
  const total = infos.reduce((s, m) => s + m.tris, 0);
  console.log(`${infos.length} models, ${total} triangles, ${palette.colors.length} palette colours, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
