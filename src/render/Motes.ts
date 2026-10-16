/**
 * Light in the air, on the Limitless preset: by day, specks of dust drifting in the sun; after dark, fireflies
 * blinking over the grass. A few hundred points in a box round the camera's focus, each wandering its own slow
 * loop (worked out in the vertex shader from the time, so nothing is touched per frame but a few uniforms).
 */
import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Color, Vector3 } from 'three';

const N = 420;
/** Half the width of the box the motes fill round the focus. */
const R = 14;

export class Motes {
  readonly points: Points;
  private readonly mat: ShaderMaterial;
  /** How far in (0..1) the night is: the dust fades out as the fireflies come up. */
  private dark = 0;

  constructor() {
    const g = new BufferGeometry();
    const seed = new Float32Array(N * 4);
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N * 4; i++) seed[i] = rnd();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('seed', new Float32BufferAttribute(seed, 4));
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCentre: { value: new Vector3() }, uColour: { value: new Color() }, uAlpha: { value: 0 }, uSize: { value: 1 }, uPixel: { value: 1 }, uTop: { value: 3 } },
      vertexShader: `
        attribute vec4 seed;
        uniform float uTime; uniform vec3 uCentre; uniform float uSize; uniform float uPixel; uniform float uTop;
        varying float vA;
        void main() {
          float t = uTime * (0.05 + seed.w * 0.08);
          // A home in the box round the focus (wrapping round as the camera moves on), and a slow wander about it.
          vec3 home = vec3(seed.x * ${(2 * R).toFixed(1)} - ${R.toFixed(1)}, 0.15 + seed.y * uTop, seed.z * ${(2 * R).toFixed(1)} - ${R.toFixed(1)});
          vec3 p = home + vec3(sin(t * 6.3 + seed.y * 20.0), 0.4 * sin(t * 4.1 + seed.x * 17.0), cos(t * 5.2 + seed.z * 13.0)) * 0.6;
          p.xz = mod(p.xz - uCentre.xz + ${R.toFixed(1)}, ${(2 * R).toFixed(1)}) - ${R.toFixed(1)} + uCentre.xz;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // Each twinkles to its own beat.
          vA = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * (1.2 + seed.w * 2.2) + seed.x * 40.0), 3.0);
          gl_PointSize = min(7.0 * uPixel, uSize * uPixel * (0.6 + seed.w) * 60.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: `
        uniform vec3 uColour; uniform float uAlpha; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.0, r);
          gl_FragColor = vec4(uColour * (1.0 + a), a * vA * uAlpha);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    // Never picked by a click (their positions live in the shader).
    this.points.raycast = () => {};
    this.points.visible = false;
  }

  /** Each frame: seconds so far, the focus, whether the lights are on (night), the pixel ratio. */
  update(time: number, dt: number, focus: Vector3, night: boolean, pixel: number): void {
    if (!this.points.visible) return;
    this.dark += ((night ? 1 : 0) - this.dark) * Math.min(1, dt * 0.5);
    const u = this.mat.uniforms;
    u.uTime!.value = time;
    (u.uCentre!.value as Vector3).copy(focus);
    u.uPixel!.value = pixel;
    // Warm dust by day, yellow-green fireflies low over the ground at night (bright enough to bloom).
    (u.uColour!.value as Color).setRGB(1.0 + 0.4 * this.dark, 0.95 + 0.75 * this.dark, 0.8 - 0.35 * this.dark);
    u.uAlpha!.value = 0.28 + 0.62 * this.dark;
    u.uSize!.value = 0.55 + 0.75 * this.dark;
    u.uTop!.value = 3 - 1.9 * this.dark;
  }

  dispose(): void { this.points.geometry.dispose(); this.mat.dispose(); }
}
