import { Group, InstancedMesh, Object3D, PlaneGeometry, MeshBasicMaterial, Color, DoubleSide } from 'three';
import type { GameState } from '@/sim/types';
import { doorInside } from '@/sim/people';
import { fixtureCentre } from '@/sim/grid';

export type OverlayKind = 'none' | 'heat' | 'exposure' | 'paths';

/** Build-mode overlays: a heat map of where shoppers stand, how exposed each tile is, and current paths. */
export class Overlays {
  readonly group = new Group();
  private tiles: InstancedMesh;
  private heat = new Map<string, number>();
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  kind: OverlayKind = 'none';

  constructor() {
    const geo = new PlaneGeometry(0.96, 0.96); geo.rotateX(-Math.PI / 2);
    this.tiles = new InstancedMesh(geo, new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }), 400);
    this.tiles.count = 0; this.tiles.frustumCulled = false;
    this.group.add(this.tiles);
  }

  /** Sample shopper positions (called every sim tick batch). */
  sample(state: GameState): void {
    for (const p of state.people) {
      if (p.kind !== 'customer' || p.state === 'driving') continue;
      const k = `${Math.floor(p.x)},${Math.floor(p.z)}`;
      this.heat.set(k, (this.heat.get(k) ?? 0) + 1);
    }
    if (this.heat.size > 2000) this.heat.clear();
  }

  update(state: GameState): void {
    if (this.kind === 'none') { this.tiles.count = 0; this.tiles.visible = false; return; }
    this.tiles.visible = true;
    const shop = state.shop;
    const f = shop.floor;
    let i = 0;
    let max = 1;
    if (this.kind === 'heat') for (const v of this.heat.values()) max = Math.max(max, v);
    const d = doorInside(state);
    for (let x = f.x0; x < f.x1; x++) for (let z = f.z0; z < f.z1; z++) {
      const wx = shop.originX + x + 0.5, wz = shop.originZ + z + 0.5;
      let v = 0;
      if (this.kind === 'heat') v = (this.heat.get(`${Math.floor(wx)},${Math.floor(wz)}`) ?? 0) / max;
      else if (this.kind === 'exposure') {
        const near = Math.max(0, 1 - Math.hypot(wx - d.x, wz - d.z) / 6);
        const endcap = shop.fixtures.some((fx) => (fx.type === 'endcap' || fx.type === 'rack') && Math.hypot(fixtureCentre(shop, fx).x - wx, fixtureCentre(shop, fx).z - wz) < 1.2) ? 0.35 : 0;
        v = Math.min(1, near * 0.8 + endcap + 0.1);
      } else {
        v = state.people.some((p) => p.kind === 'customer' && p.path.some((pt) => Math.abs(pt.x - wx) < 0.5 && Math.abs(pt.z - wz) < 0.5)) ? 0.9 : 0.05;
      }
      this.dummy.position.set(wx, 0.05, wz); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
      this.tiles.setMatrixAt(i, this.dummy.matrix);
      this.tiles.setColorAt(i, this.color.setHSL(0.36 - v * 0.36, 0.9, 0.5));
      i++;
      if (i >= 400) break;
    }
    this.tiles.count = i; this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }
}
