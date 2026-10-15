/**
 * Build mode rules: where fixtures may go, what they cost, growing the shop and the lot.
 * Placement never blocks a path: the door, the back door and every fixture's front must
 * stay reachable after the change.
 */
import type { GameState, FixtureType, Rot, Fixture, FloorStyle, WindowSide } from './types';
import { FIXTURES, SHOP_SIZES, LOT_EXPANSION_COST, FLOORS, WINDOW_PER_TILE, lotLayout, deliveryZone, toWorld, toLocal, yawToWorld } from './layout';
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
  if (x < f.x0 || x + 1 > f.x1 || z < f.z0 || z + 1 > f.z1) return { ok: false, reason: 'Only inside the shop floor', price };
  if (Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6) return { ok: false, reason: 'Snap to a floor tile', price };
  if (shop.fixtures.some((fx) => fx.id !== ignoreId && fx.x === x && fx.z === z)) return { ok: false, reason: 'Something is already there', price };
  // A doormat, a rug, a light on the wall: nothing anyone could bump into, so they may go by the doors.
  if (!def.walkable && Math.abs(x + 0.5 - shop.door.x) < 0.6 && z === f.z1 - 1) return { ok: false, reason: 'Keep the front door clear', price };
  if (!def.walkable && Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && z === f.z0) return { ok: false, reason: 'Keep the back door clear', price };
  if (def.onWall) {
    // Its back against the outer wall: the tile behind it is outside the floor.
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][rot & 3]!;
    const bx = x - fc.x, bz = z - fc.z;
    if (bx >= f.x0 && bx + 1 <= f.x1 && bz >= f.z0 && bz + 1 <= f.z1) return { ok: false, reason: 'Hang it on a wall, facing in (R turns it)', price };
    const onDoor = (Math.abs(x + 0.5 - shop.door.x) < 0.6 && bz >= f.z1) || (Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && bz < f.z0);
    if (onDoor) return { ok: false, reason: 'Not over a door', price };
  }
  const d = shop.delivery;
  if (d && x + 1 > d.x0 && x < d.x1 && z + 1 > d.z0 && z < d.z1) return { ok: false, reason: 'That is where deliveries go', price };
  if (state.cash < price && ignoreId === undefined) return { ok: false, reason: `Need ${dollars(price)}`, price };
  // Never on top of the manager.
  const owner = state.people.find((p) => p.kind === 'owner');
  if (owner) { const lo = toLocal(shop, owner.x, owner.z); if (lo.x > x - 0.3 && lo.x < x + 1.3 && lo.z > z - 0.3 && lo.z < z + 1.3) return { ok: false, reason: 'You are standing there', price }; }
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

/** The floor's tiles (the shop floor and the storeroom strip). */
function floorTiles(state: GameState): number {
  const f = state.shop.floor, back = Math.min(f.z0, state.shop.storeroom.z0);
  return Math.round((f.x1 - f.x0) * (f.z1 - back));
}

/** What laying a floor would cost now. */
export function floorCost(state: GameState, style: FloorStyle): number {
  return (FLOORS.find((x) => x.id === style)?.perTile ?? 0) * floorTiles(state);
}

/** Lay a new floor finish over the whole shop. */
export function setFloor(state: GameState, style: FloorStyle): string | null {
  const def = FLOORS.find((x) => x.id === style);
  if (!def) return 'No such floor.';
  if ((state.shop.floorStyle ?? 'lino') === style) return 'That floor is down already.';
  const cost = floorCost(state, style);
  if (state.cash < cost) return `Need ${dollars(cost)}`;
  state.cash -= cost;
  state.shop.floorStyle = style;
  state.shop.layoutVersion++;
  return null;
}

/** Tiles of wall on one side of the shell (for pricing its windows). */
export function windowCost(state: GameState, side: WindowSide): number {
  const f = state.shop.floor, back = Math.min(f.z0, state.shop.storeroom.z0);
  return WINDOW_PER_TILE * Math.round(side === 'back' ? f.x1 - f.x0 : f.z1 - back);
}

/** Put windows in a side or back wall. */
export function addWindows(state: GameState, side: WindowSide): string | null {
  if (state.shop.windows?.[side]) return 'That wall has windows already.';
  const cost = windowCost(state, side);
  if (state.cash < cost) return `Need ${dollars(cost)}`;
  state.cash -= cost;
  state.shop.windows = { ...state.shop.windows, [side]: true };
  state.shop.layoutVersion++;
  return null;
}

export function expandShop(state: GameState, sizeId: string): string | null {
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  if (!size) return 'No such size.';
  const current = SHOP_SIZES.findIndex((s) => s.id === state.shop.sizeId);
  const target = SHOP_SIZES.indexOf(size);
  if (target <= current) return 'The shop is already that big.';
  const cost = size.cost - (SHOP_SIZES[current]?.cost ?? 0);
  if (state.cash < cost) return `Need ${dollars(cost)} for the extension.`;
  const shop = state.shop;
  state.cash -= cost;
  shop.floor = { ...size.floor }; shop.storeroom = { ...size.storeroom }; shop.sizeId = size.id;
  shop.delivery = deliveryZone(size.floor);
  shop.backDoor = { x: shop.backDoor.x, z: size.floor.z0 };
  // Fixtures keep their tiles (the shop grows back and sideways; the front wall does not move).
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: shop.bays[i]?.carId ?? null }));
  shop.storageCapacity = 120 + target * 100;
  shop.layoutVersion++;
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
