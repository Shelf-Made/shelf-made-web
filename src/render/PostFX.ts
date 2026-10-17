import { Vector2, HalfFloatType, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer, type Scene, type Camera, type PerspectiveCamera, type Object3D, type Sprite } from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Quality } from '@/save/settings';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

/**
 * The scene's own render. On Limitless it is multisampled (smoother edges) in a target of its own and copied on
 * from there: the full-screen passes after it gain nothing from multisampling, so they keep to plain targets
 * (far less memory, and one resolve a frame instead of one a pass).
 */
class SceneRender extends RenderPass {
  private samples = 0;
  private msaa: WebGLRenderTarget | null = null;
  private readonly copy = new FullScreenQuad(new ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
    depthTest: false, depthWrite: false,
  }));

  /** Samples a pixel: 4 on Limitless, 0 for none (its target is let go). */
  setSamples(n: number): void {
    if (n === this.samples) return;
    this.samples = n;
    this.msaa?.dispose(); this.msaa = null;
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    if (this.samples === 0) { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); return; }
    this.msaa ??= new WebGLRenderTarget(readBuffer.width, readBuffer.height, { type: HalfFloatType, samples: this.samples });
    if (this.msaa.width !== readBuffer.width || this.msaa.height !== readBuffer.height) this.msaa.setSize(readBuffer.width, readBuffer.height);
    super.render(renderer, writeBuffer, this.msaa, deltaTime, maskActive);
    (this.copy.material as ShaderMaterial).uniforms.tDiffuse!.value = this.msaa.texture;
    renderer.setRenderTarget(readBuffer);
    this.copy.render(renderer);
  }
}

/**
 * The ambient occlusion, its own render of the scene (every surface's facing and depth, in one plain material)
 * kept to solid things. Anything placed by its own shader (the grass, the rain: tagged `userData.noAO`) would come
 * out as its bare template at the world's origin, and sprites (bubbles, spill markers) have no facing and come
 * out black, so they are hidden for it, as three already hides points and lines. Nor does it draw the sun's
 * shadows again: the scene's render has just drawn them.
 */
class ContactShade extends GTAOPass {
  private readonly hidden: Object3D[] = [];

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.scene.traverseVisible((o) => { if (o.userData.noAO || (o as Sprite).isSprite) { o.visible = false; this.hidden.push(o); } });
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.shadowMap.autoUpdate = shadows;
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
}

/**
 * The miniature look, kept mild: a soft bloom on things that glow (windows, signs and street lamps at
 * night are pushed brighter than any lit surface gets, so only they cross the threshold), and a
 * tilt-shift blur at the top and bottom of the screen that fades in only at the far overview zoom.
 * Tone mapping (in the output pass) and a cheerful grade (vibrance, warmth, a faint vignette) finish the frame.
 * Off on Low quality; Medium renders the bloom at a quarter of the pixels. Limitless adds ambient occlusion
 * (soft contact shade where things meet: under shelves, in corners, round people's feet), four-times
 * multisampling, and the bloom at full resolution, a little stronger.
 */
export class PostFX {
  private composer: EffectComposer;
  private pass: SceneRender;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  /** Ambient occlusion (Limitless only; made the first time it is wanted). */
  private ao: GTAOPass | null = null;
  enabled = true;
  private w = 1; private h = 1;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly camera: Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = HalfFloatType;
    this.composer.renderTarget2.texture.type = HalfFloatType;
    this.pass = new SceneRender(scene, camera);
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.45, 0.5, 1.4);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    for (const p of [this.tiltH, this.tiltV]) p.uniforms.r!.value = 0.45;
    this.composer.addPass(this.pass);
    // One stray NaN or infinite pixel (a degenerate normal somewhere) would be smeared over the whole frame by the
    // bloom's blur and blank it: zero those and clamp the rest before blooming.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = (any(isnan(c)) || any(isinf(c))) ? vec4(0.0, 0.0, 0.0, 1.0) : clamp(c, 0.0, 16.0); }',
    }));
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    // The grade, after tone mapping: a sunny, cheerful finish. Vibrance (the duller colours get the
    // most, so the grass and the paint pop and skin and the already bright colours are left alone), a
    // touch of warmth, the mid-tones opened up a little, and only a whisper of a vignette at the corners.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec3 x = c.rgb;
          float l = dot(x, vec3(0.299, 0.587, 0.114));
          float sat = max(x.r, max(x.g, x.b)) - min(x.r, min(x.g, x.b));
          x = mix(vec3(l), x, 1.0 + 0.32 * (1.0 - sat));
          x *= vec3(1.025, 1.0, 0.965);
          x = pow(max(x, 0.0), vec3(0.93));
          vec2 d = vUv - 0.5;
          x *= 1.0 - 0.1 * smoothstep(0.3, 0.8, dot(d, d) * 2.2);
          gl_FragColor = vec4(clamp(x, 0.0, 1.0), c.a);
        }`,
    }));
  }

  setQuality(q: Quality): void {
    this.enabled = q !== 'low';
    // The glow is worked out at half the drawing size each way (a quarter of the pixels), on Limitless at the full
    // size. (The bloom reads its `resolution` only when made: its size is what counts.)
    const pr = this.renderer.getPixelRatio(), k = q === 'limitless' ? 2 : 1;
    this.bloom.setSize(this.w * pr * k, this.h * pr * k);
    this.bloom.strength = q === 'limitless' ? 0.55 : 0.45;
    const limitless = q === 'limitless';
    if (limitless && !this.ao) {
      this.ao = new ContactShade(this.scene, this.camera, this.w, this.h);
      // Contact shade at the scale of the shop's pieces (a shelf is under a unit tall), soft and denoised.
      this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.ao.blendIntensity = 0.85;
      this.composer.insertPass(this.ao, 1);
    }
    if (this.ao) { this.ao.enabled = limitless; if (limitless) this.ao.setSize(this.w * this.renderer.getPixelRatio(), this.h * this.renderer.getPixelRatio()); }
    // Multisampling on the scene's render (the other passes are full-screen quads).
    this.pass.setSamples(limitless ? 4 : 0);
    this.quality = q;
  }
  private quality: Quality = 'high';

  setSize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.setQuality(this.quality);
  }

  /** tilt: 0 (none) to 1 (the far overview). */
  render(scene: Scene, camera: Camera, tilt: number): void {
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    this.pass.scene = scene; this.pass.camera = camera;
    if (this.ao?.enabled) { this.ao.scene = scene; this.ao.camera = camera as PerspectiveCamera; }
    const on = tilt > 0.01;
    this.tiltH.enabled = on; this.tiltV.enabled = on;
    if (on) { this.tiltH.uniforms.h!.value = (2.2 * tilt) / this.w; this.tiltV.uniforms.v!.value = (2.2 * tilt) / this.h; }
    this.composer.render();
  }
}
