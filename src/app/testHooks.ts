import type { GameRuntime } from './GameRuntime';
import { tick, TICK, applyCommand } from '@/sim/index';
import { PeopleView } from '@/render/People';
import { spawnCustomer } from '@/sim/people';

/** Deterministic hooks for Playwright screenshots and perf runs. Harmless in production. */
export function installTestHooks(rt: GameRuntime): void {
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
    camera: (x: number, z: number, dist: number, yaw = 0, pitch = 0.95) => { rt.renderer?.camera.focus(x, z, dist, yaw, pitch); rt.renderer?.camera.snap(); },
    focusStore: () => rt.focusStore(true),
    stats: () => rt.renderer?.stats(),
    state: () => rt.state,
    freezeAnim: (b: boolean) => { PeopleView.freeze = b; },
    /** Spawn n customers at once (busy-shop screenshots and queue tests). */
    crowd: (n: number, onFoot = true) => { const s = rt.state; if (!s) return; for (let i = 0; i < n; i++) spawnCustomer(s, onFoot); rt.bump(); },
    debugPeople: () => rt.renderer?.debugPeople(),
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
