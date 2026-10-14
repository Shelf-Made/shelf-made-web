import type { BufferGeometry, Material } from 'three';
import { Group, Mesh, Matrix4, Euler, Vector3, Quaternion, PlaneGeometry, InstancedMesh, Object3D, Color, BufferGeometry as Geo, Float32BufferAttribute, DoubleSide, MeshStandardMaterial } from 'three';
import type { PaletteMap } from './palette';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import { TOWN_MODEL_IDS, type TownPlan, type Placement, type ScatterKind } from './town';
import { box, paint } from './geometry';
import { terrainGeometry, structuresGeometry } from './terrain';

/** Wind: grass, flowers and leaves sway with height above their base. One clock for all of them. */
export const wind = { value: 0 };
function swaying(base: MeshStandardMaterial, amp: number, double = false): MeshStandardMaterial {
  const m = base.clone();
  if (double) m.side = DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #else
        vec4 wp = vec4(0.0);
      #endif
      float hh = max(position.y, 0.0);
      transformed.x += sin(uWind * 1.7 + wp.x * 0.7 + wp.z * 0.45) * hh * ${amp.toFixed(3)};
      transformed.z += cos(uWind * 1.3 + wp.x * 0.35 + wp.z * 0.6) * hh * ${(amp * 0.7).toFixed(3)};`);
  };
  m.customProgramCacheKey = () => `sway${amp}${double}`;
  return m;
}

/** Generated meadow pieces, all a handful of triangles: a tuft of blades, a flower, a pebble. */
function scatterGeometry(pal: PaletteMap, kind: ScatterKind): BufferGeometry {
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

const CAR_MODEL_IDS = ['cars/sedan', 'cars/hatchback', 'cars/suv', 'cars/sedan-sports', 'cars/van', 'cars/suv-luxury', 'cars/delivery', 'cars/truck', 'cars/taxi', 'cars/truck-flat', 'cars/delivery-flat', 'cars/garbage-truck'];
export { CAR_MODEL_IDS };

/** Town chunk size for merging, and the models flat enough not to need a shadow. */
const CHUNK = 44;
const FLAT = /roads\/road-|flower|grass|lily|crop|path|driveway|campfire/;

/** Everything that never moves: the land, the river, the town (merged), the woods (instanced). */
export class StaticWorld {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private terrain: Mesh | null = null;
  private grassMat: Material | null = null;
  private leafMat: Material | null = null;
  constructor(private readonly assets: AssetLibrary) {}

  /** Advance the wind. */
  update(time: number): void { wind.value = time; }

  static modelsNeeded(plan: TownPlan): string[] {
    return [...new Set(plan.placements.map((p) => p.model).concat(plan.forest.map((p) => p.model), TOWN_MODEL_IDS, CAR_MODEL_IDS))];
  }

  build(plan: TownPlan): void {
    this.dispose();
    const pal = this.assets.palette;
    // The land and the river never change between towns: build them once.
    if (!this.terrain) {
      const land = new Mesh(terrainGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }));
      land.receiveShadow = true;
      this.terrain = land;
      this.group.add(land);
      const st = structuresGeometry(pal);
      const lit = new Mesh(st.lit, this.assets.material); lit.castShadow = true; lit.receiveShadow = true;
      this.group.add(lit, new Mesh(st.dark, this.assets.unlit), new Mesh(st.glow, this.assets.unlit));
      this.grassMat = swaying(this.assets.material, 0.22, true);
      this.leafMat = swaying(this.assets.material, 0.018);
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
      if (merged) { merged.computeBoundingSphere(); add(new Mesh(merged, this.assets.material), k.endsWith('|1')); }
    }
    if (glassParts.length) {
      const g = mergeGeometries(glassParts, false);
      for (const p of glassParts) p.dispose();
      if (g) { const mesh = new Mesh(g, this.assets.glass); this.group.add(mesh); this.meshes.push(mesh); }
    }

    // Meadows: grass tufts, flowers and pebbles by the thousand, one instanced mesh per kind.
    {
      const byKind = new Map<string, typeof plan.scatter>();
      for (const sc of plan.scatter) { const k = sc.kind; const arr = byKind.get(k) ?? []; arr.push(sc); byKind.set(k, arr); }
      const geos = new Map<ScatterKind, BufferGeometry>();
      const d = new Object3D();
      for (const [k, items] of byKind) {
        const kind = k as ScatterKind;
        if (!geos.has(kind)) geos.set(kind, scatterGeometry(pal, kind));
        const im = new InstancedMesh(geos.get(kind)!, kind === 'pebble' ? this.assets.material : this.grassMat!, items.length);
        items.forEach((it, i) => { d.position.set(it.x, 0, it.z); d.rotation.set(0, it.yaw, 0); d.scale.setScalar(it.scale); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
        im.computeBoundingSphere();
        im.receiveShadow = true;
        this.group.add(im); this.meshes.push(im as unknown as Mesh);
      }
    }

    // Woods: one instanced mesh per model and quarter of the map, so the camera can skip the woods behind it.
    const dummy = new Object3D();
    const buckets = new Map<string, Placement[]>();
    for (const t of plan.forest) {
      if (!this.assets.has(t.model)) continue;
      const k = `${t.model}|${t.x < 0 ? 'w' : 'e'}${t.z < 2.5 ? 'n' : 's'}`;
      const arr = buckets.get(k) ?? []; arr.push(t); buckets.set(k, arr);
    }
    for (const [k, trees] of buckets) {
      const model = k.split('|')[0]!;
      const im = new InstancedMesh(this.assets.geometry(model), this.leafMat ?? this.assets.material, trees.length);
      trees.forEach((t, i) => { dummy.position.set(t.x, t.y ?? 0, t.z); dummy.rotation.set(0, t.yaw, 0); const s = t.scale ?? 1; dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.computeBoundingSphere();
      // No forest shadows: the sun's shadow camera only spans the town around the player, where garden trees do cast.
      add(im as unknown as Mesh, false);
    }

    // Parked cars: instanced per model (they share geometry with moving cars).
    const byModel = new Map<number, typeof plan.parked>();
    for (const c of plan.parked) { const arr = byModel.get(c.model) ?? []; arr.push(c); byModel.set(c.model, arr); }
    for (const [model, cars] of byModel) {
      const id = CAR_MODEL_IDS[model] ?? CAR_MODEL_IDS[0]!;
      const im = new InstancedMesh(this.assets.geometry(id), this.assets.material, cars.length);
      cars.forEach((c, i) => { dummy.position.set(c.x, 0, c.z); dummy.rotation.set(0, c.yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.computeBoundingSphere();
      add(im as unknown as Mesh);
    }
    // Night: lamp heads glow. Small unlit quads at each lamp head.
    if (plan.lamps.length) {
      const bulb = new InstancedMesh(paint(new PlaneGeometry(0.22, 0.22), pal, '#FFF3DC'), this.assets.unlit, plan.lamps.length);
      plan.lamps.forEach((l, i) => { dummy.position.set(l.x, 1.3, l.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulb.setMatrixAt(i, dummy.matrix); });
      bulb.visible = false;
      bulb.name = 'lampGlow';
      this.group.add(bulb); this.meshes.push(bulb as unknown as Mesh);
    }
  }

  setNight(on: boolean): void {
    const glow = this.group.getObjectByName('lampGlow');
    if (glow) glow.visible = on;
  }

  dispose(): void {
    for (const m of this.meshes) { m.geometry.dispose(); this.group.remove(m); }
    this.meshes.length = 0;
  }
}

export const NIGHT_GLOW = new Color('#FFF3DC');
