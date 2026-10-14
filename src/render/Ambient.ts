import { Group, Mesh, Object3D, IcosahedronGeometry, SphereGeometry, ShaderMaterial, BackSide, Color, MeshBasicMaterial, InstancedMesh, BufferGeometry, Float32BufferAttribute, DoubleSide, type Camera } from 'three';
import { riverZ, RIVER_HALF_W } from '@/sim/layout';
import type { AssetLibrary } from './assets';
import { groundHeight, BASIN, type TownPlan, type AnimalHome, type AnimalKind } from './town';
import { box, merge, paint } from './geometry';

/**
 * Everything in the scenery that moves on its own: animals going about their day, birds circling
 * over the pocket, the fountain's spray, the waterfall, drifting clouds and a gradient sky. Render
 * only, never part of the simulation; motion is a pure function of time so it costs nothing to save.
 */
interface Critter { home: AnimalHome; obj: Object3D; parts: Object3D[]; seed: number; x: number; z: number; tx: number; tz: number; wait: number; heading: number }

function h01(n: number): number { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

export class AmbientView {
  readonly group = new Group();
  private critters: Critter[] = [];
  private drops: InstancedMesh | null = null;
  private foam: Mesh[] = [];
  private readonly streamTime = { value: 0 };
  private readonly streamMat = streamMaterial(this.streamTime);
  private clouds: Mesh[] = [];
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private fountain = { x: 0, z: 0 };
  private waterfall = { x: 0, z: 0 };
  private readonly dummy = new Object3D();
  constructor(private readonly assets: AssetLibrary) {
    this.skyMat = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new Color('#5FA8E8') }, bottom: { value: new Color('#CFE8FF') } },
      vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main() { float t = clamp(vP.y * 1.6 + 0.05, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(t, 0.8)), 1.0); }',
    });
    this.sky = new Mesh(new SphereGeometry(200, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
  }

  build(plan: TownPlan): void {
    this.group.clear();
    this.critters = []; this.clouds = [];
    this.group.add(this.sky);
    const mat = this.assets.material;
    for (const [i, home] of plan.animals.entries()) {
      const { obj, parts } = this.make(home.kind, i);
      obj.position.set(home.x, home.y ?? 0, home.z);
      this.group.add(obj);
      this.critters.push({ home, obj, parts, seed: i * 7.31 + home.x, x: home.x, z: home.z, tx: home.x, tz: home.z, wait: h01(i) * 3, heading: h01(i + 3) * 6.28 });
    }
    // Fountain spray: drops on looping arcs.
    this.fountain = plan.fountain;
    const drop = paint(new IcosahedronGeometry(0.035, 0), this.assets.palette, '#CDEBF7');
    this.drops = new InstancedMesh(drop, this.assets.unlit, 40);
    this.drops.frustumCulled = false;
    this.group.add(this.drops);
    // The stream: it runs down off the west plateau, tumbles over the cliff into the creek, and
    // white streaks race down it. Foam churns at the foot.
    this.waterfall = plan.waterfall;
    this.group.add(new Mesh(streamGeometry(), this.streamMat));
    this.foam = [];
    for (let k = 0; k < 7; k++) {
      const g = paint(new IcosahedronGeometry(0.22 + h01(k) * 0.16, 0), this.assets.palette, '#FFFFFF');
      const m = new Mesh(g, this.assets.unlit);
      m.position.set(-BASIN.x + 0.2 + h01(k + 9) * 1.1, -0.1, riverZ(-BASIN.x) + (k - 3) * 0.32);
      this.foam.push(m); this.group.add(m);
    }
    // Clouds: lumpy white puffs high over the pocket, drifting east.
    for (let c = 0; c < 12; c++) {
      const puffs: BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const g = paint(new IcosahedronGeometry(2.4 + h01(c * 5 + k) * 2.2, 0), this.assets.palette, '#FFFFFF');
        g.translate((k - 2) * 2.6, h01(c + k * 3) * 1.4, h01(c * 2 + k) * 2.4 - 1.2);
        puffs.push(g);
      }
      const m = new Mesh(merge(puffs), mat);
      m.position.set(-160 + c * 28 + h01(c) * 20, 46 + h01(c + 40) * 16, -70 + h01(c + 80) * 130);
      m.scale.set(1, 0.55, 1);
      this.clouds.push(m); this.group.add(m);
    }
  }

  /** Low-poly animals out of a few boxes each; `parts` are the bits that move (legs, wings, heads). */
  private make(kind: AnimalKind, i: number): { obj: Object3D; parts: Object3D[] } {
    const pal = this.assets.palette, mat = this.assets.material;
    const g = new Group();
    const add = (geo: BufferGeometry, x = 0, y = 0, z = 0): Mesh => { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const parts: Object3D[] = [];
    switch (kind) {
      case 'duck': {
        const drake = i % 2 === 0;
        add(merge([box(pal, drake ? '#B9BCC4' : '#B58A5C', 0.16, 0.08, 0.26, 0, 0, 0), box(pal, drake ? '#8B5A3C' : '#A87B45', 0.14, 0.06, 0.08, 0, 0.04, 0.1), box(pal, '#38383D', 0.12, 0.05, 0.06, 0, 0.05, -0.13)]));
        const head = add(merge([box(pal, drake ? '#2E8560' : '#A87B45', 0.08, 0.09, 0.09, 0, 0, 0), box(pal, '#FF8C42', 0.04, 0.025, 0.07, 0, 0.02, 0.07)]), 0, 0.08, 0.12);
        parts.push(head);
        break;
      }
      case 'rabbit': {
        const fur = i % 3 === 0 ? '#E3D9CC' : '#9C7B5C';
        add(merge([box(pal, fur, 0.14, 0.12, 0.2, 0, 0, 0), box(pal, fur, 0.1, 0.1, 0.1, 0, 0.09, 0.1), box(pal, '#FFFFFF', 0.06, 0.06, 0.04, 0, 0.06, -0.11)]));
        parts.push(add(merge([box(pal, fur, 0.03, 0.12, 0.02, -0.025, 0, 0), box(pal, fur, 0.03, 0.12, 0.02, 0.025, 0, 0), box(pal, '#F9A39E', 0.015, 0.08, 0.005, -0.025, 0.02, 0.012), box(pal, '#F9A39E', 0.015, 0.08, 0.005, 0.025, 0.02, 0.012)]), 0, 0.19, 0.08));
        break;
      }
      case 'deer': {
        const coat = '#B8824C';
        add(merge([box(pal, coat, 0.2, 0.2, 0.5, 0, 0.32, 0), box(pal, '#FFF3DC', 0.12, 0.06, 0.06, 0, 0.42, -0.27)]));
        for (const [lx, lz] of [[-0.07, 0.19], [0.07, 0.19], [-0.07, -0.19], [0.07, -0.19]] as const) parts.push(add(box(pal, '#8B5A3C', 0.05, 0.32, 0.05, 0, -0.32, 0), lx, 0.34, lz));
        const neck = new Group(); neck.position.set(0, 0.46, 0.22); g.add(neck);
        const nk = new Mesh(merge([box(pal, coat, 0.09, 0.24, 0.09, 0, 0, 0), box(pal, coat, 0.11, 0.1, 0.17, 0, 0.22, 0.06), box(pal, '#38383D', 0.04, 0.03, 0.03, 0, 0.25, 0.15), box(pal, coat, 0.03, 0.08, 0.02, -0.06, 0.32, 0.02), box(pal, coat, 0.03, 0.08, 0.02, 0.06, 0.32, 0.02)].concat(i % 2 ? [box(pal, '#7A4E2E', 0.02, 0.16, 0.02, -0.04, 0.32, 0), box(pal, '#7A4E2E', 0.02, 0.16, 0.02, 0.04, 0.32, 0), box(pal, '#7A4E2E', 0.12, 0.02, 0.02, 0, 0.44, 0)] : [])), mat);
        nk.castShadow = true; neck.add(nk); parts.push(neck);
        break;
      }
      case 'butterfly': {
        const wing = ['#FFC044', '#F27CC1', '#4F8FE0', '#FF8C42', '#FFFFFF'][i % 5]!;
        add(box(pal, '#38383D', 0.012, 0.012, 0.06, 0, 0, 0));
        parts.push(add(box(pal, wing, 0.07, 0.004, 0.06, -0.035, 0, 0)), add(box(pal, wing, 0.07, 0.004, 0.06, 0.035, 0, 0)));
        break;
      }
      case 'bird': {
        add(box(pal, '#38383D', 0.08, 0.06, 0.24, 0, 0, 0));
        parts.push(add(box(pal, '#4A4A52', 0.3, 0.02, 0.1, 0, 0, 0)), add(box(pal, '#4A4A52', 0.3, 0.02, 0.1, 0, 0, 0)));
        (parts[0] as Mesh).geometry.translate(-0.15, 0, 0); (parts[1] as Mesh).geometry.translate(0.15, 0, 0);
        break;
      }
      case 'squirrel': {
        add(merge([box(pal, '#B8824C', 0.07, 0.08, 0.14, 0, 0.04, 0), box(pal, '#B8824C', 0.06, 0.06, 0.06, 0, 0.1, 0.07)]));
        parts.push(add(box(pal, '#C8925A', 0.06, 0.16, 0.06, 0, 0, 0), 0, 0.1, -0.1));
        break;
      }
    }
    if (kind === 'butterfly' || kind === 'bird') g.traverse((o) => { (o as Mesh).castShadow = false; });
    return { obj: g, parts };
  }

  update(t: number, dt: number, camera: Camera, skyTop: Color, skyBottom: Color): void {
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.top!.value.copy(skyTop);
    this.skyMat.uniforms.bottom!.value.copy(skyBottom);
    for (const c of this.critters) this.animate(c, t, dt);
    if (this.drops) {
      for (let i = 0; i < 40; i++) {
        const ph = ((t * 0.9 + i / 40) % 1), a = (i / 40) * Math.PI * 2 * 3.1;
        const r = ph * 0.75, y = 1.05 + ph * 1.1 - ph * ph * 1.6;
        this.dummy.position.set(this.fountain.x + Math.cos(a) * r, Math.max(0.2, y), this.fountain.z + Math.sin(a) * r);
        this.dummy.scale.setScalar(1 - ph * 0.4); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
        this.drops.setMatrixAt(i, this.dummy.matrix);
      }
      this.drops.instanceMatrix.needsUpdate = true;
    }
    this.streamTime.value = t;
    this.foam.forEach((m, i) => { const ph = t * 2.2 + i * 1.7; m.scale.set(1 + 0.25 * Math.sin(ph), 0.6 + 0.3 * Math.sin(ph * 1.3), 1 + 0.25 * Math.cos(ph)); });
    for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 180) c.position.x = -180; }
  }

  private animate(c: Critter, t: number, dt: number): void {
    const k = c.home.kind, o = c.obj, s = c.seed;
    if (k === 'bird') {
      const a = t * 0.25 + s, r = c.home.range * (0.8 + 0.2 * Math.sin(t * 0.1 + s));
      o.position.set(c.home.x + Math.cos(a) * r, (c.home.y ?? 9) + Math.sin(t * 0.7 + s) * 1.2, c.home.z + Math.sin(a) * r);
      o.rotation.set(0, -a, Math.sin(t * 0.5 + s) * 0.2);
      const flap = Math.sin(t * 9 + s) * 0.5;
      c.parts[0]!.rotation.z = flap; c.parts[1]!.rotation.z = -flap;
      return;
    }
    if (k === 'butterfly') {
      const a = t * 0.8 + s;
      o.position.set(c.home.x + Math.sin(a) * c.home.range + Math.sin(a * 2.3) * 0.4, 0.35 + Math.abs(Math.sin(a * 1.7)) * 0.5, c.home.z + Math.sin(a * 0.7 + 1) * c.home.range * 0.7);
      o.rotation.y = a * 0.5;
      const flap = Math.sin(t * 22 + s) * 1.1;
      c.parts[0]!.rotation.z = flap; c.parts[1]!.rotation.z = -flap;
      return;
    }
    // Ground and water animals wander: walk to a spot near home, pause, pick another.
    const speed = k === 'deer' ? 0.35 : k === 'duck' ? 0.25 : k === 'rabbit' ? 0.9 : 1.2;
    const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
    let moving = false;
    if (c.wait > 0) c.wait -= dt;
    else if (d < 0.05) {
      c.wait = (k === 'deer' ? 4 : k === 'duck' ? 1.5 : 2.5) * (0.5 + h01(s + t));
      const ang = h01(s * 3 + Math.floor(t)) * 6.28, r = Math.sqrt(h01(s * 5 + Math.floor(t * 1.3))) * c.home.range;
      c.tx = c.home.x + Math.cos(ang) * r; c.tz = c.home.z + Math.sin(ang) * r;
    } else {
      const step = Math.min(d, speed * dt);
      c.x += (dx / d) * step; c.z += (dz / d) * step;
      const want = Math.atan2(dx, dz);
      let dh = want - c.heading; while (dh > Math.PI) dh -= 6.283; while (dh < -Math.PI) dh += 6.283;
      c.heading += dh * Math.min(1, dt * 6);
      moving = true;
    }
    const y0 = c.home.y ?? 0;
    o.position.set(c.x, y0, c.z);
    o.rotation.y = c.heading;
    if (k === 'rabbit') { o.position.y = y0 + (moving ? Math.abs(Math.sin(t * 9 + s)) * 0.12 : 0); c.parts[0]!.rotation.x = moving ? -0.4 : Math.sin(t * 2 + s) * 0.15; }
    if (k === 'squirrel') { o.position.y = moving ? Math.abs(Math.sin(t * 14 + s)) * 0.05 : 0; c.parts[0]!.rotation.x = 0.4 + Math.sin(t * 3 + s) * 0.3; }
    if (k === 'duck') { o.position.y = y0 + Math.sin(t * 2.2 + s) * 0.008; c.parts[0]!.rotation.x = !moving && Math.sin(t * 0.7 + s) > 0.85 ? 1.2 : 0; }
    if (k === 'deer') {
      // Graze while standing, look up now and then; legs swing while walking.
      const graze = !moving && Math.sin(t * 0.4 + s) > -0.3;
      const neck = c.parts[4]!;
      neck.rotation.x += ((graze ? 1.6 : 0) - neck.rotation.x) * Math.min(1, dt * 2);
      for (let l = 0; l < 4; l++) c.parts[l]!.rotation.x = moving ? Math.sin(t * 6 + l * Math.PI * 0.5) * 0.4 : 0;
    }
  }
}

/** Cut across the stream at the creek's own offsets so the ribbon sits on the terrain's vertices. */
function streamGeometry(): BufferGeometry {
  const W = RIVER_HALF_W;
  const offs = [-(W - 0.1), -W * 0.45, W * 0.45, W - 0.1];
  const xs: number[] = [-BASIN.x + 0.6];
  for (let x = -49.5; x >= -90; x -= 1.5) xs.push(x);
  const pos: number[] = [], st: number[] = [], idx: number[] = [];
  let along = 0, prev: [number, number] | null = null;
  for (const [i, x] of xs.entries()) {
    const zc = riverZ(x);
    const yc = i === 0 ? -0.1 : groundHeight(x, zc) + 0.07;
    if (prev) along += Math.hypot(x - prev[0], yc - prev[1]);
    prev = [x, yc];
    for (const [k, o] of offs.entries()) {
      const y = i === 0 ? -0.1 : groundHeight(x, zc + o) + 0.07;
      pos.push(x, y, zc + o * (i === 0 ? 1.25 : 1));
      st.push(k / (offs.length - 1), along);
    }
  }
  const n = offs.length;
  for (let i = 0; i < xs.length - 1; i++) for (let k = 0; k < n - 1; k++) {
    const a = i * n + k, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('stream', new Float32BufferAttribute(st, 2));
  g.setIndex(idx);
  return g;
}

function streamMaterial(time: { value: number }): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: '#7EC8EC', transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = time;
    sh.vertexShader = 'attribute vec2 stream; varying vec2 vS;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vS = stream;');
    sh.fragmentShader = 'uniform float uT; varying vec2 vS;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float lane = floor(vS.x * 7.0);
      float h = fract(sin(lane * 91.7) * 4375.85);
      float f = fract(vS.y * (0.55 + h * 0.3) + uT * (1.1 + h * 0.6) + h);
      float streak = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.18, 0.35, f));
      float edge = smoothstep(0.35, 0.5, abs(vS.x - 0.5));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(streak * 0.75 + edge * 0.45, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'stream';
  return m;
}
