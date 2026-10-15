import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, type GameState } from './index';
import { openGame } from './testUtil';
import { storeysOf, zOnLevel, toWorld, MAX_LEVELS, levelTileList, wallSegments } from './layout';
import { fixtureFacingWorld } from './grid';
import { canPlace, canSellTile } from './build';
import { spawnCustomer } from './people';
import { levelOfPerson, canAddPanel, PANEL_PRICE } from './storeys';
import { gridFor } from './state';
import { findPath } from './pathfinding';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
  s.cash = 50000;
  return s;
}
const place = (s: GameState, fixtureType: Parameters<typeof canPlace>[1], x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
/** Stairs on floor `level` beside the counter, coming up a tile behind it. */
const STAIRS = { x: 0.5, z: -2 };

describe('building up', () => {
  it('opens the floor above with stairs, and only then takes shelves up there', () => {
    const s = shop(61);
    expect(storeysOf(s.shop).top).toBe(0);
    expect(canPlace(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).reason).toBe('Put in stairs up to this floor first');
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    const st = storeysOf(s.shop);
    expect(st.top).toBe(1);
    // The whole ground floor less the stairs' opening, under a ceiling of its own (no taller than a storey).
    expect(st.floors[1]!.size).toBe(30 - 2);
    expect(s.shop.ceilings![1]!.length).toBe(30);
    expect(st.inside[2]!.size).toBe(0);
    expect(canPlace(s, 'shelf', STAIRS.x, zOnLevel(STAIRS.z, 1), 0).ok).toBe(false);
    expect(place(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    // A shelf upstairs is reached by the stairs: the path rides them.
    const g = gridFor(s);
    const path = findPath(g, toWorld(s.shop, 0, -0.5), toWorld(s.shop, -1, zOnLevel(-3.5, 1)));
    expect(path).toBeTruthy();
    expect(path!.some((w) => w.ride !== undefined)).toBe(true);
    // The stairs cannot go while something stands upstairs.
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: stairs.id }).ok).toBe(false);
    // Finishes go on upstairs too: a tile of boards, a stretch of brick; the floor up there is not sold as tiles.
    expect(applyCommand(s, { type: 'paintFloor', x: -0.5, z: zOnLevel(-1, 1), style: 'wood' }).ok).toBe(true);
    expect(s.shop.tileStyles?.[`-0.5,${zOnLevel(-1, 1)}`]).toBe('wood');
    const up = wallSegments(s.shop).filter((w) => w.axis === 'x' ? w.line < -12 : w.t < -12);
    expect(up.length).toBe(22);
    expect(applyCommand(s, { type: 'paintWall', key: up[0]!.key, style: 'brick' }).ok).toBe(true);
    expect(canSellTile(s, -0.5, zOnLevel(-1, 1)).ok).toBe(false);
  });

  it('sends shoppers up the stairs for what is on the shelf up there, and back down to pay', () => {
    const s = shop(62);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    const up = s.shop.fixtures.find((f) => f.type === 'shelf' && f.z < -12)!;
    up.slots = up.slots.map(() => ({ productId: 'apples', qty: 8 }));
    s.phase = 'open';
    let upstairs = false, bought = false;
    for (let i = 0; i < 300 / TICK; i++) {
      if (i % 80 === 0 && s.people.filter((p) => p.kind === 'customer').length < 5) {
        const p = spawnCustomer(s, true);
        if (p) p.list = [{ productId: 'apples', qty: 1 }];
      }
      tick(s);
      if (i % 4 === 0) applyCommand(s, { type: 'scan' });
      for (const p of s.people) if (p.kind === 'customer' && levelOfPerson(s.shop, p) === 1) upstairs = true;
      if (s.today.revenue > 0 && up.slots.some((sl) => sl.qty < 8) && s.people.some((p) => p.kind === 'customer' && p.state === 'leaving' && p.basket?.some((b) => b.productId === 'apples'))) bought = true;
      if (upstairs && bought) break;
    }
    expect(upstairs).toBe(true);
    expect(bought).toBe(true);
    expect(s.stuckRescues).toBe(0);
  });

  it('carries the manager up the stairs when you walk into them, and down again', () => {
    const s = shop(63);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    const o = s.people.find((p) => p.kind === 'owner')!;
    const foot = toWorld(s.shop, STAIRS.x + 0.5, STAIRS.z + 1.5);
    o.x = o.px = foot.x; o.z = o.pz = foot.z;
    // Into the stairs: against the way they face.
    const into = fixtureFacingWorld(s.shop, 0);
    applyCommand(s, { type: 'moveDir', x: -into.x, z: -into.z });
    for (let i = 0; i < 5 / TICK && levelOfPerson(s.shop, o) === 0; i++) tick(s);
    expect(levelOfPerson(s.shop, o)).toBe(1);
    // Still pushing the same way at the top: off along the floor, not back down.
    for (let i = 0; i < 1 / TICK; i++) tick(s);
    expect(levelOfPerson(s.shop, o)).toBe(1);
    // Turn round and walk back into them: down.
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    const top = toWorld(s.shop, STAIRS.x + 0.5, zOnLevel(STAIRS.z - 1.5, 1));
    o.x = o.px = top.x; o.z = o.pz = top.z;
    applyCommand(s, { type: 'moveDir', x: into.x, z: into.z });
    for (let i = 0; i < 5 / TICK && levelOfPerson(s.shop, o) === 1; i++) tick(s);
    expect(levelOfPerson(s.shop, o)).toBe(0);
    // Use at the foot does the same; from across the room it will not.
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    o.x = o.px = foot.x - 3; o.z = o.pz = foot.z;
    expect(applyCommand(s, { type: 'ride', fixtureId: stairs.id }).ok).toBe(false);
    o.x = o.px = foot.x; o.z = o.pz = foot.z;
    expect(applyCommand(s, { type: 'ride', fixtureId: stairs.id }).ok).toBe(true);
    for (let i = 0; i < 5 / TICK && levelOfPerson(s.shop, o) === 0; i++) tick(s);
    expect(levelOfPerson(s.shop, o)).toBe(1);
  });

  it('sells ceiling panels for a double-height space with a tall wall in it, and buys them back', () => {
    const s = shop(64);
    const cash = s.cash;
    expect(canPlace(s, 'tallWall', -1.5, -1, 0).reason).toMatch(/open ceiling/);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -1 }).ok).toBe(true);
    expect(s.cash).toBe(cash + Math.round(PANEL_PRICE * 0.6));
    // A storey of room over it: the building stands taller there.
    expect(storeysOf(s.shop).inside[1]!.has('-1.5,-1')).toBe(true);
    expect(place(s, 'tallWall', -1.5, -1, 0).ok).toBe(true);
    expect(canAddPanel(s, -1.5, -1).reason).toBe('Something comes up through there');
    // Upstairs, once open, has no floor there.
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(storeysOf(s.shop).floors[1]!.has('-1.5,-1')).toBe(false);
    expect(applyCommand(s, { type: 'addPanel', x: -0.5, z: -1 }).ok).toBe(false); // has one already
    // Not with a shelf upstairs on it.
    expect(place(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -2.5, z: -4 }).message).toMatch(/upstairs/);
  });

  it('goes up five floors at most, each opened by its own flight', () => {
    const s = shop(65);
    for (let L = 0; L < MAX_LEVELS - 1; L++) {
      // Panels over this whole floor first (the ground floor has them).
      if (L > 0) for (const t of levelTileList(s.shop, 0)) if (canAddPanel(s, t.x, zOnLevel(t.z, L)).ok) expect(applyCommand(s, { type: 'addPanel', x: t.x, z: zOnLevel(t.z, L) }).ok).toBe(true);
      const x = L % 2 ? -0.5 : 0.5;
      const r = place(s, 'stairs', x, zOnLevel(STAIRS.z, L), 0);
      expect(r.message, `floor ${L}`).toBeUndefined();
    }
    expect(storeysOf(s.shop).top).toBe(MAX_LEVELS - 1);
    expect(canPlace(s, 'stairs', 0.5, zOnLevel(STAIRS.z, MAX_LEVELS - 1), 0).reason).toMatch(/most a shop can have/);
    expect(canAddPanel(s, 1.5, zOnLevel(-1, MAX_LEVELS - 1)).reason).toBe('This is the top floor');
    // The top floor is reached from the door.
    const g = gridFor(s);
    expect(findPath(g, toWorld(s.shop, 0, -0.5), toWorld(s.shop, -2, zOnLevel(-0.5, MAX_LEVELS - 1)))).toBeTruthy();
  });
});
