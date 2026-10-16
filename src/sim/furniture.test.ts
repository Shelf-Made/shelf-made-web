import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, FIXTURES, type GameState, type FixtureType } from './index';
import { openGame } from './testUtil';
import { FURNITURE_USE, queueDrain, thiefFactor, grimeFactor, tillExtras } from './furniture';
import { spawnCustomer } from './people';
import { PRODUCTS } from './products';
import { gridFor } from './state';
import { cellOf, cellIndex, isBlocked, reachableCells, nearestWalkable } from './grid';
import { toLocal, toWorld, zOnLevel } from './layout';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Furnished', tutorial: false });
  s.cash = 20000;
  return s;
}
/** Put a piece on the first free floor tile where it fits. */
function put(s: GameState, type: string, rot: 0 | 1 | 2 | 3 = 0): boolean {
  const f = s.shop.floor;
  for (let z = f.z0; z < f.z1; z++) for (let x = f.x0; x < f.x1; x++) if (applyCommand(s, { type: 'placeFixture', fixtureType: type as never, x, z, rot }).ok) return true;
  return false;
}

describe('furniture earns its place', () => {
  it('every piece of furniture, decor and lighting says what it does', () => {
    for (const [type, def] of Object.entries(FIXTURES)) if (def.category === 'furniture' || def.category === 'decor' || def.category === 'lights') expect(FURNITURE_USE[type as keyof typeof FURNITURE_USE], type).toBeTruthy();
  });

  it('music and plants calm the queue, lights put shoplifters off, a doormat keeps the floor clean, magazines sell', () => {
    const s = shop(51);
    expect(queueDrain(s)).toBe(1); expect(thiefFactor(s)).toBe(1); expect(grimeFactor(s)).toBe(1);
    expect(put(s, 'speaker')).toBe(true); expect(put(s, 'plant')).toBe(true);
    expect(queueDrain(s)).toBeLessThan(0.9);
    expect(put(s, 'floorLamp')).toBe(true); expect(put(s, 'pendant')).toBe(true);
    expect(thiefFactor(s)).toBeLessThan(0.9);
    expect(put(s, 'doormat')).toBe(true);
    expect(grimeFactor(s)).toBeLessThan(1);
    expect(put(s, 'bookcase')).toBe(true);
    let sold = 0;
    for (let i = 0; i < 200; i++) sold += tillExtras(s).revenue;
    expect(sold).toBeGreaterThan(0);
  });

  it('a café table sells coffee after the till; tired shoppers sit on a bench; the help desk fetches from the pallet', () => {
    const s = shop(52);
    expect(put(s, 'cafe')).toBe(true);
    expect(put(s, 'bench', 0)).toBe(true);
    expect(put(s, 'desk', 0)).toBe(true);
    // Something on the pallet that is on no shelf: only the desk can sell it.
    const shelved = new Set(s.shop.fixtures.flatMap((f) => f.slots.map((sl) => sl.productId)));
    const extra = PRODUCTS.find((p) => !shelved.has(p.id) && !p.chilled)!.id;
    s.shop.storage.push({ productId: extra, qty: 20, day: s.day });
    applyCommand(s, { type: 'openTomorrow' });
    s.phase = 'open';
    let coffee = false, sat = false, asked = false, fetched = false;
    for (let i = 0; i < 360 / TICK; i++) {
      if (i % 60 === 0 && s.people.filter((p) => p.kind === 'customer').length < 8) {
        const p = spawnCustomer(s, true);
        if (p && i % 120 === 0) { p.list = [{ productId: extra, qty: 1 }, ...(p.list ?? [])]; p.walked = 20; }
      }
      tick(s);
      if (i % 4 === 0) applyCommand(s, { type: 'scan' });
      for (const p of s.people) {
        if (p.state === 'resting' && p.timer > 0) { if (p.rest?.kind === 'cafe') coffee = true; if (p.rest?.kind === 'seat') sat = true; if (p.rest?.kind === 'desk') asked = true; }
        if (p.basket?.some((b) => b.productId === extra)) fetched = true;
      }
      if (coffee && sat && fetched) break;
    }
    expect(sat).toBe(true);
    expect(asked).toBe(true);
    expect(fetched).toBe(true);
    expect(coffee).toBe(true);
    expect(s.stuckRescues).toBe(0);
  });

  // A seat turned to face a wall or the void, or with a shelf on its front tile, as building lets it be: whoever sits
  // on it walks to it, and stands up from it, on floor inside that the door reaches (never round outside to the far
  // side of the wall, nor up inside the wall or the shelf).
  const seats: [string, [FixtureType, number, number, 0 | 1 | 2 | 3][]][] = [
    ['a bench facing the wall', [['bench', -2.5, -1, 3]]],
    ['a bench with a shelf in front', [['bench', -2.5, -1, 1], ['shelf', -1.5, -1, 1]]],
    ['a bench upstairs facing the wall', [['stairs', 0.5, -2, 0], ['bench', -2.5, zOnLevel(-5, 1), 3]]],
    ['a café table upstairs facing the back wall', [['stairs', 0.5, -2, 0], ['cafe', -1.5, zOnLevel(-6, 1), 2]]],
  ];
  for (const [what, pieces] of seats) it(`whoever sits at ${what} gets there and up again inside`, () => {
    const s = shop(41);
    s.cash = 50000;
    const o = s.people.find((p) => p.kind === 'owner')!, out = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
    o.x = o.px = out.x; o.z = o.pz = out.z;
    for (const [type, x, z, rot] of pieces) expect(applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot }).ok, type).toBe(true);
    const seat = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    s.people = [o];
    for (const f of s.shop.fixtures) { f.queue = f.queue && []; f.serving = null; }
    s.phase = 'open';
    let sat = 0, lost = '';
    const sitting = new Set<number>();
    for (let i = 0; i < 240 / TICK; i++) {
      if (i % 100 === 0 && s.people.length < 5) {
        const p = spawnCustomer(s, true);
        if (p && seat.z > -12) p.walked = 30;
        else if (p) {
          // Upstairs: tired out by it, or (at the café) just sat down with a coffee.
          const at = nearestWalkable(gridFor(s), toWorld(s.shop, -1, zOnLevel(-2.5, 1)));
          p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined; p.path = []; p.pathIdx = 0;
          p.state = 'shopping'; p.walked = 30; p.list = [{ productId: 'bread', qty: 1 }]; p.listIdx = 0;
          if (seat.type === 'cafe') { p.state = 'resting'; p.timer = -1; p.rest = { kind: 'cafe', fixtureId: seat.id, seat: 0 }; p.basket = [{ productId: 'bread', qty: 1, price: 2.5 }]; p.paid = true; }
        }
      }
      tick(s);
      if (i % 4 === 0) applyCommand(s, { type: 'scan' });
      const g = gridFor(s), reach = reachableCells(s.shop, g);
      for (const p of s.people) {
        if (p.kind !== 'customer' || p.climb !== undefined) continue;
        if (p.state === 'resting' && p.timer > 0 && p.rest?.kind !== 'desk') { sat++; sitting.add(p.id); continue; }
        // On the way to sit, or just up: on floor inside the door reaches.
        const [cx, cz] = cellOf(g, p), k = cellIndex(g, cx, cz);
        if ((p.rest || sitting.delete(p.id)) && (isBlocked(g, cx, cz) || !g.inside[k] || !reach[k])) lost ||= `${p.state} at ${JSON.stringify(toLocal(s.shop, p.x, p.z))}`;
      }
    }
    expect(lost).toBe('');
    expect(sat).toBeGreaterThan(0);
  });

  it('nobody asks at a help desk walled in where nobody can get to it', () => {
    const s = shop(41);
    s.cash = 50000;
    // In the front-left corner, walls on its two open sides.
    for (const [type, x, z, rot] of [['desk', -2.5, -1, 1], ['wall', -1.5, -1, 0], ['wall', -2.5, -2, 0]] as const) expect(applyCommand(s, { type: 'placeFixture', fixtureType: type, x, z, rot }).ok, type).toBe(true);
    const shelved = new Set(s.shop.fixtures.flatMap((f) => f.slots.map((sl) => sl.productId)));
    const extra = PRODUCTS.find((p) => !shelved.has(p.id) && !p.chilled)!.id;
    s.shop.storage.push({ productId: extra, qty: 20, day: s.day });
    s.people = s.people.filter((p) => p.kind === 'owner');
    s.phase = 'open';
    let asked = false, lost = '';
    for (let i = 0; i < 120 / TICK; i++) {
      if (i % 100 === 0) { const p = spawnCustomer(s, true); if (p) p.list = [{ productId: extra, qty: 1 }]; }
      tick(s);
      if (i % 4 === 0) applyCommand(s, { type: 'scan' });
      const g = gridFor(s);
      for (const p of s.people) {
        if (p.rest?.kind === 'desk') asked = true;
        const [cx, cz] = cellOf(g, p);
        if (p.kind === 'customer' && isBlocked(g, cx, cz) && Math.abs(toLocal(s.shop, p.x, p.z).x) < 6 && toLocal(s.shop, p.x, p.z).z < 0) lost ||= `${p.state} at ${JSON.stringify(toLocal(s.shop, p.x, p.z))}`;
      }
    }
    expect(asked).toBe(false);
    expect(lost).toBe('');
    expect(s.today.missedItems).toBeGreaterThan(0);
  });
});
