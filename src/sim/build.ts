/**
 * Build mode rules: where fixtures may go, what they cost, growing the shop and the lot.
 * Placement never blocks a path: the door, the back door and every fixture's front reached now
 * must stay reachable after the change.
 */
import type { GameState, FixtureType, Rot, Fixture, FloorStyle, WallStyle, Shop, Person } from './types';
import { DEFAULT_PAINT, FIXTURES, mainDoor, serviceDoor, entrances, byDoor, DOORS, SHOP_SIZES, FLOORS, paintedBays, MAX_FLOOR, lotLayout, toWorld, toLocal, yawToWorld, isFloor, floorTileList, floorTileCount, tileKey, tilePrice, tilePriceAt, sizeOfTiles, WALLS, RESALE, WALL_T, wallSegments, outlineSegments, edgeOf, edgeIndex, edgePieceAt, edgeSide, SOLID_EDGE, HANGS_ON, FACING, footprintOf, overlaps, levelOfZ, groundZ, insideOn, levelOf, zOnLevel, VERTICAL, rideEnds, MAX_LEVELS, storeysOf, shopTileList, onBuilding, refundOf, TALL_WALLS } from './layout';
import { placeUpstairs, ensureCeilings, levelOfPerson, withoutIt, ceilingPrice, ceilFloorsOpened, strands, reachOf, cutOff, repathAfterBuild, PANEL_PRICE } from './storeys';
import { buildGrid, frontInside, cellOf, isBlocked, type Grid } from './grid';
import { findPath } from './pathfinding';
import { doorInside, doorOutside, storeroomPoint } from './people';
import { dollars } from './money';
import { resetGridCache, gridFor } from './state';
import { canPlaceOutside, lotClash, pruneSurfaces, paintAllBays, bayLaid } from './lot';
import { syncLotBays, relayLot } from './drive';

/** `ceiling`: the part of the price that is a ceiling over a floor it opens (all a move costs). */
export interface PlaceCheck { ok: boolean; reason: string; price: number; ceiling?: number }

/** Pieces that reach up to the ceiling (or hang from it): a camera up there would be inside them. */
const TO_CEILING: ReadonlySet<FixtureType> = new Set<FixtureType>(['pendant', 'vending', 'storeRack', 'freezer', 'kiosk', 'endcap', 'sign', ...VERTICAL]);
/** Is `light` a light hung up out of the way (on a wall, from the ceiling) and `under` a piece standing on the floor below it that stays clear of it? */
const underLight = (light: FixtureType, under: FixtureType): boolean => {
  const l = FIXTURES[light], u = FIXTURES[under];
  return l.category === 'lights' && (!!l.onWall || light === 'pendant') && !u.onWall && !u.overhead && !u.edge && !u.outdoor && under !== 'pendant' && !TO_CEILING.has(under);
};

/** Is (x, z) not a tile's corner? (The Build card snaps to tiles; a command need not.) */
function offTile(shop: Shop, x: number, z: number): boolean { const f = shop.floor; return Math.abs((x - f.x0) - Math.round(x - f.x0)) > 1e-6 || Math.abs((z - f.z0) - Math.round(z - f.z0)) > 1e-6; }

/** Can this fixture go here? Reason is in plain words for the ghost label. */
export function canPlace(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck {
  const def = FIXTURES[type];
  // Out on the lot: its own grid and rules. A wall or a door: on an edge of its tile.
  if (def.outdoor) return canPlaceOutside(state, type, x, z, rot, ignoreId);
  if (def.edge) return canPlaceEdge(state, type, x, z, rot, ignoreId);
  if (def.unlisted) return { ok: false, reason: 'Put up a Wall with window instead', price: def.price };
  const shop = state.shop;
  let price = def.price;
  if (offTile(shop, x, z)) return { ok: false, reason: 'Snap to a floor tile', price };
  const level = levelOfZ(z + 0.5);
  const up = placeUpstairs(state, type, x, z, rot, ignoreId);
  if (up) return up;
  if (!isFloor(withoutIt(shop, type, ignoreId), x, z)) return { ok: false, reason: level > 0 ? 'Only on the floor up here' : 'Only inside the shop floor', price };
  // One thing per tile, except a window: it is up in the wall behind, so a shelf can stand in front of it
  // (but a light hung on the same wall cannot share it). The stairs take two.
  const sameWall = (fx: Fixture) => !!def.onWall && !!FIXTURES[fx.type].onWall && fx.rot === rot;
  const mine = footprintOf(type, x, z, rot);
  // (A camera up on the ceiling shares its tile with what stands under it, but not with another up there,
  // nor with anything that reaches up to the ceiling.)
  const apart = (fx: Fixture) => !!def.overhead !== !!FIXTURES[fx.type].overhead && !TO_CEILING.has(def.overhead ? fx.type : type)
    // (Nor does a light hung on the wall or from the ceiling with what stands on the floor under it, unless that reaches up to it.)
    || underLight(type, fx.type) || underLight(fx.type, type);
  if (shop.fixtures.some((fx) => fx.id !== ignoreId && !FIXTURES[fx.type].outdoor && !FIXTURES[fx.type].edge && !apart(fx) && (fx.x === x && fx.z === z
    ? (sameWall(fx) || (type !== 'window' && fx.type !== 'window'))
    : type !== 'window' && fx.type !== 'window' && overlaps(footprintOf(fx.type, fx.x, fx.z, fx.rot), mine)))) return { ok: false, reason: 'Something is already there', price };
  // Nor where a ride is got on or comes off: whoever steps off would step into it (nor may a flight come up onto anything).
  const ends = def.walkable ? undefined : shop.fixtures.find((fx) => fx.id !== ignoreId && VERTICAL.has(fx.type) && (() => { const e = rideEnds(fx); return [e.bottom, e.top].some((t) => overlaps(mine, { x0: t.x - 0.5, z0: t.z - 0.5, x1: t.x + 0.5, z1: t.z + 0.5 })); })());
  if (ends) return { ok: false, reason: `Keep the way on and off the ${FIXTURES[ends.type].name.toLowerCase()} clear`, price };
  // A doormat, a rug, a light on the wall: nothing anyone could bump into, so they may go by the doors.
  if (!def.walkable && entrances(shop).some((d) => overlaps(mine, { x0: d.f.x, z0: d.f.z, x1: d.f.x + 1, z1: d.f.z + 1 }))) return { ok: false, reason: 'Keep the door clear', price };
  if (def.onWall) {
    // Its back against a wall: one on the edge of its tile behind it (round the shop or across it), not a window or a door.
    const w = edgePieceAt(shop.fixtures, x, z, rot);
    if (!w || w.id === ignoreId) return { ok: false, reason: 'Hang it on a wall, facing in (R turns it)', price };
    if (!HANGS_ON.has(w.type)) return { ok: false, reason: w.type === 'frontDoor' || w.type === 'backDoor' || w.type === 'doorway' || w.type === 'gate' ? 'Not over a door' : 'Hang it on a plain wall, not a window', price };
  }
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
 * Where the main door and the service door are (shop.door, shop.backDoor: the middle of each one's line), from the doors
 * in the walls (see mainDoor, serviceDoor): the rest of the game asks there. With no way in at all, where they were.
 */
export function syncDoors(shop: Shop): void {
  const main = mainDoor(shop), service = serviceDoor(shop);
  if (main) shop.door = { x: main.x, z: main.z };
  if (service) shop.backDoor = { x: service.x, z: service.z };
}

/** Pieces hanging on this wall (a light, a camera, a wall shelf), on either side of it. */
export function hungOn(shop: Shop, wall: { x: number; z: number; rot: number }): Fixture[] {
  const key = edgeOf(wall).key;
  return shop.fixtures.filter((f) => FIXTURES[f.type].onWall && edgeOf(f).key === key);
}

/**
 * A wall or a door: on an edge of a floor tile (the one behind it as it faces; R turns it round the tile), one to an
 * edge. Round the floor it stands out in the band a wall has always stood in; across it, on the line between two
 * tiles. The doors move but stay doors: the front one along the front wall, the back one in a wall at the back.
 */
function canPlaceEdge(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck {
  const shop = state.shop, def = FIXTURES[type], price = def.price;
  const moving = ignoreId !== undefined ? shop.fixtures.find((f) => f.id === ignoreId) : undefined;
  if (def.fixed && !moving) return { ok: false, reason: `The shop has its ${def.name.toLowerCase()}: move it`, price };
  if (offTile(shop, x, z)) return { ok: false, reason: 'Snap to a floor tile', price };
  const level = levelOfZ(z + 0.5);
  const up = placeUpstairs(state, type, x, z, rot, ignoreId);
  if (up) return up;
  if (!isFloor(shop, x, z)) return { ok: false, reason: level > 0 ? 'Only on the floor up here' : 'Only inside the shop floor', price };
  const e = edgeOf({ x, z, rot });
  const across = insideOn(shop, level, e.bx, groundZ(e.bz));
  const there = edgeIndex(shop.fixtures).get(e.key);
  if (there && there.id !== ignoreId) return { ok: false, reason: FIXTURES[there.type].fixed ? `The ${FIXTURES[there.type].name.toLowerCase()} is there` : 'A wall is there already (R turns it to another side)', price };
  // A tall wall reaches up through a double-height space (no panel over its tile: placeUpstairs), and stands as the
  // wall up there on its line: none of that floor's may be on it.
  if (TALL_WALLS.has(type) && edgeIndex(shop.fixtures).get(edgeOf({ x, z: zOnLevel(z, 1), rot }).key)) return { ok: false, reason: 'A wall upstairs stands on that line', price };
  if (moving && hungOn(shop, moving).length) return { ok: false, reason: 'Take down what hangs on it first', price };
  // A door out of the shop opens onto its tile: nothing may stand in the way there.
  if (DOORS.has(type) && !across && level === 0 && shop.fixtures.some((f) => f.id !== ignoreId && !FIXTURES[f.type].walkable && !FIXTURES[f.type].edge && levelOf(f) === 0 && overlaps(footprintOf(f.type, f.x, f.z, f.rot), { x0: x, z0: z, x1: x + 1, z1: z + 1 }))) return { ok: false, reason: `Keep the ${def.name.toLowerCase()} clear: something stands inside it`, price };
  if (!moving && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  // Nobody stands across its line (a wall round the shop: nobody where it goes up out there either).
  if (SOLID_EDGE.has(type)) { const p = state.people.find((q) => inWallsWay(shop, q, { x, z, rot })); if (p) return { ok: false, reason: p.kind === 'owner' ? 'You are standing there' : 'Someone is standing there', price }; }
  // The main door and the delivery door wherever the doors are then, and one way out at least.
  const trial: Fixture = { id: ignoreId ?? -1, type, x, z, rot, slots: [] };
  const trialShop: Shop = { ...shop, fixtures: shop.fixtures.filter((f) => f.id !== ignoreId).concat([trial]) };
  if (!entrances(trialShop).length) return { ok: false, reason: 'The shop needs a door to the outside', price };
  syncDoors(trialShop);
  const inside = buildGrid(trialShop, -1, true), open = buildGrid(trialShop, -1);
  const shut = builtOver(state, open) ?? shuts(state, trialShop, inside, open);
  if (shut) return { ok: false, reason: shut, price };
  const why = cutOff(state, reachOf(state, shop), reachOf(state, trialShop, inside), trialShop, trial.id);
  if (why) return { ok: false, reason: why, price };
  return { ok: true, reason: def.fixed ? def.name : `${def.name}, ${across ? 'across the shop' : 'round the shop'}`, price };
}

/**
 * Is this person where a wall on this edge would go up? Astride its line, or round the shop anywhere out in the band
 * it fills (someone walking in over an open edge).
 */
function inWallsWay(shop: Shop, p: Person, at: { x: number; z: number; rot: number }): boolean {
  if (p.kind === 'walker' || p.state === 'driving' || p.climb !== undefined || levelOfPerson(shop, p) !== levelOfZ(at.z + 0.5)) return false;
  const e = edgeOf(at), l = toLocal(shop, p.x, p.z), m = 0.22;
  // (Along its line, and across it: out from the tile it faces into.)
  const along = Math.abs((e.axis === 'x' ? l.x : l.z) - e.t), across = ((e.axis === 'x' ? l.z : l.x) - e.line) * (e.axis === 'x' ? e.nz : e.nx);
  return along < 0.5 + m && across > -m && across < (edgeSide(shop, at) === 'outer' ? WALL_T : 0) + m;
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
  // The door deliveries come in at, wherever it is.
  const sd = serviceDoor(shop), by = (out: number, side = 0) => { const p = sd ? byDoor(sd, out, side) : { x: shop.backDoor.x, z: shop.backDoor.z - out }; return toWorld(shop, p.x, p.z); };
  if (!findPath(open, from, by(0.6))) out.push('Would block the delivery door');
  if ([-0.25, 0.25].some((dx) => [-0.25, -0.75].some((dz) => { const [cx, cz] = cellOf(inside, by(dz, dx)); return isBlocked(inside, cx, cz); }))) out.push('Keep the delivery door clear');
  if (!findPath(inside, from, by(-0.6))) out.push('Would cut the shop in two');
  if (!findPath(inside, from, storeroomPoint(at, inside))) out.push('Would block the way to the pallet');
  // Where boxes are picked up itself, or the way there is judged by the nearest free floor to it (a pocket, maybe).
  if (isBlocked(inside, ...cellOf(inside, storeroomPoint(at, inside)))) out.push('Keep the way to the pallet clear');
  return out;
}
/** Why a change (making the shop `trial`, `inside` its grid with the back door shut) would shut one of those ways that is open now, or null. What is shut already (an older save's) stops nobody. */
function shuts(state: GameState, trial: Shop, inside: Grid, open?: Grid): string | null {
  const now = waysShut(state, trial, inside, open);
  if (!now.length) return null;
  const was = waysShut(state, state.shop, buildGrid(state.shop, -1, true), gridFor(state));
  return now.find((r) => !was.includes(r)) ?? null;
}

/** Why taking this piece away would shut a way that is open now (where it is judged to go moving into a pocket), or null. */
export function removalShuts(state: GameState, id: number): string | null {
  const trial = { ...state.shop, fixtures: state.shop.fixtures.filter((f) => f.id !== id) };
  return shuts(state, trial, buildGrid(trial, -1, true));
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
export function canPaintFloor(state: GameState, x: number, z: number, style: FloorStyle, colour?: string): PlaceCheck {
  const now = isFloor(state.shop, x, z) ? styleAt(state.shop, x, z) : null;
  // Repainting a painted tile another colour costs just the paint.
  const repaint = style === 'paint' && now === 'paint';
  const price = (FLOORS.find((f) => f.id === style)?.perTile ?? 0) - (repaint ? 0 : Math.round(RESALE * (FLOORS.find((f) => f.id === now)?.perTile ?? 0)));
  if (offTile(state.shop, x, z)) return { ok: false, reason: 'Snap to a tile', price };
  if (!now) return { ok: false, reason: 'Only on the shop floor', price };
  if (style === 'photo' && !state.shop.floorImage) return { ok: false, reason: 'Choose a picture first', price };
  if (now === style && (!repaint || (state.shop.tileColors?.[tileKey(x, z)] ?? DEFAULT_PAINT).toUpperCase() === (colour ?? DEFAULT_PAINT).toUpperCase())) return { ok: false, reason: repaint ? 'That colour is on it already' : 'That floor is down already', price };
  if (price > 0 && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: FLOORS.find((f) => f.id === style)?.name ?? style, price };
}

/** Walls round the shop that take a finish on their inside face (a door, a doorway, a gate or a railing has none). */
export const FINISHED: ReadonlySet<FixtureType> = new Set<FixtureType>(['wall', 'wallWindow', 'tallWall', 'tallWindow']);
/** The wall round the shop on this stretch (keyed as wallSegments), if it takes a finish. */
export function finishedWall(shop: Shop, key: string): Fixture | undefined {
  const seg = wallSegments(shop).find((w) => w.key === key);
  const f = seg && shop.fixtures.find((x) => x.id === seg.id);
  return f && FINISHED.has(f.type) ? f : undefined;
}
/** The finish on one wall: its own, or the shop's. */
export function finishOf(shop: Shop, f: { finish?: WallStyle }): WallStyle { return f.finish ?? shop.wallStyle ?? 'bands'; }
/** The finish on one stretch of wall round the shop. */
export function wallStyleAt(shop: Shop, key: string): WallStyle {
  const f = finishedWall(shop, key);
  return f ? finishOf(shop, f) : shop.wallStyle ?? 'bands';
}

/** Can this wall be given this finish (on its inside face)? Priced as floors are (the old finish sells back). */
export function canPaintWall(state: GameState, key: string, style: WallStyle, colour?: string): PlaceCheck {
  const f = finishedWall(state.shop, key);
  const now = f ? finishOf(state.shop, f) : null;
  const repaint = style === 'paint' && now === 'paint';
  const price = (WALLS.find((w) => w.id === style)?.perSeg ?? 0) - (repaint ? 0 : Math.round(RESALE * (WALLS.find((w) => w.id === now)?.perSeg ?? 0)));
  if (!f || !now) return { ok: false, reason: 'Point at a wall round the shop', price };
  if (now === style && (!repaint || (f.paint ?? DEFAULT_PAINT).toUpperCase() === (colour ?? DEFAULT_PAINT).toUpperCase())) return { ok: false, reason: repaint ? 'That colour is on it already' : 'That wall has it already', price };
  if (price > 0 && state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: WALLS.find((w) => w.id === style)?.name ?? style, price };
}

/** Give one wall a finish (it goes where the wall goes). */
export function paintWall(state: GameState, key: string, style: WallStyle, colour?: string): string | null {
  const check = canPaintWall(state, key, style, colour);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const f = finishedWall(state.shop, key)!;
  if (style === (state.shop.wallStyle ?? 'bands')) delete f.finish; else f.finish = style;
  if (style === 'paint') f.paint = colour ?? DEFAULT_PAINT; else delete f.paint;
  state.shop.layoutVersion++;
  return null;
}

/**
 * The walls and doors once these tiles (ground keys) are floor no more, on any floor of the building (`after`: the
 * shop then): one on such a tile faces the other way, onto the floor beyond its edge, or with no floor there goes,
 * sold back (nothing is put up in its place).
 */
function wallsAfter(after: Shop, gone: Set<string>): { turned: Map<number, { x: number; z: number; rot: Rot }>; sold: Fixture[] } {
  const turned = new Map<number, { x: number; z: number; rot: Rot }>(), sold: Fixture[] = [];
  for (const f of after.fixtures) {
    if (!FIXTURES[f.type].edge || !gone.has(tileKey(f.x, groundZ(f.z)))) continue;
    const e = edgeOf(f);
    if (isFloor(after, e.bx, e.bz)) turned.set(f.id, { x: e.bx, z: e.bz, rot: ((f.rot + 2) & 3) as Rot });
    else sold.push(f);
  }
  return { turned, sold };
}
/** The shop's pieces with the walls turned and gone as wallsAfter says. */
function withWalls(fixtures: Fixture[], w: ReturnType<typeof wallsAfter>): Fixture[] {
  return fixtures.filter((f) => !w.sold.includes(f)).map((f) => { const t = w.turned.get(f.id); return t ? { ...f, ...t } : f; });
}

/**
 * Can this tile of floor be sold back? Not the front door's tile, the back door's, the pallet's, one with anything
 * on it or anyone standing on it, nor one the rest of the floor hangs from (it must stay one room). The walls on its
 * edges with nothing beyond them go with it; none goes up in their place.
 */
export function canSellTile(state: GameState, x: number, z: number): PlaceCheck {
  // The panels over it on the floors above go with it, 60% back as taken down (the one over the ground floor came with it).
  const shop = state.shop, n = floorTileCount(shop), above = shop.ceilings?.slice(1).filter((r) => r.includes(tileKey(x, z))).length ?? 0;
  let price = -Math.round(RESALE * tilePriceAt(n - 1)) - above * Math.round(RESALE * PANEL_PRICE);
  if (levelOfZ(z + 0.5) > 0) return { ok: false, reason: 'Upstairs, take the ceiling panel down instead (Upstairs tab)', price };
  if (offTile(shop, x, z)) return { ok: false, reason: 'Snap to a tile', price };
  if (!isFloor(shop, x, z)) return { ok: false, reason: 'Point at a tile of floor', price };
  // A door out of the shop opens onto it: moved first.
  const doors = entrances(shop);
  if (doors.some((d) => d.f.x === x && d.f.z === z)) return { ok: false, reason: 'A door stands here: move it first', price };
  if (shop.fixtures.some((f) => !FIXTURES[f.type].outdoor && levelOf(f) === 0 && overlaps(footprintOf(f.type, f.x, f.z, f.rot), { x0: x, z0: z, x1: x + 1, z1: z + 1 }))) return { ok: false, reason: 'Move or sell what is on it first', price };
  for (let L = 1; L < MAX_LEVELS; L++) {
    const t = { x0: x, z0: zOnLevel(z, L), x1: x + 1, z1: zOnLevel(z, L) + 1 };
    if (shop.fixtures.some((f) => !FIXTURES[f.type].outdoor && levelOf(f) === L && overlaps(footprintOf(f.type, f.x, f.z, f.rot), t))) return { ok: false, reason: 'Something upstairs stands over it', price };
  }
  if (shop.fixtures.some((f) => VERTICAL.has(f.type) && (() => { const t = rideEnds(f).top; return t.x - 0.5 === x && groundZ(t.z - 0.5) === z; })())) return { ok: false, reason: 'The stairs come up over it', price };
  if (shop.fixtures.some((f) => VERTICAL.has(f.type) && (() => { const b = rideEnds(f).bottom; return b.x - 0.5 === x && groundZ(b.z - 0.5) === z; })())) return { ok: false, reason: 'You step onto the stairs from it', price };
  if (state.people.some((p) => p.kind !== 'walker' && levelOfPerson(shop, p) > 0 && (() => { const l = toLocal(shop, p.x, p.z); return l.x > x && l.x < x + 1 && groundZ(l.z) > z && groundZ(l.z) < z + 1; })())) return { ok: false, reason: 'Someone is standing over it upstairs', price };
  if (state.people.some((p) => { const l = toLocal(shop, p.x, p.z); return l.x > x && l.x < x + 1 && l.z > z && l.z < z + 1; })) return { ok: false, reason: 'Someone is standing there', price };
  // Still one room: every other tile reachable from the door's.
  const rest = floorTileList(shop).filter((t) => !(t.x === x && t.z === z));
  const keys = new Set(rest.map((t) => tileKey(t.x, t.z)));
  // (From a door's tile that stays: the main door's, unless it is this one.)
  const by = doors.find((d) => d.f.x !== x || d.f.z !== z), first = by ? { x: by.f.x, z: by.f.z } : rest[0];
  const start = first ? tileKey(first.x, first.z) : '', seen = new Set([start]), todo = [start];
  while (todo.length) {
    const [tx, tz] = todo.pop()!.split(',').map(Number) as [number, number];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = tileKey(tx + dx!, tz + dz!); if (keys.has(k) && !seen.has(k)) { seen.add(k); todo.push(k); } }
  }
  if (seen.size !== keys.size) return { ok: false, reason: 'The shop would come apart', price };
  // The lot moves in with the walls: nothing out there may end up on its paths, and no painted bay may go.
  const trial = { ...shop };
  setFloorTiles(trial, rest);
  trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 };
  if (!shop.lotBaked && paintedBays(trial).bays.length < paintedBays(shop).bays.length) return { ok: false, reason: 'A bay at the back would go: paint it out first', price };
  const clash = lotClash(state, trial);
  if (clash) return { ok: false, reason: clash, price };
  // The floors above lose it too: nothing up there (nor the way up to them) may be cut off, and the ways that stay
  // open when building stay open (judged with the walls on its edges gone or turned).
  trial.ceilings = shop.ceilings?.map((row) => row.filter((k) => k !== tileKey(x, z)));
  const walls = wallsAfter(trial, new Set([tileKey(x, z)]));
  trial.fixtures = withWalls(shop.fixtures, walls);
  const inside = buildGrid(trial, -1, true), why = cutOff(state, reachOf(state, shop), reachOf(state, trial, inside), trial) ?? shuts(state, trial, inside);
  if (why) return { ok: false, reason: why, price };
  price -= walls.sold.reduce((a, f) => a + refundOf(f, state), 0);
  const also = [above ? 'the panels over it' : '', walls.sold.length ? (walls.sold.length === 1 ? `the ${FIXTURES[walls.sold[0]!.type].name.toLowerCase()} on it` : 'the walls on it') : ''].filter(Boolean);
  return { ok: true, reason: also.length ? `Sell this tile, and ${also.join(' and ')}` : 'Sell this tile', price };
}

/** Sell a tile of floor back: the walls on its edges with no floor beyond them go with it (none goes up in their place). */
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
  // Its walls: turned to the floor beyond them, or gone (their money is in the price).
  const walls = wallsAfter(shop, new Set([tileKey(x, z)]));
  for (const f of shop.fixtures) { const t = walls.turned.get(f.id); if (t) { f.x = t.x; f.z = t.z; f.rot = t.rot; } }
  if (walls.sold.length) shop.fixtures = shop.fixtures.filter((f) => !walls.sold.includes(f));
  // Its finish goes with it, on every floor (bought back, it is bare again up there too).
  const keys = Array.from({ length: MAX_LEVELS }, (_, L) => tileKey(x, zOnLevel(z, L)));
  if (keys.some((k) => shop.tileStyles?.[k])) { const st = { ...shop.tileStyles }; for (const k of keys) delete st[k]; shop.tileStyles = st; }
  reshape(state);
  return null;
}

/** Lay a finish on one tile. */
export function paintFloor(state: GameState, x: number, z: number, style: FloorStyle, colour?: string): string | null {
  const check = canPaintFloor(state, x, z, style, colour);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const shop = state.shop;
  const styles = { ...shop.tileStyles };
  if (style === (shop.floorStyle ?? 'lino')) delete styles[tileKey(x, z)]; else styles[tileKey(x, z)] = style;
  shop.tileStyles = styles;
  const colours = { ...shop.tileColors };
  if (style === 'paint') colours[tileKey(x, z)] = colour ?? DEFAULT_PAINT; else delete colours[tileKey(x, z)];
  shop.tileColors = colours;
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

/** (`pushing`: a wall pushed out, its back door going out with it.) */
export function canBuyTile(state: GameState, x: number, z: number, pushing = false): PlaceCheck {
  const shop = state.shop, price = tileCost(shop), up = grownCeilings(shop).length, m = MAX_FLOOR;
  if (levelOfZ(z + 0.5) > 0) return { ok: false, reason: 'Grow the ground floor: the floors above grow with it (Upstairs tab: ceiling panels)', price };
  if (offTile(shop, x, z)) return { ok: false, reason: 'Snap to a tile', price };
  if (isFloor(shop, x, z)) return { ok: false, reason: 'That is floor already', price };
  if (z + 1 > m.z1) return { ok: false, reason: 'The front wall stays where it is', price };
  if (x < m.x0 || x + 1 > m.x1 || z < m.z0) return { ok: false, reason: 'The plot ends here', price };
  if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isFloor(shop, x + dx!, z + dz!))) return { ok: false, reason: 'Next to the floor you have', price };
  // A door opens out onto it (it would be a door inside the shop after): moved first, or pushed out with its wall.
  if (!pushing && entrances(shop).some((d) => { const e = edgeOf(d.f); return e.bx === x && e.bz === z; })) return { ok: false, reason: 'A door opens out here: move it first', price };
  // The walls and the lot move out with it: nothing out on the lot may end up in the way.
  const trial = { ...shop };
  setFloorTiles(trial, [...floorTileList(shop), { x, z }]);
  trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 };
  const clash = lotClash(state, trial);
  if (clash) return { ok: false, reason: clash, price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  // (No wall goes up round it: the walls are pieces. The one it is built against is across the shop now.)
  return { ok: true, reason: up ? `More floor, and ${up === 1 ? 'a ceiling panel' : `${up} ceiling panels`} over it upstairs` : 'More floor', price };
}

/** Build one more tile of shop. No wall goes up round it, nor moves: put walls up, or move them out, as you like. */
export function buyTile(state: GameState, x: number, z: number, pushing = false): string | null {
  const check = canBuyTile(state, x, z, pushing);
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

// ---- Moving a wall: the straight run of walls round the shop a wall pointed at is part of, pushed out a row (the
// floor beyond it bought, the walls moved out onto its far edge and the ends closed) or pulled in a row (the walls
// moved in a row and the floor behind them sold back). Floor bought or sold on its own moves no wall.

/** The straight run of walls round the ground floor the one keyed `key` is part of (the one pointed at first): the tiles inside and outside it, and the walls. */
export function wallRun(shop: Shop, key: string): { inside: { x: number; z: number }[]; outside: { x: number; z: number }[]; dir: string; walls: number[] } | null {
  const segs = wallSegments(shop), seg = segs.find((w) => w.key === key);
  if (!seg || levelOfZ(seg.axis === 'x' ? seg.line - 0.5 : seg.t) > 0) return null;
  const on = new Map(segs.filter((w) => w.dir === seg.dir && w.line === seg.line).map((w) => [w.t, w]));
  // Out along the wall from the one pointed at, nearest first, while the run goes on.
  const ts = [seg.t];
  for (const step of [1, -1]) for (let t = seg.t + step; on.has(t); t += step) ts.push(t);
  ts.sort((a, b) => Math.abs(a - seg.t) - Math.abs(b - seg.t));
  const inside = ts.map((t) => seg.axis === 'x' ? { x: t - 0.5, z: seg.nz > 0 ? seg.line - 1 : seg.line } : { x: seg.nx > 0 ? seg.line - 1 : seg.line, z: t - 0.5 });
  return { inside, outside: inside.map((c) => ({ x: c.x + seg.nx, z: c.z + seg.nz })), dir: seg.dir, walls: ts.map((t) => on.get(t)!.id) };
}

/** Can this wall be pushed out? Its price is every tile of the row beyond it; at least the first must be buyable. */
export function canPushWall(state: GameState, key: string): PlaceCheck & { tiles: number } {
  const run = wallRun(state.shop, key);
  if (!run) return { ok: false, reason: 'Point at a wall round the shop', price: 0, tiles: 0 };
  if (run.dir === 'front') return { ok: false, reason: 'The front wall stays where it is', price: 0, tiles: 0 };
  const first = canBuyTile(state, run.outside[0]!.x, run.outside[0]!.z, true);
  if (!first.ok) return { ...first, tiles: 0 };
  // The whole row at the price each tile will be (floor dearer as the shop grows), and its panels upstairs.
  const n = floorTileCount(state.shop), up = grownCeilings(state.shop).length * PANEL_PRICE;
  let price = 0;
  for (let k = 0; k < run.outside.length; k++) price += tilePriceAt(n + k) + up;
  return { ok: true, reason: `Push the wall out: ${run.outside.length} tile${run.outside.length > 1 ? 's' : ''} of floor`, price, tiles: run.outside.length };
}

/** The walls on this edge of a ground tile, on every floor it is floor on (and what hangs on each), moved a tile (nx, nz). */
function shiftWalls(shop: Shop, x: number, z: number, rot: number, nx: number, nz: number): void {
  for (let L = 0; L < MAX_LEVELS; L++) {
    const w = edgePieceAt(shop.fixtures, x, zOnLevel(z, L), rot);
    // (Only onto floor: a floor above without that tile keeps its wall where it is.)
    if (!w || !isFloor(shop, w.x + nx, w.z + nz)) continue;
    const there = edgePieceAt(shop.fixtures, w.x + nx, w.z + nz, w.rot);
    // Up against a wall there already: the two are one (this one goes, unless something hangs on it).
    if (there && there !== w) { if (!hungOn(shop, w).length) shop.fixtures = shop.fixtures.filter((f) => f !== w); continue; }
    for (const h of hungOn(shop, w)) { h.x += nx; h.z += nz; }
    w.x += nx; w.z += nz;
  }
}

/**
 * Push a wall out a row: tile by tile from the one pointed at, as far as the row can go (and the money lasts), the
 * walls (on every floor it grows on) and what hangs on them moving out with it; the open ends are walled for nothing.
 */
export function pushWall(state: GameState, key: string): string | null {
  const check = canPushWall(state, key);
  if (!check.ok) return check.reason;
  const shop = state.shop, run = wallRun(shop, key)!, grown: { x: number; z: number }[] = [];
  const first = shop.fixtures.find((f) => f.id === run.walls[0])!, n = edgeOf(first);
  for (let i = 0; i < run.outside.length; i++) {
    const c = run.inside[i]!, t = run.outside[i]!;
    if (buyTile(state, t.x, t.z, true)) break;
    grown.push(t);
    shiftWalls(shop, c.x, c.z, first.rot, n.nx, n.nz);
  }
  wallUp(state, grown, true);
  syncDoors(shop);
  shop.layoutVersion++;
  return null;
}

/** Can this wall be pulled in? The row inside it is sold back; at least the first tile must be sellable. */
export function canPullWall(state: GameState, key: string): PlaceCheck & { tiles: number } {
  const run = wallRun(state.shop, key);
  if (!run) return { ok: false, reason: 'Point at a wall round the shop', price: 0, tiles: 0 };
  if (run.dir === 'front') return { ok: false, reason: 'The front wall stays where it is', price: 0, tiles: 0 };
  const first = pullCheck(state, run, 0);
  if (!first.ok) return { ...first, tiles: 0 };
  return { ok: true, reason: `Pull the wall in: up to ${run.inside.length} tile${run.inside.length > 1 ? 's' : ''} sold back`, price: first.price * run.inside.length, tiles: run.inside.length };
}

/** Pulling the run's wall `i` in a row: the tile behind it sold, with the wall (and what hangs on it) moved in onto the floor in front first. */
function pullCheck(state: GameState, run: NonNullable<ReturnType<typeof wallRun>>, i: number): PlaceCheck {
  const shop = state.shop, c = run.inside[i]!, w = shop.fixtures.find((f) => f.id === run.walls[i]), price = 0;
  if (!w) return { ok: false, reason: 'Point at a wall round the shop', price };
  const e = edgeOf(w), into = { x: c.x - e.nx, z: c.z - e.nz };
  if (!isFloor(shop, into.x, into.z)) return { ok: false, reason: 'No floor to pull it in onto', price };
  // Nobody across the line it comes in to (the tile behind it is checked as it is sold).
  const p = state.people.find((q) => inWallsWay(shop, q, { ...into, rot: w.rot }));
  if (p) return { ok: false, reason: p.kind === 'owner' ? 'You are standing there' : 'Someone is standing there', price };
  return movedIn(shop, c, w, () => canSellTile(state, c.x, c.z));
}
/** With the wall on tile `c` (and what hangs on it, on every floor) moved in a row while `fn` runs, then put back. */
function movedIn<T>(shop: Shop, c: { x: number; z: number }, w: Fixture, fn: () => T): T {
  const e = edgeOf(w), was = shop.fixtures, pos = new Map(shop.fixtures.map((f) => [f, { x: f.x, z: f.z }])), doors = { door: shop.door, backDoor: shop.backDoor };
  shiftWalls(shop, c.x, c.z, w.rot, -e.nx, -e.nz);
  syncDoors(shop);
  try { return fn(); } finally {
    shop.fixtures = was;
    for (const [f, p] of pos) { f.x = p.x; f.z = p.z; }
    shop.door = doors.door; shop.backDoor = doors.backDoor;
  }
}

/** Pull a wall in a row: the walls moved in and the floor behind them sold back, tile by tile, as far as nothing needs it. */
export function pullWall(state: GameState, key: string): string | null {
  const check = canPullWall(state, key);
  if (!check.ok) return check.reason;
  const shop = state.shop, run = wallRun(shop, key)!;
  for (let i = 0; i < run.inside.length; i++) {
    if (!pullCheck(state, run, i).ok) break;
    const c = run.inside[i]!, w = shop.fixtures.find((f) => f.id === run.walls[i])!, e = edgeOf(w);
    shiftWalls(shop, c.x, c.z, w.rot, -e.nx, -e.nz);
    syncDoors(shop);
    if (sellTile(state, c.x, c.z)) { shiftWalls(shop, c.x - e.nx, c.z - e.nz, w.rot, e.nx, e.nz); syncDoors(shop); break; }
  }
  syncDoors(shop);
  shop.layoutVersion++;
  return null;
}

/** The edges of the floor (on every open floor) with nothing standing on them: open to the outside there. */
export function openEdges(shop: Shop, tiles?: { x: number; z: number }[]): { x: number; z: number; rot: Rot }[] {
  const out: { x: number; z: number; rot: Rot }[] = [];
  const st = storeysOf(shop), on = tiles ?? floorTileList(shop);
  for (let L = 0; L <= st.top; L++) for (const g of on) {
    const x = g.x, z = zOnLevel(g.z, L);
    if (!isFloor(shop, x, z)) continue;
    for (let r = 0; r < 4; r++) {
      const e = edgeOf({ x, z, rot: r });
      if (!insideOn(shop, L, e.bx, groundZ(e.bz)) && !edgePieceAt(shop.fixtures, x, z, r)) out.push({ x, z, rot: r as Rot });
    }
  }
  return out;
}
/** What walling every open edge would cost (a wall each; the front wall glass). */
export const wallUpPrice = (shop: Shop): number => openEdges(shop).reduce((a, g) => a + FIXTURES[gapWall(shop, g)].price, 0);
/** The wall for an open edge: glass along the front, as the shop came; plain anywhere else. */
function gapWall(shop: Shop, g: { x: number; z: number; rot: Rot }): FixtureType { return levelOfZ(g.z + 0.5) === 0 && edgeOf(g).line === shop.floor.z1 && g.rot === 2 ? 'wallWindow' : 'wall'; }

/**
 * Wall up the open edges of the floor (of these tiles only, given: on every floor they are floor on): a wall each,
 * glass along the front, at their price (`free`: put up for nothing, as the walls the shop came with).
 */
export function wallUp(state: GameState, tiles?: { x: number; z: number }[], free = false): string | null {
  const shop = state.shop, gaps = openEdges(shop, tiles);
  if (!gaps.length) return free ? null : 'No open edges: the shop is walled all round.';
  const cost = free ? 0 : gaps.reduce((a, g) => a + FIXTURES[gapWall(shop, g)].price, 0);
  if (state.cash < cost) return `Need ${dollars(cost)}`;
  const walls = gaps.map((g): Fixture => ({ id: -1, type: gapWall(shop, g), x: g.x, z: g.z, rot: g.rot, slots: [] }));
  if (!free) {
    // Nobody across a line a wall goes up on, and nothing reached only through a gap shut off by it.
    if (gaps.some((g) => state.people.some((p) => inWallsWay(shop, p, g)))) return 'Someone is standing in the way: try again in a moment';
    const trial: Shop = { ...shop, fixtures: [...shop.fixtures, ...walls] };
    const inside = buildGrid(trial, -1, true), open = buildGrid(trial, -1);
    const why = builtOver(state, open) ?? shuts(state, trial, inside, open) ?? cutOff(state, reachOf(state, shop), reachOf(state, trial, inside), trial);
    if (why) return `${why}: put the walls up one at a time`;
  }
  state.cash -= cost;
  for (const f of walls) {
    f.id = state.nextId++;
    if (free) f.free = true; else { f.bought = state.day; f.boughtAt = state.time; }
    shop.fixtures.push(f);
  }
  shop.layoutVersion++;
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

/** After the floor changed (the walls stand where they stood: they are pieces): the lot, the storage and the size follow. */
function reshape(state: GameState): void {
  const shop = state.shop, f = shop.floor;
  shop.storeroom = { x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z0 };
  syncDoors(shop);
  const n = floorTileCount(shop);
  shop.sizeId = sizeOfTiles(n);
  shop.storageCapacity = 5 * Math.max(0, n - 30);
  if (shop.lotBaked) {
    // Laid as tiles, the lot stays where it is: what the building now stands on is dug up, and a bay under it sold
    // back (lotClash never lets the shop grow over a car).
    const under = shop.fixtures.filter((fx) => fx.type === 'parkingBay' && onBuilding(shop, footprintOf(fx.type, fx.x, fx.z, fx.rot)));
    if (under.length) {
      for (const fx of under) state.cash += refundOf(fx, state);
      shop.fixtures = shop.fixtures.filter((fx) => !under.includes(fx));
      // One word a day on it, however many tiles it took (the count carries on).
      const was = state.notices.find((n) => n.day === state.day && n.text.startsWith('The shop grew over'));
      const total = under.length + (was ? Number(/over (\d+)/.exec(was.text)?.[1] ?? 1) : 0);
      const text = `The shop grew over ${total === 1 ? 'a parking bay' : `${total} parking bays`}: sold back. Lay more bays where there is room (Build, Outside).`;
      if (was) was.text = text; else state.notices.push({ day: state.day, text, kind: 'info' });
    }
    syncLotBays(state);
  } else {
    const L = lotLayout(shop);
    shop.bays = L.bays.map((b, i) => ({ ...toWorld(shop, b.x, b.z), yaw: yawToWorld(shop, b.yaw), carId: shop.bays[i]?.carId ?? null }));
    shop.lotRows = paintedBays(shop).rows;
  }
  // Paving the building or the moved lanes now cover is gone with the grass.
  pruneSurfaces(shop);
  shop.layoutVersion++;
}

/**
 * Which way a piece for the wall should face on this tile: away from a wall it can hang on behind it (the way it
 * already faces if that works, in a corner), or null when the tile has none on its edges.
 */
export function facingOffWall(state: GameState, x: number, z: number, prefer: Rot): Rot | null {
  if (!isFloor(state.shop, x, z)) return null;
  for (const r of [prefer, 0, 1, 3, 2] as Rot[]) { const w = edgePieceAt(state.shop.fixtures, x, z, r); if (w && HANGS_ON.has(w.type)) return r; }
  return null;
}

/**
 * Old saves had painted bands on every wall, said nowhere: each stretch there is keeps them, written down, and walls
 * gained later come plain, as in a new game (bands for nothing on every new stretch sold back as plain paid out).
 */
export function bandsWrittenDown(state: GameState): void {
  const shop = state.shop;
  if (shop.wallStyle || shop.walled) return;
  shop.wallStyles = { ...Object.fromEntries(outlineSegments(shop).map((w) => [w.key, 'bands' as WallStyle])), ...shop.wallStyles };
  shop.wallStyle = 'plain';
}

/**
 * Walls as pieces. A new shop, and an older save (whose walls were drawn round the floor), gets one on every edge of
 * the floor with no floor beyond it, on every floor, each one it came with (nothing back for it): the front all
 * glass but for the front door, the back door where it was, a wall with a window wherever a Window was put in, and
 * the finish and colour each stretch had. A wall an older save stood in the middle of a tile goes onto the edge of
 * its tile behind it (or in front, that one taken); with neither free it is sold back.
 */
export function wallsToPieces(state: GameState): void {
  const shop = state.shop;
  if (shop.walled) return;
  const windows = new Set(shop.fixtures.filter((f) => f.type === 'window').map((f) => edgeOf(f).key));
  const before = shop.fixtures.filter((f) => FIXTURES[f.type].edge);
  shop.fixtures = shop.fixtures.filter((f) => f.type !== 'window' && !FIXTURES[f.type].edge);
  const taken = new Set<string>();
  for (const seg of outlineSegments(shop)) {
    // The tile inside it, which the wall faces into (in that floor's region upstairs). Over a double-height space
    // none: the wall under it reaches up there.
    const x = seg.axis === 'x' ? seg.t - 0.5 : seg.nx < 0 ? seg.line : seg.line - 1;
    const z = seg.axis === 'z' ? seg.t - 0.5 : seg.nz < 0 ? seg.line : seg.line - 1;
    if (!isFloor(shop, x, z)) continue;
    const rot = FACING.findIndex((d) => d.x === -seg.nx && d.z === -seg.nz) as Rot;
    const ground = levelOfZ(z + 0.5) === 0;
    const type: FixtureType = ground && seg.dir === 'front' && seg.line === shop.floor.z1 ? (Math.abs(seg.t - shop.door.x) < 0.01 ? 'frontDoor' : 'wallWindow')
      : ground && seg.dir === 'back' && seg.line === shop.backDoor.z && Math.abs(seg.t - shop.backDoor.x) < 0.01 ? 'backDoor'
        : windows.has(edgeOf({ x, z, rot }).key) ? 'wallWindow' : 'wall';
    const piece: Fixture = { id: state.nextId++, type, x, z, rot, slots: [], free: true };
    const finish = shop.wallStyles?.[seg.key], paint = shop.wallColors?.[seg.key];
    if (finish && finish !== (shop.wallStyle ?? 'plain')) piece.finish = finish;
    if (finish === 'paint' && paint) piece.paint = paint;
    shop.fixtures.push(piece);
    taken.add(edgeOf(piece).key);
  }
  // Walls put up across the shop: from the middle of their tile onto an edge of it.
  for (const f of before) {
    const back = edgeOf(f).key, front = edgeOf({ ...f, rot: (f.rot + 2) & 3 }).key;
    if (!taken.has(back)) { taken.add(back); shop.fixtures.push(f); continue; }
    if (!taken.has(front)) { taken.add(front); f.rot = ((f.rot + 2) & 3) as Rot; shop.fixtures.push(f); continue; }
    const back$ = refundOf(f, state);
    state.cash += back$;
    state.notices.push({ day: state.day, text: `${FIXTURES[f.type].name}: no edge free for it now walls stand on edges, so it was sold back for ${dollars(back$)}.`, kind: 'info' });
  }
  delete shop.wallStyles; delete shop.wallColors;
  shop.walled = true;
  shop.layoutVersion++;
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
  // (The doors out of the shop now: still doors out after, in its new walls.)
  const outs = new Set(entrances(shop).map((d) => d.f.id));
  {
    const trial = { ...shop }; setFloorTiles(trial, [...floorTileList(shop), ...want]); trial.storeroom = { x0: trial.floor.x0, z0: trial.floor.z0, x1: trial.floor.x1, z1: trial.floor.z0 }; const clash = lotClash(state, trial); if (clash) return clash;
    // (The pallets stay where they stand: they are pieces.)
    trial.fixtures = rewalled(trial, () => -1, outs); syncDoors(trial);
    const why = cutOff(state, reachOf(state, shop), reachOf(state, trial), trial);
    if (why) return why;
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
  const before = { floor: { ...shop.floor }, storeroom: { ...shop.storeroom }, door: shop.door };
  addFloor(shop, want);
  if (shop.lotBaked) relayLot(state, before);
  // The extension comes walled as the shop did: the walls it came with that are inside it now come down.
  shop.fixtures = rewalled(shop, () => state.nextId++, outs);
  reshape(state);
  state.notices.push({ day: state.day, text: `Extension built: the shop is now a ${size.name.toLowerCase()}.`, kind: 'info' });
  return null;
}

/**
 * An extension's walls (the shop's pieces after it): each door that was a door out (`outs`) out to the new edge the
 * way it opened, the walls the shop came with that are inside the shop now taken down, and every open edge walled for nothing (glass at the front).
 */
function rewalled(shop: Shop, id: () => number, outs: ReadonlySet<number>): Fixture[] {
  const out = shop.fixtures.map((f) => ({ ...f }));
  // (A door that was a door out, inside the shop now: out to its new outside wall, the way it opened.)
  for (const bd of out.filter((f) => outs.has(f.id))) {
    if (edgeSide({ ...shop, fixtures: out }, bd) !== 'inner') continue;
    const { nx, nz } = edgeOf(bd);
    while (isFloor(shop, bd.x + nx, bd.z + nz)) { bd.x += nx; bd.z += nz; }
  }
  const kept = out.filter((f) => !(FIXTURES[f.type].edge && f.free && !DOORS.has(f.type) && edgeSide({ ...shop, fixtures: out }, f) === 'inner'));
  const walled = { ...shop, fixtures: kept };
  for (const g of openEdges(walled)) kept.push({ id: id(), type: gapWall(walled, g), x: g.x, z: g.z, rot: g.rot, slots: [], free: true });
  return kept;
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
  // A bay moved onto grass brings its tarmac (paid for as it goes down).
  const tarmac = f.type === 'parkingBay' ? Math.max(0, check.price - FIXTURES.parkingBay.price) : 0;
  if (tarmac > state.cash) return `Need ${dollars(tarmac)} for the tarmac`;
  const opened = VERTICAL.has(f.type) ? [...storeysOf(state.shop).built] : null;
  f.x = x; f.z = z; f.rot = rot;
  state.shop.layoutVersion++;
  if (DOORS.has(f.type)) syncDoors(state.shop);
  if (f.type === 'parkingBay') { state.cash -= tarmac; bayLaid(state, f); }
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

/**
 * Loading an older save: the fixed delivery corner the shop came with becomes a Pallet on each of its tiles, pieces
 * to move like any bought (the room they hold is what the corner held; came with the shop, nothing back for them), and the corner is gone.
 */
export function palletsFromDelivery(state: GameState): void {
  const shop = state.shop, d = shop.delivery;
  if (!d) return;
  delete shop.delivery;
  for (let z = d.z0; z < d.z1; z++) for (let x = d.x0; x < d.x1; x++) {
    const tile = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    if (!isFloor(shop, x, z) || shop.fixtures.some((f) => !FIXTURES[f.type].onWall && !FIXTURES[f.type].edge && levelOf(f) === 0 && overlaps(footprintOf(f.type, f.x, f.z, f.rot), tile))) continue;
    shop.fixtures.push({ id: state.nextId++, type: 'pallet', x, z, rot: 0, slots: [], free: true });
  }
  shop.storageCapacity = 5 * Math.max(0, floorTileCount(shop) - 30);
  shop.layoutVersion++;
}
