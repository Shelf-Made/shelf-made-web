import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, type GameState } from './index';
import { openGame } from './testUtil';
import { rideEnds, storeysOf, toLocal, toWorld, zOnLevel } from './layout';
import { cellOf, fixtureAccessWorld, fixtureFacingWorld, isBlocked, nearestWalkable } from './grid';
import { gridFor } from './state';
import { findPath } from './pathfinding';
import { levelOfPerson, repathAfterBuildChange } from './storeys';
import { addSpill, spawnCustomer, startLeaving, setPath } from './people';
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

describe('a key tapped on the way up a flight clicked for', () => {
  it('lets the manager off at the top and leaves them there, with no walk left over that they never take', () => {
    const s = quiet(87);
    const o = owner(s), there = at(s, 2, -5.5, 1);
    expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
    run(s, 20, () => o.climb !== undefined);
    expect(o.climb).toBeDefined();
    const d = into(s);
    applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
    run(s, 0.3);
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    run(s, 4, () => o.climb === undefined);
    expect(levelOfPerson(s.shop, o)).toBe(1);
    const top = { x: o.x, z: o.z };
    run(s, 12);
    expect(o.path.length - o.pathIdx).toBe(0);
    expect(Math.hypot(o.x - top.x, o.z - top.z)).toBeLessThan(0.01);
    expect(s.stuckRescues).toBe(0);
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

/** Every tick: nobody rides a piece that is not there any more. */
const ghost = (s: GameState) => s.people.some((p) => p.climb !== undefined && !s.shop.fixtures.some((f) => f.id === p.path[p.pathIdx]?.via));
/** Anyone with a ride ahead that is not there to take from where they would get on (the waypoint before it, or where they stand). */
const staleRide = (s: GameState) => s.people.some((p) => p.path.some((w, i) => {
  if (i < p.pathIdx || w.ride === undefined || (i === p.pathIdx && p.climb !== undefined)) return false;
  const from = i > p.pathIdx ? p.path[i - 1]! : p;
  return ![...(gridFor(s).portals?.values() ?? [])].flat().some((pt) => pt.via === w.via && pt.at.x === w.x && pt.at.z === w.z && Math.hypot(pt.from.x - from.x, pt.from.z - from.z) < 0.45);
}));

describe('stairs sold or moved while someone heads for them', () => {
  it('the manager on the way up stairs that are sold stops downstairs, not up on a floor that has gone', () => {
    const s = quiet(79);
    const o = owner(s), stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    const there = at(s, -1.5, -4.5, 1);
    expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
    expect(o.path.some((w) => w.via === stairs.id)).toBe(true);
    run(s, 0.5);
    // Nothing upstairs yet: they can go.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: stairs.id }).ok).toBe(true);
    expect(storeysOf(s.shop).top).toBe(0);
    let rodeGhost = false;
    run(s, 10, () => { rodeGhost ||= ghost(s); return false; });
    expect(rodeGhost).toBe(false);
    expect(levelOfPerson(s.shop, o)).toBe(0);
    expect(o.climb).toBeUndefined();
    // The keys still walk them about.
    const was = { x: o.x, z: o.z };
    applyCommand(s, { type: 'moveDir', x: 1, z: 0 });
    run(s, 0.5);
    expect(Math.hypot(o.x - was.x, o.z - was.z)).toBeGreaterThan(0.3);
  });

  it('a shopper heading for an escalator that is sold goes up the stairs instead', () => {
    const s = shop(80);
    expect(place(s, 'stairs', -0.5, -2).ok).toBe(true);
    expect(place(s, 'escalator', 0.5, -2).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-5, 1), 1).ok).toBe(true);
    const up = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < -12)!;
    up.slots = up.slots.map(() => ({ productId: 'apples', qty: 8 }));
    s.phase = 'open';
    const esc = s.shop.fixtures.find((f) => f.type === 'escalator')!;
    const p = spawnCustomer(s, true)!;
    p.list = [{ productId: 'apples', qty: 1 }];
    run(s, 40, () => p.path.slice(p.pathIdx).some((w) => w.via === esc.id));
    expect(p.climb).toBeUndefined();
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: esc.id }).ok).toBe(true);
    const w = rideWatch(s);
    let rodeGhost = false;
    run(s, 30, () => { rodeGhost ||= ghost(s); return w.check() || levelOfPerson(s.shop, p) === 1; });
    expect(rodeGhost).toBe(false);
    expect(levelOfPerson(s.shop, p)).toBe(1);
    expect(w.dropped).toBe(0);
  });

  it('a shopper heading for stairs that are moved takes them where they now stand', () => {
    const s = shop(81);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-5, 1), 1).ok).toBe(true);
    const up = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < -12)!;
    up.slots = up.slots.map(() => ({ productId: 'apples', qty: 8 }));
    s.phase = 'open';
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    const p = spawnCustomer(s, true)!;
    p.list = [{ productId: 'apples', qty: 1 }];
    run(s, 40, () => p.path.slice(p.pathIdx).some((w) => w.via === stairs.id));
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: stairs.id, x: -0.5, z: -2, rot: 0 }).ok).toBe(true);
    const old = toWorld(s.shop, STAIRS.x + 0.5, STAIRS.z + 1.5);
    let wrong = false;
    run(s, 30, () => { if (p.climb !== undefined && Math.hypot(p.x - old.x, p.z - old.z) < 0.3) wrong = true; return levelOfPerson(s.shop, p) === 1; });
    expect(wrong).toBe(false);
    expect(levelOfPerson(s.shop, p)).toBe(1);
  });

  it('after a change to the building, everyone whose way rode a piece that has gone is sent another way', () => {
    const s = shop(82);
    expect(place(s, 'stairs', -0.5, -2).ok).toBe(true);
    expect(place(s, 'escalator', 0.5, -2).ok).toBe(true);
    const esc = s.shop.fixtures.find((f) => f.type === 'escalator')!;
    s.people = s.people.filter((p) => p.kind === 'owner');
    const o = owner(s);
    put(o, at(s, -2, -5.5));
    const there = at(s, 2, -5.5, 1);
    expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
    expect(o.path.some((w) => w.via === esc.id)).toBe(true);
    s.shop.fixtures = s.shop.fixtures.filter((f) => f !== esc); s.shop.layoutVersion++;
    repathAfterBuildChange(s);
    expect(o.path.some((w) => w.via === esc.id)).toBe(false);
    expect(o.path.some((w) => w.ride !== undefined)).toBe(true);
    expect(o.path[o.path.length - 1]).toEqual(there);
    // And with no way up left, they stop where they are.
    s.shop.fixtures = s.shop.fixtures.filter((f) => f.type !== 'stairs'); s.shop.layoutVersion++;
    repathAfterBuildChange(s);
    expect(o.path.length - o.pathIdx).toBe(0);
  });

  it('someone after a shelf used from the landing of a flight that is sold or moved gets there another way', () => {
    // The shelf upstairs is used standing where the flight comes up, so a way to it ends with the ride.
    for (const [change, who] of [['sold', 'customer'], ['sold', 'stocker'], ['moved', 'customer'], ['moved', 'stocker']] as const) {
      const s = shop(81), tag = `${change}, ${who}`;
      expect(place(s, change === 'sold' ? 'escalator' : 'stairs', STAIRS.x, STAIRS.z).ok).toBe(true);
      if (change === 'sold') expect(place(s, 'stairs', STAIRS.x - 1, STAIRS.z).ok).toBe(true);
      expect(place(s, 'shelf', STAIRS.x, zOnLevel(STAIRS.z - 3, 1), 0).ok).toBe(true);
      const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < -12)!, flight = s.shop.fixtures.find((f) => f.x === STAIRS.x && f.z === STAIRS.z)!;
      s.people = s.people.filter((p) => p.kind === 'owner');
      s.phase = 'open';
      let p: Person;
      if (who === 'customer') { shelf.slots = shelf.slots.map(() => ({ productId: 'apples', qty: 8 })); p = spawnCustomer(s, true)!; p.list = [{ productId: 'apples', qty: 1 }]; }
      else { shelf.slots = shelf.slots.map(() => ({ productId: 'rice', qty: 0 })); s.shop.storage = [{ productId: 'rice', qty: 40, day: s.day }]; p = hire(s, 'stocker'); }
      run(s, 60, () => p.path[p.path.length - 1]?.via === flight.id && p.pathIdx < p.path.length - 1);
      expect(p.path[p.path.length - 1]?.via, tag).toBe(flight.id);
      expect(applyCommand(s, change === 'sold' ? { type: 'removeFixture', fixtureId: flight.id } : { type: 'moveFixture', fixtureId: flight.id, x: STAIRS.x - 1, z: STAIRS.z, rot: 0 }).ok, tag).toBe(true);
      const w = rideWatch(s), done = () => who === 'customer' ? !!p.basket?.some((b) => b.productId === 'apples') : rice(shelf) > 0;
      let stale = false, plans = 0, path = p.path;
      run(s, 40, () => { w.check(); stale ||= staleRide(s); if (p.path !== path) { plans++; path = p.path; } return done(); });
      expect(done(), tag).toBe(true);
      expect(stale, tag).toBe(false);
      expect(plans, tag).toBeLessThan(10);
      expect(w.dropped, tag).toBe(0);
      expect(s.stuckRescues, tag).toBe(0);
    }
  });

  it('a flight turned to come down where it did from somewhere else up there is got on where it now starts', () => {
    for (const type of ['stairs', 'escalator'] as const) {
      const s = shop(79);
      expect(place(s, type, 0.5, -4).ok).toBe(true);
      s.people = s.people.filter((p) => p.kind === 'owner');
      s.phase = 'open';
      const o = owner(s), f = s.shop.fixtures.find((q) => q.type === type)!;
      put(o, at(s, 3, -3, 1));
      const there = at(s, 3, -1.5);
      expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
      expect(o.path.some((w) => w.via === f.id), type).toBe(true);
      run(s, 0.3);
      // A quarter turn about the same foot: the top is three tiles over now.
      expect(applyCommand(s, { type: 'moveFixture', fixtureId: f.id, x: -0.5, z: -3, rot: 1 }).ok, type).toBe(true);
      const e = rideEnds(f), top = toWorld(s.shop, e.top.x, e.top.z);
      let from: { x: number; z: number } | undefined;
      run(s, 30, () => { if (o.climb !== undefined) from ??= { x: o.x, z: o.z }; return levelOfPerson(s.shop, o) === 0; });
      expect(from && Math.hypot(from.x - top.x, from.z - top.z), type).toBeLessThan(0.3);
      expect(levelOfPerson(s.shop, o), type).toBe(0);
    }
  });
});

describe('a ride under way', () => {
  it('the manager riding up on the way to a floor that closes meanwhile gets off at the top, not back at the foot', () => {
    const s = quiet(84);
    expect(place(s, 'escalator', STAIRS.x - 1, zOnLevel(STAIRS.z, 1)).ok).toBe(true);
    expect(storeysOf(s.shop).top).toBe(2);
    const o = owner(s), there = at(s, 2, -5.5, 2);
    expect(applyCommand(s, { type: 'walkTo', x: there.x, z: there.z }).ok).toBe(true);
    const w = rideWatch(s);
    run(s, 20, () => w.check() || (o.climb ?? 0) > 1);
    expect(levelOfPerson(s.shop, o)).toBe(0);
    // Nobody is up there yet, so the escalator to floor 2 can go.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: s.shop.fixtures.find((f) => f.type === 'escalator')!.id }).ok).toBe(true);
    run(s, 5, w.check);
    expect(o.climb).toBeUndefined();
    expect(levelOfPerson(s.shop, o)).toBe(1);
    expect(w.dropped).toBe(0);
  });

  it('something put down at the foot of a flight someone is riding: they ride it out and step off clear of it', () => {
    for (const up of [true, false]) {
      const s = quiet(86, 'escalator'), dir = up ? 'up' : 'down';
      const o = owner(s), f = s.shop.fixtures.find((q) => q.type === 'escalator')!, e = rideEnds(f);
      put(o, up ? foot(s) : toWorld(s.shop, e.top.x, e.top.z));
      expect(applyCommand(s, { type: 'ride', fixtureId: f.id }).ok, dir).toBe(true);
      const w = rideWatch(s);
      run(s, 0.6, w.check);
      // However it came to be there (a lift is a way up too), it shuts the flight to anyone else.
      s.shop.fixtures.push({ id: s.nextId++, type: 'shelf', x: e.bottom.x - 0.5, z: e.bottom.z - 0.5, rot: 0, slots: [] } as unknown as GameState['shop']['fixtures'][number]);
      s.shop.layoutVersion++;
      run(s, 5, () => w.check() || o.climb === undefined);
      expect(levelOfPerson(s.shop, o), dir).toBe(up ? 1 : 0);
      expect(w.dropped, dir).toBe(0);
      const g = gridFor(s), [cx, cz] = cellOf(g, o);
      expect(isBlocked(g, cx, cz), dir).toBe(false);
    }
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

/** A shelf of rice (nowhere else in the shop) on floor `level`, empty, and boxes of it on the pallet. */
function riceUpstairs(s: GameState, level: number) {
  expect(place(s, 'shelf', -2.5, zOnLevel(-5, level), 1).ok).toBe(true);
  const shelf = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < zOnLevel(-4, level) + 1 && f.z > zOnLevel(-6, level))!;
  s.shop.storage = [{ productId: 'rice', qty: 40, day: s.day }];
  return shelf;
}
const rice = (f: { slots: { productId: string | null; qty: number }[] }) => f.slots.reduce((a, sl) => a + (sl.productId === 'rice' ? sl.qty : 0), 0);

describe('everyone rides every way up', () => {
  for (const type of ['stairs', 'escalator', 'elevator'] as const) {
    it(`stockers with boxes, cleaners, cashiers and shoppers with baskets all ride the ${type === 'elevator' ? 'lift' : type}`, () => {
      const s = shop(83);
      expect(place(s, type, STAIRS.x, STAIRS.z).ok).toBe(true);
      const shelf = riceUpstairs(s, 1);
      // A till upstairs too, with a cashier of its own (the first one hired takes the one downstairs).
      expect(place(s, 'register', 1.5, zOnLevel(-5, 1), 2).ok).toBe(true);
      const upTill = s.shop.fixtures.find((f) => f.type === 'register' && f.z < -12)!;
      hire(s, 'cashier');
      const cashier = hire(s, 'cashier'), stocker = hire(s, 'stocker'), cleaner = hire(s, 'cleaner');
      expect(upTill.staffId).toBe(cashier.id);
      const spill = at(s, 1, -1.5, 1);
      expect(addSpill(s, spill.x, spill.z)).toBe(true);
      s.phase = 'open';
      const w = rideWatch(s);
      const went = new Set<number>(), carried = new Set<number>();
      let bought = 0;
      for (let i = 0; i < 150 / TICK; i++) {
        if (i % 100 === 0 && s.people.filter((p) => p.kind === 'customer').length < 4) { const p = spawnCustomer(s, true); if (p) p.list = [{ productId: 'rice', qty: 1 }]; }
        tick(s); w.check();
        for (const p of s.people) {
          if (p.climb !== undefined) went.add(p.id);
          if (p.kind === 'customer' && p.climb !== undefined && p.basket?.some((b) => b.productId === 'rice')) carried.add(p.id);
          if (p.kind === 'staff' && p.climb !== undefined && p.carrying) carried.add(p.id);
        }
        bought = Math.max(bought, s.today.served);
      }
      expect(went.has(stocker.id), 'stocker').toBe(true);
      expect(carried.has(stocker.id), 'stocker with a box').toBe(true);
      expect(rice(shelf), 'shelved upstairs').toBeGreaterThan(0);
      expect(went.has(cleaner.id), 'cleaner').toBe(true);
      expect(s.shop.litter.length, 'mopped upstairs').toBe(0);
      expect(went.has(cashier.id), 'cashier').toBe(true);
      expect(levelOfPerson(s.shop, cashier)).toBe(1);
      expect([...carried].some((id) => id !== stocker.id), 'a shopper down with a basket').toBe(true);
      expect(bought, 'served').toBeGreaterThan(0);
      expect(w.dropped).toBe(0);
      expect(s.stuckRescues).toBe(0);
    });
  }

  it('up three floors and back: a stocker with a box, a shopper with a basket', () => {
    const s = shop(84);
    for (let L = 0; L < 3; L++) expect(place(s, L % 2 ? 'escalator' : 'stairs', L % 2 ? -0.5 : 0.5, zOnLevel(STAIRS.z, L)).ok, `floor ${L}`).toBe(true);
    expect(storeysOf(s.shop).top).toBe(3);
    const shelf = riceUpstairs(s, 3);
    const stocker = hire(s, 'stocker');
    hire(s, 'cashier');
    s.phase = 'open';
    const w = rideWatch(s);
    let top = 0, boxUp = 0, shopper: Person | null = null, home = false;
    for (let i = 0; i < 240 / TICK && !home; i++) {
      if (!shopper && rice(shelf) > 0) { shopper = spawnCustomer(s, true); shopper!.list = [{ productId: 'rice', qty: 1 }]; }
      tick(s); w.check();
      if (stocker.carrying) boxUp = Math.max(boxUp, levelOfPerson(s.shop, stocker));
      if (shopper) top = Math.max(top, levelOfPerson(s.shop, shopper));
      // Paid downstairs and out of the door.
      if (shopper && top === 3 && s.today.served > 0 && (!s.people.includes(shopper) || toLocal(s.shop, shopper.x, shopper.z).z > 0.5)) home = true;
    }
    expect(boxUp).toBe(3);
    expect(rice(shelf)).toBeGreaterThan(0);
    expect(top).toBe(3);
    expect(home).toBe(true);
    // Up and down three floors each, at least.
    expect(w.started).toBeGreaterThanOrEqual(12);
    expect(w.dropped).toBe(0);
    expect(s.stuckRescues).toBe(0);
  });

  it('two meeting on a flight, one going up as the other comes down, both get where they were going', () => {
    for (const type of ['stairs', 'escalator', 'elevator'] as const) {
      const s = quiet(85, type);
      const shelf = riceUpstairs(s, 1);
      shelf.slots[0] = { productId: 'rice', qty: 8 };
      const up = spawnCustomer(s, true)!, down = spawnCustomer(s, true)!;
      for (const p of [up, down]) { p.xings = undefined; p.list = [{ productId: 'rice', qty: 1 }]; p.listIdx = 0; p.basket = []; }
      const f = s.shop.fixtures.find((x) => x.type === type)!;
      // One at the foot after the rice, the other at the top on their way out.
      put(up, foot(s));
      up.state = 'browsing'; up.timer = -1; up.targetFixture = shelf.id;
      setPath(s, up, fixtureAccessWorld(s.shop, shelf, up, gridFor(s)));
      put(down, toWorld(s.shop, STAIRS.x + 0.5, zOnLevel(type === 'elevator' ? STAIRS.z + 1.5 : STAIRS.z - 1.5, 1)));
      startLeaving(s, down, true);
      expect(up.path.some((x) => x.via === f.id), type).toBe(true);
      expect(down.path.some((x) => x.via === f.id), type).toBe(true);
      const w = rideWatch(s);
      let both = false;
      run(s, 20, () => { w.check(); both ||= up.climb !== undefined && down.climb !== undefined; return levelOfPerson(s.shop, up) === 1 && up.timer > 0 && (!s.people.includes(down) || toLocal(s.shop, down.x, down.z).z > 0.5); });
      expect(both, type).toBe(true);
      expect(levelOfPerson(s.shop, up), type).toBe(1);
      expect(up.timer, type).toBeGreaterThan(0);
      expect(!s.people.includes(down) || toLocal(s.shop, down.x, down.z).z > 0.5, type).toBe(true);
      expect(w.dropped, type).toBe(0);
      expect(s.stuckRescues, type).toBe(0);
    }
  });
});
