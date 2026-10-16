import { frontageLitter } from '@/sim/life';
import { type GameState, type Command, type CommandResult, newGame, tick, applyCommand, TICK, clockLabel, resetGridCache, DAY_SECONDS, quickSetup } from '@/sim/index';
import type { Difficulty, FixtureType, Rot, CustomerType, Look, FloorStyle, WallStyle, LotSurface } from '@/sim/types';
import { rating, type ReviewPhoto } from '@/sim/reviews';
import { inspectPerson, type InspectInfo } from '@/sim/inspect';
import { canPlace, facingOffWall, canBuyTile, canPaintFloor, canPaintWall, canSellTile } from '@/sim/build';
import { MANAGER_DEFAULT_MODEL } from '@/sim/commands';
import { PLOTS, FIXTURES, FLOORS, WALLS, SURFACES, MAX_FLOOR, toLocal, toWorld, storeFrame, rectToWorld, wallSegments, footprintOf, lotTileAt, type Rect, type WallSeg, storeysOf, panelsOver, liftWorld, VERTICAL, levelOf, zOnLevel, groundZ, rideEnds, STOREY } from '@/sim/layout';
import { canPave, canPaintBay, canEraseBay, nearestSlot } from '@/sim/lot';
import { canAddPanel, canRemovePanel, levelOfPerson, rideOn } from '@/sim/storeys';
import { fixtureCentre, fixtureBackWorld, fixtureAccessWorld } from '@/sim/grid';
import { hint } from '@/sim/progression';
import { productDef } from '@/sim/products';
import { ownerAt, neediestInStorage, palletChoices, wrongFixture, storeroomPoint, roomOnFixture } from '@/sim/people';
import { MathUtils } from 'three';
import { WorldRenderer } from '@/render/WorldRenderer';
import { FollowCamera } from '@/render/FollowCamera';
import type { StoreHit } from '@/render/StoreView';
import { keyLabel } from '@/save/settings';
import { AudioEngine, type Cue } from '@/audio/AudioEngine';
import { defaultBackend, type StorageBackend } from '@/save/storage';
import { saveGame, loadGame, type Slot } from '@/save/saves';
import { loadSettings, saveSettings, type Settings, type ManagerLook } from '@/save/settings';
import { analytics } from './analytics';
import { dollars } from '@/sim/money';
import { activeGoal, goalDef, goalProgress, GOALS } from '@/sim/goals';

/** The active goal for the chip: its title, target, reward and how far along it is. */
function goalInfo(s: GameState): Snapshot['goal'] {
  const g = activeGoal(s);
  if (!g) return null;
  const p = goalProgress(s, g);
  return { title: g.title, target: g.target, reward: g.rewardText, frac: Math.round(p.frac * 100) / 100, text: p.text, step: s.goals.index + 1, total: GOALS.length };
}
const goalKey = (s: GameState) => { const g = goalInfo(s); return `${s.goals.index}|${g ? `${g.frac}|${g.text}` : ''}|${s.goals.champion}|${s.goals.championSeen}`; };

export type Speed = 0 | 1 | 2 | 4;
export type CardId = 'stock' | 'prices' | 'build' | 'staff' | 'marketing' | 'stats' | 'settings' | 'reviews' | null;

export interface TipInfo { id: string; text: string; anchor: 'register' | 'shelf' | 'delivery' | 'button:prices' | 'button:stock' | 'button:build' | 'button:open' | 'night'; fixtureId?: number }

/** What Use (or a click) would do: the key to press, a short label, and where in the world to show it. */
export interface AimInfo { key: string | null; text: string; ok: boolean; at?: { x: number; y: number; z: number } }

/** Something the manager can use. */
type Thing = { kind: 'fixture' | 'delivery' | 'spill' | 'mess'; id: number };

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
  /** The active goal, for the chip under the top bar (null once the ladder is done). */
  goal: { title: string; target: string; reward: string; frac: number; text: string; step: number; total: number } | null;
  /** A goal just reached: confetti and the reward, for a few seconds (play goes on). */
  celebrate: { key: number; title: string; reward: string; next: string | null } | null;
  /** Owns the crossroads: the ending card, until it is waved away. */
  champion: boolean;
  /** The person clicked on, for the inspect panel (null when nobody is selected), and whether the camera follows them. */
  inspect: (InspectInfo & { following: boolean }) | null;
  /** A piece of furniture clicked with empty hands: its menu (its use, Move, Turn), null when closed. */
  /** A piece's menu (id -1: the delivery pallet). A pallet's lists what is on it to pick up; the delivery pallet cannot be moved. */
  fixtureMenu: { id: number; name: string; use: string | null; refund?: number; picks?: { productId: string; name: string; qty: number }[]; fixed?: boolean } | null;
  /** At night, whether the day's log is up (it can be closed, and comes back from the bar at the top). */
  nightLog: boolean;
  /** The shop's listing on the map app: how many reviews, the rating, and how many came in since you last looked. */
  reviews: { count: number; rating: number; unseen: number };
  /** Bumped whenever a review photo has been developed (the listing shows it). */
  photoVersion: number;
}

/** A tile tool in Build: buying floor to grow the shop, or laying a finish on a tile. */
export type TileTool = { kind: 'grow' } | { kind: 'sell' } | { kind: 'floor'; style: FloorStyle } | { kind: 'wall'; style: WallStyle }
  /** Out on the lot: lay a surface (null takes it up), paint a parking bay, or paint one out. */
  | { kind: 'pave'; surface: LotSurface | null } | { kind: 'bay' } | { kind: 'unbay' }
  /** A ceiling panel over a tile (the floor of the storey above), or one taken down for a double-height space. */
  | { kind: 'panel' } | { kind: 'unpanel' };
/** Tools and pieces that work on the lot's own grid (whole x, half z), not the shop floor's. */
const LOT_TOOLS = new Set<TileTool['kind']>(['pave', 'bay', 'unbay']);
export interface BuildUI { active: boolean; placing: FixtureType | null; tool: TileTool | null; rot: Rot; selectedId: number | null; reason: string; valid: boolean; price: number; canUndo: boolean; canRedo: boolean; overlay: 'none' | 'heat' | 'exposure' | 'paths'; level: number }

/** Short titles for the tutorial steps (the coach card shows one at a time). */
const JOB_TITLES: Record<string, string> = {
  counter: 'Place a checkout counter', shelf: 'Place a shelf', order: 'Order stock', stock: 'Stock a shelf',
  open: 'Open the shop', ringUp: 'Serve a customer', price: 'Check your prices', openTomorrow: 'Start day 2',
};

/**
 * One line per tutorial step, in order (the sim's TUTORIAL_STEPS): what to do next and nothing more.
 * {interact} and {scan} become key labels.
 */
const TIPS: TipInfo[] = [
  { id: 'counter', text: 'Open Build, pick the counter, click the floor.', anchor: 'button:build' },
  { id: 'shelf', text: 'Now pick a shelf. R turns it.', anchor: 'button:build' },
  { id: 'order', text: 'Open Stock and order a few boxes.', anchor: 'button:stock' },
  { id: 'stock', text: 'Click the pallet by the back door to grab a box.', anchor: 'delivery' },
  { id: 'open', text: 'Press Open shop to let the town in.', anchor: 'button:open' },
  { id: 'ringUp', text: 'Stand behind the counter, press {scan}.', anchor: 'register' },
  { id: 'price', text: 'Open Prices: a little above average still sells.', anchor: 'button:prices' },
  { id: 'openTomorrow', text: 'Rent is paid. Open tomorrow to keep going.', anchor: 'night' },
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
  build: { placing: FixtureType | null; tool: TileTool | null; rot: Rot; hover: { x: number; z: number } | null; at: { x: number; z: number } | null; wall: string | null; slot: number | null; selectedId: number | null; reason: string; valid: boolean; price: number } = { placing: null, tool: null, rot: 0, hover: null, at: null, wall: null, slot: null, selectedId: null, reason: '', valid: false, price: 0 };
  /** Placing, moving or using a tile tool: the pointer works on tiles. */
  private get building(): boolean { return !!this.build.placing || this.build.selectedId !== null || !!this.build.tool; }
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
      build: { active: this.card === 'build', placing: this.build.placing, tool: this.build.tool, rot: this.build.rot, selectedId: this.build.selectedId, reason: this.build.reason, valid: this.build.valid, price: this.build.price, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, overlay: this.overlay, level: this.buildLevel },
      playing: this.inPlay,
      jobs: s && s.tutorial.enabled && !s.tutorial.done && s.phase !== 'picking' ? TIPS.map((t) => ({ id: t.id, title: JOB_TITLES[t.id] ?? t.id, done: s.tutorial.completed.includes(t.id) })) : null,
      dayFrac: s ? Math.max(0, Math.min(1, s.time / DAY_SECONDS)) : 0,
      goal: s && s.phase !== 'picking' ? goalInfo(s) : null,
      celebrate: this.celebration,
      champion: !!s && s.goals.champion && !s.goals.championSeen,
      inspect: this.inspectInfo(),
      fixtureMenu: this.fixtureMenuInfo(),
      nightLog: !this.nightLogHidden,
      reviews: { count: s?.listing?.count ?? 0, rating: s ? rating(s) : 0, unseen: Math.max(0, (s?.listing?.count ?? 0) - this.reviewsSeen) },
      photoVersion: this.photoVersion,
    };
  }

  // ---- The map app's listing: reviews come in as shoppers get home; their photos are developed off screen.
  /** Photos developed so far (JPEG data URLs), by photo id; the cover pictures by `cover-<kind>|<shop layout>`. */
  private readonly photos = new Map<string, string>();
  private photoVersion = 0;
  private photoWait = 0;
  /** How many reviews there were when the listing was last open (the rest are new). */
  private reviewsSeen = 0;
  private reviewsKnown = -1;
  /** A developed photo, or null while it is still being taken. */
  photoUrl(id: string): string | null { return this.photos.get(id) ?? null; }
  /** The listing's own pictures (the owner's): the shopfront and the aisles as they look now (retaken each day and after a refit). */
  coverUrl(kind: 'outside' | 'aisle'): string | null { return this.photos.get(this.coverKey(kind)) ?? this.photos.get(`cover-${kind}`) ?? null; }
  private coverKey(kind: 'outside' | 'aisle'): string { const s = this.state; return `cover-${kind}|${s?.shop.layoutVersion ?? 0}|${s?.day ?? 0}|${this.renderer?.shopLayoutKey ?? ''}`; }

  /** A new review: a toast (unless the listing is open, where it simply appears). */
  private watchReviews(s: GameState): void {
    const n = s.listing?.count ?? 0;
    if (this.reviewsKnown < 0 || n < this.reviewsKnown) { this.reviewsKnown = n; this.reviewsSeen = n; return; }
    if (n > this.reviewsKnown) {
      const rv = s.listing!.reviews[0];
      if (this.card === 'reviews') this.reviewsSeen = n;
      else if (rv) this.showToast(`New review ${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}${rv.text ? ` “${rv.text.length > 60 ? `${rv.text.slice(0, 57)}…` : rv.text}”` : ''}`, 4200);
      this.reviewsKnown = n;
    }
  }

  /**
   * Take the next photo nobody has seen yet: one per frame while the listing is open (the covers first,
   * then the newest reviews'), otherwise one every few seconds so new reviews have theirs ready.
   */
  private developPhotos(s: GameState, r: WorldRenderer, dt: number): void {
    const open = this.card === 'reviews';
    this.photoWait -= dt;
    if (this.photoWait > 0 && !open) return;
    let next: { key: string; ph: ReviewPhoto; who: { look: Look; ctype?: CustomerType } | null } | null = null;
    if (open) for (const kind of ['outside', 'aisle'] as const) {
      const key = this.coverKey(kind);
      if (!next && !this.photos.has(key)) next = { key, ph: { id: key, kind, seed: kind === 'outside' ? 7 : 11, t: 0.38 }, who: null };
    }
    if (!next) for (const rv of (s.listing?.reviews ?? []).slice(0, open ? 60 : 8)) {
      const ph = rv.photos.find((x) => !this.photos.has(x.id));
      if (ph) { next = { key: ph.id, ph, who: { look: rv.look, ctype: rv.ctype } }; break; }
    }
    if (!next) return;
    this.photoWait = 3;
    const url = r.takePhoto(s, next.ph, next.who);
    if (url) {
      this.photos.set(next.key, url);
      // The latest covers stand in until the new ones are taken.
      if (next.key.startsWith('cover-')) {
        const base = next.key.split('|')[0]!;
        for (const k of [...this.photos.keys()]) if (k.startsWith(`${base}|`) && k !== next.key) this.photos.delete(k);
        this.photos.set(base, url);
      }
      // Reviews that have dropped off the listing take their photos with them.
      if (this.photos.size > 140) {
        const live = new Set((s.listing?.reviews ?? []).flatMap((rv) => rv.photos.map((p) => p.id)));
        for (const k of [...this.photos.keys()]) if (!k.startsWith('cover-') && !live.has(k)) this.photos.delete(k);
      }
      this.photoVersion++;
    }
  }

  // ---- The day's log at night: up when the day closes; × or Esc puts it away, the night bar brings it back.
  private nightLogHidden = false;
  showNightLog(open: boolean): void {
    if (open === !this.nightLogHidden) return;
    this.nightLogHidden = !open;
    if (open && this.card) this.card = null;
    this.audio.play(open ? 'cardOpen' : 'cardClose');
    this.emit();
    requestAnimationFrame(() => this.updateSideOffset());
  }

  // ---- Furniture: clicked with empty hands, a piece opens a small menu at it: its use, Move and Turn.
  /** The fixture whose menu is open. */
  fixtureMenu: number | null = null;
  openFixtureMenu(id: number | null): void { if (this.fixtureMenu === id) return; this.fixtureMenu = id; this.emit(); }
  private fixtureMenuInfo(id = this.fixtureMenu): Snapshot['fixtureMenu'] {
    const s = this.state;
    if (!s || id === null || !this.inPlay || s.phase === 'night' || this.card === 'build') return null;
    const picks = () => palletChoices(s).slice(0, 8).map((c) => ({ productId: c.productId, name: productDef(c.productId).name, qty: c.qty }));
    if (id === -1) return { id, name: 'Delivery pallet', use: null, picks: picks(), fixed: true };
    const f = s.shop.fixtures.find((x) => x.id === id); if (!f) return null;
    const def = FIXTURES[f.type];
    return { id, name: def.name, use: f.type === 'register' ? 'Serve here' : def.slots > 0 ? 'Stock' : VERTICAL.has(f.type) ? 'Ride' : null, refund: Math.round(def.price * 0.6), ...(f.type === 'pallet' ? { picks: picks() } : {}) };
  }
  /** Picked from a pallet's menu: walk over and pick that box up. */
  palletPick(productId: string): void {
    const id = this.fixtureMenu;
    this.fixtureMenu = null;
    this.palletWant = productId;
    this.audio.start();
    if (id === -1 || id === null) this.walkAndUse({ kind: 'delivery', id: 0 });
    else this.walkAndUse({ kind: 'fixture', id });
    this.emit();
  }
  /** The box asked for from a pallet's menu, and the one just put back (the next pick-up offers the one after it). */
  private palletWant: string | null = null;
  private palletAfter: string | null = null;
  /** A choice from the menu: its use (Stock, serve at the till), pick it up to Move it, or Turn it where it stands. */
  fixtureMenuAction(action: 'use' | 'move' | 'turn' | 'sell'): void {
    const s = this.state, id = this.fixtureMenu;
    this.fixtureMenu = null;
    const f = s?.shop.fixtures.find((x) => x.id === id);
    if (!s || !f) { this.emit(); return; }
    this.audio.start();
    if (action === 'use') this.walkAndUse({ kind: 'fixture', id: f.id });
    else if (action === 'sell') {
      // Sold where it stands, for part of what it cost (its stock goes back on the pallet).
      this.snapshotForUndo();
      const res = this.dispatch({ type: 'removeFixture', fixtureId: f.id });
      if (!res.ok) { this.undoStack.pop(); this.showToast(res.message ?? "That can't be sold.", 1800); }
      else { this.audio.play('coin'); this.showToast(`Sold the ${FIXTURES[f.type].name.toLowerCase()} for ${dollars(Math.round(FIXTURES[f.type].price * 0.6))}.`, 1800); }
    } else if (action === 'move') {
      // Picked up: the ghost follows the pointer; a click puts it down, R turns it, Esc puts it back.
      this.build.rot = f.rot; this.build.hover = null;
      this.selectFixture(f.id);
    } else {
      // Turned a quarter where it stands (or as far round as it will go).
      this.snapshotForUndo();
      let res: CommandResult = { ok: false };
      for (let k = 1; k < 4 && !res.ok; k++) res = this.dispatch({ type: 'moveFixture', fixtureId: f.id, x: f.x, z: f.z, rot: ((f.rot + k) % 4) as Rot });
      if (!res.ok) { this.undoStack.pop(); this.showToast(res.message ?? "It won't turn here.", 1800); }
      else this.audio.play('rotate');
    }
    this.emit();
  }

  // ---- Inspecting people: click someone to see who they are and why they came; Follow keeps the camera on them.
  /** The person the inspect panel is about. Nothing about selection costs anything while this is null. */
  selectedPerson: number | null = null;
  private followingPerson = false;
  private inspectInfo(): Snapshot['inspect'] {
    const s = this.state;
    if (!s || this.selectedPerson === null) return null;
    const info = inspectPerson(s, this.selectedPerson);
    return info ? { ...info, following: this.followingPerson } : null;
  }
  selectPerson(id: number | null): void {
    if (id !== null) this.fixtureMenu = null;
    if (id === this.selectedPerson) return;
    if (this.followingPerson) this.stopFollow();
    this.selectedPerson = id;
    this.renderer?.selectPerson(id);
    if (id !== null) this.audio.play('click');
    this.emit();
  }
  /** The camera tracks the selected person until they leave the world (or Esc, or the focus key). */
  followSelected(): void {
    const s = this.state; const r = this.renderer; const id = this.selectedPerson;
    if (!s || !r || id === null) return;
    const p = s.people.find((x) => x.id === id); if (!p) return;
    this.followingPerson = true;
    r.followId = id;
    { const l = liftWorld(this.state!.shop, p.x, p.z); r.follow.focus(l.x, l.z, l.y); }
    this.emit();
  }
  stopFollow(): void {
    if (!this.followingPerson) return;
    this.followingPerson = false;
    if (this.renderer) this.renderer.followId = null;
    this.focusCamera();
    this.emit();
  }
  /** Esc: stop placing, then let go of the person you were looking at, then close the open card. */
  escape(): void {
    if (this.fixtureMenu !== null) { this.openFixtureMenu(null); return; }
    if (this.building) { this.closeCard(); return; }
    if (this.selectedPerson !== null) { this.selectPerson(null); return; }
    if (!this.card && this.state?.phase === 'night' && !this.nightLogHidden) { this.showNightLog(false); return; }
    this.closeCard();
  }
  /** Each frame while someone is selected: they may have left (or the day ended). */
  private checkSelection(s: GameState): void {
    if (this.selectedPerson === null) return;
    const p = s.people.find((x) => x.id === this.selectedPerson);
    if (!p || p.state === 'gone' || s.phase === 'night' || !this.inPlay) this.selectPerson(null);
  }
  /** "Who shops where": mark every shopper of a type for ten seconds. */
  highlightType(type: CustomerType): void { this.renderer?.highlightType(type, 10); this.audio.play('click'); }

  // ---- Goals: a burst of confetti when one is reached (once; never replayed from a save).
  private celebration: Snapshot['celebrate'] = null;
  private celebrationUntil = 0;
  private celebratedTick = -1;
  private checkCelebration(s: GameState): void {
    const c = s.goals.celebrate;
    if (c && c.tick !== this.celebratedTick) {
      this.celebratedTick = c.tick;
      const g = goalDef(c.id);
      if (g && s.tick - c.tick < 200) {
        const next = activeGoal(s);
        this.celebration = { key: c.tick, title: g.title, reward: g.rewardText, next: next ? next.title : null };
        this.celebrationUntil = performance.now() + 4200;
        this.emit();
      }
    }
    if (this.celebration && performance.now() > this.celebrationUntil) { this.celebration = null; this.emit(); }
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
        const where = def.chilled ? 'chiller' : 'shelf';
        return { ...tip, text: shelf ? `Click a ${where} to put the ${def.name.toLowerCase()} on it.` : `Build a ${where} for the ${def.name.toLowerCase()} first.`, anchor: 'shelf', fixtureId: shelf?.id };
      }
      if (s.shop.storage.length === 0) return { ...tip, text: 'The truck is on its way. Hang on!' };
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
    // Closing the tab, switching away or the phone locking: save where you are, so Continue picks it up.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.autosaveNow(); });
      window.addEventListener('pagehide', () => this.autosaveNow());
    }
  }

  // ---- Autosave: every night, every half minute of play, after picking a plot, and when the page is hidden.
  private autosaveClock = 0;
  static readonly AUTOSAVE_SECONDS = 30;
  /** A game worth saving: past the plot picker and not over. */
  private get saveable(): boolean { const s = this.state; return this.screen === 'game' && !!s && s.phase !== 'picking' && !s.gameOver; }
  autosaveNow(): void { if (this.saveable && !this.saving) { this.autosaveClock = 0; void this.save('auto'); } }
  private tickAutosave(dt: number): void {
    if (!this.saveable) { this.autosaveClock = 0; return; }
    this.autosaveClock += dt;
    if (this.autosaveClock >= GameRuntime.AUTOSAVE_SECONDS) this.autosaveNow();
  }

  detach(): void { cancelAnimationFrame(this.raf); this.renderer?.dispose(); this.renderer = null; }

  startNew(opts: { seed?: number; difficulty?: Difficulty; sandbox?: boolean; plotId?: string; name?: string; tutorial?: boolean; scheme?: string }): void {
    const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    resetGridCache();
    this.state = newGame({ seed, difficulty: opts.difficulty, sandbox: opts.sandbox, plotId: opts.plotId, name: opts.name, tutorial: opts.tutorial, scheme: opts.scheme });
    this.wearManagerLook(this.state);
    this.lastPhase = null;
    this.enterGame();
  }

  loadState(state: GameState): void {
    resetGridCache();
    this.state = state;
    this.wearManagerLook(state);
    this.lastPhase = state.phase;
    this.noticesSeen = state.notices.length;
    this.enterGame();
  }

  private enterGame(): void {
    const s = this.state!;
    this.lobbyState = null;
    if (this.renderer) { this.renderer.camera.lookY = 0; this.renderer.cutaway = true; }
    this.screen = 'game';
    this.resetSpeed(); this.card = null;
    this.forgetSelection();
    this.renderer?.setTown(s.seed, s.shop.plotId);
    this.renderer?.setShop(s);
    this.faceShop();
    if (s.phase === 'picking') this.previewPlot(PLOTS[0]!.id, true);
    this.stateVersion++;
    this.emit();
  }

  toLobby(): void { this.screen = 'lobby'; this.state = null; this.card = null; this.lobbyState = null; this.forgetSelection(); this.emit(); }
  /** A different game: nobody is selected or followed. */
  private forgetSelection(): void {
    this.selectedPerson = null; this.followingPerson = false;
    if (this.renderer) { this.renderer.followId = null; this.renderer.selectPerson(null); }
  }

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
      this.wearManagerLook(s);
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
        const shopkeeper = this.designing ? L.people.find((p) => p.kind === 'owner') : undefined;
        if (shopkeeper) {
          // Designing: the shopkeeper out on the walkway, facing us, the shop front behind them; a fixed
          // shot from straight down the walkway (nothing stands on it), framed left of the menu.
          const face = L.shop.flip ? Math.PI : 0;
          shopkeeper.yaw = face; shopkeeper.state = 'idle'; shopkeeper.anim = 'idle'; shopkeeper.path = [];
          r.camera.lookY = 0.5; r.camera.sideOffset = 0.3;
          r.camera.focus(shopkeeper.x, shopkeeper.z, 4.2, face, 0.2);
        } else r.camera.focus(L.shop.originX + 0.5, L.shop.originZ - 2.6, 20, this.lobbyYaw, 0.24);
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
        if (s.phase === 'night') { this.nightLogHidden = false; this.resetSpeed(); void this.save('auto'); analytics.track('day_end', { day: s.day, cash: Math.round(s.cash) }); }
        this.lastPhase = s.phase;
        this.updateSideOffset();
      }
      this.audio.setMood(s.phase === 'night' ? 'night' : s.time < 180 ? 'morning' : s.time < 540 ? 'day' : 'evening');
      if (s.notices.length !== this.noticesSeen) {
        const latest = s.notices[s.notices.length - 1];
        if (latest && s.notices.length > this.noticesSeen) this.showToast(latest.text, 5200);
        this.noticesSeen = s.notices.length;
      }
      this.checkSelection(s);
      this.tickAutosave(dt);
      this.watchReviews(s);
      if (this.screen === 'game') this.developPhotos(s, r, dt);
      r.mode = this.inPlay && !this.cinematic ? 'play' : 'cinematic';
      // Building upstairs: that floor in view, the ones over it lifted off (back down to the top one when it closes).
      if (this.buildLevel > storeysOf(s.shop).top) this.setBuildLevel(this.buildLevel);
      r.buildLevel = this.card === 'build' && this.inPlay ? this.buildLevel : null;
      r.render(s, this.alpha, dt);
      if (this.speed > 0) this.worldSounds(s, r.mode === 'play');
      // The weather's sounds: the rain's patter, and thunder after each flash (later the further away).
      this.audio.setRain(this.screen === 'game' ? r.weather.rainLevel : 0);
      for (const th of r.weather.thunder.splice(0)) this.audio.thunder(th.distance, th.delay, th.strength);
      if (r.mode === 'play') {
        // The build ghost sits on the tile under the mouse.
        if (this.building && this.mousePos) { const g = r.groundAt(this.mousePos.x, this.mousePos.y, this.onGround ? 0 : undefined); if (g) this.hoverWorld(g.x, g.z); }
        this.runPendingUse(s);
        this.aimCache = this.resolveAim();
      } else { this.aimCache = { info: null, run: null }; r.marker.set(null); }
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.1) { this.snapTimer = 0; if (s) this.checkCelebration(s); this.maybeEmit(); if (s) this.updateSideOffset(); }
    if (this.toast && performance.now() > this.toastUntil) { this.toast = null; this.emit(); }
  }

  private lastKey = '';
  private maybeEmit(): void {
    const s = this.state;
    const key = s ? `${s.cash.toFixed(2)}|${s.day}|${clockLabel(Math.min(s.time, DAY_SECONDS))}|${s.phase}|${this.speed}|${this.card}|${JSON.stringify(this.currentTip(s))}|${s.tutorial.completed.length}|${this.saving}|${this.stateVersion}|${s.gameOver}|${this.build.placing}|${JSON.stringify(this.build.tool)}|${this.build.rot}|${this.build.selectedId}|${this.build.reason}|${this.build.valid}|${this.overlay}|${s.shop.scheme}|${goalKey(s)}|${s.listing?.count ?? 0}|${this.reviewsSeen}|${this.photoVersion}|${this.selectedPerson === null ? '' : JSON.stringify(this.inspectInfo())}` : `lobby|${this.loaded}|${this.loadProgress}`;
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
    if (cmd.type === 'choosePlot' && res.ok) { this.renderer?.setTown(this.state.seed, this.state.shop.plotId); this.renderer?.setShop(this.state); this.faceShop(); applyCommand(this.state, { type: 'setTimeScale', scale: this.speed || 1 }); this.autosaveNow(); }
    if ((cmd.type === 'expandShop' || cmd.type === 'expandLot' || cmd.type === 'buyTile') && res.ok) this.renderer?.setShop(this.state);
    this.stateVersion++;
    this.maybeEmit();
    return res;
  }

  showHint(): void { if (this.state) this.showToast(hint(this.state), 6000); this.audio.play('click'); }

  showToast(text: string, ms = 2600): void { this.toast = { id: ++this.toastId, text }; this.toastUntil = performance.now() + ms; this.emit(); }

  /**
   * Back to normal speed (the night, a loaded game): the clock and the sim's time scale together, or the
   * manager, who walks in real time, would keep crawling at a quarter of their pace after a fast-forwarded day.
   */
  private resetSpeed(): void {
    this.speed = 1;
    if (this.state) applyCommand(this.state, { type: 'setTimeScale', scale: 1 });
  }

  setSpeed(speed: Speed): void {
    if (speed !== this.speed) this.audio.play('speed');
    this.speed = speed;
    // The manager walks in real time whatever the clock speed.
    if (this.state && speed > 0) applyCommand(this.state, { type: 'setTimeScale', scale: speed });
    this.emit();
  }
  togglePause(): void { if (this.speed === 0) this.setSpeed(this.prevSpeed || 1); else { this.prevSpeed = this.speed; this.setSpeed(0); } }
  /** The Build card's last tab, so it opens where you left it. */
  buildTab: string | null = null;
  rememberBuildTab(tab: string): void {
    this.buildTab = tab;
    // Building outside: pull back far enough to see the lot round the shop.
    const f = this.renderer?.follow;
    if (tab === 'outside' && f && f.following && f.goalDistance < 18) { const from = f.goalDistance; f.zoom(18 / from); this.buildZoom ??= { from, to: f.goalDistance }; }
  }

  /** The floor the Build card builds on (it starts on the manager's). */
  buildLevel = 0;
  setBuildLevel(level: number): void {
    const s = this.state; if (!s) return;
    const st = storeysOf(s.shop);
    this.buildLevel = Math.max(0, Math.min(st.top, level));
    this.build.hover = null;
    this.renderer?.setGhost(null, s, 0, 0, 0, false); this.renderer?.setTileGhost(null);
    this.showGrowHints();
    this.emit();
  }

  openCard(card: CardId): void {
    this.fixtureMenu = null;
    if (card === 'build' && this.card !== 'build' && this.state) { const o = this.state.people.find((p) => p.kind === 'owner'); this.buildLevel = o ? Math.min(storeysOf(this.state.shop).top, levelOfPerson(this.state.shop, o)) : 0; }
    this.card = this.card === card ? null : card;
    if (this.card === 'reviews') this.reviewsSeen = this.state?.listing?.count ?? 0;
    if (this.card) this.move(0, 0);
    if (this.card !== 'build') { this.stopPlacing(); this.setOverlay('none'); }
    this.fitBuild = this.card === 'build';
    if (this.card !== 'build') this.unfitBuildView();
    if (card && this.state?.unlocks.newBadges.includes(card)) this.dispatch({ type: 'ackBadge', card });
    this.audio.play(this.card ? 'cardOpen' : 'cardClose');
    this.updateSideOffset();
    this.emit();
  }
  closeCard(): void { if (this.building) { this.stopPlacing(); this.emit(); return; } if (this.card) { this.card = null; this.fitBuild = false; this.unfitBuildView(); this.audio.play('cardClose'); this.updateSideOffset(); this.emit(); } }
  // ---- Your manager, designed in the lobby: kept with your settings, worn in every game you play.
  /** The look you designed, or the default shop worker. */
  get managerLook(): ManagerLook { return this.settings.managerLook ?? { model: MANAGER_DEFAULT_MODEL, height: 1.04 }; }
  /** Change your manager (from the lobby): saved straight away, and shown on the lobby's shopkeeper. */
  designManager(look: Extract<Command, { type: 'designManager' }>['look']): void {
    const next: ManagerLook = { ...this.managerLook };
    if (look.model !== undefined) next.model = look.model;
    if (look.height !== undefined) next.height = look.height;
    for (const k of ['skin', 'hair', 'top', 'bottom'] as const) { const v = look[k]; if (v === null) delete next[k]; else if (v !== undefined) next[k] = v; }
    this.updateSettings({ managerLook: next });
    for (const s of [this.lobbyState, this.state]) if (s) this.wearManagerLook(s);
    this.audio.play('click');
  }
  /** Dress a game's manager in your design (new games, loaded saves, the lobby's demo shop). */
  private wearManagerLook(s: GameState): void {
    // Always a guy or a girl: the default look until you design one (older saves had the shop worker).
    const l = this.managerLook;
    applyCommand(s, { type: 'designManager', look: { model: l.model, height: l.height, skin: l.skin ?? null, hair: l.hair ?? null, top: l.top ?? null, bottom: l.bottom ?? null } });
  }
  /** The lobby's designer is open: the shopkeeper steps out in front of the shop and the camera comes in close. */
  designing = false;
  setDesigning(on: boolean): void {
    this.designing = on;
    const L = this.lobbyState, r = this.renderer;
    if (!L || !r) return;
    if (on) {
      const o = L.people.find((p) => p.kind === 'owner');
      if (o) {
        // Out on the walkway in front of the door, clear of the awning, facing the street.
        const at = toWorld(L.shop, L.shop.door.x, L.shop.floor.z1 + 1.9);
        o.x = o.px = at.x; o.z = o.pz = at.z; o.path = []; o.moveDir = null; o.state = 'idle'; o.anim = 'idle'; o.carrying = null;
        o.yaw = L.shop.flip ? Math.PI : 0;
      }
    } else { r.camera.lookY = 2.2; r.camera.sideOffset = 0; }
    this.emit();
  }

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
  /** Docked cards sit on the right third, so the world slides left while one is open. (Public for the test hooks.) */
  updateSideOffset(): void {
    const r = this.renderer; if (!r) return;
    const open = this.card !== null || (this.state?.phase === 'night' && !this.nightLogHidden);
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
  startPlacing(type: FixtureType): void { this.build.placing = type; this.build.tool = null; this.build.selectedId = null; this.build.reason = ''; this.renderer?.setTileGhost(null); this.emit(); }
  /** A tile tool: click tiles next to the shop to buy them, or tiles of floor to lay a finish on them. */
  startTool(tool: TileTool): void {
    this.build.tool = tool; this.build.placing = null; this.build.selectedId = null; this.build.reason = '';
    this.renderer?.setGhost(null, this.state!, 0, 0, 0, false);
    this.showGrowHints();
    this.emit();
  }
  /** While growing: the tiles that could be bought, marked on the ground. */
  private showGrowHints(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    // The panel tools: the panels over this floor, faint at ceiling height.
    const panels = this.build.tool?.kind === 'panel' || this.build.tool?.kind === 'unpanel';
    r.setPanelHints(panels ? [...panelsOver(s.shop, this.buildLevel)].map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return { x, z }; }) : [], this.buildLevel);
    if (this.build.tool?.kind !== 'grow') { r.setGrowHints([]); r.setWallGhost(null); return; }
    const out: { x: number; z: number }[] = [];
    for (let z = MAX_FLOOR.z0; z < MAX_FLOOR.z1; z++) for (let x = MAX_FLOOR.x0; x < MAX_FLOOR.x1; x++) { const c = canBuyTile({ ...s, cash: Infinity }, x, z); if (c.ok) out.push({ x, z }); }
    r.setGrowHints(out);
  }
  stopPlacing(): void { this.build.placing = null; this.build.tool = null; this.build.selectedId = null; this.build.hover = null; this.build.reason = ''; this.renderer?.setGhost(null, this.state!, 0, 0, 0, false); this.renderer?.setTileGhost(null); this.renderer?.setWallGhost(null); this.renderer?.setGrowHints([]); this.renderer?.setPanelHints([], 0); }
  rotateGhost(dir: 1 | -1 = 1): void { this.build.rot = ((this.build.rot + dir + 4) % 4) as Rot; this.refreshGhost(); this.audio.play('rotate'); this.emit(); }
  selectFixture(id: number | null): void { this.build.selectedId = id; this.build.placing = null; this.build.tool = null; this.renderer?.setTileGhost(null); this.emit(); }
  /**
   * Working on the ground (a piece for outside, a lot tool, adding floor): the pointer is on it, whichever floor is
   * picked. (Floor to sell is pointed at on the boards in view, the tile lit there: the column under it goes.)
   */
  private get onGround(): boolean {
    const type = this.build.placing ?? (this.build.selectedId !== null ? this.state?.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type : undefined);
    return (!!type && !!FIXTURES[type].outdoor) || (!!this.build.tool && (LOT_TOOLS.has(this.build.tool.kind) || this.build.tool.kind === 'grow'));
  }
  /** Pointer over the world in build mode: snap to a tile and show the ghost. */
  hoverWorld(wx: number, wz: number): void {
    const s = this.state; if (!s) return;
    // Floor tiles sit on half-integer x (the door is at x = 0) and integer z.
    const l = toLocal(s.shop, wx, wz);
    // Out on the lot the tiles sit half a tile over from the floor's, flush with the outside of the walls.
    const placing = this.build.placing ?? (this.build.selectedId !== null ? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type ?? null : null);
    const outside = (placing && FIXTURES[placing].outdoor) || (this.build.tool && LOT_TOOLS.has(this.build.tool.kind));
    const { x, z } = outside ? lotTileAt(l.x, l.z) : { x: Math.floor(l.x + 0.5) - 0.5, z: Math.floor(l.z) };
    this.build.at = { x: l.x, z: l.z };
    // A wall or bay tool follows the pointer within a tile too (which edge, which bay it is nearest).
    if (this.build.hover && this.build.hover.x === x && this.build.hover.z === z && this.build.tool?.kind !== 'wall' && this.build.tool?.kind !== 'bay' && this.build.tool?.kind !== 'unbay') return;
    this.build.hover = { x, z };
    this.refreshGhost();
  }
  private refreshGhost(): void {
    const s = this.state; const r = this.renderer; if (!s || !r || !this.build.hover) return;
    const tool = this.build.tool;
    if (tool) {
      // A tile tool: the tile under the pointer lit green or red, the price or the reason.
      const { x, z } = this.build.hover;
      if (tool.kind === 'wall') {
        const w = this.build.at ? nearestWall(s, this.build.at.x, this.build.at.z) : null;
        this.build.wall = w?.key ?? null;
        const check = w ? canPaintWall(s, w.key, tool.style) : { ok: false, reason: 'Point at a wall', price: 0 };
        this.build.valid = check.ok; this.build.reason = check.reason; this.build.price = check.price;
        r.setTileGhost(null);
        r.setWallGhost(w ? { ...w, ok: check.ok } : null);
        this.maybeEmit();
        return;
      }
      if (tool.kind === 'bay' || tool.kind === 'unbay') {
        const sl = this.build.at ? nearestSlot(s.shop, this.build.at.x, this.build.at.z) : null;
        this.build.slot = sl?.id ?? null;
        const check = sl ? (tool.kind === 'bay' ? canPaintBay(s, sl.id) : canEraseBay(s, sl.id)) : { ok: false, reason: 'Point at the car park beside the shop', price: 0 };
        this.build.valid = check.ok; this.build.reason = check.reason; this.build.price = check.price;
        r.setTileGhost(sl ? { x: sl.x - 0.85, z: sl.z - 0.55, w: 1.7, d: 1.1, ok: check.ok } : null);
        this.maybeEmit();
        return;
      }
      const check = tool.kind === 'grow' ? canBuyTile(s, x, z) : tool.kind === 'sell' ? canSellTile(s, x, groundZ(z)) : tool.kind === 'pave' ? canPave(s, x, z, tool.surface)
        : tool.kind === 'panel' ? canAddPanel(s, x, z) : tool.kind === 'unpanel' ? canRemovePanel(s, x, z) : canPaintFloor(s, x, z, tool.style);
      this.build.valid = check.ok; this.build.reason = check.reason; this.build.price = check.price;
      r.setTileGhost({ x, z, ok: check.ok });
      this.maybeEmit();
      return;
    }
    const type = this.build.placing ?? (this.build.selectedId !== null ? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type ?? null : null);
    if (!type) { r.setGhost(null, s, 0, 0, 0, false); return; }
    // Windows and lights turn to face into the room from whichever wall they are pointed at.
    if (FIXTURES[type].onWall) { const rot = facingOffWall(s, type, this.build.hover.x, this.build.hover.z, this.build.rot); if (rot !== null) this.build.rot = rot; }
    const check = canPlace(s, type, this.build.hover.x, this.build.hover.z, this.build.rot, this.build.selectedId ?? undefined);
    // A move is free, but for a ceiling over a floor it opens.
    this.build.valid = check.ok; this.build.reason = check.reason; this.build.price = this.build.selectedId !== null ? check.ceiling ?? 0 : check.price;
    r.setGhost(type, s, this.build.hover.x, this.build.hover.z, this.build.rot, check.ok);
    this.maybeEmit();
  }
  /** Click in build mode: place, move, or pick a fixture. */
  clickBuild(hit: StoreHit | null): void {
    const s = this.state; if (!s || !this.build.hover) return;
    const { x, z } = this.build.hover;
    const tool = this.build.tool;
    if (tool) {
      this.snapshotForUndo();
      const res = tool.kind === 'wall'
        ? (this.build.wall ? this.dispatch({ type: 'paintWall', key: this.build.wall, style: tool.style }) : { ok: false, message: 'Point at a wall' })
        : tool.kind === 'bay' || tool.kind === 'unbay'
          ? (this.build.slot !== null ? this.dispatch({ type: tool.kind === 'bay' ? 'paintBay' : 'eraseBay', slot: this.build.slot }) : { ok: false, message: 'Point at the car park' })
          : this.dispatch(tool.kind === 'grow' ? { type: 'buyTile', x, z } : tool.kind === 'sell' ? { type: 'sellTile', x, z: groundZ(z) } : tool.kind === 'pave' ? { type: 'pave', x, z, surface: tool.surface }
            : tool.kind === 'panel' ? { type: 'addPanel', x, z } : tool.kind === 'unpanel' ? { type: 'removePanel', x, z } : { type: 'paintFloor', x, z, style: tool.style });
      if (!res.ok) { this.undoStack.pop(); if (res.message) this.showToast(res.message, 1400); }
      else if (tool.kind === 'grow' || tool.kind === 'sell' || tool.kind === 'panel' || tool.kind === 'unpanel') this.showGrowHints();
      this.refreshGhost();
      return;
    }
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
  /** Two fingers twisting on a phone: turn the camera with them. */
  twistCamera(radians: number): void { const r = this.renderer; if (!r || !this.inPlay) return; r.follow.drag(-radians / 0.006, 0); }
  turnStep(dir: 1 | -1): void { this.renderer?.follow.rotateStep(dir); this.audio.play('tick'); }
  zoom(factor: number): void { this.renderer?.follow.zoom(factor); }
  /** The wheel or a trackpad: zoom in proportion to how far it scrolled, so a flick of the trackpad is a nudge, not a leap. */
  wheelZoom(deltaY: number, deltaMode: number): void {
    const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
    this.zoom(Math.exp(Math.max(-120, Math.min(120, px)) * 0.0011));
  }
  /** Click (or touch) and drag: grab the ground and pull the view along. */
  dragPan(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.renderer; if (!r || !this.inPlay) return;
    // Both on the floor grabbed: from outside (every floor drawn) a move off the top boards onto the lawn, or across
    // the stairwell, would measure from one floor to another (a storey down, and a floor's region away).
    const a = r.groundAt(x0, y0), b = a && r.groundAt(x1, y1, Math.round(a.y / STOREY));
    if (!a || !b) return;
    if (this.followingPerson) this.stopFollowQuietly();
    r.follow.panWorld(a.x - b.x, a.z - b.z);
  }
  /** Walking again after looking around: the camera comes back to the manager (unless zoomed right out). */
  refollow(): void {
    const r = this.renderer; if (!r || r.follow.following || this.followingPerson) return;
    if (r.follow.goalDistance <= FollowCamera.FOLLOW_MAX) r.follow.following = true;
  }
  private stopFollowQuietly(): void { this.followingPerson = false; if (this.renderer) this.renderer.followId = null; this.emit(); }
  /** Back to the manager (the focus key). */
  focusCamera(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    if (this.followingPerson) { this.followingPerson = false; r.followId = null; this.emit(); }
    const o = s.people.find((p) => p.kind === 'owner');
    if (o) { const l = liftWorld(this.state!.shop, o.x, o.z); r.follow.focus(l.x, l.z, l.y); }
  }

  /** Walk direction on the ground (unit vector, or zero to stop). Sent straight to the sim. */
  move(x: number, z: number): void {
    const s = this.state; if (!s || !this.inPlay) return;
    // Walking yourself while the camera follows someone: it comes back to you.
    if ((x || z) && this.followingPerson) this.stopFollow();
    const o = s.people.find((p) => p.kind === 'owner'), walking = o?.state === 'walking';
    applyCommand(s, { type: 'moveDir', x, z });
    // The keys take over from a walk clicked for, and so does letting go when that stops it (a card opened): what it
    // was going to use goes with it, never done from wherever they stopped (or from the stairs, a ride under way).
    if (x || z || (walking && o?.state !== 'walking')) this.pendingUse = null;
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
    if (!s || !r || !this.inPlay) return;
    const building = this.building || this.card === 'build';
    // At night the shop is shut but the manager can still fit it out for tomorrow: only the build tools work.
    if (s.phase === 'night' && !building) return;
    if (building) {
      const g = r.groundAt(px, py, this.onGround ? 0 : undefined);
      if (g && this.building) { this.hoverWorld(g.x, g.z); this.clickBuild(null); return; }
      const hit = r.pick(px, py, s);
      if (hit?.kind === 'fixture') { this.clickBuild(hit); return; }
      return;
    }
    // People first: a click on someone opens their panel (and walks nobody anywhere).
    const who = r.personAt(px, py, s);
    if (who !== null) { this.selectPerson(who); return; }
    // Anywhere else lets go of them (following them too: the camera comes back to the manager).
    if (this.selectedPerson !== null) this.selectPerson(null);
    const t = this.thingAt(px, py);
    // A click anywhere closes a furniture menu (and does what it does there).
    const hadMenu = this.fixtureMenu;
    if (hadMenu !== null) this.openFixtureMenu(null);
    if (t) {
      // Empty-handed, furniture opens its menu (use it, move it, turn it); carrying a box, a click stocks the shelf.
      const carrying = !!s.people.find((p) => p.kind === 'owner')?.carrying;
      if (t.kind === 'fixture' && !carrying) { if (hadMenu !== t.id) this.openFixtureMenu(t.id); return; }
      // The delivery pallet with more than one kind of box on it: a menu to pick which.
      if (t.kind === 'delivery' && !carrying && palletChoices(s).length > 1) { if (hadMenu !== -1) this.openFixtureMenu(-1); return; }
      this.walkAndUse(t); return;
    }
    const g = r.groundAt(px, py);
    if (g) {
      const res = applyCommand(s, { type: 'walkTo', x: g.x, z: g.z });
      if (!res.ok) this.showToast(res.message ?? "You can't get there.", 1400);
      else this.refollow();
      this.pendingUse = null;
      this.renderer?.marker.set({ x0: g.x - 0.2, z0: g.z - 0.2, x1: g.x + 0.2, z1: g.z + 0.2 }, false);
    }
  }

  /** Right click: cancel placing or moving. */
  secondary(): void { if (this.building) { this.stopPlacing(); this.emit(); } }

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
    if (t.kind === 'fixture') {
      const f = s.shop.fixtures.find((x) => x.id === t.id)!, r = footprintOf(f.type, f.x, f.z, f.rot);
      // The stairs seen from the floor they come up to: their opening up there.
      const o = s.people.find((p) => p.kind === 'owner');
      if (VERTICAL.has(f.type) && o && levelOfPerson(s.shop, o) === levelOf(f) + 1) return rectToWorld(s.shop, { ...r, z0: zOnLevel(r.z0, 1), z1: zOnLevel(r.z1, 1) });
      return rectToWorld(s.shop, r);
    }
    if (t.kind === 'delivery') return rectToWorld(s.shop, s.shop.delivery);
    const l = t.kind === 'mess' ? s.life!.litter.find((x) => x.id === t.id)! : s.shop.litter.find((x) => x.id === t.id)!;
    return { x0: l.x - 0.25, z0: l.z - 0.25, x1: l.x + 0.25, z1: l.z + 0.25 };
  }

  /** The thing under a screen point, if any. */
  private thingAt(px: number, py: number): Thing | null {
    const s = this.state; const r = this.renderer; if (!s || !r) return null;
    // A spill: its marker floating above it, or the puddle itself, close to the pointer on screen (a
    // shelf behind it, or the floor beyond the marker, must not take the click). Only one in sight: not upstairs of the floor in view, nor under it.
    {
      const rect = this.canvas?.getBoundingClientRect();
      const ox = rect?.left ?? 0, oy = rect?.top ?? 0;
      const pt = { x: 0, y: 0, visible: false };
      let best: { id: number; d: number } | null = null;
      for (const l of s.shop.litter) for (const y of [0.03, 0.5]) {
        if (!r.inSight(s, l.x, y, l.z)) continue;
        r.project(l.x, y, l.z, pt);
        if (!pt.visible) continue;
        const d = Math.hypot(pt.x - (px - ox), pt.y - (py - oy));
        if (d < 30 && (!best || d < best.d)) best = { id: l.id, d };
      }
      if (best) return { kind: 'spill', id: best.id };
    }
    const hit = r.pick(px, py, s);
    // Mess on the frontage, outside: picked against the ground under the pointer.
    if (s.life?.litter.length) {
      const g = r.groundAt(px, py, 0);
      const m = g ? frontageLitter(s).find((l) => Math.hypot(l.x - g.x, l.z - g.z) < 0.4) : undefined;
      if (m) return { kind: 'mess', id: m.id };
    }
    if (!hit) return null;
    if (hit.kind === 'fixture') return { kind: 'fixture', id: hit.id };
    if (hit.kind === 'delivery') return { kind: 'delivery', id: 0 };
    const spill = s.shop.litter.find((l) => Math.hypot(l.x - hit.x, l.z - hit.z) < 0.45);
    if (spill) return { kind: 'spill', id: spill.id };
    // The pallet's own tiles count even when it is empty.
    const lp = toLocal(s.shop, hit.x, hit.z), d = s.shop.delivery;
    if (lp.x >= d.x0 && lp.x <= d.x1 && lp.z >= d.z0 && lp.z <= d.z1) return { kind: 'delivery', id: 0 };
    // So does a piece's: pieces stand back against an edge of their tile, and a click on the floor in front still means them.
    const f = s.shop.fixtures.find((x) => { if (FIXTURES[x.type].walkable) return false; const r = footprintOf(x.type, x.x, x.z, x.rot); return lp.x >= r.x0 && lp.x < r.x1 && lp.z >= r.z0 && lp.z < r.z1; });
    if (f) return { kind: 'fixture', id: f.id };
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
      // A spill at your feet counts whichever way you face; anything else has to be in front.
      const mess = t.kind === 'spill' || t.kind === 'mess';
      if (d > (mess ? 0.6 : 0.35) && (dx * fx + dz * fz) / d < 0.26) return;
      // Things you can actually do something with win over things you can only look at, and a spill
      // in reach wins over the shelf it lies by (a shelf's tile is always nearer than the spill's middle).
      const score = d - (this.actionFor(s, t, true).ok ? 0.3 : 0) - (mess ? 0.6 : 0);
      if (score < bestD) { bestD = score; best = t; }
    };
    for (const f of s.shop.fixtures) if (FIXTURES[f.type].slots > 0 || f.type === 'register' || f.type === 'pallet' || VERTICAL.has(f.type)) consider({ kind: 'fixture', id: f.id });
    consider({ kind: 'delivery', id: 0 });
    for (const l of s.shop.litter) consider({ kind: 'spill', id: l.id });
    for (const l of frontageLitter(s)) consider({ kind: 'mess', id: l.id });
    return best;
  }

  /** What using a thing does, standing in reach of it (near) or from across the room. */
  private actionFor(s: GameState, t: Thing, near: boolean): { text: string; ok: boolean; key: 'use' | 'scan' | null; run: (() => void) | null } {
    const owner = s.people.find((p) => p.kind === 'owner')!;
    if (t.kind === 'spill') return { text: 'Mop up the spill', ok: true, key: 'use', run: () => { this.dispatch({ type: 'clean', litterId: t.id }); } };
    if (t.kind === 'mess') {
      const kind = s.life?.litter.find((l) => l.id === t.id)?.kind;
      return { text: kind === 'poop' ? 'Clear up after the dog' : 'Pick up the litter', ok: true, key: 'use', run: () => { this.dispatch({ type: 'cleanTown', litterId: t.id }); } };
    }
    if (t.kind === 'delivery') {
      if (owner.carrying) {
        const back = owner.carrying.productId;
        return { text: `Put the ${productDef(back).name} back`, ok: true, key: 'use', run: () => { if (this.dispatch({ type: 'putBack' }).ok) { this.palletAfter = back; this.palletWant = null; } } };
      }
      const want = this.palletWant && s.shop.storage.some((e) => e.productId === this.palletWant && e.qty > 0) ? this.palletWant : null;
      const pid = want ?? neediestInStorage(s, this.palletAfter);
      if (!pid) return { text: 'No boxes yet: order stock', ok: false, key: null, run: null };
      const qty = Math.min(8, s.shop.storage.filter((e) => e.productId === pid).reduce((a, e) => a + e.qty, 0));
      return { text: `Pick up ${productDef(pid).name} ×${qty}`, ok: true, key: 'use', run: () => { if (this.dispatch({ type: 'pickUp', productId: pid }).ok) { this.palletAfter = null; this.palletWant = null; } } };
    }
    const f = s.shop.fixtures.find((x) => x.id === t.id);
    if (!f) return { text: '', ok: false, key: null, run: null };
    const def = FIXTURES[f.type];
    // An extra pallet: its boxes are the delivery's, picked up and put back the same way.
    if (f.type === 'pallet') return this.actionFor(s, { kind: 'delivery', id: 0 }, near);
    if (VERTICAL.has(f.type)) {
      // Up or down, from whichever end you are at (walking into it does the same); beside it, round to that end first.
      const up = levelOfPerson(s.shop, owner) === levelOf(f), dir = up ? 'up' : 'down';
      if (near && !rideOn(s, owner, f.id)) return { text: f.type === 'elevator' ? 'Walk round to the lift door' : `Walk round to the ${up ? 'foot' : 'top'} of the ${f.type === 'escalator' ? 'escalator' : 'stairs'}`, ok: false, key: null, run: null };
      const text = f.type === 'elevator' ? `Take the lift ${dir}` : f.type === 'escalator' ? `Ride the escalator ${dir}` : `Go ${dir} the stairs`;
      return { text, ok: true, key: 'use', run: () => { const r = this.dispatch({ type: 'ride', fixtureId: f.id }); if (!r.ok && r.message) this.showToast(r.message, 1400); } };
    }
    if (f.type === 'register') {
      if (near && !ownerAt(s, f)) return { text: 'Walk round behind the counter to scan', ok: false, key: null, run: null };
      const waiting = !!f.serving;
      return { text: waiting ? 'Scan item' : 'Nobody waiting yet', ok: waiting, key: 'scan', run: waiting ? () => this.scanHere() : null };
    }
    if (def.slots > 0) {
      if (owner.carrying) {
        // Say how many will actually go on (the rest stays in your hands), or that none will.
        const c = owner.carrying, name = productDef(c.productId).name, fit = Math.min(c.qty, roomOnFixture(f, c.productId));
        // Milk to a dry shelf: say where it goes instead of offering to stock it.
        const wrong = wrongFixture(c.productId, f.type);
        if (wrong) return { text: wrong, ok: false, key: null, run: null };
        if (fit === 0) return { text: `No room for ${name} here`, ok: false, key: null, run: null };
        return { text: `Stock ${name} ×${fit}`, ok: true, key: 'use', run: () => { this.dispatch({ type: 'stockFixture', fixtureId: f.id }); } };
      }
      // Empty-handed: a shelf opens the Stock card, at the products that go on it.
      const stocked = f.slots.filter((sl) => sl.productId && sl.qty > 0);
      return { text: `${def.name}: ${stocked.length ? stocked.map((sl) => `${productDef(sl.productId!).name} ${sl.qty}`).join(' · ') : 'empty'} · order stock`, ok: true, key: 'use', run: () => this.openStockFor(f.type) };
    }
    return { text: def.name, ok: false, key: null, run: null };
  }

  /** The Stock card, opened from a shelf: it starts at the kind of products that go on that shelf. */
  private stockFor: FixtureType | null = null;
  /** The shelf the Stock card was opened from, once (the card reads it when it opens). */
  takeStockFor(): FixtureType | null { const t = this.stockFor; this.stockFor = null; return t; }
  openStockFor(type: FixtureType): void {
    this.stockFor = type;
    if (this.card !== 'stock') this.openCard('stock'); else this.emit();
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
      // Empty-handed, a shelf only opens the Stock card: no need to walk over first.
      if (FIXTURES[f.type].slots > 0 && !o.carrying) { this.openStockFor(f.type); return; }
      // The stairs: their foot, or their top from the floor above.
      const ends = VERTICAL.has(f.type) ? rideEnds(f) : null, end = ends && (levelOfPerson(s.shop, o) > levelOf(f) ? ends.top : ends.bottom);
      to = f.type === 'register' ? fixtureBackWorld(s.shop, f) : end ? toWorld(s.shop, end.x, end.z) : fixtureAccessWorld(s.shop, f, o);
      if (Math.hypot(to.x - o.x, to.z - o.z) < 0.3) { this.actionFor(s, t, true).run?.(); return; }
    } else if (t.kind === 'delivery') to = storeroomPoint(s);
    else to = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 + 0.4 };
    const res = applyCommand(s, { type: 'walkTo', x: to.x, z: to.z });
    if (!res.ok) { this.showToast("You can't get there.", 1400); return; }
    this.refollow();
    this.pendingUse = t;
  }

  /** Each frame: when the manager arrives at what they were sent to use, use it. */
  private runPendingUse(s: GameState): void {
    const t = this.pendingUse; if (!t) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (!o || o.moveDir) { this.pendingUse = null; return; }
    // Not there yet: on the way, or partway up (or down) a ride.
    if (o.state === 'walking' || o.state === 'carrying' || o.climb !== undefined) return;
    this.pendingUse = null;
    if (t.kind === 'fixture' && !s.shop.fixtures.some((f) => f.id === t.id)) return;
    if (t.kind === 'spill' && !s.shop.litter.some((l) => l.id === t.id)) return;
    if (t.kind === 'mess' && !s.life?.litter.some((l) => l.id === t.id)) return;
    // Turn to face it, then act.
    const r = this.thingRect(s, t);
    o.yaw = Math.atan2((r.x0 + r.x1) / 2 - o.x, (r.z0 + r.z1) / 2 - o.z);
    const a = this.actionFor(s, t, true);
    if (a.run) a.run(); else if (a.text) this.showToast(a.text, 1600);
  }

  private resolveAim(): { info: AimInfo | null; run: (() => void) | null } {
    const s = this.state; const r = this.renderer;
    const none = { info: null, run: null };
    if (!s || !r || !this.inPlay || (s.phase === 'night' && !this.building && this.card !== 'build')) { r?.marker.set(null); return none; }
    const keys = this.settings.keys;
    const useKey = keyLabel(keys.interact), scanKey = keyLabel(keys.scan);
    if (this.build.tool) {
      const tool = this.build.tool;
      if (!this.build.hover) { r.marker.set(null); return { info: { key: null, text: tool.kind === 'grow' ? 'Point at a tile next to the shop' : tool.kind === 'wall' ? 'Point at a wall' : tool.kind === 'pave' ? 'Point at the grass' : tool.kind === 'bay' || tool.kind === 'unbay' ? 'Point at the car park' : 'Point at a floor tile', ok: false }, run: null }; }
      const h = this.build.hover, at = toWorld(s.shop, h.x + 0.5, h.z + 0.5);
      r.marker.set(null);
      const what = tool.kind === 'grow' ? 'Add this tile' : tool.kind === 'sell' ? 'Sell this tile'
        : tool.kind === 'wall' ? `Finish the wall: ${WALLS.find((w) => w.id === tool.style)?.name.toLowerCase() ?? ''}`
        : tool.kind === 'pave' ? (tool.surface ? `Lay ${SURFACES.find((x) => x.id === tool.surface)?.name.toLowerCase() ?? ''}` : 'Back to grass')
        : tool.kind === 'bay' ? 'Paint a parking bay' : tool.kind === 'unbay' ? 'Paint out this bay'
        : tool.kind === 'panel' ? 'Put up a ceiling panel' : tool.kind === 'unpanel' ? 'Take the panel down: double height'
        : `Lay ${FLOORS.find((f) => f.id === tool.style)?.name.toLowerCase() ?? 'floor'}`;
      const cost = this.build.price > 0 ? dollars(this.build.price) : this.build.price < 0 ? `${dollars(-this.build.price)} back` : 'free';
      return { info: { key: 'Click', text: this.build.valid ? `${what} · ${cost}` : this.build.reason, ok: this.build.valid, at: { x: at.x, y: 0.6, z: at.z } }, run: this.build.valid ? () => this.clickBuild(null) : null };
    }
    if (this.build.placing || this.build.selectedId !== null) {
      const type = this.build.placing ?? s.shop.fixtures.find((f) => f.id === this.build.selectedId)?.type;
      const name = type ? FIXTURES[type].name : '';
      if (!this.build.hover) { r.marker.set(null); return { info: { key: null, text: 'Point at a floor tile', ok: false }, run: null }; }
      const h = this.build.hover;
      const at = toWorld(s.shop, h.x + 0.5, h.z + 0.5);
      r.marker.set(null);
      return {
        info: { key: 'Click', text: (this.build.valid ? `${this.build.placing ? 'Place' : 'Move'} ${name}${this.build.price ? ` · ${dollars(this.build.price)}` : ''}` : this.build.reason)
          // Picked up from its menu (no Build card to say so): how to turn it and how to put it back.
          + (this.card !== 'build' && this.build.selectedId !== null ? ` · ${keyLabel(keys.rotate)} turns · Esc puts it back` : ''), ok: this.build.valid, at: { x: at.x, y: 1.1, z: at.z } },
        run: this.build.valid ? () => this.clickBuild(null) : null,
      };
    }
    const owner = s.people.find((p) => p.kind === 'owner'); if (!owner) return none;
    // On the way up or down: nothing to use until they step off.
    if (owner.climb !== undefined) { r.marker.set(null); return none; }
    // In front of a manager out of sight (on a floor lifted off to build on one under it): nothing (as a click finds nothing there).
    const kb = r.inSight(s, owner.x, 0.5, owner.z) ? this.thingInFront(s) : null;
    const hov = this.mousePos ? this.thingAt(this.mousePos.x, this.mousePos.y) : null;
    const show = kb ?? hov;
    if (!show) { if (!this.pendingUse) r.marker.set(null); return none; }
    // At night only the Build card's moves: nothing else is open for business.
    if (s.phase === 'night' && !(this.card === 'build' && show.kind === 'fixture')) { r.marker.set(null); return none; }
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
    // Furniture across the room, hands empty: a click opens its menu.
    if (show.kind === 'fixture' && !owner.carrying) {
      const m = this.fixtureMenuInfo(show.id);
      const what = m ? [m.use, 'Move', 'Turn', 'Sell'].filter(Boolean).join(', ').replace(/, (?=[^,]*$)/, ' or ') : 'Move, Turn or Sell';
      return { info: { key: 'Click', text: `${m?.name ?? 'Furniture'}: ${what}`, ok: true, at }, run: () => this.openFixtureMenu(show.id) };
    }
    // The delivery pallet across the room with several kinds of box on it: a click asks which.
    if (show.kind === 'delivery' && !owner.carrying && palletChoices(s).length > 1) return { info: { key: 'Click', text: 'Delivery pallet: choose a box', ok: true, at }, run: () => this.openFixtureMenu(-1) };
    // Across the room: a click walks over and does it.
    return { info: { key: a.ok ? 'Click' : null, text: a.text, ok: a.ok, at }, run: a.ok ? () => this.walkAndUse(show) : null };
  }

  /** Point the camera at the manager from the street side of the shop (new game, load, after picking a plot). */
  faceShop(): void {
    const s = this.state; const r = this.renderer; if (!s || !r) return;
    const o = s.people.find((p) => p.kind === 'owner');
    if (!o) return;
    r.follow.following = true;
    // Upstairs, where they are drawn (over the ground floor, a storey up a floor).
    const l = liftWorld(s.shop, o.x, o.z);
    r.follow.set(l.x, l.z, s.shop.flip ? Math.PI : 0, FollowCamera.DEFAULT, MathUtils.degToRad(52), l.y);
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
    if (id === -1) { const d = s.shop.delivery; const w = toWorld(s.shop, (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2); return { x: w.x, y: 0.8, z: w.z }; }
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

/** The stretch of outer wall nearest a shop-relative point on the ground (within reach of it), if any. */
function nearestWall(s: GameState, x: number, z: number): WallSeg | null {
  let best: WallSeg | null = null, bd = 0.8;
  for (const w of wallSegments(s.shop)) {
    const along = w.axis === 'x' ? Math.abs(x - w.t) : Math.abs(z - w.t);
    const across = w.axis === 'x' ? Math.abs(z - w.line) : Math.abs(x - w.line);
    if (along > 0.5 || across >= bd) continue;
    bd = across; best = w;
  }
  return best;
}
