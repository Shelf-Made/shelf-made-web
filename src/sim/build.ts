/**
 * Build mode rules: where fixtures may go, what they cost, growing the shop and the lot.
 * Placement never blocks a path: the door, the back door and every fixture's front must
 * stay reachable after the change.
 */
import type { GameState, FixtureType, Rot, Fixture } from './types';
import { FIXTURES, SHOP_SIZES, LOT_EXPANSION_COST, lotLayout } from './layout';
import { buildGrid, fixtureFrontWorld } from './grid';
import { findPath } from './pathfinding';
import { doorInside, doorOutside } from './people';

export interface PlaceCheck { ok: boolean; reason: string; price: number }

/** Can this fixture go here? Reason is in plain words for the ghost label. */
export function canPlace(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck {
  const def = FIXTURES[type];
  const shop = state.shop;
  const f = shop.floor;
  const price = def.price;
  if (x < f.x0 || x + 1 > f.x1 || z < f.z0 || z + 1 > f.z1) return { ok: false, reason: 'Only inside the shop floor', price };
  if (shop.fixtures.some((fx) => fx.id !== ignoreId && fx.x === x && fx.z === z)) return { ok: false, reason: 'Something is already there', price };
  if (Math.abs(x + 0.5 - shop.door.x) < 0.6 && z === f.z1 - 1) return { ok: false, reason: 'That is the doorway', price };
  if (state.cash < price && ignoreId === undefined) return { ok: false, reason: `Need $${price}`, price };
  // Trial layout: every front and both doors must stay reachable.
  const trial: Fixture = { id: -1, type, x, z, rot, slots: [] };
  const fixtures = shop.fixtures.filter((fx) => fx.id !== ignoreId).concat([trial]);
  const grid = buildGrid({ ...shop, fixtures }, -1);
  const from = doorInside(state);
  if (!findPath(grid, doorOutside(state), from)) return { ok: false, reason: 'Would block the door', price };
  const back = { x: shop.originX + shop.backDoor.x, z: shop.originZ + shop.backDoor.z - 0.6 };
  if (!findPath(grid, from, back)) return { ok: false, reason: 'Would block the way to the storeroom', price };
  for (const fx of fixtures) {
    if (FIXTURES[fx.type].slots === 0 && fx.type !== 'register' && fx.type !== 'kiosk') continue;
    if (!findPath(grid, from, fixtureFrontWorld(shop, fx))) return { ok: false, reason: fx === trial ? 'Nobody could reach its front' : `Would cut off the ${FIXTURES[fx.type].name.toLowerCase()}`, price };
  }
  return { ok: true, reason: def.slots ? `${def.name}: ${def.slots} slots` : def.name, price };
}

export function expandShop(state: GameState, sizeId: string): string | null {
  const size = SHOP_SIZES.find((s) => s.id === sizeId);
  if (!size) return 'No such size.';
  const current = SHOP_SIZES.findIndex((s) => s.id === state.shop.sizeId);
  const target = SHOP_SIZES.indexOf(size);
  if (target <= current) return 'The shop is already that big.';
  const cost = size.cost - (SHOP_SIZES[current]?.cost ?? 0);
  if (state.cash < cost) return `Need $${cost} for the extension.`;
  const shop = state.shop;
  state.cash -= cost;
  shop.floor = { ...size.floor }; shop.storeroom = { ...size.storeroom }; shop.sizeId = size.id;
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ x: shop.originX + b.x, z: shop.originZ + b.z, yaw: b.yaw, carId: shop.bays[i]?.carId ?? null }));
  shop.storageCapacity = 200 + target * 120;
  shop.layoutVersion++;
  state.notices.push({ day: state.day, text: `Extension built: the shop is now a ${size.name.toLowerCase()}.`, kind: 'info' });
  return null;
}

export function expandLot(state: GameState): string | null {
  const shop = state.shop;
  if (shop.lotRows >= 2) return 'The lot is as big as the plot allows.';
  if (state.cash < LOT_EXPANSION_COST) return `Need $${LOT_EXPANSION_COST} for the extra bays.`;
  state.cash -= LOT_EXPANSION_COST;
  shop.lotRows = 2;
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ x: shop.originX + b.x, z: shop.originZ + b.z, yaw: b.yaw, carId: shop.bays[i]?.carId ?? null }));
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
