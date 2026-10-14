import type { GameRuntime } from './GameRuntime';
import { tick, TICK, applyCommand, FIXTURES, quickSetup } from '@/sim/index';
import { PeopleView } from '@/render/People';
import { spawnCustomer } from '@/sim/people';
import { toWorld } from '@/sim/layout';

/** Deterministic hooks for Playwright screenshots and perf runs. Harmless in production. */
export function installTestHooks(rt: GameRuntime): void {
  // Cheats are allowed when a test harness drives the page (the balance harness and specs), never in normal play.
  if (typeof navigator !== 'undefined' && navigator.webdriver) (globalThis as { __shelfTest?: boolean }).__shelfTest = true;
  const hooks = {
    runtime: rt,
    ready: () => rt.getSnapshot().loaded,
    newGame: (seed: number, plotId?: string, name?: string, opts: { tutorial?: boolean; sandbox?: boolean } = {}) => rt.startNew({ seed, plotId, name, tutorial: opts.tutorial, sandbox: opts.sandbox }),
    /** Advance the simulation by game seconds without rendering (fast). */
    advance: (seconds: number) => { const s = rt.state; if (!s) return; const n = Math.round(seconds / TICK); for (let i = 0; i < n; i++) { tick(s); if (i % 5 === 0) applyCommand(s, { type: 'scan' }); } s.sounds.length = 0; rt.bump(); },
    /** Advance, scanning one item every `every` game seconds (a slow cashier, so a line forms). */
    advanceScan: (seconds: number, every = 1.5) => { const s = rt.state; if (!s) return; const n = Math.round(seconds / TICK); const k = Math.max(1, Math.round(every / TICK)); for (let i = 0; i < n; i++) { tick(s); if (i % k === 0) applyCommand(s, { type: 'scan' }); } s.sounds.length = 0; rt.bump(); },
    /** Advance while auto-scanning so customers get served. */
    advanceNoScan: (seconds: number) => { const s = rt.state; if (!s) return; const n = Math.round(seconds / TICK); for (let i = 0; i < n; i++) tick(s); s.sounds.length = 0; rt.bump(); },
    dispatch: (cmd: Parameters<GameRuntime['dispatch']>[0]) => rt.dispatch(cmd),
    setSpeed: (s: 0 | 1 | 2 | 4) => rt.setSpeed(s),
    openCard: (c: Parameters<GameRuntime['openCard']>[0]) => rt.openCard(c),
    camera: (x: number, z: number, dist: number, yaw = 0, pitch = 0.95) => { rt.cinematic = true; rt.renderer?.camera.focus(x, z, dist, yaw, pitch); rt.renderer?.camera.snap(); },
    /** Back to the manager's eyes, optionally standing at (x, z) shop-relative and looking along yaw/pitch. */
    fp: (x?: number, z?: number, yaw?: number, pitch?: number) => {
      rt.cinematic = false;
      const s = rt.state; const r = rt.renderer; if (!s || !r) return;
      const o = s.people.find((p) => p.kind === 'owner');
      if (o && x !== undefined && z !== undefined) { const w = toWorld(s.shop, x, z); o.x = o.px = w.x; o.z = o.pz = w.z; o.path = []; o.state = 'idle'; o.moveDir = null; }
      if (yaw !== undefined) r.fp.yaw = yaw + (s.shop.flip ? Math.PI : 0);
      if (pitch !== undefined) r.fp.pitch = pitch;
      rt.bump();
    },
    /** Stand at (x, z) shop-relative and turn so the crosshair lands on (tx, ty, tz). */
    aimAt: (x: number, z: number, tx: number, ty: number, tz: number) => {
      rt.cinematic = false;
      const s = rt.state; const r = rt.renderer; if (!s || !r) return;
      const o = s.people.find((p) => p.kind === 'owner'); if (!o) return;
      const w = toWorld(s.shop, x, z), t = toWorld(s.shop, tx, tz);
      o.x = o.px = w.x; o.z = o.pz = w.z; o.path = []; o.state = 'idle'; o.moveDir = null;
      r.fp.aimAt(o.x, o.z, o.look.height, t.x, ty, t.z);
      o.yaw = Math.atan2(t.x - o.x, t.z - o.z);
      rt.bump();
    },
    /** Furnish, stock and (optionally) open the shop the quick way, through commands. */
    quickSetup: (open = true) => { const s = rt.state; if (!s) return; quickSetup(s, open); rt.renderer?.setShop(s); rt.bump(); },
    aim: () => rt.aimInfo(),
    /** Model bounding boxes as the renderer sees them (art measurements). */
    bounds: async (ids: string[]) => { await rt.renderer?.assets.loadModels(ids.filter((id) => rt.renderer!.assets.has(id)), () => {}); return Object.fromEntries(ids.map((id) => { const r = rt.renderer; if (!r || !r.assets.has(id)) return [id, null]; const g = r.assets.geometry(id); g.computeBoundingBox(); const b = g.boundingBox!; return [id, [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => Math.round(v * 100) / 100)]; })); },
    interact: () => rt.interact(),
    look: (dx: number, dy: number) => rt.look(dx, dy),
    move: (x: number, z: number) => rt.move(x, z),
    focusStore: () => rt.focusStore(true),
    stats: () => rt.renderer?.stats(),
    state: () => rt.state,
    freezeAnim: (b: boolean) => { PeopleView.freeze = b; },
    /** Fill every slot to capacity (screenshots). */
    restock: () => { const s = rt.state; if (!s) return; for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = FIXTURES[f.type].capacity; rt.bump(); },
    /** Spawn n customers at once (busy-shop screenshots and queue tests). */
    crowd: (n: number, onFoot = true) => { const s = rt.state; if (!s) return; for (let i = 0; i < n; i++) spawnCustomer(s, onFoot); rt.bump(); },
    debugPeople: () => rt.renderer?.debugPeople(),
    /** Force a rival sale for screenshots. */
    rivalSale: (id: string) => { const s = rt.state; if (!s) return; const r = s.rivals.find((x) => x.id === id); if (r) { r.open = true; r.saleDaysLeft = 2; } rt.bump(); },
    startPlacing: (t: Parameters<GameRuntime['startPlacing']>[0]) => rt.startPlacing(t),
    hover: (x: number, z: number) => rt.hoverWorld(x, z),
    debugFixtures: () => rt.renderer?.debugFixtures(),
    /** A row of test people on the lawn, one per spec, each playing one animation. */
    testPeople: (specs: { model: number; variant: number; anim: 'idle' | 'walk' | 'browse' | 'carry' | 'pay' }[]) => {
      const s = rt.state; if (!s) return null;
      const x0 = s.shop.originX - 8, z = s.shop.originZ - 2;
      s.people = s.people.filter((p) => p.kind !== 'walker');
      specs.forEach((sp, i) => {
        const x = x0 + i * 0.9;
        const walking = sp.anim === 'walk';
        s.people.push({ id: 91000 + i, kind: 'walker', look: { model: sp.model, variant: sp.variant, height: 1 }, x, z, yaw: 0, px: x, pz: z, state: walking ? 'walking' : 'idle', anim: sp.anim, path: walking ? [{ x, z: z + 40 }] : [], pathIdx: 0, speed: walking ? 1.2 : 0, timer: 0 });
      });
      return { x: x0 + (specs.length - 1) * 0.45, z };
    },
    /** Put a lone, still person on the lawn west of the shop for close-ups. */
    testPerson: (model: number, variant: number) => {
      const s = rt.state; if (!s) return null;
      const x = s.shop.originX - 6, z = s.shop.originZ - 2;
      s.people = s.people.filter((p) => p.kind !== 'walker');
      s.people.push({ id: 90000 + model * 10 + variant, kind: 'walker', look: { model, variant, height: 1 }, x, z, yaw: 0, px: x, pz: z, state: 'idle', anim: 'idle', path: [], pathIdx: 0, speed: 0, timer: 0 });
      return { x, z };
    },
    ownerPos: () => { const o = rt.state?.people.find((p) => p.kind === 'owner'); return o ? { x: o.x, z: o.z } : null; },
    carry: () => { const s = rt.state; if (!s) return; const shelf = s.shop.fixtures.find((f) => f.type === 'shelf'); if (shelf) rt.dispatch({ type: 'carry', fixtureId: shelf.id }); },
  };
  (window as unknown as { __shelf: typeof hooks }).__shelf = hooks;
}
