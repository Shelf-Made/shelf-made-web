import type { BufferGeometry } from 'three';
import { Group, Mesh, Matrix4, Euler, Vector3, Quaternion, PlaneGeometry, InstancedMesh, Object3D, Color } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import { TOWN_MODEL_IDS, type TownPlan, type Placement } from './town';
import { box, paint } from './geometry';
import { terrainGeometry, waterGeometry, bridgeGeometry } from './terrain';

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
  constructor(private readonly assets: AssetLibrary) {}

  static modelsNeeded(plan: TownPlan): string[] {
    return [...new Set(plan.placements.map((p) => p.model).concat(plan.forest.map((p) => p.model), TOWN_MODEL_IDS, CAR_MODEL_IDS))];
  }

  build(plan: TownPlan): void {
    this.dispose();
    const pal = this.assets.palette;
    // The land and the river never change between towns: build them once.
    if (!this.terrain) {
      const land = new Mesh(terrainGeometry(pal), this.assets.material);
      land.receiveShadow = true;
      const water = new Mesh(waterGeometry(pal), this.assets.material);
      water.receiveShadow = true;
      this.terrain = land;
      this.group.add(land, water);
    }
    const add = (m: Mesh, cast = true) => { m.castShadow = cast; m.receiveShadow = true; this.group.add(m); this.meshes.push(m); };
    add(new Mesh(bridgeGeometry(pal, plan), this.assets.material));

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

    // Woods: one instanced mesh per model and quarter of the map, so the camera can skip the woods behind it.
    const dummy = new Object3D();
    const buckets = new Map<string, Placement[]>();
    for (const t of plan.forest) {
      if (!this.assets.has(t.model)) continue;
      const k = `${t.model}|${t.x < 0 ? 'w' : 'e'}${t.z < 6 ? 'n' : 's'}`;
      const arr = buckets.get(k) ?? []; arr.push(t); buckets.set(k, arr);
    }
    for (const [k, trees] of buckets) {
      const model = k.split('|')[0]!;
      const im = new InstancedMesh(this.assets.geometry(model), this.assets.material, trees.length);
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
