import { type BufferGeometry, Color, DirectionalLight, Group, HalfFloatType, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { AssetLibrary } from './assets';
import { box, merge } from './geometry';
import { productGeometry } from './storeArt';
import { bagGeometry } from './props';

/** Photos are 4:3, like a phone's main camera; big enough for the gallery, small enough to keep dozens. */
export const PHOTO_W = 480, PHOTO_H = 360;

/** A repeatable stream of 0..1 numbers for one photo. */
export function photoRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The phone in a shopper's hand. Renders a scene off screen (tone-mapped the way the game is), then
 * finishes it the way a phone does: its own white balance (a little warm or cool), a punchy contrast
 * and colour, a soft vignette, sensor noise in the shadows, held not quite level, saved as a JPEG.
 */
export class PhotoBooth {
  private readonly hdr = new WebGLRenderTarget(PHOTO_W, PHOTO_H, { type: HalfFloatType, samples: 4 });
  private readonly ldr = new WebGLRenderTarget(PHOTO_W, PHOTO_H);
  private readonly output = new OutputPass();
  private readonly buf = new Uint8Array(PHOTO_W * PHOTO_H * 4);
  private canvas: HTMLCanvasElement | null = null;
  private out: HTMLCanvasElement | null = null;

  constructor(private readonly renderer: WebGLRenderer) {}

  /** Render through a camera; the pixels, top row first. */
  shoot(scene: Scene, camera: Camera): ImageData | null {
    if (typeof document === 'undefined') return null;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.hdr);
      r.clear();
      r.render(scene, camera);
      this.output.render(r, this.ldr, this.hdr, 0, false);
      r.readRenderTargetPixels(this.ldr, 0, 0, PHOTO_W, PHOTO_H, this.buf);
    } finally {
      r.setRenderTarget(prev);
    }
    const img = new ImageData(PHOTO_W, PHOTO_H);
    const row = PHOTO_W * 4;
    for (let y = 0; y < PHOTO_H; y++) img.data.set(this.buf.subarray((PHOTO_H - 1 - y) * row, (PHOTO_H - y) * row), y * row);
    return img;
  }

  /**
   * The phone's processing, then a JPEG. `focusBlur` (0..1) blurs the top of the frame for a close-up's
   * shallow depth of field.
   */
  finish(img: ImageData, seed: number, focusBlur = 0): string {
    const rand = photoRng(seed ^ 0x9e3779b9);
    const d = img.data;
    const wb = (rand() - 0.4) * 0.08, lift = (rand() - 0.5) * 0.06;
    const wr = 1 + wb, wg = 1 + wb * 0.15, wbB = 1 - wb;
    let n = seed >>> 0;
    for (let y = 0; y < PHOTO_H; y++) {
      const vy = (y / PHOTO_H - 0.5) * 2;
      for (let x = 0; x < PHOTO_W; x++) {
        const i = (y * PHOTO_W + x) * 4;
        let r = d[i]! / 255, g = d[i + 1]! / 255, b = d[i + 2]! / 255;
        r *= wr; g *= wg; b *= wbB;
        // Phone colour: vibrance on the duller colours, a gentle S-curve.
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const k = 1 + 0.28 * (1 - sat);
        r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
        const s = (v: number) => { v = Math.max(0, Math.min(1, v + lift)); return v + 0.35 * v * (1 - v) * (v - 0.5); };
        r = s(r); g = s(g); b = s(b);
        // Lens fall-off.
        const vx = (x / PHOTO_W - 0.5) * 2;
        const v = 1 - 0.16 * Math.min(1, (vx * vx + vy * vy) * 0.6);
        // Sensor noise, stronger in the shadows.
        n = (n * 1664525 + 1013904223) >>> 0;
        const grain = ((n >>> 8) / 16777216 - 0.5) * (0.018 + 0.03 * (1 - l));
        d[i] = Math.max(0, Math.min(255, (r * v + grain) * 255));
        d[i + 1] = Math.max(0, Math.min(255, (g * v + grain) * 255));
        d[i + 2] = Math.max(0, Math.min(255, (b * v + grain) * 255));
      }
    }
    this.canvas ??= Object.assign(document.createElement('canvas'), { width: PHOTO_W, height: PHOTO_H });
    this.out ??= Object.assign(document.createElement('canvas'), { width: PHOTO_W, height: PHOTO_H });
    const c = this.canvas.getContext('2d')!, o = this.out.getContext('2d')!;
    c.putImageData(img, 0, 0);
    o.save();
    o.fillStyle = '#000'; o.fillRect(0, 0, PHOTO_W, PHOTO_H);
    // Held not quite level: turned a degree or two, cropped in to fill the frame.
    const a = (rand() - 0.5) * 0.05;
    o.translate(PHOTO_W / 2, PHOTO_H / 2); o.rotate(a); o.scale(1 + Math.abs(a) * 1.4, 1 + Math.abs(a) * 1.4); o.translate(-PHOTO_W / 2, -PHOTO_H / 2);
    if (focusBlur > 0) {
      // Shallow depth of field: the whole frame blurred, then the sharp picture over it, fading out toward the top.
      o.filter = `blur(${(2 + 3 * focusBlur).toFixed(1)}px)`;
      o.drawImage(this.canvas, 0, 0);
      o.filter = 'none';
      const mask = document.createElement('canvas'); mask.width = PHOTO_W; mask.height = PHOTO_H;
      const m = mask.getContext('2d')!;
      m.drawImage(this.canvas, 0, 0);
      m.globalCompositeOperation = 'destination-in';
      const grad = m.createLinearGradient(0, 0, 0, PHOTO_H);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.28 + 0.12 * (1 - focusBlur), 'rgba(0,0,0,0)'); grad.addColorStop(0.55, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
      m.fillStyle = grad; m.fillRect(0, 0, PHOTO_W, PHOTO_H);
      o.drawImage(mask, 0, 0);
    } else o.drawImage(this.canvas, 0, 0);
    o.restore();
    return this.out.toDataURL('image/jpeg', 0.8);
  }

  dispose(): void { this.hdr.dispose(); this.ldr.dispose(); this.output.dispose(); }
}

/** A product's model for photos (recoloured once, kept: products are photographed again and again). */
const productGeos = new Map<string, BufferGeometry>();
export function photoProduct(assets: AssetLibrary, id: string): BufferGeometry {
  let g = productGeos.get(id);
  if (!g) { g = productGeometry(assets, id); g.computeBoundingBox(); productGeos.set(id, g); }
  return g;
}

/**
 * "My shopping": what a shopper bought, laid out on the kitchen worktop at home next to the shop's
 * carrier bag, under the window light. A small scene of its own (the town is not in it).
 */
export function haulScene(assets: AssetLibrary, products: string[], bagHex: string, seed: number): { scene: Scene; camera: PerspectiveCamera; dispose: () => void } {
  const rand = photoRng(seed);
  const pal = assets.palette;
  const scene = new Scene();
  scene.background = new Color('#E9E4DA');
  const wood = rand() < 0.5;
  const top = wood ? '#C99A62' : '#F4F7FA', edge = wood ? '#A87B45' : '#D8DADF';
  // The worktop, its edge, and a tiled splashback (white tiles, grey grout).
  const parts = [box(pal, top, 2.4, 0.04, 1.2, 0, -0.04, 0), box(pal, edge, 2.4, 0.03, 0.02, 0, -0.04, 0.6)];
  const tile = rand() < 0.5 ? '#FFFFFF' : '#FFF3DC';
  parts.push(box(pal, '#D8DADF', 2.4, 0.9, 0.02, 0, 0, -0.42));
  for (let row = 0; row < 9; row++) for (let col = 0; col < 16; col++) parts.push(box(pal, tile, 0.142, 0.092, 0.01, -1.2 + 0.075 + col * 0.15 + (row % 2 ? 0.075 : 0), 0.004 + row * 0.1, -0.405));
  const room = new Mesh(merge(parts), assets.plainMaterial);
  room.receiveShadow = true;
  scene.add(room);
  // The bag behind, the shopping in front of it, each turned a little.
  const goods = new Group();
  const bag = new Mesh(bagGeometry(pal, bagHex), assets.plainMaterial);
  bag.scale.setScalar(1.6); bag.position.set((rand() - 0.5) * 0.1, 0.2, -0.16); bag.rotation.y = (rand() - 0.5) * 0.5;
  bag.castShadow = true; goods.add(bag);
  const list = products.length ? products : ['bread'];
  const n = Math.min(4, list.length);
  for (let i = 0; i < n; i++) {
    const g = photoProduct(assets, list[i]!);
    const bb = g.boundingBox!;
    const m = new Mesh(g, assets.plainMaterial);
    const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    m.scale.setScalar(0.11 / Math.max(0.02, size));
    m.position.set((i - (n - 1) / 2) * 0.13 + (rand() - 0.5) * 0.03, -bb.min.y * m.scale.y, 0.02 + (i % 2) * 0.06 + (rand() - 0.5) * 0.03);
    m.rotation.y = (rand() - 0.5) * 0.9;
    m.castShadow = true; m.receiveShadow = true;
    goods.add(m);
  }
  scene.add(goods);
  // Daylight from a window to one side, the room's own light filling in.
  const side = rand() < 0.5 ? -1 : 1;
  const sun = new DirectionalLight('#FFF1DC', 2.4);
  sun.position.set(side * 1.2, 1.6, 1.0); sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -0.6; sun.shadow.camera.right = 0.6; sun.shadow.camera.top = 0.6; sun.shadow.camera.bottom = -0.6; sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 5;
  sun.shadow.bias = -0.0008; sun.shadow.radius = 3;
  scene.add(sun, sun.target, new HemisphereLight('#FFF8EE', '#C9B79C', 1.5));
  // Looking down at the worktop from where you stand, a little off to one side.
  const camera = new PerspectiveCamera(50, PHOTO_W / PHOTO_H, 0.02, 20);
  const yaw = (rand() - 0.5) * 0.6, dist = 0.44 + rand() * 0.1, h = 0.3 + rand() * 0.1;
  camera.position.set(Math.sin(yaw) * dist, h, Math.cos(yaw) * dist);
  camera.lookAt(new Vector3(0, 0.04, -0.02));
  return { scene, camera, dispose: () => { room.geometry.dispose(); bag.geometry.dispose(); } };
}
