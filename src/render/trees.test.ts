import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PaletteMap } from './palette';
import { detailedTrees, DETAILED_TREE_IDS } from './trees';
import { TREE_MIX } from './town';

const pal = new PaletteMap(JSON.parse(readFileSync('public/assets/textures/palette.json', 'utf8')));
const index = JSON.parse(readFileSync('public/assets/models/index.json', 'utf8')) as { models: { pack: string; name: string; size: [number, number, number] }[] };
const size = new Map(index.models.map((m) => [`${m.pack}/${m.name}`, m.size]));

describe('detailed trees', () => {
  it('stand in for every tree in the mix, about the size of the model they replace, standing on the ground, within budget', () => {
    const trees = detailedTrees(pal);
    for (const id of TREE_MIX) if (id.includes('tree')) expect(DETAILED_TREE_IDS, id).toContain(id);
    for (const [id, g] of trees) {
      const k = size.get(id);
      expect(k, `${id} is a model in the index`).toBeTruthy();
      g.computeBoundingBox();
      const b = g.boundingBox!;
      // Same height within a fifth and no more than half as wide again, so spacing and shadows still fit.
      expect(Math.abs(b.max.y - b.min.y - k![1]) / k![1], `${id} height`).toBeLessThan(0.2);
      expect(b.max.x - b.min.x, `${id} width`).toBeLessThan(Math.max(k![0], k![2]) * 1.5);
      expect(Math.abs(b.min.y), `${id} base`).toBeLessThan(0.02);
      // More detailed than Kenney's simplest trees, but a garden of them stays cheap.
      const tris = g.getAttribute('position').count / 3;
      expect(tris, `${id} triangles`).toBeGreaterThan(100);
      expect(tris, `${id} triangles`).toBeLessThan(800);
    }
  });

  it('are the same trees every load', () => {
    const a = detailedTrees(pal).get('nature/tree-oak')!.getAttribute('position').array;
    const b = detailedTrees(pal).get('nature/tree-oak')!.getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
