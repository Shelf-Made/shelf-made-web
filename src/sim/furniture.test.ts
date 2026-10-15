import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, FIXTURES, type GameState } from './index';
import { openGame } from './testUtil';
import { FURNITURE_USE, queueDrain, thiefFactor, grimeFactor, tillExtras } from './furniture';
import { spawnCustomer } from './people';
import { PRODUCTS } from './products';

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
});
