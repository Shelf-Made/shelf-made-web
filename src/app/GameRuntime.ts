import { type GameState, type Command, type CommandResult, type Fixture, newGame, tick, applyCommand, TICK, clockLabel, resetGridCache, DAY_SECONDS } from '@/sim/index';
import type { Difficulty, FixtureType, Rot } from '@/sim/types';
import { canPlace } from '@/sim/build';
import { PLOTS } from '@/sim/layout';
import { fixtureCentre } from '@/sim/grid';
import { hint } from '@/sim/progression';
import { WorldRenderer } from '@/render/WorldRenderer';
import { AudioEngine, type Cue } from '@/audio/AudioEngine';
import { defaultBackend, type StorageBackend } from '@/save/storage';
import { saveGame, loadGame, type Slot } from '@/save/saves';
import { loadSettings, saveSettings, type Settings } from '@/save/settings';
import { analytics } from './analytics';

export type Speed = 0 | 1 | 2 | 4;
export type CardId = 'stock' | 'prices' | 'build' | 'staff' | 'marketing' | 'stats' | 'settings' | null;

export interface TipInfo { id: string; text: string; anchor: 'register' | 'shelf' | 'button:prices' | 'button:stock' | 'night' | 'door'; fixtureId?: number }

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
}

export interface BuildUI { active: boolean; placing: FixtureType | null; rot: Rot; selectedId: number | null; reason: string; valid: boolean; price: number; canUndo: boolean; canRedo: boolean; overlay: 'none' | 'heat' | 'exposure' | 'paths' }

const TIPS: TipInfo[] = [
  { id: 'ringUp', text: 'Your first customer is here! Click the register (or press Space) to scan each item.', anchor: 'register' },
  { id: 'stock', text: 'Shelves sell out. Click the shelf to carry stock from the storeroom.', anchor: 'shelf' },
  { id: 'price', text: 'Set a price. A little above the town average still sells; too high and bargain hunters walk.', anchor: 'button:prices' },
  { id: 'order', text: 'Order stock. A truck brings it to the back door in about an hour.', anchor: 'button:stock' },
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
    };
  }

  private currentTip(s: GameState): TipInfo | null {
    const t = s.tutorial;
    if (!t.enabled || t.done || s.phase === 'picking') return null;
    const next = TIPS.find((tip) => !t.completed.includes(tip.id));
    if (!next) return null;
    // Preconditions: each tip waits until it can be acted on.
    if (next.id === 'ringUp') {
      const reg = s.shop.fixtures.find((f) => f.type === 'register');
      const waiting = reg && (reg.serving || (reg.queue?.length ?? 0) > 0);
      if (!waiting) return null;
      return { ...next, fixtureId: reg!.id };
    }
    if (next.id === 'stock') {
      const shelf = s.shop.fixtures.find((f) => f.type === 'shelf');
      if (!shelf || s.shop.storage.length === 0) return null;
      return { ...next, fixtureId: shelf.id };
    }
    if (next.id === 'openTomorrow') return s.phase === 'night' ? next : null;
    if (s.phase === 'night') return null;
    return next;
  }

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
    this.screen = 'game';
    this.speed = 1; this.card = null;
    this.renderer?.setTown(s.seed, s.shop.plotId);
    this.renderer?.setShop(s);
    this.focusStore(true);
    if (s.phase === 'picking') this.previewPlot(PLOTS[0]!.id, true);
    this.stateVersion++;
    this.emit();
  }

  toLobby(): void { this.screen = 'lobby'; this.state = null; this.card = null; this.emit(); }

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
      r.render(s, this.alpha, dt);
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.1) { this.snapTimer = 0; this.maybeEmit(); }
    if (this.toast && performance.now() > this.toastUntil) { this.toast = null; this.emit(); }
  }

  private lastKey = '';
  private maybeEmit(): void {
    const s = this.state;
    const key = s ? `${s.cash.toFixed(2)}|${s.day}|${clockLabel(Math.min(s.time, DAY_SECONDS))}|${s.phase}|${this.speed}|${this.card}|${JSON.stringify(this.currentTip(s))}|${s.tutorial.completed.length}|${this.saving}|${this.stateVersion}|${s.gameOver}|${this.build.placing}|${this.build.rot}|${this.build.selectedId}|${this.build.reason}|${this.build.valid}|${this.overlay}` : `lobby|${this.loaded}|${this.loadProgress}`;
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
    if (cmd.type === 'choosePlot' && res.ok) { this.renderer?.setTown(this.state.seed, this.state.shop.plotId); this.renderer?.setShop(this.state); this.focusStore(true); }
    this.stateVersion++;
    this.maybeEmit();
    return res;
  }

  showHint(): void { if (this.state) this.showToast(hint(this.state), 6000); this.audio.play('click'); }

  showToast(text: string, ms = 2600): void { this.toast = { id: ++this.toastId, text }; this.toastUntil = performance.now() + ms; this.emit(); }

  setSpeed(speed: Speed): void { this.speed = speed; this.emit(); }
  togglePause(): void { if (this.speed === 0) this.setSpeed(this.prevSpeed || 1); else { this.prevSpeed = this.speed; this.setSpeed(0); } }
  openCard(card: CardId): void {
    this.card = this.card === card ? null : card;
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
  rotateGhost(): void { this.build.rot = ((this.build.rot + 1) % 4) as Rot; this.refreshGhost(); this.emit(); }
  selectFixture(id: number | null): void { this.build.selectedId = id; this.build.placing = null; this.emit(); }
  /** Pointer over the world in build mode: snap to a tile and show the ghost. */
  hoverWorld(wx: number, wz: number): void {
    const s = this.state; if (!s) return;
    const x = Math.floor(wx - s.shop.originX), z = Math.floor(wz - s.shop.originZ);
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
  clickBuild(hit: { kind: 'fixture'; id: number } | { kind: 'floor'; x: number; z: number } | null): void {
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

  /** Click on a world object. */
  clickFixture(f: Fixture): void {
    this.audio.start();
    if (f.type === 'register' || f.type === 'kiosk') { this.dispatch({ type: 'scan', registerId: f.id }); return; }
    if (['shelf', 'fridge', 'freezer', 'produce', 'endcap', 'rack'].includes(f.type)) { this.dispatch({ type: 'carry', fixtureId: f.id }); return; }
  }

  scan(): void { this.dispatch({ type: 'scan' }); }

  focusStore(snap = false): void {
    const s = this.state; const r = this.renderer;
    if (!s || !r) return;
    const cx = s.shop.originX, cz = s.shop.originZ - 1.4;
    r.camera.focus(cx, cz, 17.5, 0, 0.98);
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
