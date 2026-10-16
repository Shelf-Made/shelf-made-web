import { describe, it, expect } from 'vitest';
import { newGame, applyCommand, tick, TICK, resetGridCache, type GameState } from './index';
import { canPlace } from './build';
import { lotAppeal } from './lot';
import { LOT_FRONT, PLOT_RECT, FRONT_WALK_Z, toLocal } from './layout';
import { expectedByType } from './customers';
import { placeOrder } from './economy';
import { spawnCustomer } from './people';
import { SIGN_TIERS, SLOGAN_MAX, LOADING_BAY_PRICE, BAY_ETA, CHARGE_FEE, BUS_PULL, signPrice, isElectric, chargersInUse, cleanSignText, SIGN_TEXT_MAX } from './frontage';
import { supplier } from './economy';
import type { Rot, FixtureType } from './types';

function shop(seed = 7): GameState {
  const s = newGame({ seed, plotId: 'main', name: 'Front' });
  resetGridCache();
  s.cash = 50000;
  return s;
}
const total = (s: GameState) => Object.values(expectedByType(s)).reduce((a, b) => a + b, 0);
/** The first lot tile (whole x, half z) the piece may stand on, preferring those that pass `want`. */
function spot(s: GameState, type: FixtureType, rot: Rot = 0, want: (x: number, z: number) => boolean = () => true): { x: number; z: number } {
  for (let z = Math.floor(PLOT_RECT.z0) + 0.5; z < LOT_FRONT; z++) for (let x = Math.ceil(PLOT_RECT.x0); x < PLOT_RECT.x1; x++) {
    if (want(x, z) && canPlace(s, type, x, z, rot).ok) return { x, z };
  }
  throw new Error(`nowhere for a ${type}`);
}

describe('the shop sign', () => {
  it('each sign up gets the shop noticed by more people, and costs the difference from the best one bought', () => {
    const s = shop();
    const base = total(s);
    expect(signPrice(s, 'neon')).toBe(SIGN_TIERS[2]!.price);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'signStyle', style: 'neon' }).ok).toBe(true);
    expect(cash - s.cash).toBe(SIGN_TIERS[2]!.price);
    expect(total(s) / base).toBeCloseTo(SIGN_TIERS[2]!.pull, 5);
    // The LED board on top of it: the difference only.
    expect(signPrice(s, 'led')).toBe(SIGN_TIERS[3]!.price - SIGN_TIERS[2]!.price);
    // Back down to painted letters and up again: free (it was bought).
    expect(applyCommand(s, { type: 'signStyle', style: 'classic' }).ok).toBe(true);
    expect(total(s)).toBeCloseTo(base, 5);
    const c2 = s.cash;
    expect(applyCommand(s, { type: 'signStyle', style: 'neon' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'signStyle', style: 'lit' }).ok).toBe(true);
    expect(s.cash).toBe(c2);
  });

  it('lit letters stay free with the Regulars goal, and nothing is bought without the cash', () => {
    const s = shop();
    s.goals.unlocked.push('signLit');
    expect(signPrice(s, 'lit')).toBe(0);
    expect(signPrice(s, 'neon')).toBe(SIGN_TIERS[2]!.price - SIGN_TIERS[1]!.price);
    s.cash = 10;
    expect(applyCommand(s, { type: 'signStyle', style: 'led' }).ok).toBe(false);
    expect(s.shop.signStyle ?? 'classic').toBe('classic');
  });

  it('a slogan is one tidy line, no longer than fits', () => {
    const s = shop();
    applyCommand(s, { type: 'setSlogan', text: '   Fresh   every\nday   ' });
    expect(s.shop.slogan).toBe('Fresh every day');
    applyCommand(s, { type: 'setSlogan', text: 'x'.repeat(80) });
    expect(s.shop.slogan!.length).toBe(SLOGAN_MAX);
    applyCommand(s, { type: 'setSlogan', text: '  ' });
    expect(s.shop.slogan).toBeUndefined();
  });

  it('an aisle sign takes your own words (and only an aisle sign)', () => {
    const s = shop();
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'sign', x: s.shop.floor.x0, z: s.shop.floor.z0 + 2, rot: 0 }).ok).toBe(true);
    const sign = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    expect(applyCommand(s, { type: 'setSignText', fixtureId: sign.id, text: 'Bakery this way!!!!!!!!!' }).ok).toBe(true);
    expect(sign.text).toBe(cleanSignText('Bakery this way!!!!!!!!!'));
    expect(sign.text!.length).toBeLessThanOrEqual(SIGN_TEXT_MAX);
    applyCommand(s, { type: 'setSignText', fixtureId: sign.id, text: '' });
    expect(sign.text).toBeUndefined();
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'plant', x: s.shop.floor.x0, z: s.shop.floor.z0 + 3, rot: 0 }).ok).toBe(true);
    const plant = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    expect(applyCommand(s, { type: 'setSignText', fixtureId: plant.id, text: 'Hi' }).ok).toBe(false);
  });
});

describe('the loading bay', () => {
  it('brings the truck sooner and unloads it faster', () => {
    const s = shop();
    s.phase = 'open';
    const slow = placeOrder(s, 'local', [{ productId: 'bread', qty: 10 }]);
    expect(typeof slow).not.toBe('string');
    expect(applyCommand(s, { type: 'buyLoadingBay' }).ok).toBe(true);
    expect(s.shop.loadingBay).toBe(true);
    expect(applyCommand(s, { type: 'buyLoadingBay' }).ok).toBe(false);
    const fast = placeOrder(s, 'local', [{ productId: 'milk', qty: 10 }]);
    if (typeof fast === 'string' || typeof slow === 'string') throw new Error('no order');
    expect(fast.eta).toBeCloseTo(supplier('local').etaSeconds * BAY_ETA, 5);
    expect(slow.eta).toBe(supplier('local').etaSeconds);
    expect(LOADING_BAY_PRICE).toBeGreaterThan(0);
  });
});

describe('car chargers', () => {
  it('stand where a bay is in reach; an electric car parked there plugs in and its driver pays', () => {
    const s = shop(11);
    // Nowhere near the car park: refused.
    const far = spot(s, 'tree', 0, (x) => x < -5);
    expect(canPlace(s, 'evCharger', far.x, far.z, 0).reason).toMatch(/beside the car park/);
    const at = spot(s, 'evCharger');
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'evCharger', x: at.x, z: at.z, rot: 0 }).ok).toBe(true);
    const charger = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    // Open, and let drivers come until an electric one has parked by it.
    applyCommand(s, { type: 'openShop' });
    s.phase = 'open';
    let plugged = false;
    for (let i = 0; i < 900 / TICK && !plugged; i++) {
      tick(s);
      plugged = s.cars.some((c) => c.charging === charger.id);
    }
    expect(plugged).toBe(true);
    const car = s.cars.find((c) => c.charging === charger.id)!;
    expect(isElectric(car)).toBe(true);
    expect(chargersInUse(s).has(charger.id)).toBe(true);
    expect(s.today.charging).toBeGreaterThanOrEqual(CHARGE_FEE);
  });
});

describe('your own bus stop', () => {
  it('goes by the sidewalk, side-on; brings more shoppers, some of them off the bus at your door', () => {
    const s = shop(13);
    const back = spot(s, 'tree', 0, (_x, z) => z < LOT_FRONT - 2);
    expect(canPlace(s, 'busStop', back.x, back.z, 0).ok).toBe(false);
    const at = spot(s, 'busStop', 0);
    expect(at.z + 1).toBeGreaterThan(LOT_FRONT - 0.5);
    expect(canPlace(s, 'busStop', at.x, at.z, 1).ok).toBe(false);
    const base = total(s);
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'busStop', x: at.x, z: at.z, rot: 0 }).ok).toBe(true);
    expect(total(s) / base).toBeCloseTo(BUS_PULL, 5);
    // Rush hour: of the shoppers on foot, a good share start at your stop.
    s.phase = 'open'; s.time = 20;
    let off = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      const p = spawnCustomer(s, true);
      if (!p || p.bike) continue;
      n++;
      const l = toLocal(s.shop, p.x, p.z);
      if (Math.abs(l.z - FRONT_WALK_Z) < 0.05 && Math.abs(l.x - (at.x + 1)) < 0.7) off++;
    }
    expect(n).toBeGreaterThan(20);
    expect(off / n).toBeGreaterThan(0.35);
    expect(off / n).toBeLessThan(0.85);
  });
});

describe('the new pieces for the lot', () => {
  it('each stands on the grass and makes the frontage nicer', () => {
    const s = shop(17);
    const before = lotAppeal(s.shop);
    for (const t of ['fountain', 'statue', 'lampPost', 'bollard', 'balloons', 'hedge'] as FixtureType[]) {
      const at = spot(s, t);
      expect(applyCommand(s, { type: 'placeFixture', fixtureType: t, x: at.x, z: at.z, rot: 0 }).ok, t).toBe(true);
    }
    expect(lotAppeal(s.shop)).toBeGreaterThan(before + 0.2);
  });
});
