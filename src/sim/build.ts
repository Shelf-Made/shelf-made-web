/**
 * Build mode rules: where fixtures may go, what they cost, growing the shop and the lot.
 * Placement never blocks a path: the door, the back door and every fixture's front reached now
 * must stay reachable after the change.
 */
import type { GameState, FixtureType, Rot, Fixture, FloorStyle, WallStyle, Shop } from './types';
import { FIXTURES, SHOP_SIZES, FLOORS, paintedBays, MAX_FLOOR, lotLayout, deliveryZone, toWorld, toLocal, yawToWorld, isFloor, floorTileList, floorTileCount, tileKey, tilePrice, tilePriceAt, sizeOfTiles, WALLS, RESALE, wallSegments, footprintOf, overlaps, levelOfZ, groundZ, insideOn, levelOf, zOnLevel, VERTICAL, rideEnds, MAX_LEVELS, storeysOf, shopTileList } from './layout';
import { placeUpstairs, ensureCeilings, levelOfPerson, withoutIt, ceilingPrice, ceilFloorsOpened, strands, reachOf, cutOff, repathAfterBuild, PANEL_PRICE } from './storeys';
import { buildGrid, frontInside, cellOf, isBlocked, type Grid } from './grid';
import { findPath } from './pathfinding';
import { doorInside, doorOutside, storeroomPoint } from './people';
import { dollars } from './money';
import { resetGridCache, gridFor } from './state';
import { canPlaceOutside, lotClash, pruneSurfaces, paintAllBays } from './lot';

/** `ceiling`: the part of the price that is a ceiling over a floor it opens (all a move costs). */
export interface PlaceCheck { ok: boolean; reason: string; price: number; ceiling?: number }

/** Can this fixture go here? Reason is in plain words for the ghost label. */
export function canPlace(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck {
  const def = FIXTURES[type];
  // Out on the lot: its own grid and rules.
  if (def.outdoor) return canPlaceOutside(state, type, x, z, rot, ignoreId);
  const shop = state.shop;
  const f = shop.floor;
  let price = def.price;
  if (Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6) return { ok: false, reason: 'Snap to a floor tile', price };
  const level = levelOfZ(z + 0.5);
  const up = placeUpstairs(state, type, x, z, rot, ignoreId);
  if (up) return up;
  if (!isFloor(withoutIt(shop, type, ignoreId), x, z)) return { ok: false, reason: level > 0 ? 'Only on the floor up here' : 'Only inside the shop floor', price };
  // One thing per tile, except a window: it is up in the wall behind, so a shelf can stand in front of it
  // (but a light hung on the same wall cannot share it). The stairs take two.
  const sameWall = (fx: Fixture) => !!def.onWall && !!FIXTURES[fx.type].onWall && fx.rot === rot;
  const mine = footprintOf(type, x, z, rot);
  if (shop.fixtures.some((fx) => fx.id !== ignoreId && !FIXTURES[fx.type].outdoor && (fx.x === x && fx.z === z
    ? (sameWall(fx) || (type !== 'window' && fx.type !== 'window'))
    : type !== 'window' && fx.type !== 'window' && overlaps(footprintOf(fx.type, fx.x, fx.z, fx.rot), mine)))) return { ok: false, reason: 'Something is already there', price };
  // A doormat, a rug, a light on the wall: nothing anyone could bump into, so they may go by the doors.
  if (!def.walkable && overlaps(mine, { x0: shop.door.x - 0.5, z0: f.z1 - 1, x1: shop.door.x + 0.5, z1: f.z1 })) return { ok: false, reason: 'Keep the front door clear', price };
  if (!def.walkable && overlaps(mine, { x0: shop.backDoor.x - 0.5, z0: shop.backDoor.z, x1: shop.backDoor.x + 0.5, z1: shop.backDoor.z + 1 })) return { ok: false, reason: 'Keep the back door clear', price };
  if (def.onWall) {
    // Its back against the outer wall: the tile behind it is outside the building (on that floor).
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][rot & 3]!;
    const bx = x - fc.x, bz = z - fc.z;
    if (insideOn(shop, level, bx, groundZ(bz))) return { ok: false, reason: 'Hang it on a wall, facing in (R turns it)', price };
    const onDoor = (Math.abs(x + 0.5 - shop.door.x) < 0.6 && bz >= f.z1) || (Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && fc.z === 1 && bz + 1 === shop.backDoor.z);
    if (onDoor) return { ok: false, reason: 'Not over a door', price };
    if (type === 'window' && bz >= f.z1) return { ok: false, reason: 'The front is all windows already', price };
  }
  const d = shop.delivery;
  if (!def.onWall && d && overlaps(mine, d)) return { ok: false, reason: 'That is where deliveries go', price };
  // Trial layout (a piece moved keeps its id): a floor it opens gets its ceiling, at the panel price.
  const trial: Fixture = { id: ignoreId ?? -1, type, x, z, rot, slots: [] };
  const fixtures = shop.fixtures.filter((fx) => fx.id !== ignoreId).concat([trial]);
  const trialShop = { ...shop, fixtures };
  const ceiling = VERTICAL.has(type) ? ceilingPrice(shop, trialShop) : 0, cost = (ignoreId === undefined ? price : 0) + ceiling;
  price += ceiling;
  if (state.cash < cost) return { ok: false, reason: `Need ${dollars(cost)}${ceiling ? ', with a ceiling over the floor it opens' : ''}`, price };
  // Never on top of the manager.
  const owner = state.people.find((p) => p.kind === 'owner');
  if (owner && !def.onWall) { const lo = toLocal(shop, owner.x, owner.z); if (lo.x > mine.x0 - 0.3 && lo.x < mine.x1 + 0.3 && lo.z > mine.z0 - 0.3 && lo.z < mine.z1 + 0.3) return { ok: false, reason: 'You are standing there', price }; }
  if (type === 'register') {
    const bx = x - [0, 1, 0, -1][rot]!, bz = z - [1, 0, -1, 0][rot]!;
    if (!isFloor(shop, bx, bz)) return { ok: false, reason: 'Leave room behind the counter to stand', price };
  }
  // A way up moved must not shut a floor with anything or anyone on it (as selling it would not).
  if (ignoreId !== undefined && VERTICAL.has(type)) { const why = strands(state, trialShop); if (why) return { ok: false, reason: why, price }; }
  // Nobody else under it either, and the doors, the pallet and the manager's way out stay open.
  const inside = buildGrid(trialShop, -1, true), open = buildGrid(trialShop, -1), shut = builtOver(state, open) ?? shuts(state, trialShop, inside, open);
  if (shut) return { ok: false, reason: shut, price };
  // The piece itself: shoppers queue at a till's front (facing into the room, the tile clear), whoever serves stands
  // behind a counter; shelves are used from whichever side is free inside; a way up is got on at its foot.
  const now = reachOf(state, trialShop, inside), till = type === 'register' || type === 'kiosk';
  if (till && !frontInside(shop, trial)) return { ok: false, reason: 'Turn it to face into the shop', price };
  if ((till || def.slots > 0) && !now.pieces.has(trial.id)) return { ok: false, reason: 'Nobody could reach it from inside', price };
  if (type === 'register' && !now.behind.has(trial.id)) return { ok: false, reason: 'You could not get behind it', price };
  if (VERTICAL.has(type) && !now.rides.has(trial.id)) return { ok: false, reason: 'Nobody could get on it from inside', price };
  // Nothing else cut off that is reached now (a floor, a piece on any, someone up there or on the way), and every
  // way up that goes up still does. What is cut off already (an older save's) stops nobody building round it.
  const why = cutOff(state, reachOf(state, shop), now, trialShop, trial.id);
  if (why) return { ok: false, reason: why, price };
  return { ok: true, reason: def.slots ? `${def.name}: ${def.slots} slots` : VERTICAL.has(type) ? `${def.name} up to the next floor${ceiling ? `, and a ceiling over it for ${dollars(ceiling)}` : ''}` : def.name, price, ...(ceiling ? { ceiling } : {}) };
}

/**
 * What a layout shuts of the ways that must stay open, by the reason each gives: in at the front door, the manager
 * out of it, round to the back door, the tile just inside the back door clear (a path's end is only near where it
 * is asked for: the doorway itself may not be), and inside from the front door (never out and round: a wall across
 * the shop must not cut the back half off) to the back door and to the pallet, where whoever stocks the shelves goes.
 */
function waysShut(state: GameState, shop: Shop, inside: Grid, open = buildGrid(shop, -1)): string[] {
  const at = { ...state, shop }, from = doorInside(at), owner = state.people.find((p) => p.kind === 'owner'), out: string[] = [];
  if (!findPath(open, doorOutside(at), from)) out.push('Would block the door');
  if (owner && !findPath(open, { x: owner.x, z: owner.z }, doorOutside(at))) out.push('Would box you in');
  if (!findPath(open, from, toWorld(shop, shop.backDoor.x, shop.backDoor.z - 0.6))) out.push('Would block the back door');
  if ([-0.25, 0.25].some((dx) => [0.25, 0.75].some((dz) => { const [cx, cz] = cellOf(inside, toWorld(shop, shop.backDoor.x + dx, shop.backDoor.z + dz)); return isBlocked(inside, cx, cz); }))) out.push('Keep the back door clear');
  if (!findPath(inside, from, toWorld(shop, shop.backDoor.x, shop.backDoor.z + 0.6))) out.push('Would cut the shop in two');
  if (!findPath(inside, from, storeroomPoint(at))) out.push('Would block the way to the delivery pallet');
  return out;
}
/** Why a change (making the shop `trial`, `inside` its grid with the back door shut) would shut one of those ways that is open now, or null. What is shut already (an older save's) stops nobody. */
function shuts(state: GameState, trial: Shop, inside: Grid, open?: Grid): string | null {
  const now = waysShut(state, trial, inside, open);
  if (!now.length) return null;
  const was = waysShut(state, state.shop, buildGrid(state.shop, -1, true), gridFor(state));
  return now.find((r) => !was.includes(r)) ?? null;
}

/**
 * Who a change (`open`: the shop's walking grid after it) would build over: anyone standing where a piece or the walls
 * round new floor go up would be inside it, judged by the floor beside it (maybe the far side of it), and walk on
 * from there through anything. Nobody is: as for the manager, a tile sold, upstairs.
 */
function builtOver(state: GameState, open: Grid): string | null {
  const g = gridFor(state);
  const p = state.people.find((q) => q.kind !== 'walker' && q.climb === undefined && q.state !== 'driving' && isBlocked(open, ...cellOf(open, q)) && !isBlocked(g, ...cellOf(g, q)));
  return p ? (p.kind === 'owner' ? 'You are standing there' : 'Someone is standing there') : null;
}

/** The finish on one tile of floor. */
export function styleAt(shop: GameState['shop'], x: number, z: number): FloorStyle {
  return shop.tileStyles?.[tileKey(x, z)] ?? shop.floorStyle ?? 'lino';
}

/** What laying a finish over the whole shop (every open floor) would cost now (the tiles that have another finish). */
export function floorCost(state: GameState, style: FloorStyle): number {
  const per = FLOORS.find((x) => x.id === style)?.perTile ?? 0;
  return per * shopTileList(state.shop).filter((t) => styleAt(state.shop, t.x, t.z) !== style).length;
}

/** Lay a finish over the whole shop. */
export function setFloor(state: GameState, style: FloorStyle): string | null {
  const def = FLOORS.find((x) => x.id === style);
  if (!def) return 'No such floor.';
  const cost = floorCost(state, style);
  if (!shopTileList(state.shop).some((t) => styleAt(state.shop, t.x, t.z) !== style)) return 'That floor is down already.';
  if (state.cash < cost) return `Need ${dollars(cost)}`;
  state.cash -= cost;
  // Over every tile in use (a floor shut, or under a flight, keeps its own for when it is back).
  const open = new Set(shopTileList(state.shop).map((t) => tileKey(t.x, t.z)));
  state.shop.floorStyle = style;
  state.shop.tileStyles = Object.fromEntries(Object.entries(state.shop.tileStyles ?? {}).filter(([k]) => !open.has(k)));
  return null;
}

/**
 * Can this tile of floor be given this finish? Its price, less what the finish coming up fetches
 * (laying the cheapest sells the old one back: the price comes out below nothing).
 */
export function canPaintFloor(state: GameState, x: number, z: number, style: FloorStyle): PlaceCheck {
  const now = isFloor(state.shop, x, z) ? styleAt(state.shop, x, z) : null;
  const price = (FLOORS.find((f) => f.id === style)?.perTile ?? 0) - Math.round(RESALE * (FLOORS.find((f) => f.id === now)?.perTile ?? 0));
  if (!now) return { ok: false, reason: 'Only on the shop floor', price };
  if (now === style) return { ok: false, reason: 'That floor is down already', price };
  if (price > 0 && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: FLOORS.find((f) => f.id === style)?.name ?? style, price };
}

/** The finish on one stretch of outer wall. */
export function wallStyleAt(shop: GameState['shop'], key: string): WallStyle {
  return shop.wallStyles?.[key] ?? shop.wallStyle ?? 'bands';
}

/** Can this stretch of wall be given this finish? Priced as floors are (the old finish sells back). */
export function canPaintWall(state: GameState, key: string, style: WallStyle): PlaceCheck {
  const seg = wallSegments(state.shop).find((w) => w.key === key);
  const now = seg ? wallStyleAt(state.shop, key) : null;
  const price = (WALLS.find((w) => w.id === style)?.perSeg ?? 0) - Math.round(RESALE * (WALLS.find((w) => w.id === now)?.perSeg ?? 0));
  if (!now) return { ok: false, reason: 'Point at a wall', price };
  if (now === style) return { ok: false, reason: 'That wall has it already', price };
  if (price > 0 && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: WALLS.find((w) => w.id === style)?.name ?? style, price };
}

/** Give one stretch of wall a finish. */
export function paintWall(state: GameState, key: string, style: WallStyle): string | null {
  const check = canPaintWall(state, key, style);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop;
  const styles = { ...shop.wallStyles };
  if (style === (shop.wallStyle ?? 'bands')) delete styles[key]; else styles[key] = style;
  shop.wallStyles = styles;
  return null;
}

/**
 * Can this tile of floor be sold back? Not the door's tile, the pallet's, one with anything on it or
 * anyone standing on it, nor one the rest of the floor hangs from (it must stay one room).
 */
export function canSellTile(state: GameState, x: number, z: number): PlaceCheck {
  // The panels over it on the floors above go with it, 60% back as taken down (the one over the ground floor came with it).
  const shop = state.shop, n = floorTileCount(shop), above = shop.ceilings?.slice(1).filter((r) => r.includes(tileKey(x, z))).length ?? 0;
  const price = -Math.round(RESALE * tilePriceAt(n - 1)) - above * Math.round(RESALE * PANEL_PRICE);
  if (levelOfZ(z + 0.5) > 0) return { ok: false, reason: 'Upstairs, take the ceiling panel down instead (Upstairs tab)', price };
  if (!isFloor(shop, x, z)) return { ok: false, reason: 'Point at a tile of floor', price };
  if (Math.abs(x + 0.5 - shop.door.x) < 0.6 && z + 1 === shop.floor.z1) return { ok: false, reason: 'The front door stands here', price };
  const d = shop.delivery;
  if (x + 1 > d.x0 && x < d.x1 && z + 1 > d.z0 && z < d.z1) return { ok: false, reason: 'That is where deliveries go', price };
  if (shop.fixtures.some((f) => !FIXTURES[f.type].outdoor && levelOf(f) === 0 && overlaps(footprintOf(f.type, f.x, f.z, f.rot), { x0: x, z0: z, x1: x + 1, z1: z + 1 }))) return { ok: false, reason: 'Move or sell what is on it first', price };
  for (let L = 1; L < MAX_LEVELS; L++) {
    const t = { x0: x, z0: zOnLevel(z, L), x1: x + 1, z1: zOnLevel(z, L) + 1 };
    if (shop.fixtures.some((f) => !FIXTURES[f.type].outdoor && levelOf(f) === L && overlaps(footprintOf(f.type, f.x, f.z, f.rot), t))) return { ok: false, reason: 'Something upstairs stands over it', price };
  }
  if (shop.fixtures.some((f) => VERTICAL.has(f.type) && (() => { const t = rideEnds(f).top; return t.x - 0.5 === x && groundZ(t.z - 0.5) === z; })())) return { ok: false, reason: 'The stairs come up over it', price };
  if (shop.fixtures.some((f) => VERTICAL.has(f.type) && (() => { const b = rideEnds(f).bottom; return b.x - 0.5 === x && groundZ(b.z - 0.5) === z; })())) return { ok: false, reason: 'You step onto the stairs from it', price };
  if (state.people.some((p) => p.kind !== 'walker' && levelOfPerson(shop, p) > 0 && (() => { const l = toLocal(shop, p.x, p.z); return l.x > x && l.x < x + 1 && groundZ(l.z) > z && groundZ(l.z) < z + 1; })())) return { ok: false, reason: 'Someone is standing over it upstairs', price };
  if (state.people.some((p) => { const l = toLocal(shop, p.x, p.z); return l.x > x && l.x < x + 1 && l.z > z && l.z < z + 1; })) return { ok: false, reason: 'Someone is standing there', price };
  // The back door's column keeps a tile.
  if (Math.abs(x + 0.5 - shop.backDoor.x) < 0.6 && !floorTileList(shop).some((t) => t.x === x && t.z !== z)) return { ok: false, reason: 'The back door needs a tile', price };
  // Still one room: every other tile reachable from the door's.
  const rest = floorTileList(shop).filter((t) => !(t.x === x && t.z === z));
  const keys = new Set(rest.map((t) => tileKey(t.x, t.z)));
  const start = tileKey(shop.door.x - 0.5, shop.floor.z1 - 1), seen = new Set([start]), todo = [start];
  while (todo.length) {
    const [tx, tz] = todo.pop()!.split(',').map(Number) as [number, number];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = tileKey(tx + dx!, tz + dz!); if (keys.has(k) && !seen.has(k)) { seen.add(k); todo.push(k); } }
  }
  if (seen.size !== keys.size) return { ok: false, reason: 'The shop would come apart', price };
  // The lot moves in with the walls: nothing out there may end up on its paths, and no painted bay may go.
  const trial = { ...shop };
  setFloorTiles(trial, rest);
  trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 };
  if (paintedBays(trial).bays.length < paintedBays(shop).bays.length) return { ok: false, reason: 'A bay at the back would go: paint it out first', price };
  const clash = lotClash(state, trial);
  if (clash) return { ok: false, reason: clash, price };
  // The floors above lose it too: nothing up there (nor the way up to them) may be cut off. The back door comes
  // forward with its column (see sellTile), and the ways that stay open when building stay open.
  trial.ceilings = shop.ceilings?.map((row) => row.filter((k) => k !== tileKey(x, z)));
  const col = rest.filter((t) => Math.abs(t.x + 0.5 - shop.backDoor.x) < 0.01);
  if (col.length) trial.backDoor = { x: shop.backDoor.x, z: Math.min(...col.map((t) => t.z)) };
  const inside = buildGrid(trial, -1, true), why = cutOff(state, reachOf(state, shop), reachOf(state, trial, inside), trial) ?? shuts(state, trial, inside);
  if (why) return { ok: false, reason: why, price };
  return { ok: true, reason: above ? 'Sell this tile, and the panels over it' : 'Sell this tile', price };
}

/** Sell a tile of floor back: the walls come in round it. */
export function sellTile(state: GameState, x: number, z: number): string | null {
  const check = canSellTile(state, x, z);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop;
  const rest = floorTileList(shop).filter((t) => !(t.x === x && t.z === z));
  // The panels over it go with it, on every floor.
  const rows = ensureCeilings(shop);
  for (let L = 0; L < rows.length; L++) rows[L] = rows[L]!.filter((k) => k !== tileKey(x, z));
  setFloorTiles(shop, rest);
  // Its finish goes with it, on every floor (bought back, it is bare again up there too).
  const keys = Array.from({ length: MAX_LEVELS }, (_, L) => tileKey(x, zOnLevel(z, L)));
  if (keys.some((k) => shop.tileStyles?.[k])) { const st = { ...shop.tileStyles }; for (const k of keys) delete st[k]; shop.tileStyles = st; }
  // The back door comes forward to the back edge of its column.
  const col = rest.filter((t) => Math.abs(t.x + 0.5 - shop.backDoor.x) < 0.01);
  if (col.length) shop.backDoor = { x: shop.backDoor.x, z: Math.min(...col.map((t) => t.z)) };
  reshape(state);
  return null;
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
/**
 * The ceilings above the ground floor a tile bought gets a panel in, each at the panel price: every one with
 * panels in it (an open floor's, or one shut, kept for when it opens), so the floors above grow with the shop.
 * The one over the ground floor comes with the tile, as ever. (Sold, a tile pays 60% back on each, as a panel.)
 */
export function grownCeilings(shop: GameState['shop']): number[] { return (shop.ceilings ?? []).flatMap((row, L) => L > 0 && row.length ? [L] : []); }
/** What the next tile costs: the tile, and its panel in each ceiling upstairs. */
export function tileCost(shop: GameState['shop']): number { return tilePrice(shop) + grownCeilings(shop).length * PANEL_PRICE; }

export function canBuyTile(state: GameState, x: number, z: number): PlaceCheck {
  const shop = state.shop, price = tileCost(shop), up = grownCeilings(shop).length, m = MAX_FLOOR, f = shop.floor;
  if (levelOfZ(z + 0.5) > 0) return { ok: false, reason: 'Grow the ground floor: the floors above grow with it (Upstairs tab: ceiling panels)', price };
  if (Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6) return { ok: false, reason: 'Snap to a tile', price };
  if (isFloor(shop, x, z)) return { ok: false, reason: 'That is floor already', price };
  if (z + 1 > m.z1) return { ok: false, reason: 'The front wall stays where it is', price };
  if (x < m.x0 || x + 1 > m.x1 || z < m.z0) return { ok: false, reason: 'The plot ends here', price };
  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isFloor(shop, x + dx!, z + dz!))) return { ok: false, reason: 'Next to the floor you have', price };
  // The walls and the lot move out with it: nothing out on the lot may end up in the way.
  const trial = { ...shop };
  setFloorTiles(trial, [...floorTileList(shop), { x, z }]);
  trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 };
  const clash = lotClash(state, trial);
  if (clash) return { ok: false, reason: clash, price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  // The walls go up round it: never round anyone.
  const over = builtOver(state, buildGrid(trial, -1));
  if (over) return { ok: false, reason: over, price };
  return { ok: true, reason: up ? `More floor, and ${up === 1 ? 'a ceiling panel' : `${up} ceiling panels`} over it upstairs` : 'More floor', price };
}

/** Build one more tile of shop: the walls move out round it. */
export function buyTile(state: GameState, x: number, z: number): string | null {
  const check = canBuyTile(state, x, z);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  // It comes with a ceiling panel, like the rest, and one (paid for) in each ceiling up there: the floors above grow with it.
  const rows = ensureCeilings(state.shop);
  for (const L of [0, ...grownCeilings(state.shop)]) rows[L] = [...rows[L]!, tileKey(x, z)];
  addFloor(state.shop, [{ x, z }]);
  // (New floor comes with the cheapest finish, up there too: lay a better one a tile at a time. See keepFinishes.)
  reshape(state);
  return null;
}

/** Make tiles floor, on top of what there is. */
function addFloor(shop: GameState['shop'], tiles: { x: number; z: number }[]): void {
  setFloorTiles(shop, [...floorTileList(shop), ...tiles]);
}

/** The floor is exactly these tiles: its bounding rectangle, and the tiles in it that are not floor as gaps. */
function setFloorTiles(shop: GameState['shop'], tiles: { x: number; z: number }[]): void {
  const keys = new Set(tiles.map((t) => tileKey(t.x, t.z)));
  const nf = { x0: Math.min(...tiles.map((t) => t.x)), z0: Math.min(...tiles.map((t) => t.z)), x1: Math.max(...tiles.map((t) => t.x + 1)), z1: Math.max(...tiles.map((t) => t.z + 1)) };
  const gaps: string[] = [];
  for (let zz = nf.z0; zz < nf.z1 - 1e-6; zz++) for (let xx = nf.x0; xx < nf.x1 - 1e-6; xx++) if (!keys.has(tileKey(xx, zz))) gaps.push(tileKey(xx, zz));
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
  // Finishes on stretches of wall that are gone now (built over, or moved out) go with them.
  if (shop.wallStyles) { const live = new Set(wallSegments(shop).map((w) => w.key)); shop.wallStyles = Object.fromEntries(Object.entries(shop.wallStyles).filter(([k]) => live.has(k))); }
  const n = floorTileCount(shop);
  shop.sizeId = sizeOfTiles(n);
  shop.storageCapacity = 120 + 5 * Math.max(0, n - 30);
  const L = lotLayout(shop);
  shop.bays = L.bays.map((b, i) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: shop.bays[i]?.carId ?? null }));
  shop.lotRows = paintedBays(shop).rows;
  // Paving the building or the moved lanes now cover is gone with the grass.
  pruneSurfaces(shop);
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
  const level = levelOfZ(z + 0.5);
  for (const r of [prefer, 0, 1, 3, 2] as Rot[]) {
    const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][r]!;
    if (!insideOn(state.shop, level, x - fc.x, groundZ(z - fc.z)) && !(type === 'window' && r === 2 && level === 0)) return r;
  }
  return null;
}

/**
 * Old saves had painted bands on every wall, said nowhere: each stretch there is keeps them, written down, and walls
 * gained later come plain, as in a new game (bands for nothing on every new stretch sold back as plain paid out).
 */
export function bandsWrittenDown(state: GameState): void {
  const shop = state.shop;
  if (shop.wallStyle) return;
  shop.wallStyles = { ...Object.fromEntries(wallSegments(shop).map((w) => [w.key, 'bands' as WallStyle])), ...shop.wallStyles };
  shop.wallStyle = 'plain';
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
  {
    const trial = { ...shop }; setFloorTiles(trial, [...floorTileList(shop), ...want]); trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 }; const clash = lotClash(state, trial); if (clash) return clash;
    // The delivery pallet goes to the new back corner: nothing may stand there, nor a way up be stepped onto from
    // it, nor anything upstairs be cut off by it.
    const zone = deliveryZone(trial.floor);
    if (shop.fixtures.some((fx) => !FIXTURES[fx.type].outdoor && !FIXTURES[fx.type].onWall && levelOf(fx) === 0 && overlaps(footprintOf(fx.type, fx.x, fx.z, fx.rot), zone))) return 'Clear the back corner first: the delivery pallet goes there.';
    const foot = shop.fixtures.find((fx) => VERTICAL.has(fx.type) && (() => { const b = rideEnds(fx).bottom; return overlaps({ x0: b.x - 0.5, z0: b.z - 0.5, x1: b.x + 0.5, z1: b.z + 0.5 }, zone); })());
    if (foot) return `The delivery pallet would go where you get on the ${FIXTURES[foot.type].name.toLowerCase()}: move it first.`;
    trial.delivery = zone; trial.backDoor = { x: shop.backDoor.x, z: trial.floor.z0 };
    const why = cutOff(state, reachOf(state, shop), reachOf(state, trial), trial);
    if (why) return `${why}: the delivery pallet goes to the new back corner.`;
    // The walls go up round it: never round anyone.
    const over = builtOver(state, buildGrid(trial, -1));
    if (over) return over;
  }
  // Each tile at the tile price as it goes in, and its panels upstairs (as a tile bought).
  const up = grownCeilings(shop);
  let n = floorTileCount(shop), cost = 0;
  for (let i = 0; i < want.length; i++, n++) cost += tilePriceAt(n) + up.length * PANEL_PRICE;
  if (state.cash < cost) return `Need ${dollars(cost)} for the extension.`;
  state.cash -= cost;
  const rows = ensureCeilings(shop);
  for (const L of [0, ...up]) rows[L] = [...rows[L]!, ...want.map((t) => tileKey(t.x, t.z))];
  addFloor(shop, want);
  // The delivery pallet goes to the new back corner, by the back door.
  shop.delivery = deliveryZone(shop.floor);
  shop.backDoor = { x: shop.backDoor.x, z: shop.floor.z0 };
  reshape(state);
  state.notices.push({ day: state.day, text: `Extension built: the shop is now a ${size.name.toLowerCase()}.`, kind: 'info' });
  return null;
}

/** Paint every bay the car park has room for, at the bay price each (the Build card paints them one at a time). */
export function expandLot(state: GameState): string | null {
  const err = paintAllBays(state);
  if (!err) state.notices.push({ day: state.day, text: `More parking: ${state.shop.bays.length} bays now.`, kind: 'info' });
  return err;
}

export function moveFixture(state: GameState, id: number, x: number, z: number, rot: Rot): string | null {
  const f = state.shop.fixtures.find((fx) => fx.id === id);
  if (!f) return 'No such fixture.';
  if (f.type === 'register' && (f.serving || (f.queue?.length ?? 0) > 0)) return 'Wait until the line is served.';
  if (f.bikes?.some((b) => b !== null)) return 'Bikes are locked to it: wait till they ride off.';
  if (state.people.some((p) => p.climb !== undefined && p.path[p.pathIdx]?.via === id)) return 'Someone is on it: wait till they are off.';
  const check = canPlace(state, f.type, x, z, rot, id);
  if (!check.ok) return check.reason;
  const opened = VERTICAL.has(f.type) ? [...storeysOf(state.shop).built] : null;
  f.x = x; f.z = z; f.rot = rot;
  state.shop.layoutVersion++;
  // A floor it opens where it goes gets its ceiling, as placing it there would.
  if (opened) { ceilFloorsOpened(state.shop, opened); state.cash -= check.ceiling ?? 0; }
  return null;
}

/**
 * Loading an older save: a way up facing out through a wall (the first build of floors let one be put so) is
 * turned, or moved a tile or two, to be stepped onto from the floor inside. With nowhere it fits, it stays and
 * still goes up, from outside, and the news says so.
 */
export function stepOnInside(state: GameState): void {
  const shop = state.shop, out = shop.fixtures.filter((f) => VERTICAL.has(f.type) && (() => { const b = rideEnds(f).bottom; return !isFloor(shop, b.x - 0.5, b.z - 0.5); })());
  if (!out.length) return;
  // Never the walking grid of the game played before this one.
  resetGridCache();
  for (const f of out) {
    let moved = false;
    for (let r = 0; r <= 2 && !moved; r++) for (let dz = -r; dz <= r && !moved; dz++) for (let dx = -r; dx <= r && !moved; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const k of [2, 1, 3, 0]) if (!moved) moved = !moveFixture(state, f.id, f.x + dx, f.z + dz, ((f.rot + k) % 4) as Rot);
    }
    const name = FIXTURES[f.type].name;
    state.notices.push({ day: state.day, text: moved ? `${name}: turned to be stepped onto from inside the shop.` : `${name}: stepped onto from outside. Turn or move it to step on from inside.`, kind: 'info' });
  }
  repathAfterBuild(state);
}
