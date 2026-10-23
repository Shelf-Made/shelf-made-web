import type { BufferGeometry, Material } from 'three';
import { Group, Mesh, Matrix4, Euler, Vector3, Quaternion, PlaneGeometry, InstancedMesh, Object3D, Color, BufferGeometry as Geo, Float32BufferAttribute, DoubleSide, MeshStandardMaterial } from 'three';
import type { PaletteMap } from './palette';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import { TOWN_MODEL_IDS, type TownPlan, type Placement, type ScatterKind } from './town';
import { box, paint } from './geometry';
import { terrainGeometry, structuresGeometry, grassTexture } from './terrain';
import { LAMP_GLOW, SPILL, spillGeometry } from './glow';

/** Grass tufts and flowers: the shared material, seen from both sides, standing still (no wind). */
export function stillGrass(base: MeshStandardMaterial): MeshStandardMaterial {
  const m = base.clone();
  m.side = DoubleSide;
  return m;
}

/** Generated meadow pieces, all a handful of triangles: a tuft of blades, a flower, a pebble. */
export function scatterGeometry(pal: PaletteMap, kind: ScatterKind): BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  const tri = (a: number[], b: number[], c: number[], hex: string) => { const [u, v] = pal.uv(hex); pos.push(...a, ...b, ...c); uv.push(u, v, u, v, u, v); };
  const blade = (ang: number, h: number, lean: number, hex: string, w = 0.03) => {
    const cx = Math.cos(ang), sz = Math.sin(ang);
    tri([-sz * w, 0, cx * w], [sz * w, 0, -cx * w], [cx * lean, h, sz * lean], hex);
  };
  if (kind === 'grass') {
    const greens = ['#63A854', '#7CC26B', '#4FAE62', '#8CCB72', '#3C8F4E'];
    for (let i = 0; i < 6; i++) blade(i * 1.05 + 0.3, 0.13 + (i % 3) * 0.05, 0.05 + (i % 2) * 0.03, greens[i % greens.length]!);
  } else if (kind === 'pebble') {
    return box(pal, '#ADAAA4', 0.09, 0.04, 0.07, 0, 0, 0);
  } else {
    const petal = { 'flower-red': '#E8573F', 'flower-yellow': '#FFC044', 'flower-purple': '#9B6FE0', 'flower-white': '#FCFFFF', 'flower-pink': '#F27CC1' }[kind];
    blade(0.4, 0.2, 0.0, '#3C8F4E', 0.012); blade(2.1, 0.11, 0.05, '#4FAE62', 0.025); blade(4.0, 0.09, 0.04, '#63A854', 0.025);
    const y = 0.2, r = 0.055;
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * Math.PI * 2, a1 = a0 + 0.9;
      tri([0, y + 0.004, 0], [Math.cos(a0) * r, y, Math.sin(a0) * r], [Math.cos(a1) * r, y, Math.sin(a1) * r], petal);
    }
    tri([-0.018, y + 0.012, -0.018], [0.018, y + 0.012, -0.018], [0, y + 0.012, 0.022], kind === 'flower-yellow' ? '#E8903F' : '#FFC044');
  }
  const g = new Geo();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Grass tufts and wild flowers on a corner's lawn, merged into one mesh (null when there are none). */
let tuftMat: MeshStandardMaterial | null = null;
export function tuftMesh(assets: AssetLibrary, tufts: { kind: ScatterKind; x: number; z: number; yaw: number; scale: number }[]): Mesh | null {
  if (!tufts.length) return null;
  const geos = new Map<ScatterKind, BufferGeometry>();
  const d = new Object3D();
  const parts: BufferGeometry[] = [];
  for (const t of tufts) {
    let g = geos.get(t.kind);
    if (!g) { const raw = scatterGeometry(assets.palette, t.kind); g = raw.index ? raw.toNonIndexed() : raw; geos.set(t.kind, g); }
    d.position.set(t.x, 0, t.z); d.rotation.set(0, t.yaw, 0); d.scale.setScalar(t.scale); d.updateMatrix();
    parts.push(g.clone().applyMatrix4(d.matrix));
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  for (const g of geos.values()) g.dispose();
  if (!merged) return null;
  tuftMat ??= stillGrass(assets.material);
  const m = new Mesh(merged, tuftMat); m.name = 'lawn-grass'; m.receiveShadow = true;
  return m;
}

const CAR_MODEL_IDS = ['cars/sedan', 'cars/hatchback', 'cars/suv', 'cars/sedan-sports', 'cars/van', 'cars/suv-luxury', 'cars/delivery', 'cars/truck', 'cars/taxi', 'cars/truck-flat', 'cars/delivery-flat', 'cars/garbage-truck'];
export { CAR_MODEL_IDS };

/** Town chunk size for merging, and the models flat enough not to need a shadow. */
const CHUNK = 44;
const FLAT = /roads\/road-|flower|grass|lily|crop|path|driveway|campfire/;

/** Everything that never moves: the land, the street (merged), the grass and flowers on the verges (instanced). */
export class StaticWorld {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private terrain: Mesh | null = null;
  /** The land's material (the lawn gets wet in the rain too). */
  get terrainMaterial(): MeshStandardMaterial | null { return (this.terrain?.material as MeshStandardMaterial | undefined) ?? null; }
  private grassMat: Material | null = null;
  constructor(private readonly assets: AssetLibrary) {}

  static modelsNeeded(plan: TownPlan): string[] {
    return [...new Set(plan.placements.map((p) => p.model).concat(TOWN_MODEL_IDS, CAR_MODEL_IDS))];
  }

  build(plan: TownPlan): void {
    this.dispose();
    const pal = this.assets.palette;
    // The land and the river never change between towns: build them once.
    if (!this.terrain) {
      const land = new Mesh(terrainGeometry(), new MeshStandardMaterial({ vertexColors: true, map: grassTexture(), roughness: 1, metalness: 0, flatShading: true }));
      land.receiveShadow = true; land.name = 'terrain';
      this.terrain = land;
      this.group.add(land);
      const st = structuresGeometry(pal);
      const lit = new Mesh(st.lit, this.assets.material); lit.castShadow = true; lit.receiveShadow = true; lit.name = 'structures';
      this.group.add(lit, new Mesh(st.dark, this.assets.unlit), new Mesh(st.glow, this.assets.unlit));
      this.grassMat = stillGrass(this.assets.material);
    }
    const add = (m: Mesh, cast = true) => { m.castShadow = cast; m.receiveShadow = true; this.group.add(m); this.meshes.push(m); };

    // The town is merged per 44-unit chunk, casters apart from flat ground pieces, so the camera and the
    // sun's shadow pass skip what they cannot see.
    const chunks = new Map<string, BufferGeometry[]>();
    const glassParts: BufferGeometry[] = [];
    const put = (geo: BufferGeometry, x: number, z: number, cast: boolean) => {
      // Flat pieces only split east and west; casters split into chunks.
      const k = cast ? `${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}|1` : `${x < 0 ? 'w' : 'e'}|0`;
      const arr = chunks.get(k) ?? []; arr.push(geo); chunks.set(k, arr);
    };
    for (const s of plan.slabs) {
      const cx = (s.rect.x0 + s.rect.x1) / 2, cz = (s.rect.z0 + s.rect.z1) / 2;
      put(box(pal, s.color, s.rect.x1 - s.rect.x0, s.h, s.rect.z1 - s.rect.z0, cx, s.y - 0.012, cz), cx, cz, false);
    }
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), sc = new Vector3();
    const transformed = (geo: BufferGeometry, p: Placement): BufferGeometry => {
      const g = geo.clone();
      e.set(0, p.yaw, 0); q.setFromEuler(e);
      const s = p.scale ?? 1;
      m.compose(v.set(p.x, p.y ?? 0, p.z), q, sc.set(s, s, s));
      g.applyMatrix4(m);
      return g;
    };
    for (const p of plan.placements) {
      if (!this.assets.has(p.model)) continue;
      put(transformed(this.assets.geometry(p.model), p), p.x, p.z, !FLAT.test(p.model));
      const glass = this.assets.glassGeometry(p.model);
      if (glass) glassParts.push(transformed(glass, p));
    }
    for (const [k, parts] of chunks) {
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      if (merged) { merged.computeBoundingSphere(); const cm = new Mesh(merged, k.endsWith('|1') ? this.assets.material : this.assets.ground); cm.name = k.endsWith('|1') ? 'town' : 'paving'; add(cm, k.endsWith('|1')); }
    }
    if (glassParts.length) {
      const g = mergeGeometries(glassParts, false);
      for (const p of glassParts) p.dispose();
      if (g) { const mesh = new Mesh(g, this.assets.windowGlass); this.group.add(mesh); this.meshes.push(mesh); }
    }

    // The verges: grass tufts, flowers and pebbles by the thousand, merged into one mesh (one draw).
    if (plan.scatter.length) {
      const geos = new Map<ScatterKind, BufferGeometry>();
      const d = new Object3D();
      const parts: BufferGeometry[] = [];
      for (const it of plan.scatter) {
        if (!geos.has(it.kind)) { const g = scatterGeometry(pal, it.kind); geos.set(it.kind, g.index ? g.toNonIndexed() : g); }
        d.position.set(it.x, 0, it.z); d.rotation.set(0, it.yaw, 0); d.scale.setScalar(it.scale); d.updateMatrix();
        parts.push(geos.get(it.kind)!.clone().applyMatrix4(d.matrix));
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      for (const g of geos.values()) g.dispose();
      if (merged) {
        const m = new Mesh(merged, this.grassMat!); m.name = 'verges'; m.receiveShadow = true;
        this.group.add(m); this.meshes.push(m);
      }
    }

    const dummy = new Object3D();
    // Night: lamp heads glow. Small unlit quads at each lamp head.
    if (plan.lamps.length) {
      const bulb = new InstancedMesh(paint(new PlaneGeometry(0.22, 0.22), pal, '#FFF3DC'), LAMP_GLOW, plan.lamps.length);
      plan.lamps.forEach((l, i) => { dummy.position.set(l.x, 1.3, l.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulb.setMatrixAt(i, dummy.matrix); });
      bulb.visible = false;
      bulb.name = 'lampGlow';
      this.group.add(bulb); this.meshes.push(bulb as unknown as Mesh);
      // Each lamp's pool of light on the pavement below it.
      const pools = new Mesh(mergeGeometries(plan.lamps.map((l) => spillGeometry(1.1, 1.1, l.x, 0.035, l.z, 0.42))), SPILL);
      pools.visible = false; pools.name = 'lampPools'; pools.renderOrder = 1;
      this.group.add(pools); this.meshes.push(pools);
    }
  }

  setNight(on: boolean): void {
    for (const name of ['lampGlow', 'lampPools']) { const m = this.group.getObjectByName(name); if (m) m.visible = on; }
  }

  dispose(): void {
    for (const m of this.meshes) { m.geometry.dispose(); this.group.remove(m); }
    this.meshes.length = 0;
  }
}

export const NIGHT_GLOW = new Color('#FFF3DC');

