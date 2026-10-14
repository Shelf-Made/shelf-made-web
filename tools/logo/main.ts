/**
 * Renders the brand mark: the manager's head (the in-game Kenney employee) on a transparent
 * background. Driven by tools/render-logo.ts; exposes the PNGs as data URLs on window.
 */
import { Scene, WebGLRenderer, OrthographicCamera, DirectionalLight, HemisphereLight, AmbientLight, Vector3, SRGBColorSpace, NoToneMapping } from 'three';
import { AssetLibrary } from '@/render/assets';
import { PeopleView } from '@/render/People';
import type { GameState, Person } from '@/sim/types';

declare global { interface Window { __logo?: Record<string, string>; __logoError?: string } }

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const yaw = Number(params.get('yaw') ?? 0.35);
  const S = 1024;
  const assets = new AssetLibrary('/assets/');
  await assets.loadCore();
  await assets.loadModels(['market/character-employee']);
  const scene = new Scene();
  const people = new PeopleView(assets);
  scene.add(people.group);
  const person = { id: 1, kind: 'owner', look: { model: 12, variant: 0, height: 1 }, x: 0, z: 0, yaw, px: 0, pz: 0, state: 'idle', anim: 'idle', path: [], pathIdx: 0, speed: 0, timer: 0 } as unknown as Person;
  // Let the idle animation settle so the arms hang naturally instead of the bind pose.
  const state = { people: [person] } as unknown as GameState;
  for (let i = 0; i < Number(params.get('t') ?? 8); i++) people.update(state, 1, 0.1, new Vector3(), -1, 0);
  const key = new DirectionalLight(0xfff4e0, 2.4); key.position.set(1.2, 2.2, 2.4);
  const rim = new DirectionalLight(0xbfe3ff, 1.2); rim.position.set(-2, 1.4, -1.5);
  scene.add(key, rim, new HemisphereLight(0xbfe3ff, 0x8fb07a, 1.1), new AmbientLight(0xffffff, 0.5));
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(S, S);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);
  // Orthographic, so framing is exact: first a wide shot to find the head, then the crop.
  const cam = new OrthographicCamera(-0.6, 0.6, 1.1, -0.1, 0.1, 30);
  const dir = new Vector3(0, 0.28, 1).normalize();
  const aim = (cx: number, cy: number, half: number) => {
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
    cam.position.set(cx, cy, 0).addScaledVector(dir, 6); cam.lookAt(cx, cy, 0);
    renderer.render(scene, cam);
  };
  aim(0, 0.5, 0.6);
  const scan = document.createElement('canvas'); scan.width = S; scan.height = S;
  const sg = scan.getContext('2d')!; sg.drawImage(renderer.domElement, 0, 0);
  const px = sg.getImageData(0, 0, S, S).data;
  const alpha = (x: number, y: number) => px[(y * S + x) * 4 + 3]!;
  let topRow = 0;
  outer: for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (alpha(x, y) > 8) { topRow = y; break outer; }
  // The head is the top 0.42 units of the figure; find its left and right in those rows.
  const unit = S / 1.2, headRows = Math.round(0.4 * unit);
  let minX = S, maxX = 0;
  for (let y = topRow; y < Math.min(S, topRow + headRows); y++) for (let x = 0; x < S; x++) if (alpha(x, y) > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const topY = 0.5 + 0.6 - topRow / unit;
  const cx = -0.6 + ((minX + maxX) / 2) / unit;
  const half = Number(params.get('half') ?? 0.285);
  aim(cx, topY + 0.035 - half, half);
  const out: Record<string, string> = {};
  for (const size of [512, 192, 180, 64, 32]) {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(renderer.domElement, 0, 0, size, size);
    // The shoulders dissolve into the background instead of ending in a hard cut.
    const fade = g.createLinearGradient(0, size * 0.8, 0, size);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fade; g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
    out[String(size)] = c.toDataURL('image/png');
  }
  window.__logo = out;
}

main().catch((e: unknown) => { window.__logoError = String(e); });
