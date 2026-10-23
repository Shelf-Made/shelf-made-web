import { openGame } from '@/sim/testUtil';
import { describe, it, expect } from 'vitest';
import { MemoryBackend } from './storage';
import { saveGame, loadGame, listSlots, parse, serialize } from './saves';
import { tick, SAVE_VERSION, TICK, gridFor, findPath, applyCommand, newGame, type GameState, type Person } from '@/sim/index';
import { toWorld, toLocal, zOnLevel, rideEnds, isFloor, wallSegments, lotLayout, yawToWorld, onBuilding, lotKey, edgePieceAt, edgeOf, FIXTURES } from '@/sim/layout';
import { onLotGrid, bayCentre } from '@/sim/drive';
import { wallStyleAt, openEdges } from '@/sim/build';
import { looksOf } from '@/sim/reviews';
import { ensureCeilings, levelOfPerson } from '@/sim/storeys';
import { cellOf, cellIndex, inBounds, isBlocked, reachableCells } from '@/sim/grid';
import { makeCandidate } from '@/sim/staff';
import { doorInside, spawnCustomer, addSpill, queueSlot } from '@/sim/people';

describe('saves', () => {
  it('round-trips a game through the backend and keeps determinism', async () => {
    const b = new MemoryBackend();
    const s = openGame({ seed: 42, plotId: 'main', name: 'Round Trip' });
    for (let i = 0; i < 500; i++) tick(s);
    await saveGame(b, 'slot1', s);
    const loaded = (await loadGame(b, 'slot1'))!;
    expect(loaded.shop.name).toBe('Round Trip');
    for (let i = 0; i < 300; i++) { tick(s); tick(loaded); }
    expect(JSON.stringify(loaded)).toEqual(JSON.stringify(s));
    const slots = await listSlots(b);
    expect(slots[0]!.slot).toBe('slot1');
  });
  it('rejects foreign files and migrates old versions', () => {
    expect(() => parse('{"hello":1}')).toThrow();
    const s = openGame({ seed: 1, plotId: 'elm', name: 'Old' });
    const text = serialize(s).replace(`"version":${SAVE_VERSION}`, '"version":0');
    const f = parse(text);
    expect(f.state.version).toBe(SAVE_VERSION);
    expect(f.state.rivals.length).toBe(3);
  });
  it('moves a valley save onto the crossroads (v8 → v9)', () => {
    const s = openGame({ seed: 8, plotId: 'elm', name: 'Valley' });
    for (let i = 0; i < 400; i++) tick(s);
    const raw = JSON.parse(serialize(s)) as { version: number; state: Record<string, unknown> };
    const st = raw.state as Record<string, unknown> & { shop: Record<string, unknown>; rivals: Record<string, unknown>[]; franchises: unknown[] };
    // What a v8 save looked like: plot ids from the valley, rivals without corners, franchises on town plots.
    st.version = 8; raw.version = 8;
    st.shop.plotId = 'hill'; st.shop.originX = -22; st.shop.originZ = -1.6; delete st.shop.flip;
    for (const r of st.rivals) { delete r.corner; delete r.bays; delete r.branches; r.x = 20; r.z = 8.9; }
    delete st.streetBays; delete st.rivalSpawn;
    st.franchises = [{ id: 1, plotId: 'east', name: 'Valley East End', manager: { id: 2, name: 'Mo', role: 'manager', skill: 0.7, speed: 1, wage: 90, look: { model: 1, variant: 0, height: 1 } }, openedDay: 1, stockLevel: 0.6, reputation: 0.5, cashToday: 0, history: [], alerts: [] }];
    const f = parse(JSON.stringify(raw));
    expect(f.state.version).toBe(SAVE_VERSION);
    expect(f.state.shop.plotId).toBe('elm');
    expect(f.state.shop.originX).toBe(-15.5);
    expect(f.state.franchises[0]!.siteId).toBe('elmheights');
    expect(f.state.streetBays.length).toBe(3);
    expect(new Set(f.state.rivals.map((r) => r.corner))).toEqual(new Set(['ne', 'sw', 'se']));
    // The migrated game keeps running.
    for (let i = 0; i < 600; i++) tick(f.state);
    expect(f.state.stuckRescues).toBe(0);
  });
  it('keeps the shop colour scheme through a save, and gives older shops the green (v9 → v10)', async () => {
    const b = new MemoryBackend();
    const s = openGame({ seed: 5, plotId: 'bus', name: 'Berry Mart', scheme: 'berry' });
    await saveGame(b, 'slot2', s);
    expect((await loadGame(b, 'slot2'))!.shop.scheme).toBe('berry');
    const raw = JSON.parse(serialize(s)) as { version: number; state: { version: number; shop: { scheme?: string } } };
    raw.version = 9; raw.state.version = 9; delete raw.state.shop.scheme;
    expect(parse(JSON.stringify(raw)).state.shop.scheme).toBe('green');
  });
  it('gives older rivals an empty book of moves (v11 → v12)', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'Older' });
    const raw = JSON.parse(serialize(s)) as { version: number; state: { version: number; rivals: Record<string, unknown>[] } };
    raw.version = 11; raw.state.version = 11;
    for (const r of raw.state.rivals) { delete r.responses; delete r.moveCooldown; delete r.cooldown; delete r.mods; }
    const st = parse(JSON.stringify(raw)).state;
    expect(st.version).toBe(SAVE_VERSION);
    for (const r of st.rivals) { expect(r.responses).toEqual([]); expect(r.moveCooldown).toEqual({}); expect(r.cooldown).toBe(0); }
    for (let i = 0; i < 300; i++) tick(st);
    expect(st.stuckRescues).toBe(0);
  });
  it('gives older saves the goal ladder, ticking off what their history shows (v10 → v11)', () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'Old Hand' });
    for (let i = 0; i < 400; i++) tick(s);
    const raw = JSON.parse(serialize(s)) as { version: number; state: Record<string, unknown> & { history: Record<string, unknown>[]; today: Record<string, unknown>; rivals: Record<string, unknown>[]; shop: { reputation: number } } };
    raw.version = 10; raw.state.version = 10;
    // What a v10 save looked like: no goals, no plan for tomorrow, no complaints, rivals without books.
    delete raw.state.goals; delete raw.state.tomorrow; delete raw.state.today.complaints;
    for (const r of raw.state.rivals) delete r.brokeDays;
    raw.state.history = [{ ...raw.state.today, day: 1, served: 34 }, { ...raw.state.today, day: 2, served: 20 }];
    raw.state.shop.reputation = 0.64;
    const st = parse(JSON.stringify(raw)).state;
    expect(st.version).toBe(SAVE_VERSION);
    // Thirty served and 60% reputation are in the history; out-selling Cheapo was never recorded, so that is next.
    expect(st.goals.done.map((d) => d.id)).toEqual(['doors', 'regulars']);
    expect(st.goals.unlocked).toContain('signLit');
    expect(st.goals.index).toBe(2);
    expect(st.tomorrow).toBeNull();
    for (const d of [st.today, ...st.history]) expect(d.complaints).toEqual({ outOfStock: {}, pricey: {}, queue: 0, lotFull: 0, dirty: 0 });
    for (const r of st.rivals) expect(r.brokeDays).toBe(0);
    // It plays on: the evening rolls tomorrow's plan.
    for (let i = 0; i < 20000 && st.phase !== 'night'; i++) tick(st);
    expect(st.tomorrow?.day).toBe(st.day + 1);
  });

  it('turns stairs an older save has facing out through a wall to step on from inside, and they go up meanwhile', () => {
    const s = openGame({ seed: 93, plotId: 'main', name: 'Upstairs', tutorial: false });
    const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = by.x; o.z = o.pz = by.z;
    // As the first build of floors let them go: the foot out on the pavement, a shelf up there.
    s.shop.fixtures.push({ id: s.nextId++, type: 'stairs', x: 1.5, z: -1, rot: 0, slots: [] });
    ensureCeilings(s.shop)[1] = [...s.shop.ceilings![0]!];
    s.shop.fixtures.push({ id: s.nextId++, type: 'shelf', x: -2.5, z: zOnLevel(-4, 1), rot: 1, slots: [] });
    s.shop.layoutVersion++;
    const up = toWorld(s.shop, -1, zOnLevel(-3.5, 1));
    expect(findPath(gridFor(s), doorInside(s), up)).toBeTruthy();
    expect(findPath(gridFor(s), up, doorInside(s))).toBeTruthy();
    // Loaded, they are stepped onto from the floor inside, and the way up never goes out of the door.
    const t = parse(serialize(s)).state, f = t.shop.fixtures.find((x) => x.type === 'stairs')!, b = rideEnds(f).bottom;
    expect(isFloor(t.shop, b.x - 0.5, b.z - 0.5)).toBe(true);
    expect(t.notices[t.notices.length - 1]!.text).toMatch(/^Stairs: turned/);
    const path = findPath(gridFor(t), doorInside(t), up)!;
    expect(path.some((w) => w.ride !== undefined)).toBe(true);
    expect(path.every((w) => toLocal(t.shop, w.x, w.z).z < t.shop.floor.z1)).toBe(true);
  });
  it('loads an older save with something upstairs cut off, and building goes on round it', () => {
    const fresh = () => {
      const s = openGame({ seed: 61, plotId: 'main', name: 'Upstairs', tutorial: false });
      s.cash = 50000;
      const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
      o.x = o.px = by.x; o.z = o.pz = by.z;
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
      return s;
    };
    const shelf = (s: GameState, x: number, z: number, rot: 0 | 1 | 2 | 3) => s.shop.fixtures.push({ id: s.nextId++, type: 'shelf', x, z, rot, slots: [] });
    // As the first build of floors let them be: a shelf on the landing of the only stairs...
    const landing = fresh();
    shelf(landing, 0.5, zOnLevel(-4, 1), 1);
    // ...a shelf up there with the floor round it sold...
    const bare = fresh();
    expect(applyCommand(bare, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: zOnLevel(-4, 1), rot: 1 }).ok).toBe(true);
    bare.shop.ceilings![0] = bare.shop.ceilings![0]!.filter((k) => !['-1.5,-4', '-2.5,-3', '-2.5,-5'].includes(k));
    // ...and a floor shut with a shelf on it, its stairs moved away.
    const shut = fresh();
    expect(applyCommand(shut, { type: 'placeFixture', fixtureType: 'stairs', x: -0.5, z: -3, rot: 0 }).ok).toBe(true);
    expect(applyCommand(shut, { type: 'placeFixture', fixtureType: 'stairs', x: 1.5, z: zOnLevel(-4, 1), rot: 0 }).ok).toBe(true);
    expect(applyCommand(shut, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: zOnLevel(-4, 2), rot: 1 }).ok).toBe(true);
    shut.shop.fixtures = shut.shop.fixtures.filter((f) => !(f.type === 'stairs' && f.z < -12));
    for (const [name, s] of [['landing', landing], ['bare', bare], ['shut', shut]] as const) {
      s.shop.layoutVersion++;
      const t = parse(serialize(s)).state;
      expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'plant', x: -2.5, z: -1, rot: 0 }).message, name).toBeUndefined();
      expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'plant', x: 1.5, z: -5, rot: 0 }).message, name).toBeUndefined();
    }
  });
  it('loads an older save with the manager walled in, or out on the road (a refused click took them), back inside the door', () => {
    for (const where of ['upstairs', 'road']) {
      const s = openGame({ seed: 62, plotId: 'main', name: 'Upstairs', tutorial: false });
      s.cash = 50000;
      const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
      o.x = o.px = by.x; o.z = o.pz = by.z;
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
      // A tile left on its own up there (the panels round it sold), the manager on it; or stood out over the road.
      for (const [x, z] of [[-1.5, -6], [-2.5, -5]] as const) expect(applyCommand(s, { type: 'removePanel', x, z }).ok).toBe(true);
      const at = where === 'road' ? toWorld(s.shop, 2, 7.9) : toWorld(s.shop, -2, zOnLevel(-5.5, 1));
      o.x = o.px = at.x; o.z = o.pz = at.z;
      expect(findPath(gridFor(s), o, doorInside(s)), where).toBeNull();
      const t = parse(serialize(s)).state, p = t.people.find((q) => q.kind === 'owner')!;
      expect(findPath(gridFor(t), p, doorInside(t)), where).toBeTruthy();
      expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'plant', x: -2.5, z: -1, rot: 0 }).message, where).toBeUndefined();
    }
  });
  it('loads an older save with people or a spill where the door does not reach, and nobody walks through the walls after', () => {
    const fresh = (seed: number) => {
      const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
      s.cash = 50000;
      const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
      o.x = o.px = by.x; o.z = o.pz = by.z;
      s.people = [o];
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
      return s;
    };
    const put = (p: Person, at: { x: number; z: number }) => { p.x = p.px = at.x; p.z = p.pz = at.z; };
    /** Anyone in a wall, a piece or the void, or up on floor the door does not reach (the manager and riders aside). */
    const stray = (t: GameState) => {
      const g = gridFor(t), reach = reachableCells(t.shop, g);
      for (const p of t.people) {
        const [cx, cz] = cellOf(g, p), l = toLocal(t.shop, p.x, p.z);
        if (p.kind === 'walker' || p.kind === 'owner' || p.climb !== undefined || p.state === 'driving' || !inBounds(g, cx, cz)) continue;
        if ((isBlocked(g, cx, cz) && Math.abs(l.x) < 6 && l.z < 0) || (levelOfPerson(t.shop, p) > 0 && !reach[cellIndex(g, cx, cz)])) return `${p.kind} ${p.state} at ${JSON.stringify(l)}`;
      }
      return '';
    };
    // A shopper done shopping on a tile of the first floor left on its own (the panels round it sold), and a stocker
    // in a wall put down over them.
    const s = fresh(62);
    for (const [x, z] of [[-1.5, -6], [-2.5, -5]] as const) expect(applyCommand(s, { type: 'removePanel', x, z }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'wall', x: -1.5, z: -1, rot: 0 }).ok).toBe(true);
    const c = spawnCustomer(s, true)!;
    put(c, toWorld(s.shop, -2, zOnLevel(-5.5, 1))); c.xings = undefined; c.path = []; c.pathIdx = 0;
    c.state = 'shopping'; c.list = [{ productId: 'bread', qty: 1 }]; c.listIdx = 1; c.basket = [{ productId: 'bread', qty: 1, price: 2.5 }];
    const k = makeCandidate(s, 'stocker'); s.staffPool.push(k);
    expect(applyCommand(s, { type: 'hire', candidateId: k.id }).ok).toBe(true);
    put(s.people.find((p) => p.id === k.id)!, toWorld(s.shop, -1, -0.5));
    s.phase = 'open';
    expect(stray(s)).not.toBe('');
    const t = parse(serialize(s)).state;
    let lost = stray(t);
    for (let i = 0; i < 30 / TICK; i++) { tick(t); if (i % 2 === 0) applyCommand(t, { type: 'scan' }); lost ||= stray(t); }
    expect(lost).toBe('');
    // A spill on a floor an older save shut (its stairs taken away, as the first build of floors let them be): gone.
    const w = fresh(64), at = toWorld(w.shop, -1, zOnLevel(-2.5, 1));
    expect(addSpill(w, at.x, at.z)).toBe(true);
    w.shop.fixtures = w.shop.fixtures.filter((f) => f.type !== 'stairs');
    w.shop.layoutVersion++;
    const u = parse(serialize(w)).state;
    expect(u.shop.litter.some((l) => Math.abs(l.z - at.z) < 0.01 && Math.abs(l.x - at.x) < 0.01)).toBe(false);
  });
  // The till's line was kept as it was: in at the door (let out of the void), the shopper still in the line of a counter
  // up on floor the door does not reach, and on to pay there in a straight line, out of the back wall and over the void.
  it('loads an older save with shoppers in the line of a till nobody can get to: they choose again', () => {
    const s = openGame({ seed: 99, plotId: 'main', name: 'Upstairs', tutorial: false });
    s.cash = 50000;
    const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = by.x; o.z = o.pz = by.z;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    for (const z of [-6, -4, -3, -2, -1]) expect(applyCommand(s, { type: 'removePanel', x: -0.5, z }).ok, `${z}`).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'register', x: -1.5, z: zOnLevel(-3, 1), rot: 0 }).ok).toBe(true);
    const reg = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    const c = spawnCustomer(s, true)!, at = queueSlot(s, reg, 0);
    c.x = c.px = at.x; c.z = c.pz = at.z; c.xings = undefined; c.path = []; c.pathIdx = 0;
    c.state = 'queued'; c.list = [{ productId: 'bread', qty: 1 }]; c.listIdx = 1; c.basket = [{ productId: 'bread', qty: 1, price: 2.5 }];
    c.registerId = reg.id; reg.queue = [c.id];
    // The tile an older build let you sell, cutting the counter off.
    s.shop.gaps = [...s.shop.gaps ?? [], '-0.5,-5'];
    s.shop.layoutVersion++;
    s.phase = 'open';
    const t = parse(serialize(s)).state, d = t.people.find((p) => p.id === c.id)!, r = t.shop.fixtures.find((f) => f.id === reg.id)!;
    expect(r.queue).toEqual([]);
    let lost = '';
    for (let i = 0; i < 20 / TICK; i++) {
      tick(t);
      const g = gridFor(t), [cx, cz] = cellOf(g, d), l = toLocal(t.shop, d.x, d.z);
      if (t.people.includes(d) && inBounds(g, cx, cz) && isBlocked(g, cx, cz) && Math.abs(l.x) < 6 && l.z < 0) lost ||= `${d.state} at ${JSON.stringify(l)}`;
    }
    expect(lost).toBe('');
    expect(r.serving).not.toBe(d.id);
  });

  // Nothing planned a way again after a build (the first floors' code), so a way through a piece put down since was
  // walked through as soon as the save loaded.
  it('loads an older save with a way planned through something built since: they go round it', () => {
    const s = openGame({ seed: 63, plotId: 'main', name: 'Across', tutorial: false });
    s.cash = 20000;
    const o = s.people.find((p) => p.kind === 'owner')!, out = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    s.phase = 'open';
    const p = spawnCustomer(s, true)!, at = toWorld(s.shop, -2, -1.5);
    p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined; p.list = []; p.basket = [];
    p.state = 'leaving'; p.path = [toWorld(s.shop, 2, -1.5)]; p.pathIdx = 0;
    // Put across the way, as the old code did, nobody planning again.
    s.shop.fixtures.push({ id: s.nextId++, type: 'wall', x: -0.5, z: -2, rot: 1, slots: [] });
    s.shop.layoutVersion++;
    const t = parse(serialize(s)).state, q = t.people.find((x) => x.id === p.id)!;
    let into = 0;
    for (let i = 0; i < 10 / TICK && q.state === 'leaving'; i++) { tick(t); const g = gridFor(t), [cx, cz] = cellOf(g, q); if (isBlocked(g, cx, cz)) into++; }
    expect(into).toBe(0);
  });

  // The delivery pallet, or a worker's post, left where the door does not reach (as older rules let pieces stand):
  // stockers set off for it all the same, in a straight line through the walls.
  it('loads an older save with the pallet cut off: no worker walks through the walls to it', () => {
    const s = openGame({ seed: 65, plotId: 'main', name: 'Pallet', tutorial: false });
    s.cash = 50000;
    const o = s.people.find((p) => p.kind === 'owner')!, by = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = by.x; o.z = o.pz = by.z;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    for (const role of ['stocker', 'cleaner'] as const) { const k = makeCandidate(s, role); s.staffPool.push(k); expect(applyCommand(s, { type: 'hire', candidateId: k.id }).ok).toBe(true); }
    // Walls on every edge of a shelf's tile (as no rule now lets them be put).
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    for (const rot of [0, 1, 2, 3] as const) if (!edgePieceAt(s.shop.fixtures, shelf.x, shelf.z, rot)) s.shop.fixtures.push({ id: s.nextId++, type: 'wall', x: shelf.x, z: shelf.z, rot, slots: [] });
    s.shop.layoutVersion++;
    shelf.slots[0]!.qty = 0;
    s.shop.storage = [{ productId: shelf.slots[0]!.productId!, qty: 20, day: s.day }];
    s.phase = 'open';
    const t = parse(serialize(s)).state;
    const staff = t.people.filter((p) => p.kind === 'staff');
    let through = '';
    for (let i = 0; i < 40 / TICK; i++) {
      tick(t);
      const g = gridFor(t);
      for (const p of staff) if (isBlocked(g, ...cellOf(g, p))) through ||= `${p.role} ${p.state} at ${JSON.stringify(toLocal(t.shop, p.x, p.z))}`;
    }
    expect(through).toBe('');
    expect(applyCommand(t, { type: 'carry', fixtureId: shelf.id }).message).toBe("You can't get there.");
  });

  it("keeps an older save's painted walls, as pieces, and walls it gains come plain, never paint to sell back", () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'Bands', tutorial: false });
    // Saved before wall finishes went on a stretch at a time (painted bands all round, said nowhere), and before the
    // walls were pieces (drawn round the floor).
    delete s.shop.wallStyle; delete s.shop.ceilings;
    const looks = looksOf(s).score;
    delete s.shop.walled;
    s.shop.fixtures = s.shop.fixtures.filter((f) => !FIXTURES[f.type].edge);
    const t = parse(serialize(s)).state, was = wallSegments(t.shop);
    // Every edge of the floor walled again, each wall with its bands, the doors where they were.
    expect(was.length).toBe(22);
    expect(was.filter((w) => w.type === 'wall' || w.type === 'wallWindow').every((w) => wallStyleAt(t.shop, w.key) === 'bands')).toBe(true);
    expect(t.shop.fixtures.filter((f) => f.type === 'frontDoor' || f.type === 'backDoor').map((f) => f.type).sort()).toEqual(['backDoor', 'frontDoor']);
    expect(looksOf(t).score).toBeCloseTo(looks, 6);
    const o = t.people.find((p) => p.kind === 'owner')!, by = toWorld(t.shop, t.shop.door.x, t.shop.floor.z1 + 0.8);
    o.x = o.px = by.x; o.z = o.pz = by.z;
    // A wall taken down and put back up is a new one: plain, and painting it plain pays nothing back.
    t.cash = 1000;
    const left = t.shop.fixtures.find((f) => f.type === 'wall' && f.rot === 1 && f.x === t.shop.floor.x0)!, at = { x: left.x, z: left.z };
    expect(applyCommand(t, { type: 'removeFixture', fixtureId: left.id }).ok).toBe(true);
    expect(t.cash).toBe(1000);
    expect(applyCommand(t, { type: 'placeFixture', fixtureType: 'wall', ...at, rot: 1 }).ok).toBe(true);
    const fresh = wallSegments(t.shop).find((w) => w.id === t.shop.fixtures[t.shop.fixtures.length - 1]!.id)!;
    expect(wallStyleAt(t.shop, fresh.key)).toBe('plain');
    expect(applyCommand(t, { type: 'paintWall', key: fresh.key, style: 'plain' }).ok).toBe(false);
    expect(t.cash).toBe(1000 - FIXTURES.wall.price);
  });

  it('lays an older lot out as tiles: its paths and lanes to dig up, each bay a Parking bay, every parked car still in its own', () => {
    const s = openGame({ seed: 23, plotId: 'main', name: 'Old Lot', tutorial: false });
    // As an older save had it: bays painted from a plan (two rows), only the tiles laid by hand, nothing laid as tiles.
    s.shop.fixtures = s.shop.fixtures.filter((f) => f.type !== 'parkingBay');
    s.shop.lotBaked = undefined; s.shop.pylon = undefined;
    s.shop.lotTiles = { '10,-4.5': 'brick' };
    s.shop.bayPlan = [0, 1, 2, 3, 8, 9]; s.shop.lotRows = 2;
    s.shop.bays = lotLayout(s.shop).bays.map((b) => ({ ...toWorld(s.shop, b.x, b.z), yaw: yawToWorld(s.shop, b.yaw), carId: null }));
    s.cars = [];
    for (let i = 0; i < 800 / TICK && s.cars.filter((c) => c.state === 'parked' && c.lot === undefined).length < 3; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
    const parked = s.cars.filter((c) => c.state === 'parked' && c.lot === undefined);
    expect(parked.length).toBeGreaterThanOrEqual(2);
    const before = new Map(parked.map((c) => [c.id, toLocal(s.shop, s.shop.bays[c.bay!]!.x, s.shop.bays[c.bay!]!.z)]));
    const loaded = parse(serialize(s)).state;
    const shop = loaded.shop;
    expect(shop.lotBaked).toBe(true);
    // Every bay a piece, in the order they were (so each car keeps its number), each where its bay was.
    const pieces = shop.fixtures.filter((f) => f.type === 'parkingBay');
    expect(pieces.length).toBe(6);
    expect(shop.bays.length).toBe(6);
    for (const b of shop.bays) expect(pieces.some((f) => f.id === b.fid)).toBe(true);
    for (const c of loaded.cars.filter((x) => x.state === 'parked' && x.lot === undefined)) {
      const b = shop.bays[c.bay!]!, f = pieces.find((q) => q.id === b.fid)!, at = bayCentre(f), was = before.get(c.id)!;
      expect(b.carId).toBe(c.id);
      // (Snapped onto the lot's grid: the old bays were a little more than a tile apart.)
      expect(Math.hypot(at.x - was.x, at.z - was.z), `car ${c.id}`).toBeLessThan(1);
      const l = toLocal(shop, c.x, c.z);
      expect(Math.hypot(l.x - at.x, l.z - at.z)).toBeLessThan(1e-6);
    }
    // The hand-laid brick stays; the lanes and yard are tiles now, on the lot's grid, none under the building.
    expect(shop.lotTiles![lotKey(10, -4.5)]).toBe('brick');
    expect(Object.values(shop.lotTiles!).filter((v) => v === 'asphalt').length).toBeGreaterThan(40);
    for (const k of Object.keys(shop.lotTiles!)) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      expect(onLotGrid(x, z)).toBe(true);
      expect(onBuilding(shop, { x0: x, z0: z, x1: x + 1, z1: z + 1 })).toBe(false);
    }
    // And it plays on: the parked cars drive off, new ones park, nobody inside anybody.
    let worst = Infinity, parkedLater = 0;
    for (let i = 0; i < 300 / TICK; i++) {
      tick(loaded); if (i % 6 === 0) applyCommand(loaded, { type: 'scan' });
      const moving = loaded.cars.filter((c) => c.state !== 'parked' && c.state !== 'unloading');
      for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) worst = Math.min(worst, Math.hypot(moving[a]!.x - moving[b]!.x, moving[a]!.z - moving[b]!.z));
      parkedLater += loaded.cars.filter((c) => c.state === 'parked' && c.lot === undefined && !before.has(c.id)).length;
    }
    expect(worst).toBeGreaterThan(0.75);
    expect(parkedLater).toBeGreaterThan(0);
    for (const id of before.keys()) expect(loaded.cars.some((c) => c.id === id && c.state === 'parked')).toBe(false);
  });
});

describe('walls as pieces, from an older save', () => {
  it('an older save: its drawn walls become pieces with their finishes, a Window a wall with a window, a wall in a tile goes onto its edge', () => {
    const s = newGame({ seed: 3, plotId: 'main', name: 'Walls' });
    // As it was saved before walls were pieces: none, a stretch of brick, a Window in the left wall, a wall across a tile.
    s.shop.fixtures = s.shop.fixtures.filter((f) => !FIXTURES[f.type].edge);
    delete s.shop.walled;
    const f = s.shop.floor;
    s.shop.wallStyles = { [`left@${f.x0}@-3.5`]: 'brick' };
    s.shop.fixtures.push({ id: s.nextId++, type: 'window', x: f.x0, z: -5, rot: 1, slots: [] }, { id: s.nextId++, type: 'wall', x: 0.5, z: -3, rot: 0, slots: [] });
    const t = parse(serialize(s)).state;
    expect(t.shop.walled).toBe(true);
    expect(openEdges(t.shop)).toEqual([]);
    expect(wallStyleAt(t.shop, `left@${f.x0}@-3.5`)).toBe('brick');
    expect(edgePieceAt(t.shop.fixtures, f.x0, -5, 1)!.type).toBe('wallWindow');
    expect(t.shop.fixtures.some((x) => x.type === 'window')).toBe(false);
    const across = t.shop.fixtures.find((x) => x.type === 'wall' && !x.free)!;
    expect(edgeOf(across)).toMatchObject({ axis: 'x', line: -3, t: 1 });
    expect(wallSegments(t.shop).length).toBe(22);
    // Loaded again, nothing more changes.
    const u = parse(serialize(t)).state;
    expect(u.shop.fixtures.length).toBe(t.shop.fixtures.length);
  });
});

describe('upstairs further back', () => {
  it('an older save keeps every piece upstairs on its floor, where it stood', () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'Up', tutorial: false });
    s.cash = 20000;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: -2.5, z: zOnLevel(-4, 1), rot: 1 }).ok).toBe(true);
    const shelf = s.shop.fixtures[s.shop.fixtures.length - 1]!, at = { x: shelf.x, z: shelf.z };
    // As it was saved before: a floor up was walked 16 back, not 24.
    const old = JSON.parse(serialize(s));
    old.version = 12; old.state.version = 12;
    for (const f of old.state.shop.fixtures) if (f.z < -20) f.z += 8;
    const t = parse(JSON.stringify(old)).state, back = t.shop.fixtures.find((f) => f.id === shelf.id)!;
    expect({ x: back.x, z: back.z }).toEqual(at);
  });
});
