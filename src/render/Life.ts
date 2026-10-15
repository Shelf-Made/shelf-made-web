import { BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, MeshBasicMaterial, Object3D, Points, ShaderMaterial, type MeshStandardMaterial } from 'three';
import type { GameState } from '@/sim/types';
import type { TownLitterKind } from '@/sim/life';
import type { PaletteMap } from './palette';
import { box, cylinder, merge } from './geometry';

const MAX = 64, PUFFS = 48;

/** The little pieces: a dog's mess, a crushed can, a sweet wrapper, a cigarette end. Lying flat, a few centimetres big. */
export function litterGeometry(pal: PaletteMap, kind: TownLitterKind): BufferGeometry {
  switch (kind) {
    case 'poop': return merge([box(pal, '#6B4A2B', 0.07, 0.022, 0.05, 0, 0, 0), box(pal, '#5A3D22', 0.045, 0.02, 0.035, 0.005, 0.02, 0), box(pal, '#6B4A2B', 0.022, 0.016, 0.02, 0, 0.038, 0)]);
    case 'can': { const c = cylinder(pal, '#D8453A', 0.02, 0.07, 0, 0, 0, 8); c.rotateZ(Math.PI / 2); c.translate(0.035, 0.02, 0); return merge([c, box(pal, '#C9CBD1', 0.006, 0.04, 0.04, -0.001, 0, 0)]); }
    case 'wrapper': return merge([box(pal, '#FFC044', 0.06, 0.004, 0.04, 0, 0, 0, 0.3), box(pal, '#E8573F', 0.04, 0.006, 0.02, 0.01, 0.003, 0, -0.4)]);
    case 'butt': return merge([box(pal, '#F4F1EA', 0.026, 0.008, 0.008, 0, 0, 0), box(pal, '#E09A5A', 0.012, 0.0085, 0.0085, 0.016, 0, 0)]);
  }
}

/**
 * Town life you can see: the mess on the pavements (from the sim's town litter), smoke curling up from
 * the teenagers' cigarettes, and the hazard lights blinking on two cars stopped after a bump.
 */
export class LifeView {
  readonly group = new Group();
  private readonly litter = new Map<TownLitterKind, InstancedMesh>();
  private readonly hazards: InstancedMesh;
  private readonly smoke: Points;
  private readonly dummy = new Object3D();
  private t = 0;

  constructor(pal: PaletteMap, material: MeshStandardMaterial) {
    for (const k of ['poop', 'can', 'wrapper', 'butt'] as TownLitterKind[]) {
      const m = new InstancedMesh(litterGeometry(pal, k), material, MAX);
      m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.name = `litter-${k}`;
      this.litter.set(k, m); this.group.add(m);
    }
    // Hazard lights: four orange blinkers per car, pushed bright enough to glow.
    this.hazards = new InstancedMesh(box(pal, '#FFFFFF', 0.07, 0.05, 0.05), new MeshBasicMaterial({ color: new Color(3.2, 1.7, 0.35) }), 16);
    this.hazards.count = 0; this.hazards.frustumCulled = false; this.hazards.name = 'hazards';
    this.group.add(this.hazards);
    // Smoke: soft grey puffs rising and spreading as they fade.
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(PUFFS * 3), 3));
    g.setAttribute('aLife', new Float32BufferAttribute(new Float32Array(PUFFS), 1));
    this.smoke = new Points(g, new ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float aLife; varying float vL; void main() { vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (14.0 + aLife * 46.0) / -mv.z * 6.0; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vL; void main() { float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.2, 0.5, d)) * 0.45 * (1.0 - vL) * smoothstep(0.0, 0.08, vL); if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.86, 0.87, 0.9), a); }',
    }));
    this.smoke.frustumCulled = false; this.smoke.name = 'smoke';
    this.group.add(this.smoke);
  }

  update(state: GameState, dt: number): void {
    this.t += dt;
    const life = state.life;
    // Litter, by kind.
    const n = new Map<TownLitterKind, number>();
    for (const l of life?.litter ?? []) {
      const m = this.litter.get(l.kind)!;
      const i = n.get(l.kind) ?? 0;
      if (i >= MAX) continue;
      this.dummy.position.set(l.x, 0.05, l.z); this.dummy.rotation.set(0, l.yaw, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
      m.setMatrixAt(i, this.dummy.matrix); n.set(l.kind, i + 1);
    }
    for (const [k, m] of this.litter) { m.count = n.get(k) ?? 0; m.instanceMatrix.needsUpdate = true; }
    // Hazards: on for half of each 0.8 s.
    let h = 0;
    const on = (this.t % 0.8) < 0.4;
    for (const b of life?.bumps ?? []) for (const id of [b.a, b.b]) {
      const c = state.cars.find((x) => x.id === id);
      if (!c || !on) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      for (const [f, side] of [[0.78, 0.33], [0.78, -0.33], [-0.8, 0.33], [-0.8, -0.33]] as const) {
        if (h >= 16) break;
        this.dummy.position.set(c.x + s * f + co * side, 0.32, c.z + co * f - s * side); this.dummy.rotation.set(0, c.yaw, 0); this.dummy.updateMatrix();
        this.hazards.setMatrixAt(h++, this.dummy.matrix);
      }
    }
    this.hazards.count = h; this.hazards.instanceMatrix.needsUpdate = true;
    // Smoke from each smoker hanging about: three puffs each, staggered, rising from about head height.
    const pos = this.smoke.geometry.getAttribute('position') as Float32BufferAttribute, lifeA = this.smoke.geometry.getAttribute('aLife') as Float32BufferAttribute;
    let k = 0;
    for (const p of state.people) {
      if (!p.smoking || p.state !== 'idle' || k + 3 > PUFFS) continue;
      const hx = p.x + Math.sin(p.yaw + 0.9) * 0.2, hz = p.z + Math.cos(p.yaw + 0.9) * 0.2, top = 0.62 * p.look.height;
      for (let j = 0; j < 3; j++) {
        const u = ((this.t * 0.35 + j / 3 + p.id * 0.17) % 1);
        pos.setXYZ(k, hx + Math.sin(this.t * 0.7 + j + p.id) * 0.08 * u, top + u * 0.55, hz + Math.cos(this.t * 0.5 + j) * 0.08 * u);
        lifeA.setX(k, u); k++;
      }
    }
    for (let j = k; j < PUFFS; j++) lifeA.setX(j, 0);
    pos.needsUpdate = true; lifeA.needsUpdate = true;
    this.smoke.geometry.setDrawRange(0, k);
    this.smoke.visible = k > 0;
  }
}

