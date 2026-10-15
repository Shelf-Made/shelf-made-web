import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, type GameState } from './index';
import { openGame } from './testUtil';
import { toLocal, toWorld, zOnLevel } from './layout';
import { fixtureFacingWorld, nearestWalkable } from './grid';
import { gridFor } from './state';
import { findPath } from './pathfinding';
import { levelOfPerson } from './storeys';
import { spawnCustomer } from './people';
import { bolt } from './shoplifting';
import { makeCandidate } from './staff';
import type { FixtureType, Person } from './types';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
  s.cash = 50000;
  return s;
}
const place = (s: GameState, fixtureType: FixtureType, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
/** Stairs (or an escalator, or a lift) beside the counter: the foot a tile in from the door, the top a tile behind them. */
const STAIRS = { x: 0.5, z: -2 };
const owner = (s: GameState) => s.people.find((p) => p.kind === 'owner')!;
const put = (p: Person, at: { x: number; z: number }) => { p.x = p.px = at.x; p.z = p.pz = at.z; };
/** Into the stairs from their foot (against the way they face). */
const into = (s: GameState) => { const f = fixtureFacingWorld(s.shop, 0); return { x: -f.x, z: -f.z }; };
const foot = (s: GameState) => toWorld(s.shop, STAIRS.x + 0.5, STAIRS.z + 1.5);
const run = (s: GameState, secs: number, until?: () => boolean) => { for (let i = 0; i < secs / TICK; i++) { tick(s); if (until?.()) return; } };
/** A point on floor `level` (shop-relative ground x, z), on the walking grid. */
const at = (s: GameState, x: number, z: number, level = 0) => nearestWalkable(gridFor(s), toWorld(s.shop, x, zOnLevel(z, level)));

/**
 * Watches every ride: each one begun must be ridden to the other floor, never dropped halfway (that leaves
 * them where they got on, after the renderer carried them partway up). Call it every tick.
 */
function rideWatch(s: GameState) {
  const on = new Map<number, number>();
  const w = { started: 0, dropped: 0, check: () => {
    for (const p of s.people) {
      if (p.climb !== undefined && !on.has(p.id)) { on.set(p.id, levelOfPerson(s.shop, p)); w.started++; }
      else if (p.climb === undefined && on.has(p.id)) { if (levelOfPerson(s.shop, p) === on.get(p.id)) w.dropped++; on.delete(p.id); }
    }
    return false;
  } };
  return w;
}

/** An open shop with stairs and nobody about but the manager, parked at the back; no stock on the pallet. */
function quiet(seed: number, type: FixtureType = 'stairs'): GameState {
  const s = shop(seed);
  expect(place(s, type, STAIRS.x, STAIRS.z).ok).toBe(true);
  s.people = s.people.filter((p) => p.kind === 'owner');
  for (const f of s.shop.fixtures) { f.queue = []; f.serving = null; }
  s.shop.storage = [];
  put(owner(s), at(s, -2, -5.5));
  s.phase = 'open';
  return s;
}

/** A shopper upstairs with a basket of bread, done shopping. */
function shopperUpstairs(s: GameState): Person {
  const p = spawnCustomer(s, true)!;
  put(p, at(s, -1.5, -4.5, 1));
  p.path = []; p.pathIdx = 0; p.xings = undefined;
  p.state = 'shopping'; p.list = [{ productId: 'bread', qty: 3 }]; p.listIdx = 1; p.basket = [{ productId: 'bread', qty: 3, price: 2.5 }];
  return p;
}

function hire(s: GameState, role: 'stocker' | 'cashier' | 'cleaner'): Person {
  const c = makeCandidate(s, role);
  s.staffPool.push(c);
  expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
  return s.people.find((p) => p.id === c.id)!;
}

describe('riding the stairs with the keys', () => {
  it('carries the manager to the top once on, whatever the keys do (let go, or a card opened)', () => {
    const s = shop(71);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z).ok).toBe(true);
    const o = owner(s);
    put(o, foot(s));
    const d = into(s);
    applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
    run(s, 0.2);
    expect(o.climb).toBeDefined();
    // Let go a step onto the stairs (a card opening does the same).
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    run(s, 4, () => o.climb === undefined);
    expect(o.climb).toBeUndefined();
    expect(levelOfPerson(s.shop, o)).toBe(1);
    // The keys walk them on along the floor up there...
    const at = { x: o.x, z: o.z };
    applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
    run(s, 0.5);
    expect(Math.hypot(o.x - at.x, o.z - at.z)).toBeGreaterThan(0.4);
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    // ...and Use at the top takes them back down.
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    put(o, toWorld(s.shop, STAIRS.x + 0.5, zOnLevel(STAIRS.z - 1.5, 1)));
    expect(applyCommand(s, { type: 'ride', fixtureId: stairs.id }).ok).toBe(true);
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    run(s, 4, () => o.climb === undefined);
    expect(levelOfPerson(s.shop, o)).toBe(0);
  });
});

describe('which way up', () => {
  it('shoppers take an escalator (or a lift) over stairs that cost them more, wherever the stairs stand', () => {
    // Stairs cost 12 (half-tile steps), an escalator 7, a lift 9; stairs and an escalator come up three tiles back.
    for (const [a, b, z, want] of [['stairs', 'escalator', -5.5, 'escalator'], ['escalator', 'stairs', -5.5, 'escalator'], ['stairs', 'elevator', -0.5, 'elevator']] as const) {
      const s = shop(77);
      // One right by the door, the other a tile over.
      expect(place(s, a, -0.5, -2).ok).toBe(true);
      expect(place(s, b, 0.5, -2).ok).toBe(true);
      const kind = (id?: number) => s.shop.fixtures.find((f) => f.id === id)?.type;
      const g = gridFor(s), door = at(s, 0, -0.7);
      for (const x of [-2, 0, 2]) {
        const path = findPath(g, door, at(s, x, z, 1))!;
        expect(path.filter((w) => w.ride !== undefined).map((w) => kind(w.via)), `${a} by the door, ${b} beside, to ${x}, ${z}`).toEqual([want]);
      }
    }
  });

  it('shoppers after a shelf at the back upstairs ride the escalator, not the stairs by the door', () => {
    const s = shop(78);
    expect(place(s, 'stairs', -0.5, -2).ok).toBe(true);
    expect(place(s, 'escalator', 0.5, -2).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-5, 1), 1).ok).toBe(true);
    const up = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < -12)!;
    up.slots = up.slots.map(() => ({ productId: 'apples', qty: 8 }));
    s.phase = 'open';
    const rode = new Map<number, string | undefined>();
    for (let i = 0; i < 120 / TICK && rode.size < 4; i++) {
      if (i % 60 === 0) { const p = spawnCustomer(s, true); if (p) p.list = [{ productId: 'apples', qty: 1 }]; }
      tick(s);
      if (i % 4 === 0) applyCommand(s, { type: 'scan' });
      for (const p of s.people) if (p.kind === 'customer' && p.climb !== undefined && !rode.has(p.id) && levelOfPerson(s.shop, p) === 0) rode.set(p.id, s.shop.fixtures.find((f) => f.id === p.path[p.pathIdx]?.via)?.type);
    }
    expect(rode.size).toBe(4);
    expect([...rode.values()]).toEqual(['escalator', 'escalator', 'escalator', 'escalator']);
  });
});

describe('riding the lift with the keys', () => {
  it('holding a key a little off into the lift takes the manager up once, not up and down for ever', () => {
    for (const turn of [0.3, -0.3, 0]) {
      const s = quiet(76, 'elevator');
      const o = owner(s);
      put(o, foot(s));
      const d = into(s), c = Math.cos(turn), n = Math.sin(turn);
      applyCommand(s, { type: 'moveDir', x: d.x * c - d.z * n, z: d.x * n + d.z * c });
      const w = rideWatch(s);
      run(s, 12, w.check);
      expect(w.started, `turned ${turn}`).toBe(1);
      expect(levelOfPerson(s.shop, o)).toBe(1);
      // Let go and push into it again: back down.
      applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
      run(s, 0.1);
      put(o, toWorld(s.shop, STAIRS.x + 0.5, zOnLevel(STAIRS.z + 1.5, 1)));
      applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
      run(s, 6, () => w.check() || (w.started === 2 && o.climb === undefined));
      expect(w.started, `turned ${turn}`).toBe(2);
      expect(levelOfPerson(s.shop, o)).toBe(0);
    }
  });
});

describe('a change of plan on the stairs', () => {
  it('a click while the manager rides up takes them on from the top, never back to the foot', () => {
    const s = quiet(75);
    const o = owner(s), stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    put(o, foot(s));
    expect(applyCommand(s, { type: 'ride', fixtureId: stairs.id }).ok).toBe(true);
    const w = rideWatch(s);
    run(s, 1, w.check);
    const there = at(s, -1.5, -0.5);
    expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
    // Up to the top first, then back down and over.
    expect(o.climb).toBeDefined();
    run(s, 2, () => w.check() || o.climb === undefined);
    expect(levelOfPerson(s.shop, o)).toBe(1);
    run(s, 15, () => w.check() || Math.hypot(o.x - there.x, o.z - there.z) < 0.3);
    expect(Math.hypot(o.x - there.x, o.z - there.z)).toBeLessThan(0.3);
    expect(w.started).toBe(2);
    expect(w.dropped).toBe(0);
  });
});

describe('shoplifters and the stairs', () => {
  it('one bolting from upstairs gets down the stairs and away (a re-plan never starts a ride over)', () => {
    const s = quiet(72);
    const p = shopperUpstairs(s);
    bolt(s, p);
    const w = rideWatch(s);
    run(s, 30, () => w.check() || (s.today.escaped ?? 0) > 0);
    expect(s.today.escaped).toBe(1);
    expect(w.started).toBe(1);
    expect(w.dropped).toBe(0);
  });

  it('staff give chase up and down the stairs and finish every ride they start', () => {
    const s = quiet(73);
    const st = hire(s, 'stocker');
    put(st, at(s, -1, -0.8)); st.state = 'idle'; st.task = null;
    const p = shopperUpstairs(s);
    bolt(s, p);
    const w = rideWatch(s);
    run(s, 30, () => w.check() || (s.today.caught ?? 0) + (s.today.escaped ?? 0) > 0);
    expect((s.today.caught ?? 0) + (s.today.escaped ?? 0)).toBe(1);
    run(s, 20, () => w.check() || levelOfPerson(s.shop, st) === 0 && st.chase === null && st.climb === undefined);
    expect(levelOfPerson(s.shop, st)).toBe(0);
    expect(w.started).toBeGreaterThan(0);
    expect(w.dropped).toBe(0);
    expect(s.stuckRescues).toBe(0);
  });

  it('one caught upstairs goes down the stairs and out, and so does whoever caught them', () => {
    for (const by of ['owner', 'stocker'] as const) {
      const s = quiet(74);
      const p = shopperUpstairs(s);
      const c = by === 'owner' ? owner(s) : hire(s, 'stocker');
      put(c, { x: p.x + 0.3, z: p.z }); c.state = 'idle'; c.task = null;
      bolt(s, p);
      const w = rideWatch(s);
      run(s, 2, () => w.check() || (s.today.caught ?? 0) > 0);
      expect(s.today.caught, by).toBe(1);
      // Out of the door and off down the street.
      const out = () => !s.people.includes(p) || toLocal(s.shop, p.x, p.z).z > 0.5;
      run(s, 30, () => w.check() || out());
      expect(out(), by).toBe(true);
      expect(levelOfPerson(s.shop, p), by).toBe(0);
      // A member of staff goes back to work downstairs.
      if (by === 'stocker') { run(s, 20, () => w.check() || levelOfPerson(s.shop, c) === 0 && c.state === 'idle'); expect(levelOfPerson(s.shop, c)).toBe(0); }
      expect(w.dropped, by).toBe(0);
      expect(s.stuckRescues, by).toBe(0);
    }
  });
});
