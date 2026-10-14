import { Scene, WebGLRenderer, Raycaster, Vector2, Vector3, SRGBColorSpace, PCFShadowMap, NoToneMapping, type PerspectiveCamera, type Fog } from 'three';
import { FirstPersonView } from './FirstPerson';
import { AssetLibrary } from './assets';
import { CameraRig } from './CameraRig';
import { StaticWorld } from './StaticWorld';
import { StoreView, STORE_MODELS, type StoreHit } from './StoreView';
import { PeopleView, PEOPLE_MODELS } from './People';
import { CarsView } from './Cars';
import { Lighting } from './Lighting';
import { RivalsView } from './RivalsView';
import { AmbientView } from './Ambient';
import { Overlays, type OverlayKind } from './Overlays';
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
  /** Cinematic camera: lobby orbit, plot picker, screenshot views. */
  readonly camera: CameraRig;
  /** The manager's eyes: the game camera. */
  readonly fp: FirstPersonView;
  mode: 'fp' | 'cinematic' = 'cinematic';
  /** Cinematic views cut the near walls down to show the floor; the lobby keeps the building whole. */
  cutaway = true;
  readonly assets = new AssetLibrary();
  readonly lighting: Lighting;
  private statics: StaticWorld;
  private store: StoreView;
  private people: PeopleView;
  private cars: CarsView;
  private rivals: RivalsView;
  private ambient: AmbientView;
  private clock = 0;
  readonly overlays = new Overlays();
  private plan: TownPlan | null = null;
  private townKey = '';
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private fpsAcc = 0; private fpsN = 0; private fps = 60;
  private night = false;
  private readonly tmpFocus = new Vector3();
  quality: 'high' | 'medium' | 'low' = 'high';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.camera = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.fp = new FirstPersonView(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.lighting = new Lighting(this.scene);
    this.statics = new StaticWorld(this.assets);
    this.store = new StoreView(this.assets);
    this.people = new PeopleView(this.assets);
    this.cars = new CarsView(this.assets);
    this.rivals = new RivalsView(this.assets);
    this.ambient = new AmbientView(this.assets);
    this.scene.add(this.ambient.group, this.statics.group, this.store.group, this.people.group, this.cars.group, this.rivals.group, this.overlays.group);
    this.resize();
  }

  async load(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.02, 'Loading palette');
    await this.assets.loadCore();
    const plan = buildTown(1, 'main');
    // Every town uses the same model set (the plan lists every model any seed can place), so load once.
    const all = [...new Set([...StaticWorld.modelsNeeded(plan), ...STORE_MODELS, ...PEOPLE_MODELS])].filter((id) => this.assets.has(id));
    await this.assets.loadModels(all, (done, total) => onProgress(0.05 + 0.85 * (done / total), `Loading models (${done}/${total})`));
    await this.store.init();
    this.cars.init();
    this.fp.attach(this.scene, this.assets);
    onProgress(1, 'Ready');
  }

  /** Build or rebuild the neighbourhood for a seed and plot. */
  setTown(seed: number, plotId: string, branches: { plotId: string; name: string }[] = []): void {
    const key = `${seed}:${plotId}:${branches.map((b) => b.plotId + '=' + b.name).join(',')}`;
    if (key === this.townKey) return;
    this.townKey = key;
    this.plan = buildTown(seed, plotId, branches.map((b) => b.plotId));
    this.statics.build(this.plan);
    this.ambient.build(this.plan);
    this.rivals.build(this.plan, Object.fromEntries(branches.map((b) => [b.plotId, b.name])));
  }

  get town(): TownPlan | null { return this.plan; }

  setShop(state: GameState): void { this.store.buildShell(state.shop); this.store.setNight(this.night); }

  /** Render one frame. alpha interpolates between the previous and current sim tick. */
  get activeCamera(): PerspectiveCamera { return this.mode === 'fp' ? this.fp.camera : this.camera.camera; }

  render(state: GameState, alpha: number, dt: number): void {
    const owner = state.people.find((p) => p.kind === 'owner');
    const fp = this.mode === 'fp' && !!owner;
    let focus: Vector3;
    if (fp) {
      const x = owner.px + (owner.x - owner.px) * alpha, z = owner.pz + (owner.z - owner.pz) * alpha;
      this.fp.update(x, z, owner.look.height, dt, !!owner.carrying);
      focus = this.tmpFocus.set(x, 0, z);
    } else {
      this.camera.update(dt);
      focus = this.camera.target;
    }
    const night = state.phase === 'night';
    if (night !== this.night) { this.night = night; this.statics.setNight(night); this.store.setNight(night); }
    this.lighting.setTime(state.time / DAY_SECONDS, night, focus, fp ? 16 : this.camera.viewRadius());
    // Haze: close in first person, pushed back for the high cinematic views.
    const fog = this.scene.fog as Fog | null;
    if (fog) { const d = fp ? 0 : this.camera.goalDistance; fog.near = 55 + d * 0.9; fog.far = 210 + d * 1.2; }
    // Branches change the town: rebuild when the set changes (cheap, a few times per game).
    this.setTown(state.seed, state.shop.plotId, state.franchises.map((f) => ({ plotId: f.plotId, name: f.name })));
    // In first person every wall stands full height; the cinematic camera still cuts the near ones down.
    // Third person cuts the walls between the camera and the manager down to a ledge; the lobby keeps them whole.
    // Outside, the shop stands whole; step in and the walls between the camera and the manager drop.
    let inside = false;
    if (fp) {
      const f = state.shop.floor, ox = state.shop.originX, oz = state.shop.originZ, c = this.fp.camera.position;
      const within = (x: number, z: number) => x - ox > f.x0 - 0.4 && x - ox < f.x1 + 0.4 && z - oz > f.z0 - 0.4 && z - oz < f.z1 + 0.7;
      inside = within(owner.x, owner.z) || within(c.x, c.z);
    }
    this.store.update(state, fp ? (this.fp.third && inside ? this.fp.yaw : null) : (this.cutaway ? this.camera.yaw : null));
    this.people.update(state, alpha, dt, focus, fp && !this.fp.third ? owner.id : -1, fp && !this.fp.third ? 0.3 : 0);
    this.cars.update(state, alpha);
    this.rivals.update(state);
    this.overlays.sample(state);
    this.overlays.update(state);
    this.clock += Math.min(dt, 0.1);
    this.statics.update(this.clock);
    this.ambient.update(this.clock, Math.min(dt, 0.1), this.activeCamera, this.lighting.skyTop, this.lighting.sky);
    this.renderer.render(this.scene, this.activeCamera);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
  }

  /** Pick at canvas pixel coordinates. */
  pick(px: number, py: number, state: GameState): StoreHit | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.activeCamera);
    return this.store.pick(this.ray, state.shop);
  }

  /** What the crosshair points at: a fixture, the delivery boxes, or the floor, with the distance. */
  aim(state: GameState): { hit: StoreHit | null; dist: number; floor: Vector3 | null; point: Vector3 | null } {
    this.ndc.set(0, 0);
    this.ray.setFromCamera(this.ndc, this.activeCamera);
    const hit = this.store.pick(this.ray, state.shop);
    const t = -this.ray.ray.origin.y / this.ray.ray.direction.y;
    const floor = t > 0 ? new Vector3().copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, t) : null;
    let dist = Infinity;
    if (hit) dist = hit.dist;
    else if (floor) dist = floor.distanceTo(this.ray.ray.origin);
    // Where the ray lands, so reach is measured from the manager rather than the camera.
    const point = hit ? new Vector3().copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, hit.dist) : floor;
    return { hit, dist, floor, point };
  }

  /** Ground point under a canvas pixel. */
  groundAt(px: number, py: number): Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.activeCamera);
    const t = -this.ray.ray.origin.y / this.ray.ray.direction.y;
    if (t <= 0) return null;
    return new Vector3().copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, t);
  }

  /** World → canvas pixel. */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void {
    const v = new Vector3(x, y, z).project(this.activeCamera);
    out.visible = v.z < 1 && v.z > -1;
    out.x = (v.x + 1) / 2 * this.canvas.clientWidth;
    out.y = (1 - v.y) / 2 * this.canvas.clientHeight;
  }

  setOverlay(kind: OverlayKind): void { this.overlays.kind = kind; }

  setGhost(type: Parameters<StoreView['setGhost']>[0], state: GameState, x: number, z: number, rot: Parameters<StoreView['setGhost']>[4], valid: boolean): void { this.store.setGhost(type, state.shop, x, z, rot, valid); }

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
    this.fp.resize(w / Math.max(1, h));
  }

  dispose(): void { this.renderer.dispose(); }
}
