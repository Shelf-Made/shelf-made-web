/**
 * Building up: the ceiling panels (each the floor of the storey above, sold back for a double-height space),
 * the rules for what stands upstairs, and riding the stairs with the walking keys. The floors themselves (which
 * are open, their shapes, how upstairs is walked) live with the rest of the floor in layout.ts.
 */
import type { GameState, FixtureType, Person, Rot, Vec2, Waypoint, Shop } from './types';
import { FIXTURES, MAX_LEVELS, MAX_FLOOR, TICK, VERTICAL, footprintOf, groundZ, insideOn, isFloor, levelOf, levelOfZ, overlaps, panelsOver, rideEnds, storeysOf, tileKey, toWorld, toLocal, zOnLevel, RESALE, type Rect } from './layout';
import { buildGrid, fixtureStandWorld, fixtureFrontWorld } from './grid';
import { findPath } from './pathfinding';
import { followPath } from './movement';
import { doorInside, dynamicBlockers, setPath } from './people';
import { gridFor } from './state';
import { dollars } from './money';
import type { PlaceCheck } from './build';

/** A ceiling panel (and the floor it makes upstairs). */
export const PANEL_PRICE = 25;

/** The tiles a footprint covers (corners). */
function tilesOf(r: Rect): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = r.z0; z < r.z1 - 1e-6; z++) for (let x = r.x0; x < r.x1 - 1e-6; x++) out.push({ x, z });
  return out;
}

/** Write the panels out (an old save has them over the whole ground floor without saying so). */
export function ensureCeilings(shop: Shop): string[][] {
  if (!shop.ceilings) shop.ceilings = [[...panelsOver(shop, 0)]];
  while (shop.ceilings.length < MAX_LEVELS - 1) shop.ceilings.push([]);
  return shop.ceilings;
}

/** Everything standing on floor `level`. */
function onLevel(shop: Shop, level: number) { return shop.fixtures.filter((f) => !FIXTURES[f.type].outdoor && levelOf(f) === level); }

/** Does anything on floor `level` stand on this tile (ground corner)? */
function standsOn(shop: Shop, level: number, x: number, z: number, ignoreId?: number): boolean {
  const t = { x0: x, z0: zOnLevel(z, level), x1: x + 1, z1: zOnLevel(z, level) + 1 };
  return onLevel(shop, level).some((f) => f.id !== ignoreId && overlaps(footprintOf(f.type, f.x, f.z, f.rot), t));
}

/**
 * Upstairs rules for a piece (null when there is nothing to add to the floor's own): a floor must be open
 * before anything goes on it; stairs need a panel to come up onto and room where they come through; a tall
 * wall only stands where no panel is over it.
 */
export function placeUpstairs(state: GameState, type: FixtureType, x: number, z: number, rot: Rot, ignoreId?: number): PlaceCheck | null {
  const shop = state.shop, price = FIXTURES[type].price, level = levelOfZ(z + 0.5);
  const st = storeysOf(shop);
  if (level > 0 && !st.built[level]) return { ok: false, reason: 'Put in stairs up to this floor first', price };
  const gz = groundZ(z);
  if (type === 'tallWall') {
    if (level >= MAX_LEVELS - 1) return { ok: false, reason: 'No room up here for one', price };
    if (panelsOver(shop, level).has(tileKey(x, gz))) return { ok: false, reason: 'Only under an open ceiling: sell the panel above first', price };
  }
  if (!VERTICAL.has(type)) return null;
  if (level >= MAX_LEVELS - 1) return { ok: false, reason: `${MAX_LEVELS} floors is the most a shop can have`, price };
  const r = footprintOf(type, x, z, rot);
  for (const t of tilesOf(r)) if (!isFloor(shop, t.x, t.z)) return { ok: false, reason: 'It needs room on the floor', price };
  // Where it comes off upstairs: a tile with a panel over it (the floor up there), clear of anything.
  const top = rideEnds({ type, x, z, rot }).top, tx = top.x - 0.5, tz = groundZ(top.z - 0.5);
  if (!isFloor(shop, tx, zOnLevel(tz, level)) && !st.holes[level]?.has(tileKey(tx, tz))) return { ok: false, reason: 'Turn it to come up over the floor', price };
  if (!panelsOver(shop, level).has(tileKey(tx, tz))) return { ok: false, reason: 'It needs a ceiling panel to come up onto', price };
  if (standsOn(shop, level + 1, tx, tz, ignoreId)) return { ok: false, reason: 'Something stands where it comes up', price };
  for (const t of tilesOf(r)) if (standsOn(shop, level + 1, t.x, groundZ(t.z), ignoreId)) return { ok: false, reason: 'Something upstairs stands over it', price };
  // Not up through another flight, nor coming up where one does.
  const landing = { x0: tx, z0: zOnLevel(tz, level), x1: tx + 1, z1: zOnLevel(tz, level) + 1 };
  for (const o of onLevel(shop, level)) {
    if (o.id === ignoreId || !VERTICAL.has(o.type)) continue;
    const ot = rideEnds(o).top, otile = { x0: ot.x - 0.5, z0: zOnLevel(ot.z - 0.5, -1), x1: ot.x + 0.5, z1: zOnLevel(ot.z + 0.5, -1) };
    if (overlaps(footprintOf(o.type, o.x, o.z, o.rot), landing) || overlaps(otile, r)) return { ok: false, reason: 'Another way up is in the way', price };
  }
  return null;
}

/** With this piece in: can people get up it, and on to the floor above? */
export function rideReachable(state: GameState, grid: ReturnType<typeof buildGrid>, f: { type: FixtureType; x: number; z: number; rot: Rot }): boolean {
  if (!VERTICAL.has(f.type)) return true;
  const e = rideEnds(f);
  return !!findPath(grid, doorInside(state), toWorld(state.shop, e.top.x, e.top.z));
}

// ---- Ceiling panels: bought over a floor (it becomes the floor of the one above), sold for a double-height space.

/** Can a panel go up over this tile of floor `level` (a corner in that floor's region)? */
export function canAddPanel(state: GameState, x: number, z: number): PlaceCheck {
  const shop = state.shop, level = levelOfZ(z + 0.5), gz = groundZ(z), price = PANEL_PRICE, st = storeysOf(shop);
  if (level >= MAX_LEVELS - 1) return { ok: false, reason: 'This is the top floor', price };
  if (!st.built[level]) return { ok: false, reason: 'Put in stairs up to this floor first', price };
  const k = tileKey(x, gz);
  if (!st.floors[level]!.has(k) && !st.holes[level]!.has(k)) return { ok: false, reason: 'Point at the floor', price };
  if (panelsOver(shop, level).has(k)) return { ok: false, reason: 'There is a panel up there already', price };
  if (onLevel(shop, level).some((f) => (VERTICAL.has(f.type) || f.type === 'tallWall') && overlaps(footprintOf(f.type, f.x, f.z, f.rot), { x0: x, z0: z, x1: x + 1, z1: z + 1 }))) return { ok: false, reason: 'Something comes up through there', price };
  if (state.cash < price) return { ok: false, reason: `Need ${dollars(price)}`, price };
  return { ok: true, reason: 'Ceiling panel (the floor above)', price };
}

/** Can the panel over this tile come down (and be sold)? Not with anything upstairs on it, nor where the stairs come up. */
export function canRemovePanel(state: GameState, x: number, z: number): PlaceCheck {
  const shop = state.shop, level = levelOfZ(z + 0.5), gz = groundZ(z), price = -Math.round(RESALE * PANEL_PRICE);
  const k = tileKey(x, gz);
  if (!panelsOver(shop, level).has(k)) return { ok: false, reason: 'No panel over this tile', price };
  if (standsOn(shop, level + 1, x, gz)) return { ok: false, reason: 'Move or sell what stands on it upstairs first', price };
  if (onLevel(shop, level).some((f) => VERTICAL.has(f.type) && (() => { const t = rideEnds(f).top; return t.x - 0.5 === x && groundZ(t.z - 0.5) === gz; })())) return { ok: false, reason: 'The stairs come up onto it', price };
  if (state.people.some((p) => { const l = toLocalOf(shop, p); return levelOfPerson(shop, p) === level + 1 && l.x > x && l.x < x + 1 && groundZ(l.z) > gz && groundZ(l.z) < gz + 1; })) return { ok: false, reason: 'Someone is standing on it', price };
  // Everything upstairs still within reach without it.
  const trial = { ...shop, ceilings: ensureCopy(shop).map((row, L) => L === level ? row.filter((t) => t !== k) : row) };
  const why = upstairsReachable(state, trial as Shop);
  if (why) return { ok: false, reason: why, price };
  return { ok: true, reason: 'Sell this panel: a double-height space', price };
}

function ensureCopy(shop: Shop): string[][] { const rows = shop.ceilings ? shop.ceilings.map((r) => [...r]) : [[...panelsOver(shop, 0)]]; while (rows.length < MAX_LEVELS - 1) rows.push([]); return rows; }
function toLocalOf(shop: Shop, p: Vec2): Vec2 { return toLocal(shop, p.x, p.z); }

/** Every piece upstairs (shelves, tills, the stairs on up) still reached from the door in this layout, or why not. */
function upstairsReachable(state: GameState, shop: Shop): string | null {
  const grid = buildGrid(shop, -1, true), from = doorInside(state);
  for (const f of shop.fixtures) {
    if (FIXTURES[f.type].outdoor || levelOf(f) === 0 || FIXTURES[f.type].walkable) continue;
    const till = f.type === 'register' || f.type === 'kiosk';
    const stand = till || VERTICAL.has(f.type) ? fixtureFrontWorld(shop, f) : fixtureStandWorld(shop, f, undefined, grid);
    if (!stand || !findPath(grid, from, stand)) return `Would cut off the ${FIXTURES[f.type].name.toLowerCase()} upstairs`;
  }
  return null;
}

export function addPanel(state: GameState, x: number, z: number): string | null {
  const check = canAddPanel(state, x, z);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const rows = ensureCeilings(state.shop), level = levelOfZ(z + 0.5);
  rows[level] = [...rows[level]!, tileKey(x, groundZ(z))];
  state.shop.layoutVersion++;
  return null;
}

export function removePanel(state: GameState, x: number, z: number): string | null {
  const check = canRemovePanel(state, x, z);
  if (!check.ok) return check.reason;
  state.cash -= check.price;
  const rows = ensureCeilings(state.shop), level = levelOfZ(z + 0.5), k = tileKey(x, groundZ(z));
  rows[level] = rows[level]!.filter((t) => t !== k);
  state.shop.layoutVersion++;
  return null;
}

/**
 * After a piece went in: a floor it opened comes with its ceiling, a panel over every tile (as the ground floor
 * does), unless panels went up there before.
 */
export function ceilFloorsOpened(shop: Shop, before: boolean[]): void {
  const st = storeysOf(shop);
  for (let L = 1; L < MAX_LEVELS - 1; L++) {
    if (!st.built[L] || before[L]) continue;
    const rows = ensureCeilings(shop);
    if (rows[L]!.length) continue;
    rows[L] = [...st.floors[L]!, ...st.holes[L]!];
    shop.layoutVersion++;
  }
}

/** Can this piece be taken away (sold)? Not the last way up to a floor with anything on it. */
export function canTakeAway(state: GameState, id: number): string | null {
  const shop = state.shop, f = shop.fixtures.find((x) => x.id === id);
  if (!f || !VERTICAL.has(f.type)) return null;
  if (state.people.some((p) => p.climb !== undefined && p.path[p.pathIdx]?.via === id)) return 'Someone is on it';
  const rest = { ...shop, fixtures: shop.fixtures.filter((x) => x.id !== id) };
  const st = storeysOf(rest);
  if (shop.fixtures.some((x) => x.id !== id && !FIXTURES[x.type].outdoor && !st.built[levelOf(x)])) return 'It is the only way up: clear the floor above first';
  if (state.people.some((p) => p.kind !== 'walker' && !st.built[levelOfPerson(shop, p)])) return 'Someone is upstairs';
  return upstairsReachable(state, rest as Shop);
}

/** Which floor a person is on (anyone out in the town is on the ground). */
export function levelOfPerson(shop: Shop, p: Vec2): number {
  const l = toLocalOf(shop, p);
  return l.x > MAX_FLOOR.x0 - 1 && l.x < MAX_FLOOR.x1 + 1 ? levelOfZ(l.z) : 0;
}

// ---- Walking with the keys: push into the stairs (up at the foot, down at the top) or a lift's door to ride.

/** How near the start of a ride walking into it gets you on. */
export const RIDE_REACH = 0.45;

/** The ride a person pushing that way stands at the start of, or null. */
export function rideAt(state: GameState, p: Person, dir: Vec2): Waypoint | null {
  const g = gridFor(state);
  if (!g.portals) return null;
  const len = Math.hypot(dir.x, dir.z) || 1;
  for (const list of g.portals.values()) for (const pt of list) {
    if (Math.hypot(pt.from.x - p.x, pt.from.z - p.z) > RIDE_REACH) continue;
    if ((dir.x * Math.sin(pt.yaw) + dir.z * Math.cos(pt.yaw)) / len < 0.6) continue;
    return { x: pt.at.x, z: pt.at.z, ride: pt.ride, via: pt.via, yaw: pt.yaw };
  }
  return null;
}

/** The ride on this piece from where a person stands (its foot, or its top): null when they are not at either. */
export function rideOn(state: GameState, p: Vec2, fixtureId: number, within = 1.2): Waypoint | null {
  let best: Waypoint | null = null, bd = within;
  for (const list of gridFor(state).portals?.values() ?? []) for (const pt of list) {
    if (pt.via !== fixtureId) continue;
    const d = Math.hypot(pt.from.x - p.x, pt.from.z - p.z);
    if (d < bd) { bd = d; best = { x: pt.at.x, z: pt.at.z, ride: pt.ride, via: pt.via, yaw: pt.yaw }; }
  }
  return best;
}

// ---- Rides under way.

/** Is this ride still there to take: its piece where it stood, between two open floors? */
function rideStands(state: GameState, w: Waypoint): boolean {
  for (const list of gridFor(state).portals?.values() ?? []) for (const pt of list) if (pt.via === w.via && pt.at.x === w.x && pt.at.z === w.z) return true;
  return false;
}

/** Does someone's way on ride stairs, an escalator or a lift that is not there any more (sold, moved), or up to a floor that has closed? */
function wayGone(state: GameState, p: Person): boolean {
  for (let i = p.pathIdx; i < p.path.length; i++) { const w = p.path[i]!; if (w.ride !== undefined && !rideStands(state, w)) return true; }
  return false;
}

/**
 * Someone's way planned again from where they stand, to where it went (a walk out to the street keeps its
 * crossings: only the way to the first kerb, all the grid covers, is planned again). With no way there any more
 * (it was up on a floor that has closed) they stop.
 */
function replan(state: GameState, p: Person): void {
  const w = p.path[p.pathIdx];
  if (w?.ride !== undefined && !rideStands(state, w)) p.climb = undefined;
  const k = p.xings?.length ? p.xings[0]! : p.path.length - 1, tail = p.path.slice(k + 1);
  if (!setPath(state, p, p.path[k]!, dynamicBlockers(state))) { p.path = []; p.pathIdx = 0; p.xings = undefined; return; }
  if (p.xings) p.xings = p.xings.map((i) => i - k - 1 + p.path.length);
  p.path.push(...tail);
}

/**
 * After the building changes (stairs, an escalator or a lift sold or moved, a floor closed): everyone whose way
 * rides one that is not there any more, or up to a floor that has closed, sets off another way from where they
 * stand. (Each tick does the same for anyone on the move: see rideStep.)
 */
export function repathAfterBuildChange(state: GameState): void {
  for (const p of state.people) if (wayGone(state, p)) replan(state, p);
}

/**
 * Partway up (or down) a ride: it carries on to the other end whatever happens meanwhile (the keys let go, a
 * card opened, a change of plan), and nothing else is done till then. False when not on one. A ride ahead
 * that has gone from under them (sold, moved, up to a floor that has closed) is never got on: they set off
 * another way from where they stand.
 */
export function rideStep(state: GameState, p: Person): boolean {
  if (wayGone(state, p)) replan(state, p);
  if (p.climb === undefined) return false;
  if (p.path[p.pathIdx]?.ride === undefined) { p.climb = undefined; return false; }
  followPath(p, p.speed, TICK);
  return true;
}

/** Start the manager riding (they step onto its foot first). */
export function startRide(state: GameState, p: Person, w: Waypoint): void {
  const g = gridFor(state);
  for (const list of g.portals?.values() ?? []) for (const pt of list) if (pt.via === w.via && pt.at.x === w.x && pt.at.z === w.z) { p.x = pt.from.x; p.z = pt.from.z; }
  p.path = [w]; p.pathIdx = 0; p.climb = 0; p.state = 'walking';
  if (w.yaw !== undefined) p.yaw = w.yaw;
}

/** Is this tile under the open sky of a double-height space (no panel over it, a storey of room above)? */
export function doubleHeight(shop: Shop, x: number, z: number): boolean {
  const level = levelOfZ(z + 0.5);
  return level < MAX_LEVELS - 1 && insideOn(shop, level + 1, x, groundZ(z)) && !panelsOver(shop, level).has(tileKey(x, groundZ(z)));
}
