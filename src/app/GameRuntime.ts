import { type GameState, type Command, type CommandResult, newGame, tick, applyCommand, TICK, clockLabel, resetGridCache, DAY_SECONDS, quickSetup } from '@/sim/index';
import type { Difficulty, FixtureType, Rot } from '@/sim/types';
import { canPlace } from '@/sim/build';
import { PLOTS, FIXTURES } from '@/sim/layout';
import { fixtureCentre } from '@/sim/grid';
import { hint } from '@/sim/progression';
import { productDef } from '@/sim/products';
import { ownerAt, neediestInStorage } from '@/sim/people';
import { WorldRenderer } from '@/render/WorldRenderer';
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

/** What the crosshair would do: the key to press and a short label. */
export interface AimInfo { key: string | null; text: string; ok: boolean }

/** How far the manager can reach from their eyes. */
const REACH = 2.4;

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
  night: { day: number; profit: number; revenue: number; costs: number; customers: number; served: number; walkedOut: number; turnedAway: number; cash: number } | null;
  unlocks: GameState['unlocks'];
  stateVersion: number;
  settings: Settings;
  saving: boolean;
  gameOver: boolean;
  build: BuildUI;
  /** First person has the mouse (pointer lock). */
  locked: boolean;
  firstPerson: boolean;
}

export interface BuildUI { active: boolean; placing: FixtureType | null; rot: Rot; selectedId: number | null; reason: string; valid: boolean; price: number; canUndo: boolean; canRedo: boolean; overlay: 'none' | 'heat' | 'exposure' | 'paths' }

/** One tip per tutorial step, in order (the sim's TUTORIAL_STEPS). {B} style tokens become key labels. */
const TIPS: TipInfo[] = [
  { id: 'counter', text: 'Your shop is an empty shell. Press B for Build and place a checkout counter: shoppers pay there.', anchor: 'button:build' },
  { id: 'shelf', text: 'Now a shelf. Look at a floor tile, R turns it, click to place. Chillers hold the cold things.', anchor: 'button:build' },
  { id: 'order', text: 'Order stock on the Stock card (Tab). A truck leaves the boxes on the pallet by the back door.', anchor: 'button:stock' },
  { id: 'stock', text: 'Walk to the pallet and press {interact} to pick up a box. Look at a shelf and press {interact} to stock it.', anchor: 'delivery' },
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
  private locked = false;
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
      night: s && s.phase === 'night' && today ? { day: today.day, profit: today.profit, revenue: today.revenue, costs: today.rent + today.utilities + today.wages + today.cogs, customers: today.customers, served: today.served, walkedOut: today.walkedOut, turnedAway: today.turnedAway, cash: s.cash } : null,
      unlocks: s ? s.unlocks : { prices: true, stock: true, build: false, staff: false, marketing: false, stats: true, newBadges: [] },
      stateVersion: this.stateVersion,
      settings: this.settings,
      saving: this.saving,
      gameOver: s ? s.gameOver : false,
      build: { active: this.card === 'build', placing: this.build.placing, rot: this.build.rot, selectedId: this.build.selectedId, reason: this.build.reason, valid: this.build.valid, price: this.build.price, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, overlay: this.overlay },
      locked: this.locked,
      firstPerson: this.inFirstPerson,
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
        return { ...tip, text: `You are carrying ${def.name}. Look at a ${def.chilled ? 'chiller' : 'shelf'} and press ${keyLabel(keys.interact)} to stock it.${shelf ? '' : ' Build one first!'}`, anchor: 'shelf', fixtureId: shelf?.id };
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

  /** The game proper is played through the manager's eyes; only the lobby and plot picker use the orbit camera. */
  get inFirstPerson(): boolean { return this.screen === 'game' && !!this.state && this.state.phase !== 'picking'; }

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

  startNew(opts: { seed?: number; difficulty?: Difficulty; sandbox?: boolean; plotId?: string; name?: string; tutorial?: boolean }): void {
    const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    resetGridCache();
    this.state = newGame({ seed, difficulty: opts.difficulty, sandbox: opts.sandbox, plotId: opts.plotId, name: opts.name, tutorial: opts.tutorial });
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

  toLobby(): void { this.releaseLock(); this.screen = 'lobby'; this.state = null; this.card = null; this.lobbyState = null; this.emit(); }

  /** Build the lobby's demo shop: furnished, stocked and open, late in the afternoon. */
  private ensureLobbyScene(): GameState | null {
    const r = this.renderer;
    if (!r) return null;
    if (!this.lobbyState) {
      resetGridCache();
      const s = newGame({ seed: 2026, plotId: 'main', name: 'Shelf Made', tutorial: false, sandbox: true });
      quickSetup(s, true);
      s.time = DAY_SECONDS * 0.62;
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
        // Drift back and forth over Main Street, east of the shop, looking up the valley.
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
        if (s.phase === 'night') { void this.save('auto'); this.speed = 1; this.releaseLock(); analytics.track('day_end', { day: s.day, cash: Math.round(s.cash) }); }
        this.lastPhase = s.phase;
        this.updateSideOffset();
      }
      this.audio.setMood(s.phase === 'night' ? 'night' : s.time < 180 ? 'morning' : s.time < 540 ? 'day' : 'evening');
      if (s.notices.length !== this.noticesSeen) {
        const latest = s.notices[s.notices.length - 1];
        if (latest && s.notices.length > this.noticesSeen) this.showToast(latest.text, 5200);
        this.noticesSeen = s.notices.length;
      }
      r.mode = this.inFirstPerson && !this.cinematic ? 'fp' : 'cinematic';
      r.render(s, this.alpha, dt);
      if (r.mode === 'fp') {
        // The build ghost sits on the tile under the crosshair.
        if (this.build.placing || this.build.selectedId !== null) { const a = r.aim(s); if (a.floor) this.hoverWorld(a.floor.x, a.floor.z); }
        this.aimCache = this.resolveAim();
      } else this.aimCache = { info: null, run: null };
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.1) { this.snapTimer = 0; this.maybeEmit(); }
    if (this.toast && performance.now() > this.toastUntil) { this.toast = null; this.emit(); }
  }

  private lastKey = '';
  private maybeEmit(): void {
    const s = this.state;
    const key = s ? `${s.cash.toFixed(2)}|${s.day}|${clockLabel(Math.min(s.time, DAY_SECONDS))}|${s.phase}|${this.speed}|${this.card}|${JSON.stringify(this.currentTip(s))}|${s.tutorial.completed.length}|${this.saving}|${this.stateVersion}|${s.gameOver}|${this.build.placing}|${this.build.rot}|${this.build.selectedId}|${this.build.reason}|${this.build.valid}|${this.overlay}|${this.locked}` : `lobby|${this.loaded}|${this.loadProgress}`;
    if (key !== this.lastKey) { this.lastKey = key; this.emit(); }
  }

  private drainSounds(s: GameState): void {
    for (const cue of s.sounds) this.audio.play(cue as Cue);
    s.sounds.length = 0;
  }

  // ---- Commands and interaction
  dispatch(cmd: Command): CommandResult {
    if (!this.state) return { ok: false, message: 'No game.' };
    const res = applyCommand(this.state, cmd);
    if (!res.ok && res.message) this.showToast(res.message);
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
    this.speed = speed;
    // The manager walks in real time whatever the clock speed.
    if (this.state && speed > 0) applyCommand(this.state, { type: 'setTimeScale', scale: speed });
    this.emit();
  }
  togglePause(): void { if (this.speed === 0) this.setSpeed(this.prevSpeed || 1); else { this.prevSpeed = this.speed; this.setSpeed(0); } }
  openCard(card: CardId): void {
    this.card = this.card === card ? null : card;
    if (this.card) { this.releaseLock(); this.move(0, 0); }
    if (this.card !== 'build') { this.stopPlacing(); this.setOverlay('none'); }
    if (card && this.state?.unlocks.newBadges.includes(card)) this.dispatch({ type: 'ackBadge', card });
    this.audio.play('click');
    this.updateSideOffset();
    this.emit();
  }
  closeCard(): void { if (this.build.placing || this.build.selectedId !== null) { this.stopPlacing(); this.emit(); return; } if (this.card) { this.card = null; this.updateSideOffset(); this.emit(); } }
  /** Docked cards sit on the right third, so the world slides left while one is open. */
  private updateSideOffset(): void {
    const r = this.renderer; if (!r) return;
    const open = this.card !== null || this.state?.phase === 'night';
    r.camera.sideOffset = open && window.innerWidth > 760 ? 0.55 : 0;
  }
  /** Mark the state as changed (used by test hooks after driving the sim directly). */
  bump(): void { this.stateVersion++; this.maybeEmit(); }

  // ---- Build mode
  setOverlay(kind: 'none' | 'heat' | 'exposure' | 'paths'): void { this.overlay = kind; this.renderer?.setOverlay(kind); this.emit(); }
  startPlacing(type: FixtureType): void { this.build.placing = type; this.build.selectedId = null; this.build.reason = ''; this.emit(); }
  stopPlacing(): void { this.build.placing = null; this.build.selectedId = null; this.build.hover = null; this.build.reason = ''; this.renderer?.setGhost(null, this.state!, 0, 0, 0, false); }
  rotateGhost(dir: 1 | -1 = 1): void { this.build.rot = ((this.build.rot + dir + 4) % 4) as Rot; this.refreshGhost(); this.emit(); }
  selectFixture(id: number | null): void { this.build.selectedId = id; this.build.placing = null; this.emit(); }
  /** Pointer over the world in build mode: snap to a tile and show the ghost. */
  hoverWorld(wx: number, wz: number): void {
    const s = this.state; if (!s) return;
    // Floor tiles sit on half-integer x (the door is at x = 0) and integer z.
    const x = Math.floor(wx - s.shop.originX + 0.5) - 0.5, z = Math.floor(wz - s.shop.originZ);
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

  // ---- First person
  /** Mouse or touch look. */
  look(dx: number, dy: number): void {
    const r = this.renderer; if (!r || !this.inFirstPerson) return;
    r.fp.look(dx, this.settings.invertY ? -dy : dy, this.settings.lookSpeed);
  }

  /** Walk direction on the ground (unit vector, or zero to stop). Sent straight to the sim. */
  move(x: number, z: number): void {
    const s = this.state; if (!s || !this.inFirstPerson) return;
    applyCommand(s, { type: 'moveDir', x, z });
  }

  setLocked(b: boolean): void { if (this.locked === b) return; this.locked = b; this.emit(); }

  /** Take the mouse for looking. Must run inside a click. Returns false when the browser has no pointer lock. */
  requestLock(): boolean {
    const c = this.visibleCanvas;
    if (!c || typeof c.requestPointerLock !== 'function') return false;
    // A plain card (not Build) gets out of the way when you go back to the world.
    if (this.card && this.card !== 'build') { this.card = null; this.emit(); }
    try { const p = c.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => { /* refused: drag to look still works */ }); } catch { return false; }
    return true;
  }

  releaseLock(): void { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock(); }

  /** What the crosshair points at and what pressing E (or clicking) would do. Refreshed every frame. */
  aimInfo(): AimInfo | null { return this.aimCache.info; }

  /** Use whatever the crosshair points at. */
  interact(): void {
    this.audio.start();
    if (!this.inFirstPerson) return;
    const a = this.resolveAim();
    if (a.run) a.run();
    else if (a.info && !a.info.ok && a.info.text) this.showToast(a.info.text, 1800);
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

  private resolveAim(): { info: AimInfo | null; run: (() => void) | null } {
    const s = this.state; const r = this.renderer;
    const none = { info: null, run: null };
    if (!s || !r || !this.inFirstPerson || s.phase === 'night') return none;
    const keys = this.settings.keys;
    const E = keyLabel(keys.interact);
    const { hit } = r.aim(s);
    if (this.build.placing || this.build.selectedId !== null) {
      const type = this.build.placing ?? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type;
      const name = type ? FIXTURES[type].name : '';
      if (!this.build.hover) return { info: { key: null, text: 'Look at the floor', ok: false }, run: null };
      return {
        info: { key: 'Click', text: this.build.valid ? `${this.build.placing ? 'Place' : 'Move'} ${name}${this.build.price ? ` · $${this.build.price}` : ''}` : this.build.reason, ok: this.build.valid },
        run: this.build.valid ? () => this.clickBuild(hit) : null,
      };
    }
    if (!hit) return none;
    const owner = s.people.find((p) => p.kind === 'owner');
    if (!owner) return none;
    const far = hit.dist > REACH;
    if (hit.kind === 'fixture') {
      const f = s.shop.fixtures.find((x) => x.id === hit.id); if (!f) return none;
      const def = FIXTURES[f.type];
      if (this.card === 'build') return { info: { key: E, text: `Move ${def.name}`, ok: true }, run: () => this.clickBuild(hit) };
      if (far) return { info: { key: null, text: def.name, ok: false }, run: null };
      if (f.type === 'register') {
        if (!ownerAt(s, f)) return { info: { key: null, text: 'Walk round behind the counter to scan', ok: false }, run: null };
        const waiting = !!f.serving;
        return { info: { key: keyLabel(keys.scan), text: waiting ? 'Scan item' : 'Nobody waiting yet', ok: waiting }, run: waiting ? () => this.scanHere() : null };
      }
      if (def.slots > 0) {
        const stocked = f.slots.filter((sl) => sl.productId && sl.qty > 0);
        const summary = stocked.length ? stocked.map((sl) => `${productDef(sl.productId!).name} ${sl.qty}`).join(' · ') : 'empty';
        if (owner.carrying) {
          const name = productDef(owner.carrying.productId).name;
          return { info: { key: E, text: `Stock ${name} ×${owner.carrying.qty}`, ok: true }, run: () => { this.dispatch({ type: 'stockFixture', fixtureId: f.id }); } };
        }
        return { info: { key: null, text: `${def.name}: ${summary}`, ok: false }, run: null };
      }
      return { info: { key: null, text: def.name, ok: false }, run: null };
    }
    if (hit.kind === 'delivery') {
      if (far) return { info: { key: null, text: 'Delivery pallet', ok: false }, run: null };
      const pid = neediestInStorage(s);
      if (!pid) return { info: { key: null, text: 'No boxes yet', ok: false }, run: null };
      const qty = Math.min(8, s.shop.storage.filter((e) => e.productId === pid).reduce((a, e) => a + e.qty, 0));
      const verb = owner.carrying ? 'Swap for' : 'Pick up';
      return { info: { key: E, text: `${verb} ${productDef(pid).name} ×${qty}`, ok: true }, run: () => { this.dispatch({ type: 'pickUp', productId: pid }); } };
    }
    // Floor: mop a spill, or put a box back on the pallet.
    if (far) return none;
    const spill = s.shop.litter.find((l) => Math.hypot(l.x - hit.x, l.z - hit.z) < 0.4);
    if (spill) return { info: { key: E, text: 'Mop up the spill', ok: true }, run: () => { this.dispatch({ type: 'clean', litterId: spill.id }); } };
    const d = s.shop.delivery, lx = hit.x - s.shop.originX, lz = hit.z - s.shop.originZ;
    if (owner.carrying && lx >= d.x0 && lx <= d.x1 && lz >= d.z0 && lz <= d.z1) {
      return { info: { key: E, text: 'Put the box back', ok: true }, run: () => { this.dispatch({ type: 'pickUp', productId: undefined }); } };
    }
    return none;
  }

  /** Point the manager into the shop (new game, load, after picking a plot). */
  faceShop(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (o) r.fp.faceTowards(o.x, o.z, s.shop.originX, s.shop.originZ - 3);
    r.fp.pitch = -0.12;
  }

  /** Cinematic framing of the shop (screenshots and the picker). */
  focusStore(snap = false): void {
    const s = this.state; const r = this.renderer;
    if (!s || !r) return;
    const cx = s.shop.originX, cz = s.shop.originZ - 1.4;
    r.camera.focus(cx, cz, 18.5, 0, 0.98);
    if (snap) r.camera.snap();
  }

  previewPlot(plotId: string, snap = false): void {
    const r = this.renderer; if (!r) return;
    const p = PLOTS.find((x) => x.id === plotId) ?? PLOTS[0]!;
    // The picker card sits at the bottom, so frame the plot in the upper half.
    r.camera.focus(p.x, 1.5, 21, 0.25, 0.95);
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
