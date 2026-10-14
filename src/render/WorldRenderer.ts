import { Scene, WebGLRenderer, Raycaster, Vector2, Vector3, SRGBColorSpace, PCFSoftShadowMap, NoToneMapping } from 'three';
import { AssetLibrary } from './assets';
import { CameraRig } from './CameraRig';
import { StaticWorld } from './StaticWorld';
import { StoreView, STORE_MODELS, type StoreHit } from './StoreView';
import { PeopleView, PEOPLE_MODELS } from './People';
import { CarsView } from './Cars';
import { Lighting } from './Lighting';
import { RivalsView } from './RivalsView';
import { buildTown, type TownPlan } from './town';
import type { GameState } from '@/sim/types';
import { DAY_SECONDS } from '@/sim/layout';

export interface RenderStats { fps: number; drawCalls: number; triangles: number; people: number }

/**
 * The world behind a small interface: load assets, build the town and store, render a
 * game state with interpolation, pick, project. Everything three.js lives below here.
 */
export class WorldRenderer {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly camera: CameraRig;
  readonly assets = new AssetLibrary();
  readonly lighting: Lighting;
  private statics: StaticWorld;
  private store: StoreView;
  private people: PeopleView;
  private cars: CarsView;
  private rivals: RivalsView;
  private plan: TownPlan | null = null;
  private townKey = '';
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private fpsAcc = 0; private fpsN = 0; private fps = 60;
  private night = false;
  quality: 'high' | 'medium' | 'low' = 'high';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.camera = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.lighting = new Lighting(this.scene);
    this.statics = new StaticWorld(this.assets);
    this.store = new StoreView(this.assets);
    this.people = new PeopleView(this.assets);
    this.cars = new CarsView(this.assets);
    this.rivals = new RivalsView(this.assets);
    this.scene.add(this.statics.group, this.store.group, this.people.group, this.cars.group, this.rivals.group);
    this.resize();
  }

  async load(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.02, 'Loading palette');
    await this.assets.loadCore();
    const plan = buildTown(1, 'main');
    const ids = [...new Set([...StaticWorld.modelsNeeded(plan), ...STORE_MODELS, ...PEOPLE_MODELS])];
    // Every town uses the same model set, so load once.
    const allHouses = 'abcdefghijklmnopqrstu'.split('').map((l) => `suburban/house-${l}`);
    const allShops = 'abcdefghikl'.split('').map((l) => `commercial/shop-${l}`);
    const trees = ['nature/tree-default', 'nature/tree-oak', 'nature/tree-fat', 'nature/tree-small', 'nature/tree-tall', 'nature/tree-detailed', 'nature/tree-simple', 'suburban/tree-large', 'suburban/tree-small', 'nature/plant-bush', 'nature/plant-bushsmall', 'nature/plant-bushlarge', 'nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
    const all = [...new Set([...ids, ...allHouses, ...allShops, ...trees])].filter((id) => this.assets.has(id));
    await this.assets.loadModels(all, (done, total) => onProgress(0.05 + 0.85 * (done / total), `Loading models (${done}/${total})`));
    this.store.init();
    this.cars.init();
    onProgress(1, 'Ready');
  }

  /** Build or rebuild the neighbourhood for a seed and plot. */
  setTown(seed: number, plotId: string): void {
    const key = `${seed}:${plotId}`;
    if (key === this.townKey) return;
    this.townKey = key;
    this.plan = buildTown(seed, plotId);
    this.statics.build(this.plan);
    this.rivals.build(this.plan);
  }

  get town(): TownPlan | null { return this.plan; }

  setShop(state: GameState): void { this.store.buildShell(state.shop); this.store.setNight(this.night); }

  /** Render one frame. alpha interpolates between the previous and current sim tick. */
  render(state: GameState, alpha: number, dt: number): void {
    this.camera.update(dt);
    const focus = this.camera.target;
    const night = state.phase === 'night';
    if (night !== this.night) { this.night = night; this.statics.setNight(night); this.store.setNight(night); }
    this.lighting.setTime(state.time / DAY_SECONDS, night, focus, this.camera.viewRadius());
    this.store.update(state, this.camera.yaw);
    this.people.update(state, alpha, dt, focus);
    this.cars.update(state, alpha);
    this.rivals.update(state);
    this.renderer.render(this.scene, this.camera.camera);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
  }

  /** Pick at canvas pixel coordinates. */
  pick(px: number, py: number, state: GameState): StoreHit | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera.camera);
    return this.store.pick(this.ray, state.shop);
  }

  /** Ground point under a canvas pixel. */
  groundAt(px: number, py: number): Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera.camera);
    const t = -this.ray.ray.origin.y / this.ray.ray.direction.y;
    if (t <= 0) return null;
    return new Vector3().copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, t);
  }

  /** World → canvas pixel. */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void {
    const v = new Vector3(x, y, z).project(this.camera.camera);
    out.visible = v.z < 1 && v.z > -1;
    out.x = (v.x + 1) / 2 * this.canvas.clientWidth;
    out.y = (1 - v.y) / 2 * this.canvas.clientHeight;
  }

  debugPeople(): unknown { return this.people.debugInfo(); }
  debugFixtures(): unknown { return this.store.debugFixtures(); }

  stats(): RenderStats {
    const i = this.renderer.info.render;
    return { fps: this.fps, drawCalls: i.calls, triangles: i.triangles, people: this.people.count };
  }

  setQuality(q: 'high' | 'medium' | 'low'): void {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.75) : q === 'medium' ? 1 : 0.8);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.lighting.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.lighting.sun.shadow.map) { this.lighting.sun.shadow.map.dispose(); this.lighting.sun.shadow.map = null; }
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.resize(w / Math.max(1, h));
  }

  dispose(): void { this.renderer.dispose(); }
}
