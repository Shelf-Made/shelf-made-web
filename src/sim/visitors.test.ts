import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, TICK, applyCommand } from './index';
import { companyOf, onScooter, noveltyOf, stepRoundCrowd, maybeLitter } from './visitors';
import { spawnCustomer, addLitter, startLeaving, doorOutside } from './people';
import { makeCandidate } from './staff';
import type { Fixture, GameState, Person } from './types';
import { fixtureAccessWorld, fixtureCentre, nearestWalkable } from './grid';
import { gridFor } from './state';
import { toWorld } from './layout';

/** A shopper just done at this shelf, standing where shoppers stand at it. */
function atShelf(s: GameState, shelf: Fixture): Person {
  const p = spawnCustomer(s, true)!;
  const at = fixtureAccessWorld(s.shop, shelf, p, gridFor(s));
  p.x = at.x; p.z = at.z;
  return p;
}

describe('who comes through the door', () => {
  it('some bring a child or a partner, some regulars ride a scooter, and once in a long while someone unexpected', () => {
    const people = Array.from({ length: 4000 }, (_, id) => ({ id, kind: 'customer', ctype: id % 2 ? 'loyalist' : 'convenience' } as Person));
    const kids = people.filter((p) => companyOf(p).kids > 0).length, partners = people.filter((p) => companyOf(p).partner).length;
    expect(kids / people.length).toBeGreaterThan(0.08);
    expect(kids / people.length).toBeLessThan(0.3);
    expect(partners / people.length).toBeGreaterThan(0.05);
    const scoot = people.filter((p) => onScooter(p)).length;
    expect(scoot).toBeGreaterThan(0);
    expect(people.filter((p) => p.ctype !== 'loyalist' && onScooter(p)).length).toBe(0);
    const odd = people.filter((p) => noveltyOf(p)).length;
    expect(odd).toBeGreaterThan(0);
    expect(odd / people.length).toBeLessThan(0.02);
    // Thieves come alone, and so do cyclists (who never ride a scooter as well, riding home either).
    expect(companyOf({ id: 3, kind: 'customer', thief: true } as Person)).toEqual({ kids: 0, partner: false });
    const family = people.find((p) => companyOf(p).kids > 0)!, scooter = people.find((p) => onScooter(p))!;
    expect(companyOf({ ...family, bike: { rackId: 1, slot: 0 } })).toEqual({ kids: 0, partner: false });
    expect(companyOf({ ...family, riding: true })).toEqual({ kids: 0, partner: false });
    expect(onScooter({ ...scooter, riding: true })).toBe(false);
  });

  it('a shopper steps round a crowd at a shelf to shop the rest of the list first, twice a visit at most', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    s.people = s.people.filter((p) => p.kind !== 'customer');
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    const p = spawnCustomer(s, true)!;
    p.list = [{ productId: 'bread', qty: 1 }, { productId: 'milk', qty: 1 }]; p.listIdx = 0;
    expect(stepRoundCrowd(s, p, shelf)).toBe(false);
    // Two others at the shelf already: the list turns round.
    const spot = fixtureAccessWorld(s.shop, shelf, p, gridFor(s));
    for (let i = 0; i < 2; i++) { const q = spawnCustomer(s, true)!; q.state = 'browsing'; q.x = spot.x; q.z = spot.z; }
    expect(stepRoundCrowd(s, p, shelf)).toBe(true);
    expect(p.list.map((x) => x.productId)).toEqual(['milk', 'bread']);
    // Twice a visit at most.
    expect(stepRoundCrowd(s, p, shelf)).toBe(true);
    expect(stepRoundCrowd(s, p, shelf)).toBe(false);
  });

  it('drop the odd wrapper while they shop, fewer near a bin', () => {
    const run = (bin: boolean) => {
      const s = openGame({ seed: 30, plotId: 'main', name: 'T', tutorial: false });
      s.day = 3; s.cash = 5000;
      const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
      if (bin) {
        // On the free tile nearest the shelf.
        const fl = s.shop.floor, tiles: [number, number][] = [];
        for (let z = fl.z0; z < fl.z1; z++) for (let x = fl.x0; x < fl.x1; x++) tiles.push([x, z]);
        tiles.sort((a, b) => Math.hypot(a[0] - shelf.x, a[1] - shelf.z) - Math.hypot(b[0] - shelf.x, b[1] - shelf.z));
        expect(tiles.some(([x, z]) => applyCommand(s, { type: 'placeFixture', fixtureType: 'bin', x, z, rot: 0 }).ok)).toBe(true);
      }
      const p = atShelf(s, shelf);
      let drops = 0;
      for (let i = 0; i < 2000; i++) { maybeLitter(s, p, shelf); drops += s.shop.litter.length; s.shop.litter = []; }
      return drops;
    };
    const without = run(false), withBin = run(true);
    expect(withBin).toBeGreaterThan(0);
    expect(withBin).toBeLessThan(without / 2);
  });

  it('litter takes a little off the shop, and mopping it up gives just that back: a bin never leaves a shop dirtier', () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'T', tutorial: false });
    s.day = 3; s.cash = 5000;
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    const p = atShelf(s, shelf);
    const drop = () => { for (let i = 0; i < 5000 && !s.shop.litter.length; i++) maybeLitter(s, p, shelf); return s.shop.litter[0]!; };
    // A wrapper: a hundredth off, and a hundredth back when the manager picks it up.
    s.shop.cleanliness = 0.9;
    const w = drop();
    expect(s.shop.cleanliness).toBeCloseTo(0.89, 10);
    expect(applyCommand(s, { type: 'clean', litterId: w.id }).ok).toBe(true);
    expect(s.shop.cleanliness).toBeCloseTo(0.9, 10);
    // An angry walkout's spill: six hundredths, and just that back when the cleaner mops it.
    const c = makeCandidate(s, 'cleaner'); s.staffPool.push(c);
    expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
    s.people = s.people.filter((x) => x.kind !== 'customer');
    const angry = spawnCustomer(s, true)!, spot = nearestWalkable(gridFor(s), toWorld(s.shop, (s.shop.floor.x0 + s.shop.floor.x1) / 2, (s.shop.floor.z0 + s.shop.floor.z1) / 2));
    angry.x = spot.x; angry.z = spot.z; angry.basket = [{ productId: shelf.slots.find((x) => x.productId)!.productId!, qty: 1, price: 2 }];
    startLeaving(s, angry, false);
    expect(s.shop.litter.length).toBe(1);
    expect(s.shop.cleanliness).toBeCloseTo(0.84, 10);
    let before = s.shop.cleanliness;
    for (let i = 0; i < 60 / TICK && s.shop.litter.length; i++) { s.people = s.people.filter((x) => x.kind !== 'customer'); before = s.shop.cleanliness; tick(s); }
    expect(s.shop.litter.length).toBe(0);
    expect(s.shop.cleanliness - before).toBeCloseTo(0.06, 10);
    // Down at the floor (0.2) a wrapper takes nothing, so picking it up gives nothing.
    s.shop.cleanliness = 0.2;
    expect(applyCommand(s, { type: 'clean', litterId: drop().id }).ok).toBe(true);
    expect(s.shop.cleanliness).toBe(0.2);
    // A piece from an older save (nothing recorded) gives what a mop always gave.
    s.shop.litter.push({ id: 99999, x: p.x, z: p.z });
    applyCommand(s, { type: 'clean', litterId: 99999 });
    expect(s.shop.cleanliness).toBeCloseTo(0.28, 10);
  });

  it('wrappers land only on open floor in the shop, six pieces at most (as many as are drawn)', () => {
    const s = openGame({ seed: 32, plotId: 'main', name: 'T', tutorial: false });
    s.day = 3; s.shop.cleanliness = 0.9;
    const shelf = s.shop.fixtures.find((f) => f.type === 'shelf')!;
    const p = atShelf(s, shelf);
    for (let i = 0; i < 3000; i++) maybeLitter(s, p, shelf);
    expect(s.shop.litter.length).toBe(6);
    // What they took is what mopping them all gives back.
    expect(0.9 - s.shop.cleanliness).toBeCloseTo(s.shop.litter.reduce((a, l) => a + (l.dirt ?? 0), 0), 10);
    expect(0.9 - s.shop.cleanliness).toBeCloseTo(0.06, 10);
    // Under a piece, or out on the pavement: nothing lands.
    s.shop.litter = [];
    const under = fixtureCentre(s.shop, shelf), out = doorOutside(s);
    expect(addLitter(s, under.x, under.z, 0.01)).toBe(false);
    expect(addLitter(s, out.x, out.z, 0.01)).toBe(false);
    expect(s.shop.litter.length).toBe(0);
  });
});
