import { Group, InstancedMesh, Object3D } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState } from '@/sim/types';
import { CAR_MODEL_IDS } from './StaticWorld';

/** One instanced mesh per car model; matrices rebuilt each frame from the sim's cars. */
export class CarsView {
  readonly group = new Group();
  private meshes: InstancedMesh[] = [];
  private readonly dummy = new Object3D();
  constructor(private readonly assets: AssetLibrary) {}

  init(): void {
    this.meshes = CAR_MODEL_IDS.map((id) => {
      const m = new InstancedMesh(this.assets.geometry(id), this.assets.material, 48);
      m.castShadow = true; m.receiveShadow = true; m.count = 0; m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
  }

  update(state: GameState, alpha: number): void {
    const counts = new Array<number>(this.meshes.length).fill(0);
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
    }
    this.meshes.forEach((m, i) => { m.count = counts[i]!; m.instanceMatrix.needsUpdate = true; });
  }
}
