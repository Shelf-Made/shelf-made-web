import { Scene, WebGLRenderer, Raycaster, Vector2, Vector3, SRGBColorSpace, PCFShadowMap, NoToneMapping, type PerspectiveCamera, type Fog, type Mesh, type Object3D, Frustum, Matrix4, Sphere } from 'three';
import { FollowCamera } from './FollowCamera';
import { TargetMarker } from './TargetMarker';
import { AssetLibrary } from './assets';
import { CameraRig } from './CameraRig';
import { PostFX } from './PostFX';
import { ReactionsView } from './Reactions';
import { StaticWorld } from './StaticWorld';
import { StoreView, STORE_MODELS, type StoreHit } from './StoreView';
import { PeopleView, PEOPLE_MODELS } from './People';
import { CarsView } from './Cars';
import { Lighting } from './Lighting';
import { RivalsView, RIVAL_MODELS } from './RivalsView';
import { StreetView } from './StreetView';
import { AmbientView } from './Ambient';
import { Overlays, type OverlayKind } from './Overlays';
import { buildTown, type TownPlan } from './town';
import type { GameState, CustomerType } from '@/sim/types';
import { DAY_SECONDS, toLocal } from '@/sim/layout';

export interface RenderStats { fps: number; drawCalls: number; triangles: number; people: number }

/**
 * The world behind a small interface: load assets, build the town and store, render a
 * game state with interpolation, pick, project. Everything three.js lives below here.
 */
export class WorldRenderer {
  readonly scene = new Scene();
  private readonly viewFrustum = new Frustum();
  private readonly viewMatrix = new Matrix4();
  readonly renderer: WebGLRenderer;
  /** Cinematic camera: lobby orbit, plot picker, screenshot views. */
  readonly camera: CameraRig;
  /** The game camera: follows the manager from behind and above. */
  readonly follow: FollowCamera;
  mode: 'play' | 'cinematic' = 'cinematic';
  /** Highlight round whatever pressing Use (or a click) would act on. */
  readonly marker = new TargetMarker();
  /** Cinematic views cut the near walls down to show the floor; the lobby keeps the building whole. */
  cutaway = true;
  readonly assets = new AssetLibrary();
  readonly lighting: Lighting;
  private statics: StaticWorld;
  private store: StoreView;
  private people: PeopleView;
  private cars: CarsView;
  private rivals: RivalsView;
  private street: StreetView;
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
  /** Who the camera tracks instead of the manager (the inspect panel's Follow), or nobody. */
  followId: number | null = null;
  private lastAlpha = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.camera = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.follow = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.lighting = new Lighting(this.scene);
    this.statics = new StaticWorld(this.assets);
    this.store = new StoreView(this.assets);
    this.people = new PeopleView(this.assets);
    this.cars = new CarsView(this.assets);
    this.rivals = new RivalsView(this.assets, (t, sz, d, face, side, bevel) => this.store.letters(t, sz, d, face, side, bevel));
    this.street = new StreetView(this.assets);
    this.ambient = new AmbientView(this.assets);
    this.scene.add(this.ambient.group, this.statics.group, this.store.group, this.people.group, this.cars.group, this.rivals.group, this.street.group, this.overlays.group, this.reactions.group);
    // Post passes render several times a frame: count the whole frame, not just the last pass.
    this.renderer.info.autoReset = false;
    this.post = new PostFX(this.renderer, this.scene, this.follow.camera);
    this.resize();
  }
  private post: PostFX;
  private readonly reactions = new ReactionsView();

  async load(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.02, 'Loading palette');
    await this.assets.loadCore();
    const plan = buildTown(1, 'main');
    // Every town uses the same model set (the plan lists every model any seed can place), so load once.
    const all = [...new Set([...StaticWorld.modelsNeeded(plan), ...STORE_MODELS, ...PEOPLE_MODELS, ...RIVAL_MODELS])].filter((id) => this.assets.has(id));
    await this.assets.loadModels(all, (done, total) => onProgress(0.05 + 0.85 * (done / total), `Loading models (${done}/${total})`));
    await this.store.init();
    this.cars.init();
    this.scene.add(this.marker.group);
    onProgress(1, 'Ready');
  }

  /** Build or rebuild the neighbourhood for a seed and plot. */
  setTown(seed: number, plotId: string): void {
    const key = `${seed}:${plotId}`;
    if (key === this.townKey) return;
    this.townKey = key;
    this.plan = buildTown(seed, plotId);
    this.statics.build(this.plan);
    this.ambient.build(this.plan);
    this.rivals.build(this.plan);
    this.street.build();
  }

  get town(): TownPlan | null { return this.plan; }

  setShop(state: GameState): void { this.store.buildShell(state.shop); this.store.setNight(this.night); }

  /** Render one frame. alpha interpolates between the previous and current sim tick. */
  get activeCamera(): PerspectiveCamera { return this.mode === 'play' ? this.follow.camera : this.camera.camera; }

  render(state: GameState, alpha: number, dt: number): void {
    this.lastAlpha = alpha;
    const owner = state.people.find((p) => p.kind === 'owner');
    const fp = this.mode === 'play' && !!owner;
    // The camera tracks the manager, or whoever the player chose to follow.
    const followed = this.followId !== null ? state.people.find((p) => p.id === this.followId) : undefined;
    const tracked = followed ?? owner;
    let focus: Vector3;
    if (fp && tracked) {
      const x = tracked.px + (tracked.x - tracked.px) * alpha, z = tracked.pz + (tracked.z - tracked.pz) * alpha;
      this.follow.follow(x, z);
      this.follow.update(dt);
      focus = this.tmpFocus.set(this.follow.target.x, 0, this.follow.target.z);
    } else {
      this.camera.update(dt);
      focus = this.camera.target;
    }
    const night = state.phase === 'night';
    // The lights come on at dusk (the last part of the day) and stay on through the night.
    const lights = night || state.time / DAY_SECONDS > 0.86;
    if (lights !== this.night) { this.night = lights; this.statics.setNight(lights); this.store.setNight(lights); this.rivals.setNight(lights); }
    this.lighting.setTime(state.time / DAY_SECONDS, night, focus, fp ? this.follow.viewRadius() : this.camera.viewRadius());
    // Haze: the roads fade out beyond the crossroads; pushed back as the camera pulls away.
    const fog = this.scene.fog as Fog | null;
    if (fog) { const d = fp ? this.follow.distance : this.camera.goalDistance; fog.near = 45 + d * 1.1; fog.far = 160 + d * 1.6; }
    this.setTown(state.seed, state.shop.plotId);
    // With the manager inside, the roof comes off and the walls between the camera and the manager
    // drop to stubs. Outside, the shop stands whole and wears its roof once the camera pulls back.
    // The cinematic camera (picker, screenshots) cuts the near walls down; the lobby keeps them whole.
    let inside = false;
    if (fp && tracked) {
      const f = state.shop.floor;
      const l = toLocal(state.shop, tracked.x, tracked.z);
      inside = l.x > f.x0 - 0.4 && l.x < f.x1 + 0.4 && l.z > f.z0 - 0.4 && l.z < f.z1 + 0.7;
    }
    const camYaw = fp ? this.follow.yaw : this.camera.yaw;
    this.store.update(state, fp ? (inside ? camYaw : null) : (this.cutaway ? camYaw : null));
    this.store.setRoof(fp ? !inside && this.follow.distance > 16 : !this.cutaway);
    if (fp && tracked) this.rivals.occlude(this.follow.camera.position, tracked.x, tracked.z); else this.rivals.occlude(null, 0, 0);
    // Skinned people are never frustum-culled by three.js (their bounds move with the bones): skip the ones out of view here.
    const cam = this.activeCamera; cam.updateMatrixWorld();
    this.viewFrustum.setFromProjectionMatrix(this.viewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.people.update(state, alpha, dt, focus, -1, 0, fp ? 26 + this.follow.distance : 48, this.viewFrustum, cam.position);
    this.reactions.update(state, alpha, cam.position);
    this.marker.update(dt);
    this.cars.update(state, alpha);
    this.rivals.update(state);
    this.street.update(state);
    this.overlays.sample(state);
    this.overlays.update(state);
    this.clock += Math.min(dt, 0.1);
    this.statics.update(this.clock);
    this.ambient.update(this.clock, Math.min(dt, 0.1), this.activeCamera, this.lighting.skyTop, this.lighting.sky);
    this.renderer.info.reset();
    // Tilt-shift fades in only as the camera pulls right out over the town.
    const far = fp ? this.follow.distance : this.camera.goalDistance;
    this.post.render(this.scene, this.activeCamera, Math.max(0, Math.min(1, (far - 34) / 26)));
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
  }

  /** Pick the shop's fixtures, boxes or floor under canvas pixel coordinates. */
  pick(px: number, py: number, state: GameState): StoreHit | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.activeCamera);
    return this.store.pick(this.ray, state.shop);
  }

  /**
   * The person under a canvas pixel: anyone on foot but the manager, picked against the box their
   * figure covers on screen (never smaller than a fingertip), the nearest to the camera winning.
   */
  personAt(px: number, py: number, state: GameState): number | null {
    const r = this.canvas.getBoundingClientRect();
    const x = px - r.left, y = py - r.top;
    const foot = this.tmpA, head = this.tmpB, cam = this.activeCamera;
    // The camera may have moved since the last frame was drawn (a tap right after a turn).
    cam.updateMatrixWorld();
    let best: number | null = null, bestD = Infinity;
    for (const p of state.people) {
      if (p.kind === 'owner' || p.state === 'driving' || p.state === 'inRival' || p.state === 'gone') continue;
      const wx = p.px + (p.x - p.px) * this.lastAlpha, wz = p.pz + (p.z - p.pz) * this.lastAlpha;
      foot.set(wx, 0, wz).project(cam);
      if (foot.z < -1 || foot.z > 1) continue;
      head.set(wx, 0.95 * p.look.height, wz).project(cam);
      const fx = (foot.x + 1) / 2 * r.width, fy = (1 - foot.y) / 2 * r.height, hy = (1 - head.y) / 2 * r.height;
      const tall = Math.max(36, fy - hy), half = Math.max(16, tall * 0.28);
      if (Math.abs(x - fx) > half || y < fy - tall - 6 || y > fy + 8) continue;
      if (foot.z < bestD) { bestD = foot.z; best = p.id; }
    }
    return best;
  }

  /** Just above a person's head, in world space (for the inspect panel), or null once they are out of sight. */
  personAnchor(state: GameState, id: number): { x: number; y: number; z: number } | null {
    const p = state.people.find((q) => q.id === id);
    if (!p || p.state === 'gone') return null;
    const a = this.lastAlpha;
    return { x: p.px + (p.x - p.px) * a, y: p.state === 'driving' ? 1.2 : 0.95 * p.look.height + 0.15, z: p.pz + (p.z - p.pz) * a };
  }

  /** The outline round the selected person (null clears it). */
  selectPerson(id: number | null): void { this.people.select(id); }
  /** Markers over every shopper of one type, for a few seconds ("Who shops where"). */
  highlightType(type: CustomerType | null, seconds = 10): void { this.people.highlightType(type, seconds); }
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

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
  /** Where the frame's work goes: meshes and triangles in the camera's view (and shadow casters) per scene group. */
  breakdown(): Record<string, { meshes: number; tris: number; casterTris: number }> {
    const out: Record<string, { meshes: number; tris: number; casterTris: number }> = {};
    const named = new Map<Object3D, string>([[this.ambient.group, 'ambient'], [this.statics.group, 'statics'], [this.store.group, 'store'], [this.people.group, 'people'], [this.cars.group, 'cars'], [this.rivals.group, 'rivals'], [this.street.group, 'street'], [this.overlays.group, 'overlays']]);
    const cam = this.activeCamera; cam.updateMatrixWorld();
    const fr = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sph = new Sphere();
    for (const top of this.scene.children) {
      const tn = named.get(top) ?? top.type;
      top.traverseVisible((o) => {
        const m = o as Mesh; if (!m.isMesh) return;
        const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
        const im = m as unknown as { isInstancedMesh?: boolean; count: number; boundingSphere: Sphere | null; computeBoundingSphere(): void };
        if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else sph.copy(g.boundingSphere!);
        sph.applyMatrix4(m.matrixWorld);
        const inView = !m.frustumCulled || fr.intersectsSphere(sph);
        const key = `${tn}.${m.name || (m.parent && m.parent !== top ? m.parent.name : '') || (Array.isArray(m.material) ? 'multi' : m.material.name || m.material.type)}`;
        const e = out[key] ?? (out[key] = { meshes: 0, tris: 0, casterTris: 0 });
        const c = g.index ? g.index.count : g.attributes.position?.count ?? 0; const n = Math.min(c, g.drawRange.count) / 3 * (im.isInstancedMesh ? im.count : 1);
        if (inView) { e.meshes++; e.tris += n; }
        if (m.castShadow) e.casterTris += n;
      });
    }
    return out;
  }

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
    this.post.setQuality(q);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.resize(w / Math.max(1, h));
    this.follow.resize(w / Math.max(1, h));
  }

  dispose(): void { this.renderer.dispose(); }
}
