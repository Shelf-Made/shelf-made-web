import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, TICK } from './index';
import { companyOf, onScooter, noveltyOf, stepRoundCrowd } from './visitors';
import { spawnCustomer } from './people';
import type { Person } from './types';
import { fixtureAccessWorld } from './grid';
import { gridFor } from './state';

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
    // Thieves come alone.
    expect(companyOf({ id: 3, kind: 'customer', thief: true } as Person)).toEqual({ kids: 0, partner: false });
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
      s.day = 3;
      if (!bin) s.shop.fixtures = s.shop.fixtures.filter((f) => f.type !== 'bin');
      let drops = 0, before = s.shop.litter.length;
      for (let i = 0; i < 400 / TICK; i++) { tick(s); drops += Math.max(0, s.shop.litter.length - before); before = s.shop.litter.length; }
      return drops;
    };
    expect(run(false)).toBeGreaterThanOrEqual(run(true));
  });
});
