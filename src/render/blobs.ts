import { InstancedMesh, CircleGeometry, MeshBasicMaterial, Float32BufferAttribute, Object3D, type Group } from 'three';

/**
 * Soft contact shadows: a dark disc fading out to its rim (vertex alpha), one instanced draw for a
 * whole crowd or a whole street of cars. Cheaper than shadow-map casting for things that move, and
 * it keeps them sitting on the ground at every zoom.
 */
export class BlobShadows {
  private mesh: InstancedMesh;
  private readonly d = new Object3D();
  private n = 0;
  constructor(private readonly parent: Group, capacity = 128, private readonly strength = 0.42) {
    this.mesh = this.make(capacity);
    parent.add(this.mesh);
  }

  private make(cap: number): InstancedMesh {
    const g = new CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
    const k = g.getAttribute('position').count, c = new Float32Array(k * 4);
    for (let i = 0; i < k; i++) { c[i * 4] = c[i * 4 + 1] = 0.1; c[i * 4 + 2] = 0.14; c[i * 4 + 3] = i === 0 ? this.strength : 0; }
    g.setAttribute('color', new Float32BufferAttribute(c, 4));
    const m = new InstancedMesh(g, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }), cap);
    m.count = 0; m.renderOrder = 1; m.frustumCulled = false; m.name = 'blobs';
    return m;
  }

  begin(): void { this.n = 0; }

  /** A shadow at (x, z), sx wide and sz long, turned to yaw. */
  add(x: number, z: number, sx: number, sz = sx, yaw = 0): void {
    if (this.n >= this.mesh.instanceMatrix.count) {
      const bigger = this.make(this.n * 2);
      for (let i = 0; i < this.n; i++) { this.mesh.getMatrixAt(i, this.d.matrix); bigger.setMatrixAt(i, this.d.matrix); }
      this.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = bigger; this.parent.add(bigger);
    }
    const d = this.d; d.position.set(x, 0.012, z); d.rotation.set(0, yaw, 0); d.scale.set(sx, 1, sz); d.updateMatrix();
    this.mesh.setMatrixAt(this.n++, d.matrix);
  }

  end(): void { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
}
