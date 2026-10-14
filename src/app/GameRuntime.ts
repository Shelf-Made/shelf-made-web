import { type GameState, type Command, type CommandResult, newGame, tick, applyCommand, TICK, clockLabel, resetGridCache, DAY_SECONDS, quickSetup } from '@/sim/index';
import type { Difficulty, FixtureType, Rot } from '@/sim/types';
import { canPlace } from '@/sim/build';
import { PLOTS, FIXTURES, toLocal, toWorld, storeFrame, rectToWorld, type Rect } from '@/sim/layout';
import { fixtureCentre, fixtureBackWorld, fixtureAccessWorld } from '@/sim/grid';
import { hint } from '@/sim/progression';
import { productDef } from '@/sim/products';
import { ownerAt, neediestInStorage, storeroomPoint } from '@/sim/people';
import { MathUtils } from 'three';
import { WorldRenderer } from '@/render/WorldRenderer';
import { FollowCamera } from '@/render/FollowCamera';
import type { StoreHit } from '@/render/StoreView';
import { keyLabel } from '@/save/settings';
import { AudioEngine, type Cue } from '@/audio/AudioEngine';
import { defaultBackend, type StorageBackend } from '@/save/storage';
import { saveGame, loadGame, type Slot } from '@/save/saves';
import { loadSettings, saveSettings, type Settings } from '@/save/settings';
import { analytics } from './analytics';

export type Speed = 0 | 1 | 2 | 4;
export type CardId = 'stock' | 'prices' | 'build' | 'staff' | 'marketing' | 'stats' | 'settings' | null;

export interface TipInfo { id: string; text: string; anchor: 'register' | 'shelf' | 'delivery' | 'button:prices' | 'button:stock' | 'button:build' | 'button:open' | 'night'; fixtureId?: number }

/** What Use (or a click) would do: the key to press, a short label, and where in the world to show it. */
export interface AimInfo { key: string | null; text: string; ok: boolean; at?: { x: number; y: number; z: number } }

/** Something the manager can use. */
type Thing = { kind: 'fixture' | 'delivery' | 'spill'; id: number };

/** How far in front of the manager a thing may be and still be used. */
const REACH = 1.2;

/** What React sees. Replaced only when something changed. */
export interface Snapshot {
  screen: 'lobby' | 'game';
  loaded: boolean;
  loadProgress: number; loadLabel: string;
  cash: number; day: number; clock: string; phase: GameState['phase'];
  speed: Speed; card: CardId;
  tip: TipInfo | null;
  toast: { id: number; text: string } | null;
  shopName: string;
  /** The shop's colour scheme id. */
  scheme: string;
  night: { day: number; profit: number; revenue: number; costs: number; customers: number; served: number; walkedOut: number; turnedAway: number; cash: number } | null;
  unlocks: GameState['unlocks'];
  stateVersion: number;
  settings: Settings;
  saving: boolean;
  gameOver: boolean;
  build: BuildUI;
  /** In a game (not the lobby or the plot picker): the follow camera is on. */
  playing: boolean;
  /** The first day's checklist (tutorial steps with short titles), null once tips are off or done. */
  jobs: { id: string; title: string; done: boolean }[] | null;
  /** 0 at opening, 1 at closing: drives the sun on the day dial. */
  dayFrac: number;
}

export interface BuildUI { active: boolean; placing: FixtureType | null; rot: Rot; selectedId: number | null; reason: string; valid: boolean; price: number; canUndo: boolean; canRedo: boolean; overlay: 'none' | 'heat' | 'exposure' | 'paths' }

/** Short checklist titles for the tutorial steps. */
const JOB_TITLES: Record<string, string> = {
  counter: 'Place a checkout counter', shelf: 'Place a shelf', order: 'Order stock', stock: 'Stock a shelf',
  open: 'Open the shop', ringUp: 'Ring up a customer', price: 'Check your prices', openTomorrow: 'Start day 2',
};

/** One tip per tutorial step, in order (the sim's TUTORIAL_STEPS). {B} style tokens become key labels. */
const TIPS: TipInfo[] = [
  { id: 'counter', text: 'Your shop is an empty shell. Press B for Build and place a checkout counter: shoppers pay there.', anchor: 'button:build' },
  { id: 'shelf', text: 'Now a shelf. Point at a floor tile, R turns it, click to place. Chillers hold the cold things.', anchor: 'button:build' },
  { id: 'order', text: 'Order stock on the Stock card (Tab). A truck leaves the boxes on the pallet by the back door.', anchor: 'button:stock' },
  { id: 'stock', text: 'Walk to the pallet by the back door (or click it) and press {interact} to pick up a box. Then walk to a shelf and press {interact} to stock it.', anchor: 'delivery' },
  { id: 'open', text: 'Ready? Press Open shop to let the town in.', anchor: 'button:open' },
  { id: 'ringUp', text: 'A customer is waiting! Stand behind the counter and press {scan} to scan each item.', anchor: 'register' },
  { id: 'price', text: 'Set your prices. A little above the town average still sells; too high and bargain hunters walk.', anchor: 'button:prices' },
  { id: 'openTomorrow', text: 'That is a day! Rent comes out tonight. Open tomorrow to keep going.', anchor: 'night' },
];

export class GameRuntime {
  state: GameState | null = null;
  renderer: WorldRenderer | null = null;
  readonly audio = new AudioEngine();
  readonly storage: StorageBackend = defaultBackend();
  settings: Settings = loadSettings();
  speed: Speed = 1;
  private prevSpeed: Speed = 1;
  card: CardId = null;
  private acc = 0;
  private alpha = 0;
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private stateVersion = 0;
  private snapTimer = 0;
  private toastId = 0;
  private toast: Snapshot['toast'] = null;
  private toastUntil = 0;
  private loaded = false;
  private loadProgress = 0; private loadLabel = 'Starting';
  private screen: Snapshot['screen'] = 'lobby';
  private lastPhase: GameState['phase'] | null = null;
  private noticesSeen = 0;
  /** Build mode: what is being placed, where the pointer hovers, selection, undo stack. */
  build: { placing: FixtureType | null; rot: Rot; hover: { x: number; z: number } | null; selectedId: number | null; reason: string; valid: boolean; price: number } = { placing: null, rot: 0, hover: null, selectedId: null, reason: '', valid: false, price: 0 };
  overlay: 'none' | 'heat' | 'exposure' | 'paths' = 'none';
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saving = false;
  private raf = 0;
  private lastTime = 0;
  private visibleCanvas: HTMLCanvasElement | null = null;
  /** Mouse position over the canvas, for hovering and build placement. */
  private mousePos: { x: number; y: number } | null = null;
  /** Something the manager was sent to use with a click: used on arrival. */
  private pendingUse: Thing | null = null;
  /** Screenshots and the debug views can borrow the orbit camera mid-game. */
  cinematic = false;
  /** Behind the lobby: a demo shop trading away at golden hour while the camera drifts round it. */
  private lobbyState: GameState | null = null;
  private lobbyAcc = 0;
  private lobbyYaw = 1.18;
  private lobbyT = 0;
  private lobbyTicks = 0;
  private aimCache: { info: AimInfo | null; run: (() => void) | null } = { info: null, run: null };
  readonly version = __APP_VERSION__;

  constructor() { this.snap = this.buildSnapshot(); analytics.enabled = this.settings.analyticsOptIn; }

  // ---- React plumbing
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = (): Snapshot => this.snap;
  private emit(): void { this.snap = this.buildSnapshot(); for (const l of this.listeners) l(); }

  private buildSnapshot(): Snapshot {
    const s = this.state;
    const today = s?.history[s.history.length - 1];
    return {
      screen: this.screen, loaded: this.loaded, loadProgress: this.loadProgress, loadLabel: this.loadLabel,
      cash: s ? s.cash : 0, day: s ? s.day : 1, clock: s ? clockLabel(Math.min(s.time, DAY_SECONDS)) : '8:00 am', phase: s ? s.phase : 'picking',
      speed: this.speed, card: this.card,
      tip: s ? this.currentTip(s) : null,
      toast: this.toast,
      shopName: s ? s.shop.name : '',
      scheme: s?.shop.scheme ?? 'green',
      night: s && s.phase === 'night' && today ? { day: today.day, profit: today.profit, revenue: today.revenue, costs: today.rent + today.utilities + today.wages + today.cogs, customers: today.customers, served: today.served, walkedOut: today.walkedOut, turnedAway: today.turnedAway, cash: s.cash } : null,
      unlocks: s ? s.unlocks : { prices: true, stock: true, build: false, staff: false, marketing: false, stats: true, newBadges: [] },
      stateVersion: this.stateVersion,
      settings: this.settings,
      saving: this.saving,
      gameOver: s ? s.gameOver : false,
      build: { active: this.card === 'build', placing: this.build.placing, rot: this.build.rot, selectedId: this.build.selectedId, reason: this.build.reason, valid: this.build.valid, price: this.build.price, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, overlay: this.overlay },
      playing: this.inPlay,
      jobs: s && s.tutorial.enabled && !s.tutorial.done && s.phase !== 'picking' ? TIPS.map((t) => ({ id: t.id, title: JOB_TITLES[t.id] ?? t.id, done: s.tutorial.completed.includes(t.id) })) : null,
      dayFrac: s ? Math.max(0, Math.min(1, s.time / DAY_SECONDS)) : 0,
    };
  }

  private currentTip(s: GameState): TipInfo | null {
    const t = s.tutorial;
    if (!t.enabled || t.done || s.phase === 'picking') return null;
    const next = TIPS.find((tip) => !t.completed.includes(tip.id));
    if (!next) return null;
    const keys = this.settings.keys;
    const tip = { ...next, text: next.text.replaceAll('{interact}', keyLabel(keys.interact)).replaceAll('{scan}', keyLabel(keys.scan)) };
    // Preconditions: each tip waits until it can be acted on.
    if (tip.id === 'openTomorrow') return s.phase === 'night' ? tip : null;
    if (s.phase === 'night') return null;
    if (tip.id === 'stock') {
      const owner = s.people.find((p) => p.kind === 'owner');
      if (owner?.carrying) {
        const def = productDef(owner.carrying.productId);
        const shelf = s.shop.fixtures.find((f) => FIXTURES[f.type].slots > 0 && FIXTURES[f.type].chilled === def.chilled && (!FIXTURES[f.type].accepts || FIXTURES[f.type].accepts!.includes(def.category)));
        return { ...tip, text: `You are carrying ${def.name}. Walk to a ${def.chilled ? 'chiller' : 'shelf'} (or click it) and press ${keyLabel(keys.interact)} to stock it.${shelf ? '' : ' Build one first!'}`, anchor: 'shelf', fixtureId: shelf?.id };
      }
      if (s.shop.storage.length === 0) return { ...tip, text: 'The truck is on its way with your boxes. Arrange the floor while you wait.' };
      return tip;
    }
    if (tip.id === 'open') return s.phase === 'setup' ? tip : null;
    if (tip.id === 'ringUp') {
      const reg = s.shop.fixtures.find((f) => f.type === 'register' && (f.serving || (f.queue?.length ?? 0) > 0));
      return reg ? { ...tip, fixtureId: reg.id } : null;
    }
    if (tip.id === 'price') return s.phase === 'open' ? tip : null;
    return tip;
  }

  /** The game proper is played with the follow camera; only the lobby and plot picker use the orbit camera. */
  get inPlay(): boolean { return this.screen === 'game' && !!this.state && this.state.phase !== 'picking'; }

  // ---- Lifecycle
  async attach(canvas: HTMLCanvasElement): Promise<void> {
    if (this.renderer) return;
    this.visibleCanvas = canvas;
    this.renderer = new WorldRenderer(canvas);
    this.renderer.setQuality(this.settings.quality);
    await this.renderer.load((f, label) => { this.loadProgress = f; this.loadLabel = label; this.emit(); });
    this.loaded = true;
    this.emit();
    this.lastTime = performance.now();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.frame(Math.min(0.1, (now - this.lastTime) / 1000)); this.lastTime = now; };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void { cancelAnimationFrame(this.raf); this.renderer?.dispose(); this.renderer = null; }

  startNew(opts: { seed?: number; difficulty?: Difficulty; sandbox?: boolean; plotId?: string; name?: string; tutorial?: boolean; scheme?: string }): void {
    const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    resetGridCache();
    this.state = newGame({ seed, difficulty: opts.difficulty, sandbox: opts.sandbox, plotId: opts.plotId, name: opts.name, tutorial: opts.tutorial, scheme: opts.scheme });
    this.lastPhase = null;
    this.enterGame();
  }

  loadState(state: GameState): void {
    resetGridCache();
    this.state = state;
    this.lastPhase = state.phase;
    this.noticesSeen = state.notices.length;
    this.enterGame();
  }

  private enterGame(): void {
    const s = this.state!;
    this.lobbyState = null;
    if (this.renderer) { this.renderer.camera.lookY = 0; this.renderer.cutaway = true; }
    this.screen = 'game';
    this.speed = 1; this.card = null;
    this.renderer?.setTown(s.seed, s.shop.plotId);
    this.renderer?.setShop(s);
    this.faceShop();
    if (s.phase === 'picking') this.previewPlot(PLOTS[0]!.id, true);
    this.stateVersion++;
    this.emit();
  }

  toLobby(): void { this.screen = 'lobby'; this.state = null; this.card = null; this.lobbyState = null; this.emit(); }

  /** Build the lobby's demo shop: furnished, stocked and open, late in the afternoon. */
  private ensureLobbyScene(): GameState | null {
    const r = this.renderer;
    if (!r) return null;
    if (!this.lobbyState) {
      resetGridCache();
      const s = newGame({ seed: 2026, plotId: 'main', name: 'Shelf Made', tutorial: false, sandbox: true });
      quickSetup(s, true);
      // All four corners trading: the rivals are open across the crossroads.
      for (const rv of s.rivals) rv.open = true;
      s.time = DAY_SECONDS * 0.7;
      this.lobbyState = s;
      r.setTown(s.seed, s.shop.plotId);
      r.setShop(s);
      r.camera.lookY = 2.2;
      r.cutaway = false;
      r.camera.focus(s.shop.originX + 0.5, s.shop.originZ - 2.6, 20, this.lobbyYaw, 0.24);
      r.camera.snap();
    }
    return this.lobbyState;
  }

  async save(slot: Slot = 'auto'): Promise<void> {
    if (!this.state) return;
    this.saving = true; this.emit();
    try { await saveGame(this.storage, slot, this.state); } finally { this.saving = false; this.emit(); }
  }
  async load(slot: Slot): Promise<boolean> {
    const s = await loadGame(this.storage, slot);
    if (!s) return false;
    this.loadState(s);
    return true;
  }

  // ---- Frame
  private frame(dt: number): void {
    const s = this.state;
    const r = this.renderer;
    if (!r) return;
    if (this.screen === 'lobby' && this.loaded) {
      const L = this.ensureLobbyScene();
      if (L) {
        this.lobbyAcc += dt;
        let n = 0;
        while (this.lobbyAcc >= TICK && n < 8) {
          // The clock stays at golden hour; the shop keeps trading.
          L.time = Math.min(L.time, DAY_SECONDS * 0.66);
          tick(L);
          if (++this.lobbyTicks % 8 === 0) applyCommand(L, { type: 'scan' });
          this.lobbyAcc -= TICK; n++;
        }
        if (n >= 8) this.lobbyAcc = 0;
        L.sounds.length = 0;
        // Drift back and forth over the crossroads at golden hour, the rivals' corners behind the shop.
        this.lobbyT += dt;
        this.lobbyYaw = 1.18 + 0.28 * Math.sin(this.lobbyT * 0.06);
        r.camera.focus(L.shop.originX + 0.5, L.shop.originZ - 2.6, 20, this.lobbyYaw, 0.24);
        r.mode = 'cinematic';
        r.render(L, Math.min(1, this.lobbyAcc / TICK), dt);
      }
    }
    if (s) {
      this.acc += dt * (this.screen === 'game' ? this.speed : 0);
      let n = 0;
      const maxTicks = this.speed * 24;
      while (this.acc >= TICK && n < maxTicks) { tick(s); this.acc -= TICK; n++; }
      if (n >= maxTicks) this.acc = 0;
      this.alpha = Math.min(1, this.acc / TICK);
      this.drainSounds(s);
      if (s.phase !== this.lastPhase) {
        if (s.phase === 'night') { void this.save('auto'); this.speed = 1; analytics.track('day_end', { day: s.day, cash: Math.round(s.cash) }); }
        this.lastPhase = s.phase;
        this.updateSideOffset();
      }
      this.audio.setMood(s.phase === 'night' ? 'night' : s.time < 180 ? 'morning' : s.time < 540 ? 'day' : 'evening');
      if (s.notices.length !== this.noticesSeen) {
        const latest = s.notices[s.notices.length - 1];
        if (latest && s.notices.length > this.noticesSeen) this.showToast(latest.text, 5200);
        this.noticesSeen = s.notices.length;
      }
      r.mode = this.inPlay && !this.cinematic ? 'play' : 'cinematic';
      r.render(s, this.alpha, dt);
      if (this.speed > 0) this.worldSounds(s, r.mode === 'play');
      if (r.mode === 'play') {
        // The build ghost sits on the tile under the mouse.
        if ((this.build.placing || this.build.selectedId !== null) && this.mousePos) { const g = r.groundAt(this.mousePos.x, this.mousePos.y); if (g) this.hoverWorld(g.x, g.z); }
        this.runPendingUse(s);
        this.aimCache = this.resolveAim();
      } else { this.aimCache = { info: null, run: null }; r.marker.set(null); }
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.1) { this.snapTimer = 0; this.maybeEmit(); if (s) this.updateSideOffset(); }
    if (this.toast && performance.now() > this.toastUntil) { this.toast = null; this.emit(); }
  }

  private lastKey = '';
  private maybeEmit(): void {
    const s = this.state;
    const key = s ? `${s.cash.toFixed(2)}|${s.day}|${clockLabel(Math.min(s.time, DAY_SECONDS))}|${s.phase}|${this.speed}|${this.card}|${JSON.stringify(this.currentTip(s))}|${s.tutorial.completed.length}|${this.saving}|${this.stateVersion}|${s.gameOver}|${this.build.placing}|${this.build.rot}|${this.build.selectedId}|${this.build.reason}|${this.build.valid}|${this.overlay}|${s.shop.scheme}` : `lobby|${this.loaded}|${this.loadProgress}`;
    if (key !== this.lastKey) { this.lastKey = key; this.emit(); }
  }

  private drainSounds(s: GameState): void {
    for (const cue of s.sounds) this.audio.play(cue as Cue);
    s.sounds.length = 0;
  }

  /** Sounds the renderer's world makes on its own: the manager's footsteps, cars going by. */
  private stepDist = 0;
  private lastOwner: { x: number; z: number } | null = null;
  private nearCars = new Set<number>();
  private worldSounds(s: GameState, fp: boolean): void {
    const o = s.people.find((p) => p.kind === 'owner');
    if (!o) return;
    if (fp && this.lastOwner) {
      const d = Math.hypot(o.x - this.lastOwner.x, o.z - this.lastOwner.z);
      if (d < 1) this.stepDist += d;
      if (this.stepDist > 0.62) { this.stepDist = 0; this.audio.play('step', { gain: 0.8 }); }
    }
    this.lastOwner = { x: o.x, z: o.z };
    // A car passing within a few metres of the listener whooshes by, panned to its side.
    const lx = fp ? o.x : (this.renderer?.camera.target.x ?? o.x), lz = fp ? o.z : (this.renderer?.camera.target.z ?? o.z);
    const yaw = fp ? (this.renderer?.follow.yaw ?? 0) : (this.renderer?.camera.yaw ?? 0);
    for (const c of s.cars) {
      const dx = c.x - lx, dz = c.z - lz, d = Math.hypot(dx, dz);
      if (d < 7.5 && c.speed > 1.5 && !this.nearCars.has(c.id)) {
        this.nearCars.add(c.id);
        // Right of the view direction (yaw 0 looks along -z) is +x rotated by yaw.
        const pan = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(1, d);
        this.audio.play('whoosh', { gain: Math.max(0.25, 1 - d / 7.5) * (c.orderId !== undefined ? 1.3 : 1), pan });
      } else if (d > 9 && this.nearCars.has(c.id)) this.nearCars.delete(c.id);
    }
  }

  // ---- Commands and interaction
  dispatch(cmd: Command): CommandResult {
    if (!this.state) return { ok: false, message: 'No game.' };
    const res = applyCommand(this.state, cmd);
    if (!res.ok && res.message) { this.showToast(res.message); this.audio.play('bad'); }
    if (cmd.type === 'placeFixture' || cmd.type === 'removeFixture' || cmd.type === 'choosePlot') { this.stateVersion++; }
    if (cmd.type === 'choosePlot' && res.ok) { this.renderer?.setTown(this.state.seed, this.state.shop.plotId); this.renderer?.setShop(this.state); this.faceShop(); applyCommand(this.state, { type: 'setTimeScale', scale: this.speed || 1 }); }
    if ((cmd.type === 'expandShop' || cmd.type === 'expandLot') && res.ok) this.renderer?.setShop(this.state);
    this.stateVersion++;
    this.maybeEmit();
    return res;
  }

  showHint(): void { if (this.state) this.showToast(hint(this.state), 6000); this.audio.play('click'); }

  showToast(text: string, ms = 2600): void { this.toast = { id: ++this.toastId, text }; this.toastUntil = performance.now() + ms; this.emit(); }

  setSpeed(speed: Speed): void {
    if (speed !== this.speed) this.audio.play('speed');
    this.speed = speed;
    // The manager walks in real time whatever the clock speed.
    if (this.state && speed > 0) applyCommand(this.state, { type: 'setTimeScale', scale: speed });
    this.emit();
  }
  togglePause(): void { if (this.speed === 0) this.setSpeed(this.prevSpeed || 1); else { this.prevSpeed = this.speed; this.setSpeed(0); } }
  openCard(card: CardId): void {
    this.card = this.card === card ? null : card;
    if (this.card) this.move(0, 0);
    if (this.card !== 'build') { this.stopPlacing(); this.setOverlay('none'); }
    this.fitBuild = this.card === 'build';
    if (this.card !== 'build') this.unfitBuildView();
    if (card && this.state?.unlocks.newBadges.includes(card)) this.dispatch({ type: 'ackBadge', card });
    this.audio.play(this.card ? 'cardOpen' : 'cardClose');
    this.updateSideOffset();
    this.emit();
  }
  closeCard(): void { if (this.build.placing || this.build.selectedId !== null) { this.stopPlacing(); this.emit(); return; } if (this.card) { this.card = null; this.fitBuild = false; this.unfitBuildView(); this.audio.play('cardClose'); this.updateSideOffset(); this.emit(); } }
  /** Opening Build pulls the camera back (once the card is on screen) until the whole floor fits beside it. */
  private fitBuild = false;
  private fitBuildView(free: number): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    this.fitBuild = false;
    const f = r.follow, c = f.camera, t = Math.tan(MathUtils.degToRad(c.fov / 2));
    const fl = s.shop.floor, w = fl.x1 - fl.x0 + 2, d = (fl.z1 - fl.z0) * Math.sin(f.pitch) + 1.5;
    const need = Math.max(w / (Math.max(0.25, free) * 2 * t * c.aspect), d / (0.7 * 2 * t));
    if (f.following && need > f.goalDistance) {
      const from = f.goalDistance;
      f.zoom(Math.min(need, FollowCamera.FOLLOW_MAX) / from);
      this.buildZoom = { from, to: f.goalDistance };
    }
  }
  /** Closing Build goes back to the zoom you had, unless you have zoomed since. */
  private buildZoom: { from: number; to: number } | null = null;
  private unfitBuildView(): void {
    const z = this.buildZoom, f = this.renderer?.follow; this.buildZoom = null;
    if (z && f && f.following && Math.abs(f.goalDistance - z.to) < 0.01) f.zoom(z.from / f.goalDistance);
  }
  /** Docked cards sit on the right third, so the world slides left while one is open. */
  private updateSideOffset(): void {
    const r = this.renderer; if (!r) return;
    const open = this.card !== null || this.state?.phase === 'night';
    const w = window.innerWidth, h = window.innerHeight;
    r.camera.sideOffset = open && w > 760 ? 0.55 : 0;
    // The follow camera keeps the manager in the middle of the world you can still see: between a tall
    // panel on the left (today's jobs) and a docked card on the right. Phones stack cards at the bottom.
    let left = 0, right = w;
    if (w > 760 && typeof document !== 'undefined') {
      for (const el of document.querySelectorAll<HTMLElement>('.card, .tip.jobs')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height < h * 0.3) continue;
        if (b.left + b.width / 2 > w / 2) right = Math.min(right, b.left); else left = Math.max(left, b.right);
      }
    }
    r.follow.sideOffset = right - left > w * 0.3 ? ((left + right) / 2) / w * 2 - 1 : 0;
    if (this.fitBuild && right < w) this.fitBuildView((right - left) / w);
  }
  /** Mark the state as changed (used by test hooks after driving the sim directly). */
  bump(): void { this.stateVersion++; this.maybeEmit(); }

  // ---- Build mode
  setOverlay(kind: 'none' | 'heat' | 'exposure' | 'paths'): void { this.overlay = kind; this.renderer?.setOverlay(kind); this.emit(); }
  startPlacing(type: FixtureType): void { this.build.placing = type; this.build.selectedId = null; this.build.reason = ''; this.emit(); }
  stopPlacing(): void { this.build.placing = null; this.build.selectedId = null; this.build.hover = null; this.build.reason = ''; this.renderer?.setGhost(null, this.state!, 0, 0, 0, false); }
  rotateGhost(dir: 1 | -1 = 1): void { this.build.rot = ((this.build.rot + dir + 4) % 4) as Rot; this.refreshGhost(); this.audio.play('rotate'); this.emit(); }
  selectFixture(id: number | null): void { this.build.selectedId = id; this.build.placing = null; this.emit(); }
  /** Pointer over the world in build mode: snap to a tile and show the ghost. */
  hoverWorld(wx: number, wz: number): void {
    const s = this.state; if (!s) return;
    // Floor tiles sit on half-integer x (the door is at x = 0) and integer z.
    const l = toLocal(s.shop, wx, wz);
    const x = Math.floor(l.x + 0.5) - 0.5, z = Math.floor(l.z);
    if (this.build.hover && this.build.hover.x === x && this.build.hover.z === z) return;
    this.build.hover = { x, z };
    this.refreshGhost();
  }
  private refreshGhost(): void {
    const s = this.state; const r = this.renderer; if (!s || !r || !this.build.hover) return;
    const type = this.build.placing ?? (this.build.selectedId !== null ? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type ?? null : null);
    if (!type) { r.setGhost(null, s, 0, 0, 0, false); return; }
    const check = canPlace(s, type, this.build.hover.x, this.build.hover.z, this.build.rot, this.build.selectedId ?? undefined);
    this.build.valid = check.ok; this.build.reason = check.reason; this.build.price = this.build.selectedId !== null ? 0 : check.price;
    r.setGhost(type, s, this.build.hover.x, this.build.hover.z, this.build.rot, check.ok);
    this.maybeEmit();
  }
  /** Click in build mode: place, move, or pick a fixture. */
  clickBuild(hit: StoreHit | null): void {
    const s = this.state; if (!s || !this.build.hover) return;
    const { x, z } = this.build.hover;
    if (this.build.placing) {
      this.snapshotForUndo();
      const res = this.dispatch({ type: 'placeFixture', fixtureType: this.build.placing, x, z, rot: this.build.rot });
      if (!res.ok) this.undoStack.pop();
      this.refreshGhost();
      return;
    }
    if (this.build.selectedId !== null) {
      this.snapshotForUndo();
      const res = this.dispatch({ type: 'moveFixture', fixtureId: this.build.selectedId, x, z, rot: this.build.rot });
      if (!res.ok) this.undoStack.pop(); else this.selectFixture(null);
      this.renderer?.setGhost(null, s, 0, 0, 0, false);
      return;
    }
    if (hit && hit.kind === 'fixture') { const f = s.shop.fixtures.find((fx) => fx.id === hit.id); if (f) { this.build.rot = f.rot; this.selectFixture(f.id); } }
  }
  sellSelected(): void {
    if (this.build.selectedId === null) return;
    this.snapshotForUndo();
    const res = this.dispatch({ type: 'removeFixture', fixtureId: this.build.selectedId });
    if (!res.ok) this.undoStack.pop(); else this.showToast('Sold for 60% of the price.');
    this.selectFixture(null);
    this.renderer?.setGhost(null, this.state!, 0, 0, 0, false);
  }
  copySelected(): void {
    const s = this.state; if (!s || this.build.selectedId === null) return;
    const f = s.shop.fixtures.find((fx) => fx.id === this.build.selectedId); if (!f) return;
    this.build.rot = f.rot; this.startPlacing(f.type);
  }
  private snapshotForUndo(): void { if (!this.state) return; this.undoStack.push(JSON.stringify(this.state)); if (this.undoStack.length > 20) this.undoStack.shift(); this.redoStack = []; }
  undo(): void { const prev = this.undoStack.pop(); if (!prev || !this.state) return; this.redoStack.push(JSON.stringify(this.state)); this.restoreSnapshot(prev); }
  redo(): void { const next = this.redoStack.pop(); if (!next || !this.state) return; this.undoStack.push(JSON.stringify(this.state)); this.restoreSnapshot(next); }
  private restoreSnapshot(json: string): void {
    const s = JSON.parse(json) as GameState;
    resetGridCache();
    this.state = s; this.stateVersion++; this.lastPhase = s.phase; this.noticesSeen = s.notices.length;
    this.renderer?.setShop(s);
    this.emit();
  }

  // ---- Play: the follow camera, walking, and using things
  /** Right-drag (or a touch drag): turn the camera, and tilt it. */
  turnCamera(dx: number, dy: number): void {
    const r = this.renderer; if (!r || !this.inPlay) return;
    const k = this.settings.lookSpeed;
    r.follow.drag(dx * k, (this.settings.invertY ? -dy : dy) * k);
  }
  /** One finger dragging on a phone: turn the camera, or pan it when zoomed right out. */
  touchDrag(dx: number, dy: number): void {
    const r = this.renderer; if (!r || !this.inPlay) return;
    if (r.follow.following) this.turnCamera(dx * 1.4, dy * 0.8);
    else r.follow.pan(-dx * r.follow.distance * 0.0025, dy * r.follow.distance * 0.0025);
  }
  turnStep(dir: 1 | -1): void { this.renderer?.follow.rotateStep(dir); this.audio.play('tick'); }
  zoom(factor: number): void { this.renderer?.follow.zoom(factor); }
  /** Back to the manager (the focus key). */
  focusCamera(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (o) r.follow.focus(o.x, o.z);
  }

  /** Walk direction on the ground (unit vector, or zero to stop). Sent straight to the sim. */
  move(x: number, z: number): void {
    const s = this.state; if (!s || !this.inPlay) return;
    if (x || z) this.pendingUse = null;
    applyCommand(s, { type: 'moveDir', x, z });
  }

  /** Where the mouse is over the world (null when it leaves the canvas). */
  setMouse(x: number | null, y: number | null): void { this.mousePos = x === null || y === null ? null : { x, y }; }

  /** What pressing Use (or clicking) would do, and where to show it. Refreshed every frame. */
  aimInfo(): AimInfo | null { return this.aimCache.info; }

  /** Use the thing in front of the manager; with nothing in reach, the thing under the mouse. */
  interact(): void {
    this.audio.start();
    if (!this.inPlay) return;
    const a = this.resolveAim();
    if (a.run) a.run();
    else if (a.info && !a.info.ok && a.info.text) this.showToast(a.info.text, 1800);
  }

  /** A click (or tap) on the world: place in build mode, or walk to and use what is there, or just walk there. */
  clickAt(px: number, py: number): void {
    const s = this.state; const r = this.renderer;
    this.audio.start();
    if (!s || !r || !this.inPlay || s.phase === 'night') return;
    if (this.build.placing || this.build.selectedId !== null || this.card === 'build') {
      const g = r.groundAt(px, py);
      if (g && (this.build.placing || this.build.selectedId !== null)) { this.hoverWorld(g.x, g.z); this.clickBuild(null); return; }
      const hit = r.pick(px, py, s);
      if (hit?.kind === 'fixture') { this.clickBuild(hit); return; }
      return;
    }
    const t = this.thingAt(px, py);
    if (t) { this.walkAndUse(t); return; }
    const g = r.groundAt(px, py);
    if (g) {
      const res = applyCommand(s, { type: 'walkTo', x: g.x, z: g.z });
      if (!res.ok) this.showToast(res.message ?? "You can't get there.", 1400);
      this.pendingUse = null;
      this.renderer?.marker.set({ x0: g.x - 0.2, z0: g.z - 0.2, x1: g.x + 0.2, z1: g.z + 0.2 }, false);
    }
  }

  /** Right click: cancel placing or moving. */
  secondary(): void { if (this.build.placing || this.build.selectedId !== null) { this.stopPlacing(); this.emit(); } }

  /** Space: scan the next item if you stand behind a till. */
  scanHere(repeat = false): void {
    const s = this.state; if (!s) return;
    this.audio.start();
    const reg = s.shop.fixtures.find((f) => f.type === 'register' && ownerAt(s, f));
    if (!reg) { if (!repeat) this.showToast('Stand behind a checkout counter to scan.', 1800); return; }
    const res = applyCommand(s, { type: 'scanHere', registerId: reg.id });
    if (!res.ok && !repeat && res.message) this.showToast(res.message, 1400);
    this.maybeEmit();
  }

  /** Something you can use: a fixture, the delivery pallet, a spill. */
  private thingRect(s: GameState, t: Thing): Rect {
    if (t.kind === 'fixture') { const f = s.shop.fixtures.find((x) => x.id === t.id)!; return rectToWorld(s.shop, { x0: f.x, z0: f.z, x1: f.x + 1, z1: f.z + 1 }); }
    if (t.kind === 'delivery') return rectToWorld(s.shop, s.shop.delivery);
    const l = s.shop.litter.find((x) => x.id === t.id)!;
    return { x0: l.x - 0.25, z0: l.z - 0.25, x1: l.x + 0.25, z1: l.z + 0.25 };
  }

  /** The thing under a screen point, if any. */
  private thingAt(px: number, py: number): Thing | null {
    const s = this.state; const r = this.renderer; if (!s || !r) return null;
    const hit = r.pick(px, py, s);
    if (!hit) return null;
    if (hit.kind === 'fixture') return { kind: 'fixture', id: hit.id };
    if (hit.kind === 'delivery') return { kind: 'delivery', id: 0 };
    const spill = s.shop.litter.find((l) => Math.hypot(l.x - hit.x, l.z - hit.z) < 0.45);
    if (spill) return { kind: 'spill', id: spill.id };
    // The pallet's own tiles count even when it is empty.
    const lp = toLocal(s.shop, hit.x, hit.z), d = s.shop.delivery;
    if (lp.x >= d.x0 && lp.x <= d.x1 && lp.z >= d.z0 && lp.z <= d.z1) return { kind: 'delivery', id: 0 };
    return null;
  }

  /** The nearest usable thing within reach in front of the manager (what F acts on). */
  private thingInFront(s: GameState): Thing | null {
    const o = s.people.find((p) => p.kind === 'owner'); if (!o) return null;
    const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);
    let best: Thing | null = null, bestD = Infinity;
    const consider = (t: Thing) => {
      const r = this.thingRect(s, t);
      const cx = Math.max(r.x0, Math.min(r.x1, o.x)), cz = Math.max(r.z0, Math.min(r.z1, o.z));
      const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz);
      if (d > REACH) return;
      if (d > 0.35 && (dx * fx + dz * fz) / d < 0.26) return;
      // Things you can actually do something with win over things you can only look at.
      const score = d - (this.actionFor(s, t, true).ok ? 0.3 : 0);
      if (score < bestD) { bestD = score; best = t; }
    };
    for (const f of s.shop.fixtures) if (FIXTURES[f.type].slots > 0 || f.type === 'register') consider({ kind: 'fixture', id: f.id });
    consider({ kind: 'delivery', id: 0 });
    for (const l of s.shop.litter) consider({ kind: 'spill', id: l.id });
    return best;
  }

  /** What using a thing does, standing in reach of it (near) or from across the room. */
  private actionFor(s: GameState, t: Thing, near: boolean): { text: string; ok: boolean; key: 'use' | 'scan' | null; run: (() => void) | null } {
    const owner = s.people.find((p) => p.kind === 'owner')!;
    if (t.kind === 'spill') return { text: 'Mop up the spill', ok: true, key: 'use', run: () => { this.dispatch({ type: 'clean', litterId: t.id }); } };
    if (t.kind === 'delivery') {
      if (owner.carrying) return { text: 'Put the box back', ok: true, key: 'use', run: () => { this.dispatch({ type: 'pickUp', productId: undefined }); } };
      const pid = neediestInStorage(s);
      if (!pid) return { text: 'No boxes yet: order stock', ok: false, key: null, run: null };
      const qty = Math.min(8, s.shop.storage.filter((e) => e.productId === pid).reduce((a, e) => a + e.qty, 0));
      return { text: `Pick up ${productDef(pid).name} ×${qty}`, ok: true, key: 'use', run: () => { this.dispatch({ type: 'pickUp', productId: pid }); } };
    }
    const f = s.shop.fixtures.find((x) => x.id === t.id);
    if (!f) return { text: '', ok: false, key: null, run: null };
    const def = FIXTURES[f.type];
    if (f.type === 'register') {
      if (near && !ownerAt(s, f)) return { text: 'Walk round behind the counter to scan', ok: false, key: null, run: null };
      const waiting = !!f.serving;
      return { text: waiting ? 'Scan item' : 'Nobody waiting yet', ok: waiting, key: 'scan', run: waiting ? () => this.scanHere() : null };
    }
    if (def.slots > 0) {
      if (owner.carrying) return { text: `Stock ${productDef(owner.carrying.productId).name} ×${owner.carrying.qty}`, ok: true, key: 'use', run: () => { this.dispatch({ type: 'stockFixture', fixtureId: f.id }); } };
      const stocked = f.slots.filter((sl) => sl.productId && sl.qty > 0);
      return { text: `${def.name}: ${stocked.length ? stocked.map((sl) => `${productDef(sl.productId!).name} ${sl.qty}`).join(' · ') : 'empty'}`, ok: false, key: null, run: null };
    }
    return { text: def.name, ok: false, key: null, run: null };
  }

  /** Walk over to a thing, then use it when you get there. */
  private walkAndUse(t: Thing): void {
    const s = this.state; if (!s) return;
    const r = this.thingRect(s, t);
    const o = s.people.find((p) => p.kind === 'owner'); if (!o) return;
    const cx = Math.max(r.x0, Math.min(r.x1, o.x)), cz = Math.max(r.z0, Math.min(r.z1, o.z));
    if (Math.hypot(cx - o.x, cz - o.z) <= REACH && t.kind !== 'fixture') { this.actionFor(s, t, true).run?.(); return; }
    let to: { x: number; z: number };
    if (t.kind === 'fixture') {
      const f = s.shop.fixtures.find((x) => x.id === t.id)!;
      to = f.type === 'register' ? fixtureBackWorld(s.shop, f) : fixtureAccessWorld(s.shop, f, o);
      if (Math.hypot(to.x - o.x, to.z - o.z) < 0.3) { this.actionFor(s, t, true).run?.(); return; }
    } else if (t.kind === 'delivery') to = storeroomPoint(s);
    else to = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 + 0.4 };
    const res = applyCommand(s, { type: 'walkTo', x: to.x, z: to.z });
    if (!res.ok) { this.showToast("You can't get there.", 1400); return; }
    this.pendingUse = t;
  }

  /** Each frame: when the manager arrives at what they were sent to use, use it. */
  private runPendingUse(s: GameState): void {
    const t = this.pendingUse; if (!t) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (!o || o.moveDir) { this.pendingUse = null; return; }
    if (o.state === 'walking' || o.state === 'carrying') return;
    this.pendingUse = null;
    if (t.kind === 'fixture' && !s.shop.fixtures.some((f) => f.id === t.id)) return;
    if (t.kind === 'spill' && !s.shop.litter.some((l) => l.id === t.id)) return;
    // Turn to face it, then act.
    const r = this.thingRect(s, t);
    o.yaw = Math.atan2((r.x0 + r.x1) / 2 - o.x, (r.z0 + r.z1) / 2 - o.z);
    const a = this.actionFor(s, t, true);
    if (a.run) a.run(); else if (a.text) this.showToast(a.text, 1600);
  }

  private resolveAim(): { info: AimInfo | null; run: (() => void) | null } {
    const s = this.state; const r = this.renderer;
    const none = { info: null, run: null };
    if (!s || !r || !this.inPlay || s.phase === 'night') { r?.marker.set(null); return none; }
    const keys = this.settings.keys;
    const useKey = keyLabel(keys.interact), scanKey = keyLabel(keys.scan);
    if (this.build.placing || this.build.selectedId !== null) {
      const type = this.build.placing ?? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type;
      const name = type ? FIXTURES[type].name : '';
      if (!this.build.hover) { r.marker.set(null); return { info: { key: null, text: 'Point at a floor tile', ok: false }, run: null }; }
      const h = this.build.hover;
      const at = toWorld(s.shop, h.x + 0.5, h.z + 0.5);
      r.marker.set(null);
      return {
        info: { key: 'Click', text: this.build.valid ? `${this.build.placing ? 'Place' : 'Move'} ${name}${this.build.price ? ` · $${this.build.price}` : ''}` : this.build.reason, ok: this.build.valid, at: { x: at.x, y: 1.1, z: at.z } },
        run: this.build.valid ? () => this.clickBuild(null) : null,
      };
    }
    const owner = s.people.find((p) => p.kind === 'owner'); if (!owner) return none;
    const kb = this.thingInFront(s);
    const hov = this.mousePos ? this.thingAt(this.mousePos.x, this.mousePos.y) : null;
    const show = kb ?? hov;
    if (!show) { if (!this.pendingUse) r.marker.set(null); return none; }
    const rect = this.thingRect(s, show);
    const near = show === kb;
    const a = this.actionFor(s, show, near);
    r.marker.set(rect, a.ok);
    const at = { x: (rect.x0 + rect.x1) / 2, y: show.kind === 'fixture' ? 1.05 : 0.6, z: (rect.z0 + rect.z1) / 2 };
    if (this.card === 'build' && show.kind === 'fixture') {
      const f = s.shop.fixtures.find((x) => x.id === show.id)!;
      return { info: { key: near ? useKey : 'Click', text: `Move ${FIXTURES[f.type].name}`, ok: true, at }, run: () => this.clickBuild({ kind: 'fixture', id: f.id, type: f.type, dist: 0 }) };
    }
    if (near) return { info: { key: a.ok ? (a.key === 'scan' ? scanKey : useKey) : null, text: a.text, ok: a.ok, at }, run: a.ok ? a.run : null };
    // Across the room: a click walks over and does it.
    return { info: { key: a.ok ? 'Click' : null, text: a.text, ok: a.ok, at }, run: a.ok ? () => this.walkAndUse(show) : null };
  }

  /** Point the camera at the manager from the street side of the shop (new game, load, after picking a plot). */
  faceShop(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (!o) return;
    r.follow.following = true;
    r.follow.set(o.x, o.z, s.shop.flip ? Math.PI : 0, FollowCamera.DEFAULT, MathUtils.degToRad(52));
    r.follow.snap();
  }

  /** Cinematic framing of the shop (screenshots and the picker). */
  focusStore(snap = false): void {
    const s = this.state; const r = this.renderer;
    if (!s || !r) return;
    const c = toWorld(s.shop, 0, -1.4);
    r.camera.focus(c.x, c.z, 18.5, s.shop.flip ? Math.PI : 0, 0.98);
    if (snap) r.camera.snap();
  }

  previewPlot(plotId: string, snap = false): void {
    const r = this.renderer; if (!r) return;
    const fr = storeFrame(plotId);
    const c = toWorld(fr, 2, -3.5);
    // The picker card sits at the bottom, so frame the corner in the upper half; south corners are seen from across the road.
    r.camera.focus(c.x, c.z, 24, (fr.flip ? Math.PI : 0) + 0.25, 0.95);
    if (snap) r.camera.snap();
  }

  fixtureAnchor(id: number): { x: number; y: number; z: number } | null {
    const s = this.state; if (!s) return null;
    const f = s.shop.fixtures.find((x) => x.id === id); if (!f) return null;
    const c = fixtureCentre(s.shop, f);
    return { x: c.x, y: 1.05, z: c.z };
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    analytics.enabled = this.settings.analyticsOptIn;
    this.audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx });
    if (patch.quality && this.renderer) this.renderer.setQuality(patch.quality);
    this.emit();
  }

  get canvas(): HTMLCanvasElement | null { return this.visibleCanvas; }
}

declare const __APP_VERSION__: string;
