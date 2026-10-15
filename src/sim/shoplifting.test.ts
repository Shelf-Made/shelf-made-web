import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, gridFor, doorInside, type GameState } from './index';
import { toWorld } from './layout';
import { nearestWalkable } from './grid';
import { spawnCustomer, addSpill } from './people';
import { isFree } from './shoplifting';
import { makeCandidate } from './staff';
import { productDef } from './products';
import type { Person } from './types';

/** An open shop with no shoppers about, the manager parked out of the way at the back. */
function quiet(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'T', tutorial: false });
  s.people = s.people.filter((p) => p.kind === 'owner');
  for (const f of s.shop.fixtures) { f.queue = []; f.serving = null; }
  s.shop.storage = [];
  const o = s.people[0]!;
  const back = toWorld(s.shop, s.shop.floor.x1 - 0.5, s.shop.floor.z0 + 0.5);
  const at = nearestWalkable(gridFor(s), back);
  o.x = o.px = at.x; o.z = o.pz = at.z;
  return s;
}

/** A shopper at the far end of the shop, done shopping, with a basket of bread. */
function thiefIn(s: GameState): Person {
  const p = spawnCustomer(s, true)!;
  const spot = nearestWalkable(gridFor(s), toWorld(s.shop, s.shop.floor.x0 + 0.6, s.shop.floor.z0 + 0.6));
  p.x = p.px = spot.x; p.z = p.pz = spot.z; p.path = []; p.pathIdx = 0; p.xings = undefined;
  p.state = 'shopping'; p.list = [{ productId: 'bread', qty: 3 }]; p.listIdx = 1; p.basket = [{ productId: 'bread', qty: 3, price: 2.5 }];
  p.thief = true;
  return p;
}

function hireRole(s: GameState, role: 'stocker' | 'cashier' | 'cleaner'): Person {
  s.cash = 5000;
  const c = makeCandidate(s, role);
  s.staffPool.push(c);
  expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
  return s.people.find((p) => p.id === c.id)!;
}

function run(s: GameState, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < seconds / TICK; i++) { tick(s); s.people = s.people.filter((p) => p.kind !== 'customer' || p.thief); if (until?.()) return; }
}

describe('shoplifters', () => {
  it('get away with the goods when nobody is free to stop them: the day loses what they cost', () => {
    const s = quiet(41);
    const p = thiefIn(s);
    const cash = s.cash;
    run(s, 0.2);
    expect(p.state).toBe('fleeing');
    run(s, 30, () => (s.today.escaped ?? 0) > 0);
    expect(s.today.escaped).toBe(1);
    expect(s.today.caught ?? 0).toBe(0);
    expect(s.today.theft).toBeCloseTo(productDef('bread').cost * 3, 2);
    // Stock, not cash: the till is untouched.
    expect(s.cash).toBe(cash);
  });

  it('a member of staff with nothing on runs them down, and the goods go back on the shelf', () => {
    const s = quiet(42);
    const st = hireRole(s, 'stocker');
    // Standing by the door, hands empty, nothing to shelve.
    const d = doorInside(s);
    st.x = st.px = d.x + 0.6; st.z = st.pz = d.z - 0.4; st.state = 'idle'; st.task = null;
    const shelf = s.shop.fixtures.find((f) => f.slots.some((sl) => sl.productId === 'bread'));
    const before = shelf?.slots.find((sl) => sl.productId === 'bread')?.qty ?? 0;
    const p = thiefIn(s);
    run(s, 30, () => (s.today.caught ?? 0) > 0 || (s.today.escaped ?? 0) > 0);
    expect(s.today.caught).toBe(1);
    expect(s.today.theft).toBe(0);
    expect(p.basket).toEqual([]);
    if (shelf) expect(shelf.slots.find((sl) => sl.productId === 'bread')!.qty).toBe(before + 3);
    // Caught, they stand there a moment, then leave empty-handed; the stocker goes back to work.
    run(s, 3);
    expect(p.state).not.toBe('fleeing');
    expect(st.chase ?? null).toBeNull();
  });

  it('the manager catches one by running into them', () => {
    const s = quiet(43);
    const o = s.people.find((x) => x.kind === 'owner')!;
    const p = thiefIn(s);
    run(s, 0.2);
    const d = doorInside(s, p.id);
    o.x = o.px = d.x; o.z = o.pz = d.z;
    run(s, 30, () => (s.today.caught ?? 0) > 0 || (s.today.escaped ?? 0) > 0);
    expect(s.today.caught).toBe(1);
  });
});

describe('spills', () => {
  it('whoever has nothing on mops up, one of them per spill', () => {
    const s = quiet(44);
    const a = hireRole(s, 'stocker');
    const b = hireRole(s, 'cleaner');
    for (const w of [a, b]) w.state = 'idle';
    const spot = nearestWalkable(gridFor(s), toWorld(s.shop, (s.shop.floor.x0 + s.shop.floor.x1) / 2, (s.shop.floor.z0 + s.shop.floor.z1) / 2));
    expect(addSpill(s, spot.x, spot.z)).toBe(true);
    run(s, 0.1);
    const going = s.people.filter((p) => p.state === 'toStock' && p.timer === -2);
    expect(going.length).toBe(1);
    run(s, 20, () => s.shop.litter.length === 0);
    expect(s.shop.litter.length).toBe(0);
  });

  it('a cashier with someone at the till is not free to wander off', () => {
    const s = quiet(45);
    const c = hireRole(s, 'cashier');
    c.state = 'idle';
    const reg = s.shop.fixtures.find((f) => f.staffId === c.id)!;
    expect(isFree(s, c)).toBe(true);
    reg.queue = [999];
    expect(isFree(s, c)).toBe(false);
  });
});
