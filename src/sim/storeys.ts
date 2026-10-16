/**
 * Building up: the ceiling panels (each the floor of the storey above, sold back for a double-height space),
 * the rules for what stands upstairs, and riding the stairs with the walking keys. The floors themselves (which
 * are open, their shapes, how upstairs is walked) live with the rest of the floor in layout.ts.
 */
import type { GameState, FixtureType, FloorStyle, Person, Rot, Vec2, Waypoint, Shop } from './types';
import { FIXTURES, FLOORS, MAX_LEVELS, MAX_FLOOR, TICK, VERTICAL, FLOOR_NAMES, footprintOf, groundZ, insideOn, isFloor, levelOf, levelOfZ, overlaps, panelsOver, rideEnds, storeysOf, tileKey, toWorld, toLocal, zOnLevel, RESALE, type Rect, type Storeys } from './layout';
import { buildGrid, fixtureStandWorld, fixtureFrontWorld, reachableCells, nearestWalkable, cellOf, cellIndex, inBounds, lineClear, type Grid, type Portal } from './grid';
import { followPath } from './movement';
import { dynamicBlockers, setPath } from './people';
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
  // A way up being moved: the floors as they would be without it where it stands now.
  const shop = withoutIt(state.shop, type, ignoreId), price = FIXTURES[type].price, level = levelOfZ(z + 0.5);
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
  // Stepped onto from the floor in front of it (a lift's door the same), never from out through a wall.
  const ends = rideEnds({ type, x, z, rot });
  if (!isFloor(shop, ends.bottom.x - 0.5, ends.bottom.z - 0.5)) return { ok: false, reason: 'Turn it to step on from the floor', price };
  // Where it comes off upstairs: a tile with a panel over it (the floor up there), clear of anything.
  const top = ends.top, tx = top.x - 0.5, tz = groundZ(top.z - 0.5);
  if (!isFloor(shop, tx, zOnLevel(tz, level)) && !st.holes[level]?.has(tileKey(tx, tz))) return { ok: false, reason: 'Turn it to come up over the floor', price };
  if (!panelsOver(shop, level).has(tileKey(tx, tz))) return { ok: false, reason: 'It needs a ceiling panel to come up onto', price };
  if (standsOn(shop, level + 1, tx, tz, ignoreId)) return { ok: false, reason: 'Something stands where it comes up', price };
  for (const t of tilesOf(r)) if (standsOn(shop, level + 1, t.x, groundZ(t.z), ignoreId)) return { ok: false, reason: 'Something upstairs stands over it', price };
  if (state.people.some((p) => { const l = toLocalOf(shop, p); return p.kind !== 'walker' && levelOfPerson(shop, p) === level + 1 && l.x > r.x0 && l.x < r.x1 && groundZ(l.z) > zOnLevel(r.z0, -level) && groundZ(l.z) < zOnLevel(r.z1, -level); })) return { ok: false, reason: 'Someone is standing over it upstairs', price };
  // Not up through another flight, nor coming up where one does.
  const landing = { x0: tx, z0: zOnLevel(tz, level), x1: tx + 1, z1: zOnLevel(tz, level) + 1 };
  for (const o of onLevel(shop, level)) {
    if (o.id === ignoreId || !VERTICAL.has(o.type)) continue;
    const ot = rideEnds(o).top, otile = { x0: ot.x - 0.5, z0: zOnLevel(ot.z - 0.5, -1), x1: ot.x + 0.5, z1: zOnLevel(ot.z + 0.5, -1) };
    if (overlaps(footprintOf(o.type, o.x, o.z, o.rot), landing) || overlaps(otile, r)) return { ok: false, reason: 'Another way up is in the way', price };
  }
  return null;
}

/** The shop without a way up being moved (any other piece moving leaves the floors as they are). */
export function withoutIt(shop: Shop, type: FixtureType, id?: number): Shop {
  return id !== undefined && VERTICAL.has(type) ? { ...shop, fixtures: shop.fixtures.filter((f) => f.id !== id) } : shop;
}

// ---- What the door reaches. No change may cut a floor above, anything on one or anyone up there off from the
// front door, nor stop a way up that goes up now from going up. Judged against the shop as it stands, so a way
// up that never went anywhere (an older save's, blocked) stops nobody building.

/** What a layout's walking grid (the back door shut) reaches from the front door. */
export interface Reach {
  /** The ways up that go up: on at a foot someone gets to (not only by coming down it), off on the floor above. */
  rides: Set<number>;
  /** The floors above with a way up to them. */
  floors: Set<number>;
  /** Pieces upstairs someone can get to (to use it, or get on it). */
  pieces: Set<number>;
  /** Who upstairs (or halfway up) can get back down to the door. */
  people: Set<number>;
}
export function reachOf(state: GameState, shop: Shop, grid: Grid = buildGrid(shop, -1, true)): Reach {
  const reach = reachableCells(shop, grid), out: Reach = { rides: new Set(), floors: new Set(), pieces: new Set(), people: new Set() };
  const got = (p: Vec2) => { const [cx, cz] = cellOf(grid, nearestWalkable(grid, p, undefined, 1)); return inBounds(grid, cx, cz) && !!reach[cellIndex(grid, cx, cz)]; };
  // A ride up from a foot the door reaches, without riding it: going only up, nobody gets back to a foot by its
  // own top; failing that (a foot reached by coming down), with that piece left out.
  const lv = grid.rowLevel, up = (pt: Portal, at: number) => lv![(pt.to / grid.w) | 0]! > lv![(at / grid.w) | 0]!;
  let climb: Uint8Array | undefined;
  for (const [c, list] of grid.portals ?? []) for (const pt of list) {
    if (!reach[c] || !up(pt, c)) continue;
    climb ??= reachableCells(shop, grid, up);
    if (climb[c] || reachableCells(shop, grid, (q) => q.via !== pt.via)[c]) out.rides.add(pt.via);
  }
  for (const f of shop.fixtures) {
    if (FIXTURES[f.type].outdoor) continue;
    const L = levelOf(f);
    if (out.rides.has(f.id)) out.floors.add(L + 1);
    if (!L || FIXTURES[f.type].walkable) continue;
    const till = f.type === 'register' || f.type === 'kiosk';
    if (VERTICAL.has(f.type) ? out.rides.has(f.id) : till ? got(fixtureFrontWorld(shop, f)) : !!fixtureStandWorld(shop, f, undefined, grid)) out.pieces.add(f.id);
  }
  for (const p of state.people) {
    if (p.kind === 'walker') continue;
    // Halfway up a flight: from where they step off. (Where they are bound need not stay reached: with no way
    // there now they stop, at the top of a ride they are on. See repathAfterBuild.)
    const at = p.climb !== undefined ? p.path[p.pathIdx] ?? p : p;
    if (levelOfPerson(shop, at) > 0 && got(at)) out.people.add(p.id);
  }
  return out;
}

/** Why the shop after a change (reaching `now`) would cut off something it reaches as it stands (`was`), or null. `skip`: the piece being put down, judged by itself. */
export function cutOff(state: GameState, was: Reach, now: Reach, shop: Shop, skip?: number): string | null {
  const st = storeysOf(shop);
  for (const L of was.floors) if (st.built[L] && !now.floors.has(L)) return `Would cut off the ${FLOOR_NAMES[L]} floor`;
  for (const f of shop.fixtures) if (f.id !== skip && was.pieces.has(f.id) && !now.pieces.has(f.id)) return `Would cut off the ${FIXTURES[f.type].name.toLowerCase()} upstairs`;
  for (const p of state.people) if (was.people.has(p.id) && !now.people.has(p.id)) return 'Someone upstairs would have no way down';
  for (const f of shop.fixtures) if (f.id !== skip && was.rides.has(f.id) && !now.rides.has(f.id)) return 'Would block the way up';
  return null;
}

/** Would this layout shut a floor with anything or anyone still on it? Why, or null. */
export function strands(state: GameState, shop: Shop): string | null {
  const st = storeysOf(shop);
  if (shop.fixtures.some((x) => !FIXTURES[x.type].outdoor && !st.built[levelOf(x)])) return 'It is the only way up: clear the floor above first';
  if (state.people.some((p) => p.kind !== 'walker' && !st.built[levelOfPerson(shop, p)])) return 'Someone is upstairs';
  return null;
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
  const why = cutOff(state, reachOf(state, shop), reachOf(state, trial), trial);
  if (why) return { ok: false, reason: why, price };
  return { ok: true, reason: 'Sell this panel: a double-height space', price };
}

function ensureCopy(shop: Shop): string[][] { const rows = shop.ceilings ? shop.ceilings.map((r) => [...r]) : [[...panelsOver(shop, 0)]]; while (rows.length < MAX_LEVELS - 1) rows.push([]); return rows; }
function toLocalOf(shop: Shop, p: Vec2): Vec2 { return toLocal(shop, p.x, p.z); }

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
  // The finish on it upstairs goes with it, as a tile sold takes its own (put back, it is bare again).
  const up = tileKey(x, zOnLevel(groundZ(z), level + 1));
  if (state.shop.tileStyles?.[up]) { const st = { ...state.shop.tileStyles }; delete st[up]; state.shop.tileStyles = st; }
  state.shop.layoutVersion++;
  return null;
}

/**
 * The ceilings over floors a layout has open that were shut (`was`): a panel over every tile, as the ground floor
 * has, unless panels went up there before. They go up at the panel price, however the floor opens (sold and
 * opened again, it does not come with a new one for nothing).
 */
function opening(shop: Shop, was: boolean[]): [number, string[]][] {
  const st = storeysOf(shop), out: [number, string[]][] = [];
  for (let L = 1; L < MAX_LEVELS - 1; L++) if (st.built[L] && !was[L] && !shop.ceilings?.[L]?.length) out.push([L, [...st.floors[L]!, ...st.holes[L]!]]);
  return out;
}
/** What the ceilings over the floors a change opens cost (`after`: the shop with it made). */
export function ceilingPrice(shop: Shop, after: Shop): number { return opening(after, storeysOf(shop).built).reduce((a, [, tiles]) => a + tiles.length, 0) * PANEL_PRICE; }
/** After a piece went in or moved: the ceilings over the floors it opened (paid for with it). */
export function ceilFloorsOpened(shop: Shop, before: boolean[]): void {
  for (const [L, tiles] of opening(shop, before)) { ensureCeilings(shop)[L] = tiles; shop.layoutVersion++; }
}

/**
 * After a change to the building (`was`: its floors before): floor that was not there comes bare, in lino, whatever
 * the shop-wide finish (as a tile bought does): a floor opened, a panel put up, a tile the stairs moved off. Floor
 * out of use but still there (its floor shut, a flight come up through it) keeps its finish for when it is back,
 * written down if it was the shop-wide one. A panel or a tile sold takes its finish with it (removePanel, sellTile).
 */
export function keepFinishes(shop: Shop, was: Storeys): void {
  const all = shop.floorStyle ?? FLOORS[0]!.id;
  if (all === FLOORS[0]!.id) return;
  const st = storeysOf(shop), set: Record<string, FloorStyle> = {};
  for (let L = 0; L < MAX_LEVELS; L++) {
    const now = st.floors[L]!, then = was.floors[L] ?? new Set<string>(), panels = L ? panelsOver(shop, L - 1) : now;
    const at = (k: string) => { const [x, z] = k.split(',').map(Number) as [number, number]; return tileKey(x, zOnLevel(z, L)); };
    for (const k of now) if (!then.has(k) && !shop.tileStyles?.[at(k)]) set[at(k)] = FLOORS[0]!.id;
    for (const k of then) if (!now.has(k) && panels.has(k) && !shop.tileStyles?.[at(k)]) set[at(k)] = all;
  }
  if (Object.keys(set).length) shop.tileStyles = { ...shop.tileStyles, ...set };
}

/** Can this piece be taken away (sold)? Not from under anyone on it, nor the last way up to a floor with anything or anyone on it. */
export function canTakeAway(state: GameState, id: number): string | null {
  const shop = state.shop, f = shop.fixtures.find((x) => x.id === id);
  if (!f || !VERTICAL.has(f.type)) return null;
  if (state.people.some((p) => p.climb !== undefined && p.path[p.pathIdx]?.via === id)) return 'Someone is on it';
  const rest = withoutIt(shop, f.type, id);
  return strands(state, rest) ?? cutOff(state, reachOf(state, shop), reachOf(state, rest), rest);
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

/**
 * Is the ride to `w` from `from` (where they stand, or the waypoint before) still there to take: its piece where
 * it stood, getting on where it did, between two open floors? One already under way needs only the piece:
 * something put down at an end shuts it to anyone else, but whoever is on it rides it out.
 */
function rideStands(state: GameState, from: Vec2, w: Waypoint, on = false): boolean {
  const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z) < RIDE_REACH;
  for (const list of gridFor(state).portals?.values() ?? []) for (const pt of list) if (pt.via === w.via && pt.at.x === w.x && pt.at.z === w.z && near(pt.from, from)) return true;
  const shop = state.shop, f = on ? shop.fixtures.find((q) => q.id === w.via) : undefined;
  if (!f || !VERTICAL.has(f.type) || !storeysOf(shop).built[levelOf(f) + 1]) return false;
  const e = rideEnds(f), a = toWorld(shop, e.bottom.x, e.bottom.z), b = toWorld(shop, e.top.x, e.top.z);
  return (near(from, a) && near(w, b)) || (near(from, b) && near(w, a));
}

/**
 * Does someone's way on ride stairs, an escalator or a lift that is not there any more (sold, moved), or up to a
 * floor that has closed? `legs`: or walk a stretch upstairs over floor that is not there now (a panel taken out:
 * nobody steps round a gap), from where they stand or step off the ride they are on. Each tick checks the rides
 * alone; a change to the building checks both.
 */
function wayGone(state: GameState, p: Person, legs = false): boolean {
  const g = legs ? gridFor(state) : null;
  for (let i = p.pathIdx; i < p.path.length; i++) {
    const w = p.path[i]!, from = i > p.pathIdx ? p.path[i - 1]! : p;
    if (w.ride !== undefined ? !rideStands(state, from, w, i === p.pathIdx && p.climb !== undefined) : !!g && levelOfPerson(state.shop, w) > 0 && !lineClear(g, from, w)) return true;
  }
  return false;
}

/** Off a ride (at its end, or back where they got on): never left standing in something put down there meanwhile. */
function stepClear(state: GameState, p: Person): void {
  const at = nearestWalkable(gridFor(state), p);
  p.x = at.x; p.z = at.z;
}

/**
 * Someone's way planned again from where they stand, to where it went (a walk out to the street keeps its
 * crossings: only the way to the first kerb, all the grid covers, is planned again). With no way there any more
 * (it was up on a floor that has closed) they stop: at the end of the ride they are on, if they are on one.
 */
function replan(state: GameState, p: Person): void {
  const w = p.path[p.pathIdx];
  if (p.climb !== undefined && w?.ride !== undefined && !rideStands(state, p, w, true)) { p.climb = undefined; stepClear(state, p); }
  // (Crossings that do not fit the path, an old route's, are dropped with it.)
  const x = p.xings?.[0], k = x !== undefined && x < p.path.length ? x : p.path.length - 1, tail = p.path.slice(k + 1);
  if (!setPath(state, p, p.path[k]!, dynamicBlockers(state))) { p.path = p.climb !== undefined ? p.path.slice(0, 1) : []; p.pathIdx = 0; p.xings = undefined; return; }
  p.xings = x === k ? p.xings!.map((i) => i - k - 1 + p.path.length) : undefined;
  p.path.push(...tail);
}

/**
 * After any change to the building (a piece put down, moved or sold, a panel, a tile; applyCommand runs it after
 * each): everyone whose way is gone (a ride not there now, or up to a floor that has closed, a stretch upstairs
 * over a gap) sets off another way from where they stand; halfway up a flight, on from where they step off, and
 * with nowhere left to go they stop at the top. A spill nobody can get to now (on a floor that has shut) goes with
 * it: no cleaner sets off for it. (Each tick checks the rides again for anyone on the move: see rideStep.)
 */
export function repathAfterBuild(state: GameState): void {
  for (const p of state.people) if (p.kind !== 'walker' && wayGone(state, p, true)) replan(state, p);
  const g = gridFor(state), reach = reachableCells(state.shop, g);
  state.shop.litter = state.shop.litter.filter((l) => { const [cx, cz] = cellOf(g, nearestWalkable(g, l, undefined, 1)); return inBounds(g, cx, cz) && !!reach[cellIndex(g, cx, cz)]; });
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
  if (p.climb === undefined) stepClear(state, p);
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
