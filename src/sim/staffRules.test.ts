import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, gridFor, type GameState } from './index';
import { toWorld, FIXTURES, CLOSE_TIME, levelTileList, shopTileList } from './layout';
import { nearestWalkable } from './grid';
import { spawnCustomer } from './people';
import { makeCandidate, wageFor, wageToday, staffNight } from './staff';
import { dailyAutomation, dailyWages, unitCost, INSTANT_MUL } from './economy';
import { saveOrder, editSavedOrder } from './savedOrders';
import { cameraCover, securityFactor } from './security';
import { inspectPerson } from './inspect';
import type { Person, Fixture, StaffRole, FixtureType } from './types';

function quiet(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'T', tutorial: false });
  s.people = s.people.filter((p) => p.kind === 'owner');
  for (const f of s.shop.fixtures) { f.queue = []; f.serving = null; }
  s.shop.storage = [];
  s.cash = 20000;
  const o = s.people[0]!;
  const at = nearestWalkable(gridFor(s), toWorld(s.shop, s.shop.floor.x1 - 0.5, s.shop.floor.z0 + 0.5));
  o.x = o.px = at.x; o.z = o.pz = at.z;
  return s;
}
function hire(s: GameState, role: StaffRole): Person {
  const c = makeCandidate(s, role);
  s.staffPool.push(c);
  expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
  return s.people.find((p) => p.id === c.id)!;
}
const onBreak = (s: GameState, p: Person, on: boolean) => expect(applyCommand(s, { type: 'setBreak', staffId: p.id, on }).ok).toBe(true);
/** Every shelf slot that holds something, filled to this share of what it holds (0: empty). */
function fill(s: GameState, share: number): void {
  for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = Math.ceil(FIXTURES[f.type].capacity * share);
}
/** Shelves full but for the first `n` products, run right out (all of them would not fit on the pallet). */
function runOut(s: GameState, n: number): string[] {
  fill(s, 1);
  const out = [...new Set(s.shop.fixtures.flatMap((f) => f.slots.map((sl) => sl.productId)).filter((id): id is string => !!id))].slice(0, n);
  for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId && out.includes(sl.productId)) sl.qty = 0;
  return out;
}
/** Put a piece on the first ground-floor tile that takes it. */
function placeAnywhere(s: GameState, type: FixtureType, skip: (x: number, z: number) => boolean = () => false): Fixture {
  const f = s.shop.floor;
  for (let z = f.z0; z < f.z1; z++) for (let x = f.x0; x < f.x1; x++) {
    if (skip(x, z)) continue;
    if (applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot: 0 }).ok) return s.shop.fixtures[s.shop.fixtures.length - 1]!;
  }
  throw new Error(`nowhere to put a ${type}`);
}

describe('staff on a break', () => {
  it('a manager on a break does none of the job: no reorders, no prices, no saved orders, no lift for the team', () => {
    const s = quiet(101);
    const m = hire(s, 'manager');
    const c = hire(s, 'cashier');
    const [pid] = runOut(s, 3);
    s.prices[pid!] = 999;
    expect(saveOrder(s, 'Bread', 'local', [{ productId: 'bread', qty: 6 }])).toBeNull();
    const saved = s.savedOrders![0]!;
    editSavedOrder(s, saved.id, { when: { kind: 'daily' }, minCash: 0 });
    onBreak(s, m, true);
    const orders = s.orders.length;
    dailyAutomation(s);
    expect(s.orders.length).toBe(orders);
    expect(s.prices[pid!]).toBe(999);
    // The team's morale gets no lift from them either.
    const away = structuredClone(s), back = structuredClone(s);
    back.people.find((p) => p.id === m.id)!.onBreak = undefined;
    staffNight(away); staffNight(back);
    const moraleOf = (st: GameState) => st.people.find((p) => p.id === c.id)!.morale!;
    expect(moraleOf(back) - moraleOf(away)).toBeCloseTo(0.015, 5);
    // Back at work, they do it all.
    onBreak(s, m, false);
    dailyAutomation(s);
    expect(s.orders.some((o) => o.savedId === saved.id)).toBe(true);
    expect(s.orders.length).toBeGreaterThan(orders + 1);
    expect(s.prices[pid!]).not.toBe(999);
  });

  it('an orderer on a break leaves the reordering, and one at work does it', () => {
    const s = quiet(102);
    const o = hire(s, 'orderer');
    runOut(s, 3);
    onBreak(s, o, true);
    dailyAutomation(s);
    expect(s.orders.length).toBe(0);
    onBreak(s, o, false);
    dailyAutomation(s);
    expect(s.orders.length).toBe(1);
  });

  it('a break is half pay for as long as it lasts: one pressed just before closing costs next to nothing', () => {
    const s = quiet(103);
    const a = hire(s, 'cashier'), b = hire(s, 'stocker');
    const full = wageFor(a) + wageFor(b);
    // The whole day worked; a break for both a few seconds before closing.
    s.time = CLOSE_TIME - 5;
    onBreak(s, a, true); onBreak(s, b, true);
    for (let i = 0; i < 400 / TICK && s.phase !== 'night'; i++) tick(s);
    expect(s.phase).toBe('night');
    const paid = s.history[s.history.length - 1]!.wages;
    expect(paid).toBeLessThanOrEqual(full);
    expect(paid).toBeGreaterThanOrEqual(full - 2);
    // Still on a break when the doors open: the day ahead is all at half, and yesterday's seconds are forgotten.
    expect(applyCommand(s, { type: 'openTomorrow' }).ok).toBe(true);
    expect(a.breakSecs).toBeUndefined();
    expect(dailyWages(s)).toBe(Math.round(a.wage! * 0.5) + Math.round(b.wage! * 0.5));
    // Half the open day on one, then back: three quarters.
    const p = { ...a, onBreak: undefined, breakSecs: CLOSE_TIME / 2 };
    expect(wageToday(p, CLOSE_TIME)).toBe(Math.round(a.wage! * 0.75));
    // Never on one: the full wage, as before.
    expect(wageToday({ ...a, onBreak: undefined, breakSecs: undefined }, 100)).toBe(wageFor({ ...a, onBreak: undefined }));
  });

  it('the person panel says they are on a break, at the wage they are on now', () => {
    const s = quiet(104);
    const c = hire(s, 'cashier');
    expect(inspectPerson(s, c.id)!.doing).not.toBe('On a break');
    onBreak(s, c, true);
    const info = inspectPerson(s, c.id)!;
    expect(info.doing).toBe('On a break');
    expect(info.staff!.wage).toBe(Math.round(c.wage! * 0.5));
  });
});

describe('the manager\'s reorders', () => {
  it('keep to the daily spend cap with instant delivery\'s quarter more, and say when they cannot pay', () => {
    const s = quiet(105);
    hire(s, 'manager');
    runOut(s, 4);
    s.rules = { ...s.rules, spendCap: 60, stockTarget: 2, instant: true };
    const cash = s.cash;
    dailyAutomation(s);
    const order = s.orders[s.orders.length - 1]!;
    expect(order.total).toBeGreaterThan(0);
    expect(order.total).toBeLessThanOrEqual(60);
    expect(cash - s.cash).toBeCloseTo(order.total, 2);
    expect(order.lines[0]!.unitCost).toBeCloseTo(Math.round(unitCost(order.lines[0]!.productId, 'local', s) * INSTANT_MUL * 100) / 100, 2);
    // Not enough in the till: no order, and a word about it.
    const t = quiet(105);
    hire(t, 'manager');
    runOut(t, 3);
    t.rules = { ...t.rules, instant: true };
    t.cash = 5; t.notices = [];
    dailyAutomation(t);
    expect(t.orders.length).toBe(0);
    expect(t.notices.some((n) => /Couldn't reorder stock\. Not enough cash/.test(n.text))).toBe(true);
  });

  it('never stock up past "stock up to", even with the reorder point set over it', () => {
    const s = quiet(106);
    hire(s, 'manager');
    s.rules = { ...s.rules, reorderPoint: 1, stockTarget: 0.5 };
    // Everything at 70% of what its shelves hold: over the stock-up level, so nothing to order.
    fill(s, 0.7);
    dailyAutomation(s);
    expect(s.orders.length).toBe(0);
    // One product run out: topped up to half (or the smallest order, six).
    const slot = s.shop.fixtures.flatMap((f) => f.slots.map((sl) => ({ f, sl }))).find((x) => x.sl.productId)!;
    const pid = slot.sl.productId!;
    let cap = 0;
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId === pid) { sl.qty = 0; cap += FIXTURES[f.type].capacity; }
    dailyAutomation(s);
    expect(s.orders.length).toBe(1);
    expect(s.orders[0]!.lines.map((l) => l.productId)).toEqual([pid]);
    expect(s.orders[0]!.lines[0]!.qty).toBe(Math.max(6, Math.ceil(cap * 0.5)));
  });
});

describe('security', () => {
  it('cameras upstairs count for the floor they are on, out of the whole shop', () => {
    const s = openGame({ seed: 107, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 50000;
    // One floor: the whole shop is the ground floor, as it always was.
    expect(shopTileList(s.shop).length).toBe(levelTileList(s.shop, 0).length);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'stairs', x: 0.5, z: -2, rot: 0 }).ok).toBe(true);
    const up = levelTileList(s.shop, 1);
    expect(up.length).toBeGreaterThan(0);
    for (const t of up.filter((_, i) => i % 3 === 0)) applyCommand(s, { type: 'placeFixture', fixtureType: 'dome', x: t.x, z: t.z, rot: 0 });
    const cover = cameraCover(s.shop);
    expect(cover.size).toBeGreaterThan(0);
    let w = 0; for (const t of cover.values()) w += t.watch;
    const all = shopTileList(s.shop).length;
    expect(all).toBe(levelTileList(s.shop, 0).length + up.length);
    expect(securityFactor(s)).toBeCloseTo(1 - 0.5 * Math.min(1, w / all), 6);
  });

  it('a dome never shares a tile with a piece that reaches the ceiling, but still hangs over a shelf', () => {
    const s = quiet(108);
    const taken = (x: number, z: number) => s.shop.fixtures.some((f) => f.x === x && f.z === z);
    const lamp = placeAnywhere(s, 'pendant', taken);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'dome', x: lamp.x, z: lamp.z, rot: 0 }).message).toBe('Something is already there');
    const kiosk = placeAnywhere(s, 'kiosk', taken);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'smartCam', x: kiosk.x, z: kiosk.z, rot: 0 }).ok).toBe(false);
    // A wall stands on an edge of its tile, not in the middle: a camera goes up over that tile.
    const wall = placeAnywhere(s, 'wall', taken);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'smartCam', x: wall.x, z: wall.z, rot: 0 }).ok).toBe(true);
    // And the other way round: nothing tall goes up under a dome.
    const dome = placeAnywhere(s, 'dome', taken);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'pendant', x: dome.x, z: dome.z, rot: 0 }).ok).toBe(false);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'vending', x: dome.x, z: dome.z, rot: 0 }).ok).toBe(false);
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'dome', x: shelf.x, z: shelf.z, rot: 0 }).ok).toBe(true);
  });
});

describe('shoppers at the vending machine', () => {
  it('spend out of their budget there, as at the till', () => {
    const s = quiet(109);
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId === 'cola') { sl.productId = null; sl.qty = 0; }
    const vm = placeAnywhere(s, 'vending');
    vm.slots[0]!.productId = 'cola'; vm.slots[0]!.qty = 8;
    const p = spawnCustomer(s, true)!;
    p.list = [{ productId: 'cola', qty: 1 }]; p.listIdx = 0; p.thief = false; p.budget = 50;
    const revenue = s.today.revenue;
    for (let i = 0; i < 240 / TICK && !p.vended; i++) tick(s);
    expect(p.vended).toBe(true);
    expect(p.budget).toBeCloseTo(50 - (s.today.revenue - revenue), 2);
  });
});
