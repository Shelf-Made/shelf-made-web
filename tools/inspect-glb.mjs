import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import path from 'node:path';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const b = getBounds(scene);
  let tris = 0; const mats = new Set(); const texs = root.listTextures().length;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3; const m = p.getMaterial(); if (m) mats.add(m.getName()); }
  const anims = root.listAnimations().map(a => a.getName());
  const skins = root.listSkins().length;
  const nodes = root.listNodes().map(n => n.getName()).slice(0, 12);
  const sz = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  console.log(path.basename(file), 'size', sz, 'min', b.min.map(v=>+v.toFixed(2)), 'tris', tris, 'mats', [...mats].join(','), 'tex', texs, 'anims', anims.join(',') || '-', 'skins', skins, 'nodes', nodes.join('|'));
}
