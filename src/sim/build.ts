/**
 * Build mode rules: where fixtures may go, what they cost, growing the shop and the lot.
 * Placement never blocks a path: the door, the back door and every fixture's front must
 * stay reachable after the change.
 */
import type { GameState, FixtureType, Rot, Fixture, FloorStyle } from './types';
import { FIXTURES, SHOP_SIZES, LOT_EXPANSION_COST, FLOORS, MAX_FLOOR, lotLayout, deliveryZone, toWorld, toLocal, yawToWorld, isFloor, floorTileList, floorTileCount, tileKey, tilePrice, tilePriceAt, sizeOfTiles } from './layout';
import { buildGrid, fixtureFrontWorld, fixtureBackWorld, fixtureStandWorld, frontInside } from './grid';
import { findPath } from './pathfinding';
import { doorInside, doorOutside, storeroomPoint } from './people';
import { dollars } from './money';

export interface PlaceCheck { ok: boolean; reason: string; price: number }

/** Can this fixture go here? Reason is in plain words for the ghost label. */
export function canPlace(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck {
  const def = FIXTURES[type];
  const shop = state.shop;
  const f = shop.floor;
  const price = def.price;
  if (Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6) return { ok: false, reason: 'Snap to a floor tile', price };
  if (!isFloor(shop, x, z)) return { ok: false, reason: 'Only inside the shop floor', price };
  // One thing per tile, except a window: it is up in the wall behind, so a shelf can stand in front of it
  // (but a light hung on the same wall cannot share it).
  const sameWall = (fx: Fixture) => !!def.onWall && !!FIXTURES[fx.type].onWall && fx.rot === rot;
  if (shop.fixtures.some((fx) => fx.id !== ignoreId && fx.x === x && fx.z === z && (sameWall(fx) || (type !== 'window' && fx.type !== 'window')))) return { ok: false, reason: 'Something is already there', price };
  // A doormat, a rug, a light on the wall: nothing anyone could bump into, so they may go by the doors.
  if (!def.walkable && Math.abs(x + 0.5 - shop.door.x) < 0.6 && z === f.z1 - 1) return { ok: false, reason: 'Keep the front door clear', price };
  if (!def.walkable && Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && z === shop.backDoor.z) return { ok: false, reason: 'Keep the back door clear', price };
  if (def.onWall) {
    // Its back against the outer wall: the tile behind it is outside the floor.
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][rot & 3]!;
    const bx = x - fc.x, bz = z - fc.z;
    if (isFloor(shop, bx, bz)) return { ok: false, reason: 'Hang it on a wall, facing in (R turns it)', price };
    const onDoor = (Math.abs(x + 0.5 - shop.door.x) < 0.6 && bz >= f.z1) || (Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && fc.z === 1 && bz + 1 === shop.backDoor.z);
    if (onDoor) return { ok: false, reason: 'Not over a door', price };
    if (type === 'window' && bz >= f.z1) return { ok: false, reason: 'The front is all windows already', price };
  }
  const d = shop.delivery;
  if (!def.onWall && d && x + 1 > d.x0 && x < d.x1 && z + 1 > d.z0 && z < d.z1) return { ok: false, reason: 'That is where deliveries go', price };
  if (state.cash < price && ignoreId === undefined) return { ok: false, reason: `Need ${dollars(price)}`, price };
  // Never on top of the manager.
  const owner = state.people.find((p) => p.kind === 'owner');
  if (owner && !def.onWall) { const lo = toLocal(shop, owner.x, owner.z); if (lo.x > x - 0.3 && lo.x < x + 1.3 && lo.z > z - 0.3 && lo.z < z + 1.3) return { ok: false, reason: 'You are standing there', price }; }
  if (type === 'register') {
    const bx = x - [0, 1, 0, -1][rot]!, bz = z - [1, 0, -1, 0][rot]!;
    if (bx < f.x0 || bx + 1 > f.x1 || bz < f.z0 || bz + 1 > f.z1) return { ok: false, reason: 'Leave room behind the counter to stand', price };
  }
  // Trial layout: every front and both doors must stay reachable.
  const trial: Fixture = { id: -1, type, x, z, rot, slots: [] };
  const fixtures = shop.fixtures.filter((fx) => fx.id !== ignoreId).concat([trial]);
  const grid = buildGrid({ ...shop, fixtures }, -1);
  const from = doorInside(state);
  if (!findPath(grid, doorOutside(state), from)) return { ok: false, reason: 'Would block the door', price };
  // Nor boxing the manager in.
  if (owner && !findPath(grid, { x: owner.x, z: owner.z }, doorOutside(state))) return { ok: false, reason: 'Would box you in', price };
  const back = toWorld(shop, shop.backDoor.x, shop.backDoor.z - 0.6);
  if (!findPath(grid, from, back)) return { ok: false, reason: 'Would block the back door', price };
  // Inside, from the front door: never by going out and round to the back door (a wall across the
  // shop must not cut the back half off).
  const inside = buildGrid({ ...shop, fixtures }, -1, true);
  if (!findPath(inside, from, toWorld(shop, shop.backDoor.x, shop.backDoor.z + 0.6))) return { ok: false, reason: 'Would cut the shop in two', price };
  // The pallet where deliveries land: whoever stocks the shelves must be able to reach it.
  if (!findPath(inside, from, storeroomPoint(state))) return { ok: false, reason: 'Would block the way to the delivery pallet', price };
  const trialShop = { ...shop, fixtures };
  for (const fx of fixtures) {
    if (FIXTURES[fx.type].slots === 0 && fx.type !== 'register' && fx.type !== 'kiosk') continue;
    // Shoppers queue at a till's front: it has to face into the room. Shelves are used from whichever side is free inside.
    const till = fx.type === 'register' || fx.type === 'kiosk';
    if (till && !frontInside(shop, fx)) return { ok: false, reason: fx === trial ? 'Turn it to face into the shop' : `Would cut off the ${FIXTURES[fx.type].name.toLowerCase()}`, price };
    const stand = till ? fixtureFrontWorld(shop, fx) : fixtureStandWorld(trialShop, fx, undefined, grid);
    if (!stand || !findPath(inside, from, stand)) return { ok: false, reason: fx === trial ? 'Nobody could reach it from inside' : `Would cut off the ${FIXTURES[fx.type].name.toLowerCase()}`, price };
    if (fx.type === 'register' && !findPath(inside, from, fixtureBackWorld(shop, fx))) return { ok: false, reason: fx === trial ? 'You could not get behind it' : 'Would block the way behind the counter', price };
  }
  return { ok: true, reason: def.slots ? `${def.name}: ${def.slots} slots` : def.name, price };
}

/** The finish on one tile of floor. */
export function styleAt(shop: GameState['shop'], x: number, z: number): FloorStyle {
  return shop.tileStyles?.[tileKey(x, z)] ?? shop.floorStyle ?? 'lino';
}

/** What laying a finish over the whole shop would cost now (the tiles that have another finish). */
export function floorCost(state: GameState, style: FloorStyle): number {
  const per = FLOORS.find((x) => x.id === style)?.perTile ?? 0;
  return per * floorTileList(state.shop).filter((t) => styleAt(state.shop, t.x, t.z) !== style).length;
}

/** Lay a finish over the whole shop. */
export function setFloor(state: GameState, style: FloorStyle): string | null {
  const def = FLOORS.find((x) => x.id === style);
  if (!def) return 'No such floor.';
  const cost = floorCost(state, style);
  if (!floorTileList(state.shop).some((t) => styleAt(state.shop, t.x, t.z) !== style)) return 'That floor is down already.';
  if (state.cash < cost) return `Need ${dollars(cost)}`;
  state.cash -= cost;
  state.shop.floorStyle = style;
  delete state.shop.tileStyles;
  return null;
}

/** Can this tile of floor be given this finish? */
export function canPaintFloor(state: GameState, x: number, z: number, style: FloorStyle): PlaceCheck {
  const price = FLOORS.find((f) => f.id === style)?.perTile ?? 0;
  if (!isFloor(state.shop, x, z)) return { ok: false, reason: 'Only on the shop floor', price };
  if (styleAt(state.shop, x, z) === style) return { ok: false, reason: 'That floor is down already', price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: FLOORS.find((f) => f.id === style)?.name ?? style, price };
}

/** Lay a finish on one tile. */
export function paintFloor(state: GameState, x: number, z: number, style: FloorStyle): string | null {
  const check = canPaintFloor(state, x, z, style);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop;
  const styles = { ...shop.tileStyles };
  if (style === (shop.floorStyle ?? 'lino')) delete styles[tileKey(x, z)]; else styles[tileKey(x, z)] = style;
  shop.tileStyles = styles;
  return null;
}

/** Can this tile be bought and built on? Next to the floor you have, inside the plot's limit, behind the front wall. */
export function canBuyTile(state: GameState, x: number, z: number): PlaceCheck {
  const shop = state.shop, price = tilePrice(shop), m = MAX_FLOOR, f = shop.floor;
  if (Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6) return { ok: false, reason: 'Snap to a tile', price };
  if (isFloor(shop, x, z)) return { ok: false, reason: 'That is floor already', price };
  if (z + 1 > m.z1) return { ok: false, reason: 'The front wall stays where it is', price };
  if (x < m.x0 || x + 1 > m.x1 || z < m.z0) return { ok: false, reason: 'The plot ends here', price };
  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isFloor(shop, x + dx!, z + dz!))) return { ok: false, reason: 'Next to the floor you have', price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: 'More floor', price };
}

/** Build one more tile of shop: the walls move out round it. */
export function buyTile(state: GameState, x: number, z: number): string | null {
  const check = canBuyTile(state, x, z);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  addFloor(state.shop, [{ x, z }]);
  reshape(state);
  return null;
}

/** Make tiles floor: the bounding rectangle grows to hold them, the new tiles in it that are not floor become gaps. */
function addFloor(shop: GameState['shop'], tiles: { x: number; z: number }[]): void {
  const was = new Set(floorTileList(shop).map((t) => tileKey(t.x, t.z)));
  for (const t of tiles) was.add(tileKey(t.x, t.z));
  const f = shop.floor;
  const nf = { x0: Math.min(f.x0, ...tiles.map((t) => t.x)), z0: Math.min(f.z0, ...tiles.map((t) => t.z)), x1: Math.max(f.x1, ...tiles.map((t) => t.x + 1)), z1: Math.max(f.z1, ...tiles.map((t) => t.z + 1)) };
  const gaps: string[] = [];
  for (let zz = nf.z0; zz < nf.z1 - 1e-6; zz++) for (let xx = nf.x0; xx < nf.x1 - 1e-6; xx++) if (!was.has(tileKey(xx, zz))) gaps.push(tileKey(xx, zz));
  shop.floor = nf;
  if (gaps.length) shop.gaps = gaps; else delete shop.gaps;
}

/** After the floor changed: the back door, windows and lights go out with their walls; the lot, the storage and the size follow. */
function reshape(state: GameState): void {
  const shop = state.shop, f = shop.floor;
  shop.storeroom = { x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z0 };
  // The back door stays in its column, at the back edge of the floor there.
  let bz = shop.backDoor.z;
  while (isFloor(shop, shop.backDoor.x - 0.5, bz - 1)) bz--;
  shop.backDoor = { x: shop.backDoor.x, z: bz };
  for (const fx of shop.fixtures) {
    if (!FIXTURES[fx.type].onWall) continue;
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][fx.rot & 3]!;
    while (isFloor(shop, fx.x - fc.x, fx.z - fc.z)) { fx.x -= fc.x; fx.z -= fc.z; }
  }
  const n = floorTileCount(shop);
  shop.sizeId = sizeOfTiles(n);
  shop.storageCapacity = 120 + 5 * Math.max(0, n - 30);
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: shop.bays[i]?.carId ?? null }));
  shop.layoutVersion++;
}

/**
 * The outside wall an on-the-wall piece hangs on (it faces into the room, so the wall is behind it),
 * and where along that wall: the tile's centre (x along the back and front, z along the sides).
 */
export function wallOf(f: { x: number; z: number; rot: Rot }): { side: 'back' | 'left' | 'front' | 'right'; t: number } {
  return [{ side: 'back' as const, t: f.x + 0.5 }, { side: 'left' as const, t: f.z + 0.5 }, { side: 'front' as const, t: f.x + 0.5 }, { side: 'right' as const, t: f.z + 0.5 }][f.rot & 3]!;
}

/**
 * Which way a piece for the wall should face on this tile: away from the outside wall behind it
 * (the way it already faces if that works, in a corner), or null when the tile is not against one.
 */
export function facingOffWall(state: GameState, type: FixtureType, x: number, z: number, prefer: Rot): Rot | null {
  if (!isFloor(state.shop, x, z)) return null;
  for (const r of [prefer, 0, 1, 3, 2] as Rot[]) {
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][r]!;
    if (!isFloor(state.shop, x - fc.x, z - fc.z) && !(type === 'window' && r === 2)) return r;
  }
  return null;
}

/** Old saves glazed whole walls: a window on every tile of them instead. */
export function windowsFromSides(state: GameState): void {
  const shop = state.shop, sides = shop.windows;
  if (!sides) return;
  delete shop.windows;
  const f = shop.floor;
  const want: { x: number; z: number; rot: Rot }[] = [];
  for (let x = f.x0; x < f.x1; x++) if (sides.back && Math.abs(x + 0.5 - shop.backDoor.x) > 0.6) want.push({ x, z: f.z0, rot: 0 });
  for (let z = f.z0; z < f.z1; z++) { if (sides.left) want.push({ x: f.x0, z, rot: 1 }); if (sides.right) want.push({ x: f.x1 - 1, z, rot: 3 }); }
  for (const w of want) if (!shop.fixtures.some((fx) => fx.type === 'window' && fx.x === w.x && fx.z === w.z && fx.rot === w.rot)) shop.fixtures.push({ id: state.nextId++, type: 'window', ...w, slots: [] });
  shop.layoutVersion++;
}

/**
 * Grow to one of the old sizes in one go (every tile of its footprint the shop does not have yet, at the
 * tile price as each goes in): the shortcut the balance bots and older tests use.
 */
export function expandShop(state: GameState, sizeId: string): string | null {
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  if (!size) return 'No such size.';
  const shop = state.shop;
  const want: { x: number; z: number }[] = [];
  for (let z = size.floor.z0; z < size.floor.z1; z++) for (let x = size.floor.x0; x < size.floor.x1; x++) if (!isFloor(shop, x, z)) want.push({ x, z });
  if (!want.length) return 'The shop is already that big.';
  let n = floorTileCount(shop), cost = 0;
  for (let i = 0; i < want.length; i++, n++) cost += tilePriceAt(n);
  if (state.cash < cost) return `Need ${dollars(cost)} for the extension.`;
  state.cash -= cost;
  addFloor(shop, want);
  // The delivery pallet goes to the new back corner, by the back door.
  shop.delivery = deliveryZone(shop.floor);
  shop.backDoor = { x: shop.backDoor.x, z: shop.floor.z0 };
  reshape(state);
  state.notices.push({ day: state.day, text: `Extension built: the shop is now a ${size.name.toLowerCase()}.`, kind: 'info' });
  return null;
}

export function expandLot(state: GameState): string | null {
  const shop = state.shop;
  if (shop.lotRows >= 2) return 'The lot is as big as the plot allows.';
  if (state.cash < LOT_EXPANSION_COST) return `Need ${dollars(LOT_EXPANSION_COST)} for the extra bays.`;
  state.cash -= LOT_EXPANSION_COST;
  shop.lotRows = 2;
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: shop.bays[i]?.carId ?? null }));
  shop.layoutVersion++;
  state.notices.push({ day: state.day, text: `Parking doubled: ${shop.bays.length} bays now.`, kind: 'info' });
  return null;
}

export function moveFixture(state: GameState, id: number, x: number, z: number, rot: Rot): string | null {
  const f = state.shop.fixtures.find((fx) => fx.id === id);
  if (!f) return 'No such fixture.';
  if (f.type === 'register' && (f.serving || (f.queue?.length ?? 0) > 0)) return 'Wait until the line is served.';
  const check = canPlace(state, f.type, x, z, rot, id);
  if (!check.ok) return check.reason;
  f.x = x; f.z = z; f.rot = rot;
  state.shop.layoutVersion++;
  return null;
}
