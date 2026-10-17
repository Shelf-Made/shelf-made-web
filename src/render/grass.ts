import type { Object3D} from 'three';
import { BufferGeometry, Color, DoubleSide, ShaderChunk, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshStandardMaterial, ShaderMaterial, NearestFilter, OrthographicCamera, RedFormat, type Scene, type Texture, Vector2, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three';

/**
 * A lawn of real blades round wherever the camera looks: the ground carries the colour and the mottling,
 * and this grows short grass all over it, thick enough to read as turf rather than a painted floor.
 *
 * One draw: a patch of blades a unit square, instanced over a ring of cells that follows the camera's
 * focus (snapped to whole cells, so blades never swim). Where the grass may grow is a top-down mask of
 * everything built on the ground (roads, pavements, lots, buildings, tree trunks, the river banks...),
 * drawn once from the static scene whenever it changes, so the blades stop at every edge without the
 * lawn rules of each corner being written twice. Blades shrink away towards the edge of the ring, where
 * the painted ground and the scattered tufts carry on. Still: no wind.
 */
const BLADES = 100;
/** Cells across the ring (one cell = one unit, about three metres). */
export const GRASS_RING = 36;
/** The mask covers x, z in [-MASK_HALF, MASK_HALF]; outside it nothing grows (out there the fog has the plain). */
export const MASK_HALF = 96;
const MASK_RES = 1024;
/** The mask holds the height of what is built (0 where nothing is): 0.1 + 0.9 * y / HEIGHT_RANGE. */
export const HEIGHT_RANGE = 12;

/** A repeatable stream of 0..1 numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** BLADES blades scattered over the unit square: each a tapering triangle, darker at the root, lighter (some sun-bleached) at the tip. */
export function grassPatch(seed = 11): BufferGeometry {
  const r = rng(seed);
  const pos: number[] = [], col: number[] = [], root: number[] = [], nor: number[] = [];
  const base = [new Color('#3F8640'), new Color('#4A9147'), new Color('#3B7E3C')];
  const tips = [new Color('#8CCB72'), new Color('#9AD27C'), new Color('#7DBE68'), new Color('#B4CF76'), new Color('#A4D480'), new Color('#6FB25E')];
  const c = new Color();
  for (let i = 0; i < BLADES; i++) {
    const x = r(), z = r();
    // Mostly short turf, the odd taller stalk: about the size of the tufts' blades, so the two read as one lawn.
    const h = r() < 0.14 ? 0.11 + r() * 0.05 : 0.055 + r() * 0.055;
    const w = 0.02 + r() * 0.014;
    const a = r() * Math.PI * 2, lean = (0.1 + r() * 0.35) * h, la = r() * Math.PI * 2;
    const px = Math.cos(a) * w / 2, pz = Math.sin(a) * w / 2;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(la) * lean, h, z + Math.sin(la) * lean);
    c.copy(base[Math.floor(r() * base.length)]!);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    c.copy(tips[Math.floor(r() * tips.length)]!).multiplyScalar(0.92 + r() * 0.16);
    col.push(c.r, c.g, c.b);
    for (let k = 0; k < 3; k++) { root.push(x, z); nor.push(0, 1, 0); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('root', new Float32BufferAttribute(root, 2));
  return g;
}

export class GrassField {
  readonly mesh: Mesh;
  private readonly target = new WebGLRenderTarget(MASK_RES, MASK_RES, { format: RedFormat, magFilter: NearestFilter, minFilter: NearestFilter, depthBuffer: true });
  private readonly uniforms = {
    uMask: { value: null as Texture | null },
    uMaskRect: { value: new Vector4(-MASK_HALF, -MASK_HALF, 1 / (2 * MASK_HALF), 1 / (2 * MASK_HALF)) },
    uOrigin: { value: new Vector2() },
    uFocus: { value: new Vector2() },
    uRadius: { value: GRASS_RING / 2 },
    uOn: { value: 0 },
  };
  private readonly maskCam = new OrthographicCamera(-MASK_HALF, MASK_HALF, MASK_HALF, -MASK_HALF, 0.1, 200);
  /** Draws the height of the top surface (seen from above) into the mask. */
  private readonly white = new ShaderMaterial({
    side: DoubleSide, fog: false,
    vertexShader: `varying float vY; void main() { vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      vec4 w = modelMatrix * p; vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying float vY; void main() { gl_FragColor = vec4(0.1 + 0.9 * clamp(vY / ${HEIGHT_RANGE.toFixed(1)}, 0.0, 1.0), 0.0, 0.0, 1.0); }`,
  });
  private maskKey = '';

  constructor() {
    const patch = grassPatch();
    const g = new InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'color', 'root']) g.setAttribute(name, patch.getAttribute(name));
    const cells: number[] = [];
    for (let z = 0; z < GRASS_RING; z++) for (let x = 0; x < GRASS_RING; x++) cells.push(x, z);
    g.setAttribute('cell', new InstancedBufferAttribute(new Float32Array(cells), 2));
    g.instanceCount = GRASS_RING * GRASS_RING;
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = `attribute vec2 cell;
attribute vec2 root;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform vec2 uOrigin;
uniform vec2 uFocus;
uniform float uRadius;
uniform float uOn;
float grassHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
` + sh.vertexShader
        .replace('#include <color_vertex>', `#include <color_vertex>
  // Patches turned and mirrored cell by cell, so the field never shows its repeat; mottled like the ground.
  vec2 gcell = uOrigin + cell;
  float gk = floor(grassHash(gcell) * 4.0);
  vec2 gl = root - 0.5;
  vec2 gr = gk < 1.0 ? gl : gk < 2.0 ? vec2(-gl.y, gl.x) : gk < 3.0 ? -gl : vec2(gl.y, -gl.x);
  if (grassHash(gcell + 7.1) > 0.5) gr.x = -gr.x;
  vec2 groot = gcell + 0.5 + gr;
  vec2 gm = (groot - uMaskRect.xy) * uMaskRect.zw;
  float gfree = (gm.x > 0.0 && gm.x < 1.0 && gm.y > 0.0 && gm.y < 1.0) ? 1.0 - step(0.03, texture2D(uMask, vec2(gm.x, 1.0 - gm.y)).r) : 0.0;
  float gd = distance(groot, uFocus);
  float gsize = uOn * gfree * (1.0 - smoothstep(uRadius * 0.62, uRadius, gd));
  float gpatch = 0.75 + 0.5 * grassHash(floor(groot * 0.45));
  vColor.rgb *= 0.9 + 0.2 * grassHash(floor(groot * 0.8) + 3.0);`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec2 off = transformed.xz - root;
    vec2 o2 = gk < 1.0 ? off : gk < 2.0 ? vec2(-off.y, off.x) : gk < 3.0 ? -off : vec2(off.y, -off.x);
    if (grassHash(gcell + 7.1) > 0.5) o2.x = -o2.x;
    transformed = vec3(groot.x + o2.x * gsize, transformed.y * gsize * gpatch - 0.012, groot.y + o2.y * gsize);
  }`);
      // Lit like the ground under it from both sides: a blade seen from behind keeps its normal pointing up.
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    m.customProgramCacheKey = () => 'grass-field-1';
    this.mesh = new Mesh(g, m);
    this.mesh.name = 'grass-field';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // (Placed blade by blade in its shader: the ambient occlusion's plain render of the scene leaves it out.)
    this.mesh.userData.noAO = true;
    // Looking straight down from high above: screen right is +x, screen up is -z.
    this.maskCam.position.set(0, 100, 0);
    this.maskCam.up.set(0, 0, -1);
    this.maskCam.lookAt(0, 0, 0);
    this.maskCam.updateMatrixWorld();
    this.maskCam.updateProjectionMatrix();
  }

  /** Follow the camera's focus: the ring snaps to whole cells. */
  update(fx: number, fz: number, radius: number): void {
    const half = GRASS_RING / 2;
    this.uniforms.uOrigin.value.set(Math.floor(fx) - half, Math.floor(fz) - half);
    this.uniforms.uFocus.value.set(fx, fz);
    this.uniforms.uRadius.value = Math.min(half, Math.max(6, radius));
  }

  /**
   * Redraw where grass may grow when what stands on the ground has changed (`key` says so): everything
   * visible in `solids`, seen from straight above, in white. Lights, fog, shadows and everything else
   * in the scene stay out of it.
   */
  refreshMask(renderer: WebGLRenderer, scene: Scene, solids: Object3D[], skip: (o: Object3D) => boolean, key: string): void {
    if (key === this.maskKey) return;
    this.maskKey = key;
    const hidden: Object3D[] = [];
    const hide = (o: Object3D) => { if (o.visible) { o.visible = false; hidden.push(o); } };
    for (const c of scene.children) if (!solids.includes(c)) hide(c);
    for (const s of solids) s.traverse((o) => { if (o !== s && skip(o)) hide(o); });
    const prev = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, bg: scene.background, fog: scene.fog, shadows: renderer.shadowMap.autoUpdate, alpha: renderer.getClearAlpha(), colour: renderer.getClearColor(new Color()) };
    scene.overrideMaterial = this.white; scene.background = null; scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, this.maskCam);
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.colour, prev.alpha);
    renderer.shadowMap.autoUpdate = prev.shadows;
    scene.overrideMaterial = prev.override; scene.background = prev.bg; scene.fog = prev.fog;
    for (const o of hidden) o.visible = true;
    this.uniforms.uMask.value = this.target.texture;
    this.uniforms.uOn.value = 1;
  }

  /** The mask (where grass may not grow, and how high what is built there stands), once drawn. */
  get mask(): Texture | null { return this.uniforms.uMask.value; }

  /** Has the mask been drawn (so the blades show)? */
  get ready(): boolean { return this.uniforms.uOn.value > 0; }

  dispose(): void { this.target.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as MeshStandardMaterial).dispose(); this.white.dispose(); }
}
