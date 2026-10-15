import type { Object3D, SkinnedMesh, Texture, AnimationClip, Material} from 'three';
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, TextureLoader, Matrix4, MeshBasicMaterial, Color, Float32BufferAttribute, type BufferAttribute } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { detailTexture, addSurfaceDetail } from './detail';
import { detailedTrees } from './trees';
import { PaletteMap, configureAtlas, type PaletteData } from './palette';

export interface ModelInfo { pack: string; name: string; file: string; size: [number, number, number]; min: [number, number, number]; tris: number; skinned: boolean; clips: string[] }

/** Every fetch carries the build id: a deploy is never answered from the browser cache of the last one. */
const BUILD_QUERY = typeof __BUILD_ID__ === 'string' ? `?v=${__BUILD_ID__}` : '';
declare const __BUILD_ID__: string;

export interface CharacterAsset { scene: Group; clips: AnimationClip[]; info: ModelInfo }

/**
 * Loads the atlas, palette and GLBs. Static models become single merged geometries (atlas +
 * optional glass primitive) so the world can instance and merge them; characters keep their
 * skinned scenes for cloning.
 */
export class AssetLibrary {
  atlas!: Texture;
  palette!: PaletteMap;
  material!: MeshStandardMaterial;
  /** Without surface detail: for people, cars, products and the pictures of them. */
  plainMaterial!: MeshStandardMaterial;
  glass!: MeshStandardMaterial;
  unlit!: MeshBasicMaterial;
  index = new Map<string, ModelInfo>();
  private readonly geoms = new Map<string, { atlas: BufferGeometry; glass: BufferGeometry | null }>();
  private readonly chars = new Map<string, CharacterAsset>();
  private readonly loader = new GLTFLoader();
  private base: string;

  constructor(base = '/assets/') { this.base = base; }

  async loadCore(onProgress?: (done: number, total: number) => void): Promise<void> {
    const [palette, index, atlas] = await Promise.all([
      fetch(`${this.base}textures/palette.json${BUILD_QUERY}`).then((r) => r.json() as Promise<PaletteData>),
      fetch(`${this.base}models/index.json${BUILD_QUERY}`).then((r) => r.json() as Promise<{ models: ModelInfo[] }>),
      new TextureLoader().loadAsync(`${this.base}textures/atlas.png${BUILD_QUERY}`),
    ]);
    this.palette = new PaletteMap(palette);
    for (const m of index.models) this.index.set(`${m.pack}/${m.name}`, m);
    configureAtlas(atlas);
    this.atlas = atlas;
    // The town and the shops wear surface detail (grain, slab joints, asphalt specks); people, cars and
    // the products on the shelves keep the clean material.
    this.plainMaterial = new MeshStandardMaterial({ map: atlas, roughness: 0.95, metalness: 0, flatShading: false });
    this.material = addSurfaceDetail(new MeshStandardMaterial({ map: atlas, roughness: 0.95, metalness: 0, flatShading: false }), detailTexture());
    this.glass = new MeshStandardMaterial({ color: new Color('#CFE9F7'), roughness: 0.2, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false });
    this.unlit = new MeshBasicMaterial({ map: atlas });
    // The town's trees are our own detailed ones under Kenney's ids (their GLBs are then never fetched).
    for (const [id, g] of detailedTrees(this.palette)) if (this.index.has(id)) this.geoms.set(id, { atlas: g, glass: null });
    onProgress?.(1, 1);
  }

  has(id: string): boolean { return this.index.has(id); }
  /** A character that has been loaded (and can be cloned). */
  hasCharacter(id: string): boolean { return this.chars.has(id); }

  /** Load a batch of static models (ids like "market/shelf-boxes") with progress. */
  async loadModels(ids: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    const unique = [...new Set(ids)].filter((id) => !this.geoms.has(id) && !this.chars.has(id));
    await Promise.all(unique.map(async (id) => {
      await this.loadOne(id);
      done++;
      onProgress?.(done, unique.length);
    }));
  }

  private async loadOne(id: string): Promise<void> {
    const info = this.index.get(id);
    if (!info) throw new Error(`unknown model ${id}`);
    const gltf: GLTF = await this.loader.loadAsync(`${this.base}${info.file}${BUILD_QUERY}`);
    if (info.skinned) {
      this.chars.set(id, { scene: gltf.scene, clips: gltf.animations, info });
      gltf.scene.traverse((o) => { if ((o as Mesh).isMesh) ((o as Mesh).material as Material) = this.material; });
      return;
    }
    const atlasParts: BufferGeometry[] = [];
    const glassParts: BufferGeometry[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = toFloat(m.geometry);
      g.applyMatrix4(m.matrixWorld);
      // Drop attributes we do not merge on.
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      const mat = m.material as Material;
      (mat.name === 'glass' ? glassParts : atlasParts).push(g);
    });
    const atlas = atlasParts.length ? mergeGeometries(atlasParts, false) ?? new BufferGeometry() : new BufferGeometry();
    const glass = glassParts.length ? mergeGeometries(glassParts, false) : null;
    this.geoms.set(id, { atlas, glass });
  }

  geometry(id: string): BufferGeometry {
    const g = this.geoms.get(id);
    if (!g) throw new Error(`model not loaded: ${id}`);
    return g.atlas;
  }
  glassGeometry(id: string): BufferGeometry | null { return this.geoms.get(id)?.glass ?? null; }
  info(id: string): ModelInfo { const i = this.index.get(id); if (!i) throw new Error(`unknown model ${id}`); return i; }
  character(id: string): CharacterAsset { const c = this.chars.get(id); if (!c) throw new Error(`character not loaded: ${id}`); return c; }

  /** A plain mesh of a static model (for one-offs). */
  mesh(id: string): Object3D {
    const m = new Mesh(this.geometry(id), this.material);
    m.castShadow = true; m.receiveShadow = true;
    const glass = this.glassGeometry(id);
    if (!glass) return m;
    const g = new Group();
    g.add(m, new Mesh(glass, this.glass));
    return g;
  }
}

export function isSkinned(o: Object3D): o is SkinnedMesh { return (o as SkinnedMesh).isSkinnedMesh === true; }

/** Quantised (KHR_mesh_quantization) attributes become plain Float32 so geometries can be merged and transformed freely. */
export function toFloat(src: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name) as BufferAttribute | undefined;
    if (!a) continue;
    const n = a.count, size = a.itemSize;
    const out = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      out[i * size] = a.getX(i);
      if (size > 1) out[i * size + 1] = a.getY(i);
      if (size > 2) out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new Float32BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(src.index.clone());
  return g;
}
export const IDENTITY = new Matrix4();
