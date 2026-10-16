import { describe, it, expect } from 'vitest';
import { applyCommand, type GameState } from './index';
import { openGame } from './testUtil';
import { storeysOf, zOnLevel, tileKey, highCeilings, tilePrice, tilePriceAt, floorTileCount, levelTileList, RESALE } from './layout';
import { canBuyTile, canSellTile, canPaintFloor, floorCost, styleAt } from './build';
import { PANEL_PRICE } from './storeys';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
  s.cash = 50000;
  return s;
}
const place = (s: GameState, fixtureType: 'stairs' | 'wallLight' | 'elevator', x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });

describe('upstairs as the shop grows', () => {
  it('grows every open floor with a tile bought, and the lights on its walls move out with them', () => {
    const s = shop(81);
    // Three floors: stairs on the ground floor, and on the first.
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    expect(place(s, 'stairs', -0.5, zOnLevel(-2, 1), 0).ok).toBe(true);
    expect(storeysOf(s.shop).top).toBe(2);
    // A wall light on the left wall of every floor.
    for (const L of [0, 1, 2]) expect(place(s, 'wallLight', -2.5, zOnLevel(-2, L), 1).ok, `floor ${L}`).toBe(true);
    // Its panels over the two floors up there are paid for, at the panel price, as any panel is.
    const check = canBuyTile(s, -3.5, -2), cash = s.cash;
    expect(check.price).toBe(tilePrice(s.shop) + 2 * PANEL_PRICE);
    expect(check.reason).toBe('More floor, and 2 ceiling panels over it upstairs');
    expect(applyCommand(s, { type: 'buyTile', x: -3.5, z: -2 }).ok).toBe(true);
    expect(s.cash).toBe(cash - check.price);
    // The tile is floor on every open floor, under a ceiling like the rest.
    const st = storeysOf(s.shop);
    for (const L of [0, 1, 2]) expect(st.floors[L]!.has(tileKey(-3.5, -2)), `floor ${L}`).toBe(true);
    expect(s.shop.ceilings!.slice(0, 3).every((row) => row.includes(tileKey(-3.5, -2)))).toBe(true);
    // Each light went out with its wall.
    expect(s.shop.fixtures.filter((f) => f.type === 'wallLight').map((f) => f.x)).toEqual([-3.5, -3.5, -3.5]);
    // Sold back (the lights moved off it first), it pays 60% of all of it: never more than it cost.
    for (const f of s.shop.fixtures.filter((q) => q.type === 'wallLight')) expect(applyCommand(s, { type: 'removeFixture', fixtureId: f.id }).ok).toBe(true);
    const sale = canSellTile(s, -3.5, -2);
    expect(sale.price).toBe(-Math.round(RESALE * (check.price - 2 * PANEL_PRICE)) - 2 * Math.round(RESALE * PANEL_PRICE));
    expect(-sale.price).toBeLessThan(check.price);
  });

  it('charges a shop grown in one go for the panels it puts up over its new tiles upstairs', () => {
    const s = shop(81);
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    const n = floorTileCount(s.shop), cash = s.cash;
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    const added = floorTileCount(s.shop) - n;
    let tiles = 0;
    for (let i = 0; i < added; i++) tiles += tilePriceAt(n + i);
    expect(s.cash).toBe(cash - tiles - added * PANEL_PRICE);
    expect(s.shop.ceilings![1]!.length).toBe(30 + added);
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

describe('finishes upstairs', () => {
  it('lays new floor up there bare, whatever the shop-wide finish, and a shut floor keeps what it had', () => {
    const s = shop(83);
    expect(applyCommand(s, { type: 'setFloor', style: 'wood' }).ok).toBe(true);
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    // The floor the stairs open comes in lino, as a tile bought does: no boards for nothing (to sell back as lino is laid).
    const up = levelTileList(s.shop, 1);
    expect(up.every((t) => styleAt(s.shop, t.x, t.z) === 'lino')).toBe(true);
    expect(canPaintFloor(s, up[0]!.x, up[0]!.z, 'lino').ok).toBe(false);
    // Stone laid on two tiles up there; one of them has its panel taken down and put back: bare again.
    const kept = { x: -2.5, z: zOnLevel(-6, 1) }, gone = { x: 1.5, z: zOnLevel(-1, 1) };
    for (const t of [kept, gone]) expect(applyCommand(s, { type: 'paintFloor', ...t, style: 'stone' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: 1.5, z: -1 }).ok).toBe(true);
    expect(s.shop.tileStyles?.[tileKey(gone.x, gone.z)]).toBeUndefined();
    expect(applyCommand(s, { type: 'addPanel', x: 1.5, z: -1 }).ok).toBe(true);
    expect(styleAt(s.shop, gone.x, gone.z)).toBe('lino');
    // A tile bought: lino downstairs and up.
    expect(applyCommand(s, { type: 'buyTile', x: -3.5, z: -2 }).ok).toBe(true);
    expect(styleAt(s.shop, -3.5, -2)).toBe('lino');
    expect(styleAt(s.shop, -3.5, zOnLevel(-2, 1))).toBe('lino');
    // The floor shut, a whole-shop floor laid meanwhile (paid for downstairs only), and open again: as it was left.
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: stairs.id }).ok).toBe(true);
    const cash = s.cash, cost = floorCost(s, 'checker');
    expect(cost).toBe(5 * floorTileCount(s.shop));
    expect(applyCommand(s, { type: 'setFloor', style: 'checker' }).ok).toBe(true);
    expect(s.cash).toBe(cash - cost);
    expect(place(s, 'stairs', 0.5, -2, 0).ok).toBe(true);
    expect(styleAt(s.shop, kept.x, kept.z)).toBe('stone');
    expect(levelTileList(s.shop, 1).filter((t) => styleAt(s.shop, t.x, t.z) !== 'lino').length).toBe(1);
  });

  it('will not grow the shop with its delivery pallet where someone gets on a lift', () => {
    const s = shop(84);
    // Floor round to the back-left corner of the market hall, and a lift there stepped into from that corner.
    for (const [x, z] of [[-0.5, -7], [-1.5, -7], [-2.5, -7], [-3.5, -7], [-3.5, -8], [-2.5, -8]] as const) expect(applyCommand(s, { type: 'buyTile', x, z }).ok, `${x},${z}`).toBe(true);
    expect(place(s, 'elevator', -2.5, -8, 3).ok).toBe(true);
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'large' }).message).toBe('The delivery pallet would go where you get on the lift: move it first.');
    // Turned to be got on from the floor in front of it, it is out of the way.
    const lift = s.shop.fixtures.find((f) => f.type === 'elevator')!;
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: lift.id, x: -2.5, z: -8, rot: 0 }).ok).toBe(true);
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'large' }).ok).toBe(true);
  });
});
