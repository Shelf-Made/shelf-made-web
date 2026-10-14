import type { BufferGeometry} from 'three';
import { Group, Mesh, Matrix4, Euler, Vector3, Quaternion, PlaneGeometry, InstancedMesh, Object3D, Color } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import type { TownPlan, Placement } from './town';
import { box, paint } from './geometry';

const CAR_MODEL_IDS = ['cars/sedan', 'cars/hatchback', 'cars/suv', 'cars/sedan-sports', 'cars/van', 'cars/suv-luxury', 'cars/delivery', 'cars/truck', 'cars/taxi', 'cars/truck-flat', 'cars/delivery-flat', 'cars/garbage-truck'];
export { CAR_MODEL_IDS };

/** Everything that never moves: merged into a handful of meshes (one per material). */
export class StaticWorld {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  constructor(private readonly assets: AssetLibrary) {}

  static modelsNeeded(plan: TownPlan): string[] {
    return [...new Set(plan.placements.map((p) => p.model).concat(CAR_MODEL_IDS))];
  }

  build(plan: TownPlan): void {
    this.dispose();
    const pal = this.assets.palette;
    // Ground: one big grass plane, slightly below everything.
    const ground = new PlaneGeometry(260, 160, 1, 1);
    ground.rotateX(-Math.PI / 2);
    paint(ground, pal, '#7CC26B');
    const groundMesh = new Mesh(ground, this.assets.material);
    groundMesh.position.y = -0.02;
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);
    this.meshes.push(groundMesh);

    const atlasParts: BufferGeometry[] = [];
    const glassParts: BufferGeometry[] = [];
    for (const s of plan.slabs) {
      atlasParts.push(box(pal, s.color, s.rect.x1 - s.rect.x0, s.h, s.rect.z1 - s.rect.z0, (s.rect.x0 + s.rect.x1) / 2, s.y, (s.rect.z0 + s.rect.z1) / 2));
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
      atlasParts.push(transformed(this.assets.geometry(p.model), p));
      const glass = this.assets.glassGeometry(p.model);
      if (glass) glassParts.push(transformed(glass, p));
    }
    // Parked cars: instanced per model (they share geometry with moving cars).
    const byModel = new Map<number, typeof plan.parked>();
    for (const c of plan.parked) { const arr = byModel.get(c.model) ?? []; arr.push(c); byModel.set(c.model, arr); }
    const dummy = new Object3D();
    for (const [model, cars] of byModel) {
      const id = CAR_MODEL_IDS[model] ?? CAR_MODEL_IDS[0]!;
      const im = new InstancedMesh(this.assets.geometry(id), this.assets.material, cars.length);
      cars.forEach((c, i) => { dummy.position.set(c.x, 0, c.z); dummy.rotation.set(0, c.yaw, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.castShadow = true; im.receiveShadow = true;
      this.group.add(im); this.meshes.push(im as unknown as Mesh);
    }
    const merged = mergeGeometries(atlasParts, false);
    for (const g of atlasParts) g.dispose();
    if (merged) {
      const mesh = new Mesh(merged, this.assets.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    if (glassParts.length) {
      const g = mergeGeometries(glassParts, false);
      for (const p of glassParts) p.dispose();
      if (g) { const mesh = new Mesh(g, this.assets.glass); this.group.add(mesh); this.meshes.push(mesh); }
    }
    // Night: lamp heads glow. Small unlit spheres at each lamp head.
    if (plan.lamps.length) {
      const bulb = new InstancedMesh(paint(new (PlaneGeometry)(0.22, 0.22), pal, '#FFF3DC'), this.assets.unlit, plan.lamps.length);
      plan.lamps.forEach((l, i) => { dummy.position.set(l.x, 1.3, l.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.updateMatrix(); bulb.setMatrixAt(i, dummy.matrix); });
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
