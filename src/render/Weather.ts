import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicMaterial, ShaderMaterial, Vector2, Vector3, Vector4, type MeshStandardMaterial } from 'three';
import { lightningAt, type WeatherNow } from '@/sim/weather';

/** Rain drops at the heaviest (drawn: as many as the rain is heavy), and splashes on the ground. */
const DROPS = 7000, SPLASHES = 700;
/** The box of falling rain round the camera's focus, in units: wide, and as tall as the camera is high. */
const BOX = 34, HEIGHT = 22;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A strike of lightning: where, how strong, how long ago it started (seconds). */
interface Strike { x: number; z: number; strength: number; age: number; bolt: Mesh }

/**
 * The weather you can see. Rain falls in streaks round wherever the camera looks, slanting with the
 * wind, splashing on the ground and never inside the shop (its roof is only off so you can see in);
 * roads and pavements darken and shine as they get wet and dry off slowly after. In a storm, lightning:
 * a jagged bolt from the clouds to somewhere out in town, flickering for a moment, the whole scene
 * lit by it (the flash), and the thunder that follows (queued for the audio, later the further away).
 */
export class WeatherView {
  readonly group = new Group();
  private readonly rain: Mesh;
  private readonly splash: Mesh;
  private readonly rainU = {
    uCentre: { value: new Vector3() }, uTime: { value: 0 }, uWind: { value: new Vector2() }, uNoRain: { value: new Vector4(0, 0, 0, 0) }, uColour: { value: new Color('#C9D6E6') }, uAlpha: { value: 0.32 },
  };
  private readonly strikes: Strike[] = [];
  private readonly boltMat = new MeshBasicMaterial({ color: new Color(5.5, 5.8, 7.5), side: DoubleSide, toneMapped: true, fog: false });
  private time = 0;
  /** How wet the ground is, 0..1: soaks in with the rain, dries slowly after. */
  wet = 0;
  /** The flash of the latest strike right now, 0..1 (for the lighting). */
  flash = 0;
  /** Thunder to play: distance in units of each strike since the audio last took them, and the delay before it is heard. */
  readonly thunder: { distance: number; delay: number; strength: number }[] = [];
  /** The rain right now (0..1), for the sound and for umbrellas. */
  rainLevel = 0;
  /** Screenshots: hold each strike at its brightest instead of letting it flicker out. */
  static holdStrikes = false;

  /** The outdoor ground materials that get wet (roads and pavements, the lawn). */
  readonly groundMats: MeshStandardMaterial[] = [];

  constructor() {
    // Rain: one thin quad per drop, turned to face the camera round its own fall line.
    const r = rng(91);
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    const rg = new InstancedBufferGeometry();
    rg.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) { seeds[i * 3] = r(); seeds[i * 3 + 1] = r(); seeds[i * 3 + 2] = r(); }
    rg.setAttribute('seed', new InstancedBufferAttribute(seeds, 3));
    rg.instanceCount = 0;
    const rainMat = new ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, side: DoubleSide,
      vertexShader: `attribute vec3 seed;
        uniform vec3 uCentre; uniform float uTime; uniform vec2 uWind; uniform vec4 uNoRain;
        varying float vA;
        void main() {
          float H = ${HEIGHT.toFixed(1)}, B = ${BOX.toFixed(1)};
          float speed = 26.0 + seed.z * 8.0;
          float fall = mod(uTime * speed + seed.z * H, H);
          float y = H - fall;
          // The drop's column drifts with the wind as it falls; columns wrap round the focus so rain is always about you.
          vec2 col = (seed.xy - 0.5) * B + uWind * (H - y) * 0.06;
          vec2 rel = mod(col - uCentre.xz + B * 0.5, B) - B * 0.5;
          vec2 xz = uCentre.xz + rel;
          vec3 dir = normalize(vec3(-uWind.x * 0.06, -1.0, -uWind.y * 0.06));
          float len = 0.6 + seed.x * 0.35;
          vec3 base = vec3(xz.x, y, xz.y);
          float far = distance(cameraPosition, base);
          vec3 toCam = (cameraPosition - base) / far;
          // About the same width on screen near or far, so distant rain still reads as rain.
          vec3 side = normalize(cross(dir, toCam)) * (0.004 + 0.0012 * far);
          len *= 1.0 + far * 0.012;
          vec3 p = base - dir * len * position.y + side * position.x * 2.0;
          // None inside the shop, nor below the ground.
          bool inside = xz.x > uNoRain.x && xz.x < uNoRain.z && xz.y > uNoRain.y && xz.y < uNoRain.w;
          vA = (inside || y < 0.0) ? 0.0 : (1.0 - position.y * 0.7) * smoothstep(0.0, 1.5, y) * (1.0 - 0.55 * smoothstep(14.0, 40.0, far));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform vec3 uColour; uniform float uAlpha; varying float vA; void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(uColour, uAlpha * vA); }',
    });
    this.rain = new Mesh(rg, rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 3; this.rain.name = 'rain';

    // Splashes: a little ring opening and fading where a drop lands, somewhere new each time.
    const sg = new InstancedBufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    const ss = new Float32Array(SPLASHES * 2);
    for (let i = 0; i < SPLASHES; i++) { ss[i * 2] = r(); ss[i * 2 + 1] = r(); }
    sg.setAttribute('seed', new InstancedBufferAttribute(ss, 2));
    sg.instanceCount = 0;
    const splashMat = new ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute vec2 seed;
        uniform vec3 uCentre; uniform float uTime; uniform vec4 uNoRain;
        varying vec2 vP; varying float vT; varying float vA;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          float life = 0.45;
          float k = uTime / life + seed.x * 7.0;
          float cyc = floor(k);
          vT = fract(k);
          vec2 at = uCentre.xz + (vec2(h(seed + cyc), h(seed.yx + cyc * 1.7)) - 0.5) * ${(BOX * 0.7).toFixed(1)};
          bool inside = at.x > uNoRain.x && at.x < uNoRain.z && at.y > uNoRain.y && at.y < uNoRain.w;
          vA = inside ? 0.0 : 1.0;
          vP = position.xz;
          float r = 0.05 + vT * 0.09;
          gl_Position = projectionMatrix * viewMatrix * vec4(at.x + position.x * r, 0.065, at.y + position.z * r, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColour; varying vec2 vP; varying float vT; varying float vA;
        void main() { float d = length(vP); float ring = smoothstep(0.62, 0.8, d) * (1.0 - smoothstep(0.85, 1.0, d)); float a = ring * (1.0 - vT) * 0.55 * vA; if (a <= 0.01) discard; gl_FragColor = vec4(uColour, a); }`,
    });
    this.splash = new Mesh(sg, splashMat);
    this.splash.frustumCulled = false; this.splash.renderOrder = 2; this.splash.name = 'splashes';
    this.group.add(this.rain, this.splash);
  }

  /** Where rain never falls (the shop floor, in world coordinates). */
  setShelter(x0: number, z0: number, x1: number, z1: number): void { this.rainU.uNoRain.value.set(x0, z0, x1, z1); }

  /**
   * Each frame: the weather now, the camera's focus, real seconds since the last frame (rain and
   * lightning keep their pace at any game speed), the town's seed (for where lightning strikes).
   */
  update(w: WeatherNow, focus: Vector3, dt: number, seed: number, rainScale = 1): void {
    this.time += dt;
    this.rainU.uTime.value = this.time;
    this.rainU.uCentre.value.set(focus.x, 0, focus.z);
    const ang = seed * 2.4;
    this.rainU.uWind.value.set(Math.cos(ang) * w.wind * 10, Math.sin(ang) * w.wind * 10);
    this.rainLevel = w.rain;
    const drops = Math.round(DROPS * Math.min(1, w.rain) * rainScale);
    (this.rain.geometry as InstancedBufferGeometry).instanceCount = drops;
    (this.splash.geometry as InstancedBufferGeometry).instanceCount = Math.round(SPLASHES * Math.min(1, w.rain * 1.3) * rainScale);
    this.rain.visible = drops > 0; this.splash.visible = drops > 0;
    // Darker drops against a stormy sky read better than pale ones.
    this.rainU.uColour.value.set(w.storm > 0.3 ? '#AFC0D4' : '#D5E0EC');
    this.rainU.uAlpha.value = 0.32 + 0.3 * w.rain;
    // The ground soaks up the rain in a minute or so and takes several to dry.
    this.wet += (Math.min(1, w.rain * 1.6) - this.wet) * Math.min(1, dt * (w.rain > this.wet ? 0.08 : 0.015));
    for (const m of this.groundMats) {
      m.roughness = 0.95 - 0.6 * this.wet;
      m.color.setScalar(1 - 0.32 * this.wet);
    }
    // Lightning.
    const s = lightningAt(w.storm, this.time, dt, seed);
    if (s) this.strike(focus.x + s.x, focus.z + s.z, s.strength, Math.hypot(s.x, s.z));
    this.flash = 0;
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const st = this.strikes[i]!;
      st.age = WeatherView.holdStrikes ? Math.min(st.age + dt, 0.03) : st.age + dt;
      // On, off, on again, then gone: a real strike flickers as it re-strikes down the same channel.
      const a = st.age;
      const on = a < 0.07 ? 1 : a < 0.11 ? 0.15 : a < 0.22 ? 0.85 : a < 0.3 ? 0.4 * (1 - (a - 0.22) / 0.08) : 0;
      st.bolt.visible = on > 0.3;
      this.flash = Math.max(this.flash, on * st.strength * Math.max(0.35, 1 - Math.hypot(st.x - focus.x, st.z - focus.z) / 120));
      if (a > 0.32) { this.group.remove(st.bolt); st.bolt.geometry.dispose(); this.strikes.splice(i, 1); }
    }
  }

  /** A strike at (x, z), `strength` 0..1, `distance` units from the focus: the bolt, and its thunder queued. */
  strike(x: number, z: number, strength: number, distance: number): void {
    const bolt = new Mesh(boltGeometry(x, z, Math.floor(this.time * 1000)), this.boltMat);
    bolt.frustumCulled = false;
    this.group.add(bolt);
    this.strikes.push({ x, z, strength, age: 0, bolt });
    // Sound travels about 340 m a second; a unit is about three metres.
    this.thunder.push({ distance, delay: (distance * 3) / 340, strength });
    if (this.thunder.length > 6) this.thunder.shift();
  }
}

/** A jagged bolt from the cloud base down to the ground at (x, z), with a branch or two: thin flat ribbons. */
export function boltGeometry(x: number, z: number, seed: number): BufferGeometry {
  const r = rng(seed);
  const pos: number[] = [];
  const ribbon = (pts: Vector3[], w: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      // Two crossed ribbons per segment, so it reads from any side.
      for (const [ox, oz] of [[w, 0], [0, w]] as const) pos.push(a.x - ox, a.y, a.z - oz, a.x + ox, a.y, a.z + oz, b.x + ox, b.y, b.z + oz, a.x - ox, a.y, a.z - oz, b.x + ox, b.y, b.z + oz, b.x - ox, b.y, b.z - oz);
    }
  };
  const path = (from: Vector3, to: Vector3, n: number, jag: number) => {
    const pts = [from.clone()];
    for (let i = 1; i < n; i++) { const t = i / n; pts.push(new Vector3(from.x + (to.x - from.x) * t + (r() - 0.5) * jag, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t + (r() - 0.5) * jag)); }
    pts.push(to.clone());
    return pts;
  };
  const top = new Vector3(x + (r() - 0.5) * 8, 42, z + (r() - 0.5) * 8);
  const main = path(top, new Vector3(x, 0, z), 14, 3.2);
  ribbon(main, 0.16);
  for (let b = 0; b < 2; b++) {
    const from = main[3 + Math.floor(r() * 6)]!;
    ribbon(path(from, new Vector3(from.x + (r() - 0.5) * 14, from.y * (0.3 + r() * 0.3), from.z + (r() - 0.5) * 14), 6, 2.2), 0.08);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

