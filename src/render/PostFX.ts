import { Vector2, HalfFloatType, type WebGLRenderer, type Scene, type Camera } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

/**
 * The miniature look, kept mild: a soft bloom on things that glow (windows, signs and street lamps at
 * night are pushed brighter than any lit surface gets, so only they cross the threshold), and a
 * tilt-shift blur at the top and bottom of the screen that fades in only at the far overview zoom.
 * Tone mapping (in the output pass) and a cheerful grade (vibrance, warmth, a faint vignette) finish the frame.
 * Off on Low quality; Medium renders the bloom at a quarter of the pixels.
 */
export class PostFX {
  private composer: EffectComposer;
  private pass: RenderPass;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  enabled = true;
  private w = 1; private h = 1;

  constructor(private readonly renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = HalfFloatType;
    this.composer.renderTarget2.texture.type = HalfFloatType;
    this.pass = new RenderPass(scene, camera);
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

  setQuality(q: 'high' | 'medium' | 'low'): void {
    this.enabled = q !== 'low';
    this.bloom.resolution.set(q === 'high' ? this.w / 2 : this.w / 4, q === 'high' ? this.h / 2 : this.h / 4);
    this.quality = q;
  }
  private quality: 'high' | 'medium' | 'low' = 'high';

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
    const on = tilt > 0.01;
    this.tiltH.enabled = on; this.tiltV.enabled = on;
    if (on) { this.tiltH.uniforms.h!.value = (2.2 * tilt) / this.w; this.tiltV.uniforms.v!.value = (2.2 * tilt) / this.h; }
    this.composer.render();
  }
}
