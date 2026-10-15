import { Group, InstancedMesh, Object3D } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState } from '@/sim/types';
import { CAR_MODEL_IDS } from './StaticWorld';
import { BlobShadows } from './blobs';

/** One instanced mesh per car model; matrices rebuilt each frame from the sim's cars. Each sits on a soft blob shadow. */
export class CarsView {
  readonly group = new Group();
  private meshes: InstancedMesh[] = [];
  private readonly dummy = new Object3D();
  private readonly blobs = new BlobShadows(this.group, 64, 0.5, 0.05);
  constructor(private readonly assets: AssetLibrary) {}

  init(): void {
    this.meshes = CAR_MODEL_IDS.map((id) => {
      const m = new InstancedMesh(this.assets.geometry(id), this.assets.plainMaterial, 48);
      m.castShadow = false; m.receiveShadow = true; m.count = 0; m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
  }

  update(state: GameState, alpha: number): void {
    const counts = new Array<number>(this.meshes.length).fill(0);
    this.blobs.begin();
    for (const car of state.cars) {
      const mi = Math.min(car.model, this.meshes.length - 1);
      const mesh = this.meshes[mi]!;
      const i = counts[mi]!;
      if (i >= 48) continue;
      const x = car.px + (car.x - car.px) * alpha, z = car.pz + (car.z - car.pz) * alpha;
      let dy = car.yaw - car.pyaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.dummy.position.set(x, 0, z);
      this.dummy.rotation.set(0, car.pyaw + dy * alpha, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      counts[mi] = i + 1;
      const big = mi >= 6;
      this.blobs.add(x, z, big ? 1.3 : 1.15, big ? 2.6 : 2.1, this.dummy.rotation.y);
    }
    this.blobs.end();
    this.meshes.forEach((m, i) => { m.count = counts[i]!; m.instanceMatrix.needsUpdate = true; });
  }
}
