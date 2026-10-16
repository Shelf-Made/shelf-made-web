import { describe, it, expect } from 'vitest';
import { applyCommand, type GameState } from './index';
import { openGame } from './testUtil';
import { storeysOf, zOnLevel, tileKey, highCeilings } from './layout';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
  s.cash = 50000;
  return s;
}
const place = (s: GameState, fixtureType: 'stairs' | 'wallLight', x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });

describe('upstairs as the shop grows', () => {
  it('grows every open floor with a tile bought, and the lights on its walls move out with them', () => {
    const s = shop(81);
    // Three floors: stairs on the ground floor, and on the first.
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    expect(place(s, 'stairs', -0.5, zOnLevel(-2, 1), 0).ok).toBe(true);
    expect(storeysOf(s.shop).top).toBe(2);
    // A wall light on the left wall of every floor.
    for (const L of [0, 1, 2]) expect(place(s, 'wallLight', -2.5, zOnLevel(-2, L), 1).ok, `floor ${L}`).toBe(true);
    expect(applyCommand(s, { type: 'buyTile', x: -3.5, z: -2 }).ok).toBe(true);
    // The tile is floor on every open floor, under a ceiling like the rest.
    const st = storeysOf(s.shop);
    for (const L of [0, 1, 2]) expect(st.floors[L]!.has(tileKey(-3.5, -2)), `floor ${L}`).toBe(true);
    expect(s.shop.ceilings!.slice(0, 3).every((row) => row.includes(tileKey(-3.5, -2)))).toBe(true);
    // Each light went out with its wall.
    expect(s.shop.fixtures.filter((f) => f.type === 'wallLight').map((f) => f.x)).toEqual([-3.5, -3.5, -3.5]);
  });

  it('a tile bought while a floor is shut is under its ceiling when the floor opens again', () => {
    const s = shop(81);
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: stairs.id }).ok).toBe(true);
    expect(storeysOf(s.shop).top).toBe(0);
    expect(applyCommand(s, { type: 'buyTile', x: -3.5, z: -2 }).ok).toBe(true);
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    // The first floor's ceiling kept its panels while it was shut, and grew with the shop: no lone double-height tile.
    expect(storeysOf(s.shop).floors[1]!.has(tileKey(-3.5, -2))).toBe(true);
    expect(s.shop.ceilings![1]!).toContain(tileKey(-3.5, -2));
    expect(highCeilings(s.shop)).toBe(0);
  });
});
