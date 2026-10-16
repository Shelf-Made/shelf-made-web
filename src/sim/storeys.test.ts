import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, type GameState, type FixtureType } from './index';
import { openGame } from './testUtil';
import { storeysOf, zOnLevel, toWorld, MAX_LEVELS, levelTileList, wallSegments, levelOf, FIXTURES, FLOORS, RESALE, floorTileCount, tilePriceAt, VERTICAL, MAX_FLOOR, rideEnds, panelsOver, tileKey } from './layout';
import { fixtureFacingWorld, lineClear, isBlocked, cellOf } from './grid';
import { canPlace, canSellTile, floorCost, grownCeilings, styleAt } from './build';
import { spawnCustomer, setPath, doorInside, addSpill } from './people';
import { levelOfPerson, canAddPanel, canRemovePanel, ensureCeilings, PANEL_PRICE } from './storeys';
import { looksOf } from './reviews';
import { Rng } from './rng';
import { gridFor } from './state';
import { findPath } from './pathfinding';
import { dollars } from './money';
import { makeCandidate } from './staff';

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

/** The manager out of the way, on the pavement by the door. */
function aside(s: GameState): void {
  const o = s.people.find((p) => p.kind === 'owner')!;
  const at = toWorld(s.shop, s.shop.door.x, s.shop.floor.z1 + 0.8);
  o.x = o.px = at.x; o.z = o.pz = at.z;
}
const idOf = (s: GameState, type: string, level = 0) => s.shop.fixtures.find((f) => f.type === type && levelOf(f) === level)!.id;
/** A second flight on the ground floor, left of the first: its foot on (-0.5, -2), coming up onto (-0.5, -5). */
const SECOND = { x: -0.5, z: -3 };
/** Floor 1's left strip hanging from one tile: every panel along x = -1.5 down but the one at z = -4. */
function corridor(s: GameState): void {
  for (const z of [-6, -5, -3, -2, -1]) expect(applyCommand(s, { type: 'removePanel', x: -1.5, z }).ok, `panel at ${z}`).toBe(true);
}

describe('building up: nothing cut off, nothing for free', () => {
  it('will not sell a tile of floor the way up needs', () => {
    const s = shop(71); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    // The foot of the stairs.
    expect(canSellTile(s, 0.5, -1).reason).toBe('You step onto the stairs from it');
    // A tile the floor above hangs from (the panels round it down): the shelf up there would be cut off.
    corridor(s);
    expect(canSellTile(s, -1.5, -4).reason).toBe('Would cut off the shelf upstairs');
    expect(canSellTile(s, 1.5, -1).ok).toBe(true);
  });

  it('judges each panel by itself, not by the last one pointed at', () => {
    const s = shop(70); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(place(s, 'shelf', -2.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    corridor(s);
    // Pointed at a panel that may go, then clicked on the one the shelf's strip hangs from.
    expect(canRemovePanel(s, -0.5, -1).ok).toBe(true);
    expect(applyCommand(s, { type: 'removePanel', x: -1.5, z: -4 }).message).toBe('Would cut off the shelf upstairs');
    expect(s.shop.ceilings![0]!.includes('-1.5,-4')).toBe(true);
  });

  it('works out the floors of each trial layout from its own panels, however like another it is', () => {
    const s = shop(69); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // Two panels sold, one each: the same pieces, the same layout version, as many panels.
    const less = (k: string) => ({ ...s.shop, ceilings: ensureCeilings(s.shop).map((r, L) => L ? r : r.filter((t) => t !== k)) });
    const a = less('-1.5,-4'), b = less('-1.5,-5');
    expect(storeysOf(a).floors[1]!.has('-1.5,-4')).toBe(false);
    expect(storeysOf(b).floors[1]!.has('-1.5,-4')).toBe(true);
    expect(storeysOf(b).floors[1]!.has('-1.5,-5')).toBe(false);
  });

  it('puts the foot of the stairs on the floor inside, never out through a wall', () => {
    const s = shop(72); aside(s);
    // Facing out through the front wall (the foot on the pavement), or the side wall (by the parking).
    expect(canPlace(s, 'stairs', 1.5, -1, 0).reason).toBe('Turn it to step on from the floor');
    expect(canPlace(s, 'escalator', 1.5, -4, 1).reason).toBe('Turn it to step on from the floor');
    expect(canPlace(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
  });

  it('keeps every way up working, judging only the ways up there are', () => {
    const s = shop(73); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // A second flight with a plant on its foot: nobody could get on it (the first one is no excuse).
    expect(place(s, 'plant', SECOND.x, SECOND.z + 1, 0).ok).toBe(true);
    expect(canPlace(s, 'stairs', SECOND.x, SECOND.z, 0).reason).toBe('Nobody could get on it from inside');
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: idOf(s, 'plant') }).ok).toBe(true);
    // In properly, nothing may then stand on its foot.
    expect(place(s, 'stairs', SECOND.x, SECOND.z, 0).ok).toBe(true);
    expect(canPlace(s, 'plant', SECOND.x, SECOND.z + 1, 0).reason).toBe('Would block the way up');
    // A flight left blocked (an older save): selling the one that works would leave the floor above with no way up...
    s.shop.fixtures.push({ id: s.nextId++, type: 'plant', x: SECOND.x, z: SECOND.z + 1, rot: 0, slots: [] });
    s.shop.layoutVersion++;
    const first = s.shop.fixtures.find((f) => f.type === 'stairs' && f.x === STAIRS.x)!;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: first.id }).message).toBe('Would cut off the 1st floor.');
    // ...and with that one gone too, the blocked one stops nobody building.
    s.shop.fixtures = s.shop.fixtures.filter((f) => f !== first);
    s.shop.layoutVersion++;
    expect(canPlace(s, 'shelf', 1.5, -5, 3).ok).toBe(true);
  });

  it('will not move the stairs out from under a floor with anything or anyone on it', () => {
    const s = shop(74); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // Not up onto the floor they open.
    const first = idOf(s, 'stairs');
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: first, x: SECOND.x, z: zOnLevel(SECOND.z, 1), rot: 0 }).ok).toBe(false);
    // A flight on the first floor opens the second; a plant goes up there.
    expect(place(s, 'stairs', SECOND.x, zOnLevel(SECOND.z, 1), 0).ok).toBe(true);
    expect(place(s, 'plant', -1.5, zOnLevel(-5, 2), 0).ok).toBe(true);
    const up = idOf(s, 'stairs', 1);
    // Down to the ground floor, it would close the second floor with the plant on it: refused, as selling is.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: up }).message).toMatch(/only way up/);
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: up, x: SECOND.x, z: SECOND.z, rot: 0 }).message).toMatch(/only way up/);
    // A shopper up there instead of the plant: the same.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: idOf(s, 'plant', 2) }).ok).toBe(true);
    const p = spawnCustomer(s, true)!;
    const at = toWorld(s.shop, -1, zOnLevel(-4.5, 2));
    p.x = p.px = at.x; p.z = p.pz = at.z; p.path = []; p.pathIdx = 0;
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: up, x: SECOND.x, z: SECOND.z, rot: 0 }).message).toBe('Someone is upstairs');
    // Turned where it stands it still goes up: fine.
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: up, x: SECOND.x, z: zOnLevel(SECOND.z - 1, 1), rot: 2 }).message).toBeUndefined();
  });

  it('sells the stairs from under someone on the way up: they go round by another, or stop downstairs', () => {
    const s = shop(75); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(place(s, 'stairs', SECOND.x, SECOND.z, 0).ok).toBe(true);
    const p = spawnCustomer(s, true)!;
    const at = toWorld(s.shop, 1, -0.5);
    // In the shop (off the street's crossings).
    p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined;
    expect(setPath(s, p, toWorld(s.shop, -1, zOnLevel(-2.5, 1)))).toBe(true);
    // The one they are on their way to goes first.
    const first = p.path.find((w) => w.ride !== undefined)!.via!, second = s.shop.fixtures.find((f) => f.type === 'stairs' && f.id !== first)!.id;
    // With another way up, it goes, and they take that one instead.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: first }).ok).toBe(true);
    expect(p.path.slice(p.pathIdx).some((w) => w.via === first)).toBe(false);
    expect(p.path.slice(p.pathIdx).some((w) => w.via === second)).toBe(true);
    // The last one goes too (nothing up there): they stop where they are, never up on a floor that has shut.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: second }).ok).toBe(true);
    expect(p.path.length - p.pathIdx).toBe(0);
    expect(levelOfPerson(s.shop, p)).toBe(0);
  });

  it('puts a ceiling over a floor it opens, at the panel price, however it opens', () => {
    const s = shop(76); aside(s);
    let cash = s.cash;
    expect(canPlace(s, 'stairs', STAIRS.x, STAIRS.z, 0).price).toBe(450 + 30 * PANEL_PRICE);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    expect(s.cash).toBe(cash - 450 - 30 * PANEL_PRICE);
    expect(s.shop.ceilings![1]!.length).toBe(30);
    // A second flight up to the same floor: nothing more.
    cash = s.cash;
    expect(place(s, 'stairs', SECOND.x, SECOND.z, 0).ok).toBe(true);
    expect(s.cash).toBe(cash - 450);
    // Moved up a floor, it opens the second floor: that gets its ceiling as well.
    cash = s.cash;
    const second = s.shop.fixtures.find((f) => f.type === 'stairs' && f.x === SECOND.x)!.id;
    expect(applyCommand(s, { type: 'moveFixture', fixtureId: second, x: SECOND.x, z: zOnLevel(SECOND.z, 1), rot: 0 }).message).toBeUndefined();
    const st = storeysOf(s.shop), n = st.floors[2]!.size + st.holes[2]!.size;
    expect(st.top).toBe(2);
    expect(s.shop.ceilings![2]!.length).toBe(n);
    expect(s.cash).toBe(cash - n * PANEL_PRICE);
    // Shown going, as placing shows the price.
    expect(s.popups[s.popups.length - 1]!.text).toBe(dollars(-n * PANEL_PRICE));
  });

  it('pays back the panels over a tile sold, on the floors above, as taking them down would', () => {
    const s = shop(87); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // The panel over it downstairs came with the tile; the one over it upstairs was bought.
    const tile = Math.round(RESALE * tilePriceAt(floorTileCount(s.shop) - 1)), panel = Math.round(RESALE * PANEL_PRICE);
    expect(canSellTile(s, 1.5, -5).price).toBe(-(tile + panel));
    const cash = s.cash;
    expect(applyCommand(s, { type: 'sellTile', x: 1.5, z: -5 }).ok).toBe(true);
    expect(s.cash).toBe(cash + tile + panel);
    expect(s.shop.ceilings![1]!.includes('1.5,-5')).toBe(false);
  });

  it('never pays out for going round: sell the panels, sell the stairs, put them back', () => {
    const s = shop(77); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    for (let loop = 0; loop < 3; loop++) {
      const cash = s.cash;
      for (const k of [...s.shop.ceilings![1]!]) { const [x, z] = k.split(',').map(Number) as [number, number]; expect(applyCommand(s, { type: 'removePanel', x, z: zOnLevel(z, 1) }).ok).toBe(true); }
      expect(applyCommand(s, { type: 'removeFixture', fixtureId: idOf(s, 'stairs') }).ok).toBe(true);
      expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
      expect(s.cash, `loop ${loop}`).toBeLessThan(cash);
    }
  });

  it('never makes money, whatever is built, moved and sold in whatever order', () => {
    // What everything would fetch sold back now, on top of the cash: no build action may raise it.
    const worth = (s: GameState) => {
      let w = s.cash + s.shop.fixtures.reduce((a, f) => a + Math.round(FIXTURES[f.type].price * RESALE), 0);
      w += ensureCeilings(s.shop).reduce((a, r) => a + r.length, 0) * Math.round(RESALE * PANEL_PRICE);
      for (let m = 1; m <= floorTileCount(s.shop); m++) w += Math.round(RESALE * tilePriceAt(m - 1));
      // The finishes, on every tile in use and those kept for when they are back (a floor shut, a flight over them).
      const st = storeysOf(s.shop), resale = (id?: string) => Math.round(RESALE * (FLOORS.find((f) => f.id === id)?.perTile ?? 0));
      for (let L = 0; L < MAX_LEVELS; L++) for (const k of L ? panelsOver(s.shop, L - 1) : st.floors[0]!) {
        const [x, z] = k.split(',').map(Number) as [number, number], at = { x, z: zOnLevel(z, L) };
        w += resale(st.floors[L]!.has(k) ? styleAt(s.shop, at.x, at.z) : s.shop.tileStyles?.[tileKey(at.x, at.z)]);
      }
      return w;
    };
    // Floors opened along the way, the most open at once, and the shop grown and sold with floors up there, over
    // every run: it has to be tried, not just pass.
    let done = 0, top = 0, opened = 0, grownUp = 0, soldUp = 0, ups = 0, laid = 0;
    for (const seed of [81, 82, 83, 84]) {
      const s = shop(seed); aside(s);
      const r = new Rng(seed);
      const flights = () => s.shop.fixtures.filter((f) => VERTICAL.has(f.type));
      // Somewhere on an open floor a piece will go (or the last place tried), a panel there is, a tile of the plot.
      const spot = (type: FixtureType, id?: number) => {
        let at = { x: 0, z: 0, rot: 0 as 0 | 1 | 2 | 3 };
        for (let k = 0; k < 30; k++) {
          const t = r.pick(levelTileList(s.shop, r.int(0, storeysOf(s.shop).top)));
          at = { ...t, rot: r.int(0, 3) as 0 | 1 | 2 | 3 };
          if (canPlace(s, type, at.x, at.z, at.rot, id).ok) break;
        }
        return at;
      };
      const panels = (L: number) => ensureCeilings(s.shop)[L]!.map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return { x, z: zOnLevel(z, L) }; });
      const plot = () => ({ x: MAX_FLOOR.x0 + r.int(0, 8), z: MAX_FLOOR.z0 + r.int(0, 7) });
      let was = worth(s);
      for (let i = 0; i < 160; i++) {
        const a = r.int(0, 12), f = flights().length ? r.pick(flights()) : null, type = r.pick(['stairs', 'stairs', 'escalator', 'elevator'] as const);
        const before = storeysOf(s.shop).top, upRows = grownCeilings(s.shop).length;
        let ok = false;
        if (a <= 2) { const at = spot(type); ok = place(s, type, at.x, at.z, at.rot).ok; }
        else if (a === 3 && f) ok = applyCommand(s, { type: 'removeFixture', fixtureId: f.id }).ok;
        else if (a === 4 && f) { const at = spot(f.type, f.id); ok = applyCommand(s, { type: 'moveFixture', fixtureId: f.id, x: at.x, z: at.z, rot: at.rot }).ok; }
        else if (a === 5) { const at = spot('plant'); ok = applyCommand(s, { type: 'addPanel', x: at.x, z: at.z }).ok; }
        else if (a === 6) { const row = panels(r.int(0, MAX_LEVELS - 2)); if (row.length) { const at = r.pick(row); ok = applyCommand(s, { type: 'removePanel', x: at.x, z: at.z }).ok; } }
        // A whole ceiling over a floor above sold (the free-money loop sold them all).
        else if (a === 7) for (const at of panels(r.int(1, MAX_LEVELS - 2))) ok = applyCommand(s, { type: 'removePanel', x: at.x, z: at.z }).ok || ok;
        else if (a === 8) { const at = plot(); ok = applyCommand(s, { type: 'buyTile', x: at.x, z: at.z }).ok; if (ok && upRows) grownUp++; }
        else if (a === 9) { const at = plot(), over = s.shop.ceilings?.slice(1).some((row) => row.includes(`${at.x},${at.z}`)); ok = applyCommand(s, { type: 'sellTile', x: at.x, z: at.z }).ok; if (ok && over) soldUp++; }
        // The whole shop grown at once (the older shortcut), panels upstairs and all.
        else if (a === 10) { ok = applyCommand(s, { type: 'expandShop', sizeId: r.pick(['medium', 'large']) }).ok; if (ok && upRows) grownUp++; }
        // A finish laid on a tile, or over the whole shop (what new floor comes in, and what a shut floor keeps).
        else if (a === 11) { const at = r.pick(levelTileList(s.shop, r.int(0, storeysOf(s.shop).top))); ok = applyCommand(s, { type: 'paintFloor', x: at.x, z: at.z, style: r.pick(FLOORS).id }).ok; if (ok) laid++; }
        else { ok = applyCommand(s, { type: 'setFloor', style: r.pick(FLOORS).id }).ok; if (ok) laid++; }
        if (ok) done++;
        if (ok && a <= 4) ups++;
        const st = storeysOf(s.shop);
        if (st.top > before) opened++;
        top = Math.max(top, st.top);
        const now = worth(s);
        expect(now, `seed ${seed}, step ${i}, action ${a}`).toBeLessThanOrEqual(was);
        was = now;
        // Nor is any floor that is open ever left with no way up to it from the door.
        for (let L = 1; L <= st.top; L++) expect(flights().some((u) => levelOf(u) === L - 1 && !!findPath(gridFor(s), doorInside(s), toWorld(s.shop, rideEnds(u).top.x, rideEnds(u).top.z))), `seed ${seed}, step ${i}, floor ${L}`).toBe(true);
      }
    }
    expect(done).toBeGreaterThan(120);
    expect(top).toBeGreaterThanOrEqual(3);
    expect(opened).toBeGreaterThanOrEqual(8);
    expect(ups).toBeGreaterThanOrEqual(100);
    expect(grownUp).toBeGreaterThanOrEqual(8);
    expect(soldUp).toBeGreaterThanOrEqual(5);
    expect(laid).toBeGreaterThanOrEqual(20);
  });

  it('counts the finish upstairs toward how the shop looks, and prices it in a whole-shop floor', () => {
    const s = shop(78); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    const before = looksOf(s).extras, up = levelTileList(s.shop, 1);
    for (const t of up) expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'wood' }).ok).toBe(true);
    expect(looksOf(s).extras).toBeGreaterThan(before);
    expect(floorCost(s, 'wood')).toBe(7 * 30);
    expect(floorCost(s, 'stone')).toBe(9 * (30 + up.length));
  });
});

describe('building up: nobody caught halfway, nothing left behind', () => {
  /** A shopper by the stairs set off for `to`, and halfway up the first ride on the way. */
  const climber = (s: GameState, to: { x: number; z: number }) => {
    const p = spawnCustomer(s, true)!;
    const at = toWorld(s.shop, 1, -0.6);
    p.x = p.px = at.x; p.z = p.pz = at.z; p.xings = undefined;
    expect(setPath(s, p, to)).toBe(true);
    s.phase = 'open'; p.state = 'browsing'; p.timer = -1; p.list = [{ productId: 'apples', qty: 1 }]; p.listIdx = 0;
    p.pathIdx = p.path.findIndex((w) => w.ride !== undefined); p.climb = 0.1;
    return p;
  };

  it('sells a flight someone halfway up another is to take next, and sends them up one left', () => {
    const s = shop(91); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // On up from the first floor, by where the first comes up: the second floor is open, and bare.
    expect(place(s, 'stairs', -0.5, zOnLevel(-4, 1), 1).ok).toBe(true);
    const first = idOf(s, 'stairs'), next = idOf(s, 'stairs', 1);
    expect(place(s, 'stairs', 1.5, zOnLevel(-4, 1), 0).ok).toBe(true);
    const p = climber(s, toWorld(s.shop, -1.5, zOnLevel(-3.5, 2)));
    expect(p.path[p.pathIdx]!.via).toBe(first);
    expect(p.path.slice(p.pathIdx + 1).some((w) => w.via === next)).toBe(true);
    // It goes, and they ride on up the first and take the other.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: next }).ok).toBe(true);
    expect(p.climb).toBeDefined();
    expect(p.path[p.pathIdx]!.via).toBe(first);
    expect(p.path.some((w) => w.via === next)).toBe(false);
    let ghost = false;
    for (let i = 0; i < 30 / TICK && levelOfPerson(s.shop, p) !== 2; i++) {
      const w = p.path[p.pathIdx];
      if (p.climb !== undefined && !s.shop.fixtures.some((f) => f.id === w?.via)) ghost = true;
      tick(s);
    }
    expect(ghost).toBe(false);
    expect(levelOfPerson(s.shop, p)).toBe(2);
  });

  it('sends someone halfway up the stairs round a panel taken out of their way up there', () => {
    const s = shop(92); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    const p = climber(s, toWorld(s.shop, -2, zOnLevel(-5.5, 1)));
    // Right across where they were to walk from the top of the stairs.
    expect(applyCommand(s, { type: 'removePanel', x: -0.5, z: -4 }).ok).toBe(true);
    expect(p.climb).toBeDefined();
    const g = gridFor(s);
    let from = p.path[p.pathIdx]!;
    for (const w of p.path.slice(p.pathIdx + 1)) { expect(lineClear(g, from, w)).toBe(true); from = w; }
    let over = 0;
    for (let i = 0; i < 20 / TICK && !(p.climb === undefined && p.pathIdx >= p.path.length); i++) {
      tick(s);
      const [cx, cz] = cellOf(gridFor(s), p);
      if (levelOfPerson(s.shop, p) > 0 && isBlocked(gridFor(s), cx, cz)) over++;
    }
    expect(levelOfPerson(s.shop, p)).toBe(1);
    expect(over).toBe(0);
  });

  it('counts a way up only when its foot is got to from the door, not just down it from its top', () => {
    const s = shop(94); aside(s);
    expect(applyCommand(s, { type: 'expandShop', sizeId: 'large' }).ok).toBe(true);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    // A spare flight by the side wall, its foot on (3.5, -4): walls round that would leave it got on only at the top.
    expect(place(s, 'stairs', 3.5, -5, 0).ok).toBe(true);
    const spare = s.shop.fixtures[s.shop.fixtures.length - 1]!.id;
    expect(place(s, 'wall', 2.5, -4, 0).ok).toBe(true);
    expect(canPlace(s, 'wall', 3.5, -3, 0).reason).toBe('Would block the way up');
    // Without it, the walls go up; a flight or a lift with its foot in there would go up from nowhere.
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: spare }).ok).toBe(true);
    expect(place(s, 'wall', 3.5, -3, 0).ok).toBe(true);
    expect(canPlace(s, 'stairs', 3.5, -5, 0).reason).toBe('Nobody could get on it from inside');
    expect(canPlace(s, 'elevator', 3.5, -5, 0).reason).toBe('Nobody could get on it from inside');
  });

  it('takes a spill up there away with a floor that shuts, so no cleaner goes up for it', () => {
    const s = shop(95); aside(s);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z, 0).ok).toBe(true);
    const at = toWorld(s.shop, -1, zOnLevel(-2.5, 1)), n = s.shop.litter.length;
    expect(addSpill(s, at.x, at.z)).toBe(true);
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: idOf(s, 'stairs') }).ok).toBe(true);
    expect(s.shop.litter.length).toBe(n);
    const c = makeCandidate(s, 'cleaner');
    s.staffPool.push(c);
    expect(applyCommand(s, { type: 'hire', candidateId: c.id }).ok).toBe(true);
    s.phase = 'open';
    let up = false;
    for (let i = 0; i < 60 / TICK; i++) { tick(s); if (s.people.some((p) => p.kind === 'staff' && levelOfPerson(s.shop, p) > 0)) up = true; }
    expect(up).toBe(false);
  });
});
