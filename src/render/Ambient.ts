import { Group, Mesh, Object3D, IcosahedronGeometry, SphereGeometry, ShaderMaterial, BackSide, Color, Vector2, Vector3, type BufferGeometry, type Camera } from 'three';
import type { AssetLibrary } from './assets';
import type { TownPlan, AnimalHome, AnimalKind } from './town';
import { box, merge, paint } from './geometry';

/**
 * Everything in the scenery that moves on its own: animals going about their day, birds circling
 * over the crossroads, drifting clouds and a gradient sky. Render
 * only, never part of the simulation; motion is a pure function of time so it costs nothing to save.
 */
interface Critter { home: AnimalHome; obj: Object3D; parts: Object3D[]; seed: number; x: number; z: number; tx: number; tz: number; wait: number; heading: number }

function h01(n: number): number { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

export class AmbientView {
  readonly group = new Group();
  /** Seeing through the manager's eyes: only what is close by is drawn. */
  close = false;
  private critters: Critter[] = [];
  private clouds: Mesh | null = null;
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private readonly dummy = new Object3D();
  /** The sky's weather (set each frame by the renderer): cloud cover, storm, wind and a lightning flash. */
  weather = { cloud: 0.15, storm: 0, wind: 0.2, flash: 0 };
  constructor(private readonly assets: AssetLibrary) {
    this.skyMat = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new Color('#5FA8E8') }, bottom: { value: new Color('#CFE8FF') }, sunDir: { value: new Vector3(0, 1, 0) }, sunCol: { value: new Color(0, 0, 0) }, cloud: { value: 0 }, storm: { value: 0 }, drift: { value: new Vector2() }, flash: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // The gradient, and the sun: a bright disc in a soft halo that widens and warms near the horizon.
      // Then the cloud deck: noise on a plane high overhead, thickening with the cover, its underside
      // darkening in a storm, lit up by lightning, thinning out towards the horizon into the haze.
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float cloud; uniform float storm; uniform vec2 drift; uniform float flash; varying vec3 vP;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + 1.0), f.x), f.y); }
        float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vP);
          float t = clamp(d.y * 1.6 + 0.05, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(t, 0.8));
          float s = max(dot(d, sunDir), 0.0);
          vec3 sun = sunCol * (smoothstep(0.9993, 0.9997, s) * 3.0 + pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.18);
          if (cloud > 0.01 && d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.035) * 0.55 + drift;
            float n = fbm(uv);
            float cov = smoothstep(1.02 - cloud, 1.25 - cloud * 0.9, n);
            float thick = smoothstep(0.3, 0.9, n + cloud * 0.4);
            vec3 lit = mix(vec3(1.0), vec3(0.62, 0.66, 0.72), clamp((cloud - 0.45) * 1.4, 0.0, 1.0));
            vec3 base = mix(lit, vec3(0.22, 0.25, 0.3), storm * 0.85) * mix(1.0, 0.72, thick);
            base += vec3(0.85, 0.9, 1.0) * flash * 1.2;
            float fade = smoothstep(0.0, 0.035, d.y) * (1.0 - 0.35 * smoothstep(0.25, 0.0, d.y) * (1.0 - cloud));
            c = mix(c, base * mix(bottom, vec3(1.0), 0.35) * 1.05, cov * fade);
            sun *= 1.0 - cov * fade;
          }
          gl_FragColor = vec4(c + sun, 1.0);
        }`,
    });
    this.sky = new Mesh(new SphereGeometry(200, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
  }

  build(plan: TownPlan): void {
    this.group.clear();
    this.critters = [];
    this.group.add(this.sky);
    const mat = this.assets.material;
    for (const [i, home] of plan.animals.entries()) {
      const { obj, parts } = this.make(home.kind, i);
      obj.position.set(home.x, home.y ?? 0, home.z);
      this.group.add(obj);
      this.critters.push({ home, obj, parts, seed: i * 7.31 + home.x, x: home.x, z: home.z, tx: home.x, tz: home.z, wait: h01(i) * 3, heading: h01(i + 3) * 6.28 });
    }
    // Clouds: lumpy white puffs high overhead, one mesh turning slowly round the crossroads.
    const sky: BufferGeometry[] = [];
    for (let c = 0; c < 12; c++) {
      const puffs: BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const g = paint(new IcosahedronGeometry(2.4 + h01(c * 5 + k) * 2.2, 0), this.assets.palette, '#FFFFFF');
        g.translate((k - 2) * 2.6, h01(c + k * 3) * 1.4, h01(c * 2 + k) * 2.4 - 1.2);
        puffs.push(g);
      }
      const g = merge(puffs);
      g.scale(1, 0.55, 1);
      g.translate(-160 + c * 28 + h01(c) * 20, 46 + h01(c + 40) * 16, -70 + h01(c + 80) * 130);
      sky.push(g);
    }
    this.clouds = new Mesh(merge(sky), mat);
    this.clouds.castShadow = false;
    this.group.add(this.clouds);
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
        // One mesh: the whole duck tips forward to dabble.
        add(merge([box(pal, drake ? '#B9BCC4' : '#B58A5C', 0.16, 0.08, 0.26, 0, 0, 0), box(pal, drake ? '#8B5A3C' : '#A87B45', 0.14, 0.06, 0.08, 0, 0.04, 0.1), box(pal, '#38383D', 0.12, 0.05, 0.06, 0, 0.05, -0.13),
          box(pal, drake ? '#2E8560' : '#A87B45', 0.08, 0.09, 0.09, 0, 0.08, 0.12), box(pal, '#FF8C42', 0.04, 0.025, 0.07, 0, 0.1, 0.19)]));
        g.rotation.order = 'YXZ';
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
        // Two wings (the body is a dark stripe on one of them).
        parts.push(add(merge([box(pal, wing, 0.07, 0.004, 0.06, -0.035, 0, 0), box(pal, '#38383D', 0.012, 0.012, 0.06, -0.003, 0, 0)])), add(box(pal, wing, 0.07, 0.004, 0.06, 0.035, 0, 0)));
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
    // Only the deer is big enough for its shadow to read; the rest would double their draw calls for a speck.
    if (kind !== 'deer') g.traverse((o) => { (o as Mesh).castShadow = false; });
    return { obj: g, parts };
  }

  update(t: number, dt: number, camera: Camera, skyTop: Color, skyBottom: Color, sun?: { sunDir: Vector3; sunVisible: number; sun: { color: Color } }): void {
    this.sky.position.copy(camera.position);
    // Through the eyes the view ends a street or two away: the sky comes in with it (its size never shows), or it would
    // be cut away whole, leaving one flat colour with no sun or clouds.
    this.sky.scale.setScalar(this.close ? 0.25 : 1);
    this.skyMat.uniforms.top!.value.copy(skyTop);
    this.skyMat.uniforms.bottom!.value.copy(skyBottom);
    if (sun) { this.skyMat.uniforms.sunDir!.value.copy(sun.sunDir); this.skyMat.uniforms.sunCol!.value.copy(sun.sun.color).multiplyScalar(sun.sunVisible); }
    // The cloud deck drifts with the wind; the puffy fair-weather clouds give way to it as the sky closes over.
    const u = this.skyMat.uniforms;
    u.cloud!.value = this.weather.cloud; u.storm!.value = this.weather.storm; u.flash!.value = this.weather.flash;
    u.drift!.value.set(t * 0.012 * (1 + this.weather.wind * 3), t * 0.007);
    // (Not through the eyes: out past where the view ends, they would be flat blobs of haze on the sky.)
    if (this.clouds) this.clouds.visible = this.weather.cloud < 0.6 && !this.close;
    // Animals far from the camera are too small to see and cost a draw call per part: skip them.
    const cp = camera.position;
    for (const c of this.critters) {
      // Through the manager's eyes, no birds wheeling far overhead, and the rest only close by.
      const far = this.close ? (c.home.kind === 'bird' ? 0 : 18) : c.home.kind === 'bird' ? 90 : c.home.kind === 'deer' ? 36 : 24;
      const vis = Math.hypot(c.obj.position.x - cp.x, c.obj.position.z - cp.z) < far;
      c.obj.visible = vis;
      if (vis) this.animate(c, t, dt);
    }
    if (this.clouds) this.clouds.rotation.y = t * 0.004;
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
    if (k === 'duck') { o.position.y = y0 + Math.sin(t * 2.2 + s) * 0.008; o.rotation.x = !moving && Math.sin(t * 0.7 + s) > 0.85 ? 0.9 : 0; }
    if (k === 'deer') {
      // Graze while standing, look up now and then; legs swing while walking.
      const graze = !moving && Math.sin(t * 0.4 + s) > -0.3;
      const neck = c.parts[4]!;
      neck.rotation.x += ((graze ? 1.6 : 0) - neck.rotation.x) * Math.min(1, dt * 2);
      for (let l = 0; l < 4; l++) c.parts[l]!.rotation.x = moving ? Math.sin(t * 6 + l * Math.PI * 0.5) * 0.4 : 0;
    }
  }
}
