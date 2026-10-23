import type { GameState, Car, Vec2, Order, ParkingBay, RivalState } from './types';
import { BAY_UNLOAD, CHARGE_REACH, chargersInUse, isElectric, hasDock } from './frontage';
import {
  ROAD_Z, LANE_EAST_Z, LANE_WEST_Z, LANE_NORTH_X, LANE_SOUTH_X, SIDE_HALF, STOP_LINE, CAR_ROAD_SPEED, CAR_LOT_SPEED, TICK, ROAD_FAR,
  lotLayout, toWorld, toLocal, greenFor, serviceDoor, byDoor, type Frame, type LotLayout,
} from './layout';
import { followPath, roundPath, turnToward } from './movement';
import { withRng, nextId, popup, cue, complain } from './state';
import { rivalFrame, rivalShape } from './rivals';
import { lotNet, route, corners, step, tileAt, tileIndex, onLotGrid, bayMouth, bayHeading, bayCentre, truckStop, DIRS } from './drive';

const FAR = ROAD_FAR;
/** Driveway lanes: in on the east half, out on the west half (shop-relative; traffic keeps right). */
const IN = 0.45, OUT = -0.45;
/**
 * Main Road in shop-relative terms, the same on every corner: the near lane runs toward -x, the
 * far lane toward +x, and the kerb on the shop's side.
 */
const ROAD_L = ROAD_Z + 1.6;
const NEAR_L = ROAD_L - 0.5, FAR_L = ROAD_L + 0.5, KERB_L = ROAD_L - 1.0;

export const CAR_MODELS = 12; // index into the renderer's car list; 6 and 7 are delivery trucks
export const TRUCK_MODEL = 6;
const CUSTOMER_CAR_MODELS = [0, 1, 2, 3, 4, 5, 10];

/** A parking lot: the player's, a rival's. Its frame, layout and bays (world space). */
export interface LotSite { key: string | undefined; frame: Frame; L: LotLayout; bays: ParkingBay[] }

export function playerSite(state: GameState): LotSite { return { key: undefined, frame: state.shop, L: lotLayout(state.shop), bays: state.shop.bays }; }
export function rivalSite(r: RivalState): LotSite { return { key: r.id, frame: rivalFrame(r), L: lotLayout(rivalShape(r)), bays: r.bays }; }
function siteOf(state: GameState, key: string | undefined): LotSite | null {
  if (key === undefined) return playerSite(state);
  const r = state.rivals.find((x) => x.id === key);
  return r ? rivalSite(r) : null;
}
export function bayOf(state: GameState, car: Car): ParkingBay | null {
  if (car.bay === null) return null;
  if (car.lot === 'street') return state.streetBays[car.bay] ?? null;
  return siteOf(state, car.lot)?.bays[car.bay] ?? null;
}

const dwX = (L: LotLayout) => (L.driveway.x0 + L.driveway.x1) / 2;
/** Shop-relative x of your lot's ways in from the road (front-row tarmac), east first; the door's when there is none. */
function wayInXs(state: GameState): number[] {
  const net = lotNet(state.shop);
  return net.entrances.map((i) => tileAt(i).x + 0.5).sort((a, b) => b - a);
}
/** World x of your lot's main way in (the easternmost, as the driveway always was). */
export function drivewayX(state: GameState): number { return toWorld(state.shop, wayInXs(state)[0] ?? state.shop.door.x, 0).x; }
/** World x of your lot's westernmost way in (the service lane the truck always took). */
export function serviceX(state: GameState): number { const xs = wayInXs(state); return toWorld(state.shop, xs[xs.length - 1] ?? state.shop.door.x, 0).x; }

/** World point far down Main Road in a shop-relative direction (+1 = toward its +x), on the given shop-relative lane. */
function farEnd(f: Frame, dir: 1 | -1, laneL: number): Vec2 {
  const w = toWorld(f, 0, laneL);
  return { x: (f.flip ? -dir : dir) * FAR, z: w.z };
}
const W = (f: Frame, pts: Vec2[]) => pts.map((p) => toWorld(f, p.x, p.z));

function makeCar(state: GameState, model: number, path: Vec2[], carState: Car['state'], speed: number): Car {
  // Out in the fog, a new car starts a little further back if another one has just set off from the same spot.
  const first = path[0]!, next = path[1] ?? first;
  const len = Math.hypot(next.x - first.x, next.z - first.z) || 1;
  for (let k = 0; k < 6 && state.cars.some((c) => Math.hypot(c.x - path[0]!.x, c.z - path[0]!.z) < 3.4); k++) {
    path[0] = { x: path[0]!.x - ((next.x - first.x) / len) * 3.4, z: path[0]!.z - ((next.z - first.z) / len) * 3.4 };
  }
  const p0 = path[0]!, p1 = path[1] ?? p0;
  const car: Car = {
    id: nextId(state), model, x: p0.x, z: p0.z, yaw: Math.atan2(p1.x - p0.x, p1.z - p0.z), px: p0.x, pz: p0.z, pyaw: 0,
    path, pathIdx: 1, speed, state: carState, bay: null, ownerId: null, timer: 0,
  };
  car.pyaw = car.yaw;
  state.cars.push(car);
  return car;
}

/**
 * The free bay a car pulls into: the first row before the second, the back of the car park first (so
 * a car on its way in never has to squeeze past one just parked by the driveway), whatever order the
 * bays were painted in. On your own lot: a bay a car can get to, the furthest along the tarmac first, and
 * an electric car one by a free charger if there is one.
 */
export function freeBay(state: GameState, electric = false, from?: Entry[]): number {
  const shop = state.shop;
  let best = -1, bestKey = Infinity;
  const net = shop.lotBaked ? lotNet(shop) : null;
  const chargers = electric ? (() => { const busy = chargersInUse(state); return shop.fixtures.filter((f) => f.type === 'evCharger' && !busy.has(f.id)); })() : [];
  shop.bays.forEach((b, i) => {
    if (b.carId !== null) return;
    if (net) {
      const f = b.fid !== undefined ? shop.fixtures.find((x) => x.id === b.fid) : undefined;
      if (!f) return;
      const r = bayRoute(shop, f, from);
      if (!r) return;
      // (How deep into the lot it is, from the nearest way in: not how far the car has to come.)
      const m = bayMouth(f), cost = net.reach[tileIndex(m.x, m.z)]!;
      const c = bayCentre(f), plug = chargers.some((q) => Math.hypot(q.x + 0.5 - c.x, q.z + 0.5 - c.z) < CHARGE_REACH);
      // A bay opening onto the far side of a lane two wide (turned into across the cars driving out) only once the bays
      // on the near side are taken: crossing that lane is where the cars coming and going get in each other's way.
      const key = -cost - (plug ? 1000 : 0) + (r.across ? 500 : 0);
      if (key < bestKey) { bestKey = key; best = i; }
      return;
    }
    const l = toLocal(shop, b.x, b.z);
    const key = (l.x > shop.floor.x1 + 4 ? 100 : 0) + l.z;
    if (key < bestKey) { bestKey = key; best = i; }
  });
  return best;
}

/** The piece a bay of your own lot is (null on a lot not laid as tiles). */
function bayPiece(state: GameState, bayIdx: number) {
  const fid = state.shop.bays[bayIdx]?.fid;
  return fid === undefined ? null : state.shop.fixtures.find((x) => x.id === fid) ?? null;
}

/** Off Main Road toward your lot at a way in (shop-relative x), from -x on the far lane or from +x on the near lane. */
function roadIn(cx: number, fromMinus: boolean): Vec2[] {
  return fromMinus ? [{ x: cx - 1.2, z: FAR_L }, { x: cx, z: NEAR_L - 0.6 }] : [{ x: cx + 0.9, z: NEAR_L }, { x: cx, z: NEAR_L - 0.8 }];
}
/**
 * Down Main Road from `end`, off it (roadIn) and on along the lot's corners (shop-relative, from the way in): the turn
 * off the road as wide as it always was, the lot's corners tighter (they are a tile apart).
 */
function offRoadOnto(f: Frame, end: Vec2, approach: Vec2[], lot: Vec2[]): Vec2[] {
  // (Straight on from the way in, its tile's middle is no corner: the turn off the road sweeps on past it.)
  if (lot.length > 1 && Math.abs(lot[0]!.x - lot[1]!.x) < 1e-6) lot = lot.slice(1);
  const pts = [end, ...W(f, [...approach, ...lot])];
  return roundPath(pts, pts.map((_, i) => (i <= approach.length ? 1.0 : 0.6)), 4);
}
/** From a way in out onto Main Road: toward +x on the far lane, or toward -x on the near lane. */
function roadOut(f: Frame, cx: number, plus: boolean): Vec2[] {
  const local = [{ x: cx, z: KERB_L - 0.3 }, ...(plus ? [{ x: cx + 0.4, z: NEAR_L + 0.2 }, { x: cx + 1.8, z: FAR_L }] : [{ x: cx - 1.0, z: NEAR_L }])];
  return [...W(f, local), farEnd(f, plus ? 1 : -1, plus ? FAR_L : NEAR_L)];
}

/**
 * Into a bay of your own lot: off the road at the nearest way in, along the tarmac (keeping right), and nose in. A bay
 * opening onto the far lane of a two-lane run is turned into from the near one, across the lane, as a driver would.
 * Null when there is no way.
 */
/** A way in off the road (a front-row tile of your lot), with what it costs a car to get to it. */
type Entry = { tile: number; dir: number; cost?: number };
/**
 * The ways in for a car coming down Main Road to your lot: each costs the drive along the road to it (a unit of road
 * is driven in about a third of the time a tile of lot is), so the car turns in at the way that gets it to its bay
 * soonest, not the first or the last one along.
 */
function entriesFor(state: GameState, car: Car): Entry[] {
  const shop = state.shop, l = toLocal(shop, car.x, car.z), fromMinus = shop.flip ? !car.seek!.west : car.seek!.west;
  return lotNet(shop).entrances.map((i) => {
    const cx = tileAt(i).x + 0.5;
    return { tile: i, dir: 2, cost: Math.max(0, fromMinus ? cx - l.x : l.x - cx) * (CAR_LOT_SPEED / CAR_ROAD_SPEED) };
  });
}
/** The way over your lot's tarmac from the road to a bay's open end, and whether it is turned into across a lane. */
function bayRoute(shop: GameState['shop'], f: { x: number; z: number; rot: number }, from?: Entry[]): { tiles: number[]; across: boolean } | null {
  const net = lotNet(shop), m = bayMouth(f), back = (bayHeading(f) + 2) % 4;
  if (!onLotGrid(m.x, m.z)) return null;
  const mi = tileIndex(m.x, m.z), far = net.drive[mi] ? step(mi, back) : -1;
  const across = far >= 0 && !!net.drive[far];
  const r = route(net, from ?? net.entrances.map((i) => ({ tile: i, dir: 2 })), (t, d) => d !== back && (t === mi || (across && t === far)));
  return r ? { tiles: r.tiles, across: r.tiles[r.tiles.length - 1] === far } : null;
}

function pathIntoPlayerBay(state: GameState, bayIdx: number, fromWest: boolean, start?: Vec2, from?: Entry[]): Vec2[] | null {
  const shop = state.shop, f = bayPiece(state, bayIdx);
  if (!f) return null;
  const m = bayMouth(f), into = bayHeading(f);
  const r = bayRoute(shop, f, from);
  if (!r) return null;
  const fromMinus = shop.flip ? !fromWest : fromWest;
  const cx = tileAt(r.tiles[0]!).x + 0.5, c = bayCentre(f), v = DIRS[into]!;
  const turn = r.across ? [{ x: m.x + 0.5, z: m.z + 0.5 }] : [];
  return offRoadOnto(shop, start ?? farEnd(shop, fromMinus ? -1 : 1, fromMinus ? FAR_L : NEAR_L), roadIn(cx, fromMinus), [...corners(r.tiles), ...turn, { x: m.x + 0.5 + v.x, z: m.z + 0.5 + v.z }, c]);
}

/**
 * Loading an older save, the lot laid as tiles moves each bay onto the lot's grid: a car still out on the road on its
 * way into one of your bays is sent the way into where its bay is now (not the way it planned, to where it was).
 */
export function rerouteToBays(state: GameState): void {
  for (const car of state.cars) {
    if (car.lot !== undefined || car.bay === null || car.state !== 'arriving' || !onRoad(car.x, car.z)) continue;
    const path = pathIntoPlayerBay(state, car.bay, Math.sin(car.yaw) > 0, { x: car.x, z: car.z });
    if (path) { car.path = path; car.pathIdx = 1; }
  }
}

/** Into a lot's free bay from Main Road. fromWest is the world direction the car comes from. */
function pathIntoLot(site: LotSite, bayIdx: number, fromWest: boolean): Vec2[] {
  const f = site.frame, L = site.L, dx = dwX(L);
  // In shop-relative terms: from -x on the far lane, or from +x on the near lane.
  const fromMinus = f.flip ? !fromWest : fromWest;
  const bay = site.bays[bayIdx]!;
  const b = toLocal(f, bay.x, bay.z);
  const local: Vec2[] = fromMinus
    ? [{ x: dx + IN - 1.2, z: FAR_L }, { x: dx + IN, z: NEAR_L - 0.6 }, { x: dx + IN, z: L.driveway.z0 }]
    : [{ x: dx + IN + 0.9, z: NEAR_L }, { x: dx + IN, z: NEAR_L - 0.8 }, { x: dx + IN, z: L.driveway.z0 }];
  // Both bay rows are entered from the aisle; the car pulls in nose first.
  local.push({ x: dx + IN, z: b.z }, { x: b.x, z: b.z });
  return [farEnd(f, fromMinus ? -1 : 1, fromMinus ? FAR_L : NEAR_L), ...W(f, local)];
}

/** Straight down Main Road and out of town. */
function passByPath(fromWest: boolean): Vec2[] {
  return fromWest ? [{ x: -FAR, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z }] : [{ x: FAR, z: LANE_WEST_Z }, { x: -FAR, z: LANE_WEST_Z }];
}

/** Elm Street's bays are reached by a right turn from westbound Main Road (no lane to cross). */
function pathIntoStreetBay(bay: ParkingBay): Vec2[] {
  // Up the lane past the bay behind, then a short swing in to the kerb.
  return [{ x: FAR, z: LANE_WEST_Z }, { x: 2.4, z: LANE_WEST_Z }, { x: LANE_NORTH_X, z: ROAD_Z - 1.2 }, { x: LANE_NORTH_X, z: bay.z + 1.7 }, { x: bay.x - 0.3, z: bay.z + 0.6 }, { x: bay.x, z: bay.z }];
}
export function freeStreetBay(state: GameState): number { return state.streetBays.findIndex((b) => b.carId === null); }

export type Destination = { kind: 'rival'; rival: RivalState; bay: number } | { kind: 'street'; bay: number } | { kind: 'away' };

/**
 * Somewhere else to park for a car going past a full lot at world x = passX: the next rival ahead
 * with a free bay, Elm Street's bays if the car is coming from the east and has the crossroads
 * ahead, otherwise on out of town.
 */
export function onwardDestination(state: GameState, fromWest: boolean, passX: number, preferStreet = false): Destination {
  const ahead = (x: number) => (fromWest ? x > passX + 0.5 : x < passX - 0.5);
  const street = freeStreetBay(state);
  const streetOk = !fromWest && passX > 2 && street >= 0;
  if (preferStreet && streetOk) return { kind: 'street', bay: street };
  const options = state.rivals.filter((r) => r.open).map((r) => ({ r, x: toWorld(rivalFrame(r), dwX(rivalSite(r).L), 0).x, bay: r.bays.findIndex((b) => b.carId === null) }))
    .filter((o) => o.bay >= 0 && ahead(o.x)).sort((a, b) => Math.abs(a.x - passX) - Math.abs(b.x - passX));
  if (options.length) return { kind: 'rival', rival: options[0]!.r, bay: options[0]!.bay };
  if (streetOk) return { kind: 'street', bay: street };
  return { kind: 'away' };
}

/** Send a car to a destination; returns null when it simply drives on out of town. */
export function carTo(state: GameState, dest: Destination, fromWest: boolean, model: number, ownerId: number, state0: Car['state'] = 'arriving'): Car | null {
  if (dest.kind === 'away') {
    // Only for show (the customer is lost either way): not into a queue that already reaches the edge of town.
    const path = passByPath(fromWest);
    if (entryJammed(state, path[0]!)) return null;
    const car = makeCar(state, model, path, 'turnedAway', CAR_ROAD_SPEED);
    car.ownerId = ownerId;
    return null;
  }
  if (dest.kind === 'street') {
    const bay = state.streetBays[dest.bay]!;
    const car = makeCar(state, model, roundPath(pathIntoStreetBay(bay), 1.0), state0, CAR_ROAD_SPEED);
    car.bay = dest.bay; car.lot = 'street'; car.ownerId = ownerId; bay.carId = car.id;
    return car;
  }
  const site = rivalSite(dest.rival);
  const car = makeCar(state, model, roundPath(pathIntoLot(site, dest.bay, fromWest), 1.0), state0, CAR_ROAD_SPEED);
  car.bay = dest.bay; car.lot = dest.rival.id; car.ownerId = ownerId; site.bays[dest.bay]!.carId = car.id;
  return car;
}

/**
 * Spawn a customer's car heading for a bay. When the lot is full the car drives on past it to
 * park somewhere else; returns null then (the customer is lost) unless it found a street bay
 * and the driver walks over anyway.
 */
export function spawnCustomerCar(state: GameState, ownerId: number, fromWest: boolean): { car: Car | null; onward: Destination | null } {
  const model = withRng(state, 'traffic', (r) => r.pick(CUSTOMER_CAR_MODELS));
  // Your own lot: down Main Road toward it, the bay picked on getting there (from whatever is free then: no bay is
  // held for a car still out of town, and a bay freed meanwhile is there for it).
  if (state.shop.lotBaked && state.shop.bays.length) {
    const car = makeCar(state, model, roundPath(passByPath(fromWest), 1.4), 'arriving', CAR_ROAD_SPEED);
    car.ownerId = ownerId; car.seek = { west: fromWest };
    return { car, onward: null };
  }
  // (The car about to be made gets the next id: whether it is electric goes by that.)
  const bayIdx = freeBay(state, isElectric({ id: state.nextId }));
  if (bayIdx < 0) {
    const preferStreet = withRng(state, 'traffic', (r) => r.chance(0.35));
    const dest = onwardDestination(state, fromWest, drivewayX(state), preferStreet);
    const car = carTo(state, dest, fromWest, model, ownerId);
    return { car, onward: dest };
  }
  const site = playerSite(state);
  const into = state.shop.lotBaked ? pathIntoPlayerBay(state, bayIdx, fromWest) : roundPath(pathIntoLot(site, bayIdx, fromWest), 1.0);
  if (!into) return { car: null, onward: { kind: 'away' } };
  site.bays[bayIdx]!.carId = -1; // reserved
  const car = makeCar(state, model, into, 'arriving', CAR_ROAD_SPEED);
  car.bay = bayIdx; car.ownerId = ownerId; site.bays[bayIdx]!.carId = car.id;
  return { car, onward: null };
}

/** How far short of its first turn off Main Road a car coming to your lot picks its bay (and so its way in). */
const SEEK_AHEAD = 8;
/** Has a car coming to your lot reached where it picks its bay (every way in still ahead, room to slow for the turn)? */
export function atLot(state: GameState, car: Car): boolean {
  if (!car.seek) return false;
  const shop = state.shop, xs = wayInXs(state), l = toLocal(shop, car.x, car.z);
  if (!xs.length) return true;
  const fromMinus = shop.flip ? !car.seek.west : car.seek.west;
  return fromMinus ? l.x >= Math.min(...xs) - 1.2 - SEEK_AHEAD : l.x <= Math.max(...xs) + 0.9 + SEEK_AHEAD;
}
/** A car at your lot takes the free bay it can get to (as at spawning, the far end first) and turns in. False: none free. */
export function turnIntoLot(state: GameState, car: Car): boolean {
  const west = car.seek!.west, from = entriesFor(state, car);
  const bayIdx = freeBay(state, isElectric(car), from);
  const into = bayIdx >= 0 ? pathIntoPlayerBay(state, bayIdx, west, { x: car.x, z: car.z }, from) : null;
  if (!into) return false;
  car.seek = undefined;
  car.path = into; car.pathIdx = 1;
  car.bay = bayIdx; state.shop.bays[bayIdx]!.carId = car.id;
  return true;
}
/**
 * Your lot full as the car gets there: on to `dest` from where it is (a rival's lot or Elm Street's bays further on), or
 * on out of town.
 */
export function driveOn(state: GameState, car: Car, dest: Destination): void {
  const here = { x: car.x, z: car.z }, west = car.seek?.west ?? Math.sin(car.yaw) > 0;
  car.seek = undefined;
  if (dest.kind === 'away') { car.state = 'turnedAway'; return; }
  if (dest.kind === 'street') {
    const bay = state.streetBays[dest.bay]!;
    car.path = roundPath([here, ...pathIntoStreetBay(bay).slice(1).filter((q) => q.x < here.x - 0.3)], 1.0); car.pathIdx = 1;
    car.bay = dest.bay; car.lot = 'street'; bay.carId = car.id;
    return;
  }
  const site = rivalSite(dest.rival);
  car.path = roundPath([here, ...pathIntoLot(site, dest.bay, west).slice(1)], 1.0); car.pathIdx = 1;
  car.bay = dest.bay; car.lot = dest.rival.id; site.bays[dest.bay]!.carId = car.id;
}
/**
 * Closing time (or the driver gone): a car still on Main Road on its way to your lot does not turn in. It drives on
 * down the road, its bay (if it had one yet) free again.
 */
export function headHome(state: GameState, car: Car): void {
  const shop = state.shop;
  if (car.bay !== null) { const b = shop.bays[car.bay]; if (b && b.carId === car.id) b.carId = null; }
  car.seek = undefined; car.bay = null; car.held = undefined; car.yielding = false; car.state = 'passing'; car.speed = CAR_ROAD_SPEED;
  const l = toLocal(shop, car.x, car.z), plus = Math.abs(l.z - FAR_L) < Math.abs(l.z - NEAR_L);
  car.path = [{ x: car.x, z: car.z }, farEnd(shop, plus ? 1 : -1, plus ? FAR_L : NEAR_L)]; car.pathIdx = 1;
}
/** Still on Main Road (or the side street), not yet turned off it into a lot. */
export function onTheRoad(car: Car): boolean { return onRoad(car.x, car.z); }

/** Backing out: the rear axle sits this far behind a car's centre, and runs on an arc this tight. */
const REAR_AXLE = 0.45, BACK_RADIUS = 1.35;
/** Straight back this far before steering, so the nose clears the cars either side (bays are 1.1 apart). */
const BACK_STRAIGHT = 0.8;
/** Reversing: top speed, and how gently it pulls away and comes to a stop (units/s, units/s²). */
const BACK_SPEED = 1.1, BACK_ACCEL = 2.2, BACK_BRAKE = 1.8;

type Pose = { x: number; z: number; hx: number; hz: number };

/**
 * Backing out of a nose-in bay the way a driver does it (lot-relative). Straight back until the nose is
 * nearly clear of the neighbours, then steering so the rear swings away from the exit and the car comes
 * round to face it. The rear axle runs on the arc, so the heading turns only as the car rolls and nothing
 * slides sideways. It stops once it is across the aisle (at `stopX`), facing the exit, or near the aisle's
 * end; the drive out finishes the turn. `side` is which way the nose points along x.
 */
export function backOutPoses(L: LotLayout, c: Vec2, side: 1 | -1, stopX: number): Pose[] {
  const D = Math.abs(stopX - c.x);
  const straight = Math.max(BACK_STRAIGHT, D - REAR_AXLE - BACK_RADIUS);
  let rx = c.x - side * REAR_AXLE, rz = c.z, th = 0, s = 0;
  const pose = (): Pose => { const hx = side * Math.cos(th), hz = Math.sin(th); return { x: rx + REAR_AXLE * hx, z: rz + REAR_AXLE * hz, hx, hz }; };
  const out: Pose[] = [pose()];
  const ds = 0.04;
  for (let k = 1; k < 400; k++) {
    rx -= ds * side * Math.cos(th); rz -= ds * Math.sin(th); s += ds;
    if (s > straight) th = Math.min(Math.PI / 2, th + ds / BACK_RADIUS);
    const p = pose();
    // The rear corner that swings deepest into the lot.
    const rearZ = p.z - 0.76 * p.hz - 0.42 * Math.abs(p.hx);
    const done = Math.abs(p.x - c.x) >= D || th >= Math.PI / 2 || rearZ < L.aisle.z0 + 0.1;
    if (done || k % 2 === 0) out.push(p);
    if (done) break;
  }
  return out;
}

/**
 * Backing out of a bay on your own lot (shop-relative): nose in along `u`, straight back until clear, then the rear swings
 * away so the car comes round to face `v` (null: straight back), stopping once it is `D` out from where it stood.
 */
export function backOutTo(c: Vec2, u: Vec2, v: Vec2 | null, D: number): Pose[] {
  const straight = Math.max(BACK_STRAIGHT, D - REAR_AXLE - BACK_RADIUS);
  let rx = c.x - REAR_AXLE * u.x, rz = c.z - REAR_AXLE * u.z, th = 0, s = 0;
  const pose = (): Pose => { const hx = Math.cos(th) * u.x + Math.sin(th) * (v?.x ?? 0), hz = Math.cos(th) * u.z + Math.sin(th) * (v?.z ?? 0); return { x: rx + REAR_AXLE * hx, z: rz + REAR_AXLE * hz, hx, hz }; };
  const out: Pose[] = [pose()];
  const ds = 0.04;
  for (let k = 1; k < 400; k++) {
    const p0 = pose();
    rx -= ds * p0.hx; rz -= ds * p0.hz; s += ds;
    if (v && s > straight) th = Math.min(Math.PI / 2, th + ds / BACK_RADIUS);
    const p = pose();
    const back = -((p.x - c.x) * u.x + (p.z - c.z) * u.z);
    const done = back >= D || th >= Math.PI / 2;
    if (done || k % 2 === 0) out.push(p);
    if (done) break;
  }
  return out;
}

/**
 * Out of a bay on your own lot: back out, the rear swinging the way that points the car toward the way out, then along
 * the tarmac and off at the nearest way in. A car can back right across a two-lane run to drive off on its own side.
 */
function leavePlayerBay(state: GameState, car: Car): boolean {
  const shop = state.shop, f = car.bay !== null ? bayPiece(state, car.bay) : null;
  if (!f) return false;
  const net = lotNet(shop), m = bayMouth(f), into = bayHeading(f), out = (into + 2) % 4;
  const u = DIRS[into]!, c = bayCentre(f);
  const mi = onLotGrid(m.x, m.z) ? tileIndex(m.x, m.z) : -1;
  // Where it can stop backing (the tile in front of the bay, or the one past it), heading either way along the run:
  // only where its rear swings over tarmac (so never into a wall or a parked car), unless there is nowhere else.
  const starts: { tile: number; dir: number; cost: number }[] = [];
  if (mi >= 0 && net.drive[mi]) {
    const far = step(mi, out);
    for (const [tile, cost] of [[mi, 0], [far, 0.5]] as const) {
      if (tile < 0 || !net.drive[tile]) continue;
      for (const d of [(out + 1) % 4, (out + 3) % 4]) { const b = step(tile, (d + 2) % 4); if (b >= 0 && net.drive[b]) starts.push({ tile, dir: d, cost }); }
    }
    if (!starts.length) for (const d of [(out + 1) % 4, (out + 3) % 4]) starts.push({ tile: mi, dir: d, cost: 0 });
  }
  const r = starts.length ? route(net, starts, (t, d) => net.entrances.includes(t) && d !== 2) : null;
  const v = r ? DIRS[r.startDir]! : null;
  const poses = backOutTo(c, u, v, r && r.tiles[0] !== mi ? 2.5 : 1.5);
  car.path = poses.map((p) => toWorld(shop, p.x, p.z));
  car.yaws = poses.map((p) => { const a = toWorld(shop, p.x, p.z), b = toWorld(shop, p.x + p.hx, p.z + p.hz); return Math.atan2(b.x - a.x, b.z - a.z); });
  car.pathIdx = 1; car.reversing = true; car.v = 0;
  const e = poses[poses.length - 1]!;
  const plus = withRng(state, 'traffic', (q) => q.chance(0.5));
  // (No way off the tarmac any more, the lot dug up round it: it drives straight out over the grass.)
  const tiles = r ? r.tiles.slice(1) : [];
  const cx = r ? tileAt(r.tiles[r.tiles.length - 1]!).x + 0.5 : e.x;
  car.next = roundPath([toWorld(shop, e.x, e.z), ...W(shop, corners(tiles)), ...roadOut(shop, cx, plus)], 0.6);
  car.state = 'leaving'; car.speed = CAR_LOT_SPEED * 0.6;
  return true;
}

/** Back out of a bay and drive away, out of whichever lot the car is in. */
export function leaveLot(state: GameState, car: Car): void {
  if (car.lot === 'street') { leaveStreetBay(state, car); return; }
  if (car.lot === undefined && state.shop.lotBaked && leavePlayerBay(state, car)) return;
  const site = siteOf(state, car.lot) ?? playerSite(state);
  const f = site.frame, L = site.L, dx = dwX(L);
  const plus = withRng(state, 'traffic', (r) => r.chance(0.5));
  const c = toLocal(f, car.x, car.z);
  // Which way the nose points in the lot (bays run along x, either side of the aisle).
  const nose = toLocal(f, car.x + Math.sin(car.yaw), car.z + Math.cos(car.yaw));
  const side: 1 | -1 = nose.x - c.x >= 0 ? 1 : -1;
  // Back out round an arc to just past the middle of the aisle, then drive out on the exit lane.
  const poses = backOutPoses(L, c, side, dx - side * 0.1);
  car.path = poses.map((p) => toWorld(f, p.x, p.z));
  car.yaws = poses.map((p) => { const a = toWorld(f, p.x, p.z), b = toWorld(f, p.x + p.hx, p.z + p.hz); return Math.atan2(b.x - a.x, b.z - a.z); });
  car.pathIdx = 1; car.reversing = true; car.v = 0;
  const e = poses[poses.length - 1]!;
  const local: Vec2[] = [{ x: e.x, z: e.z }, { x: dx + OUT, z: e.z + 1.2 }, { x: dx + OUT, z: Math.max(L.driveway.z1, KERB_L - 0.3) }];
  if (plus) local.push({ x: dx + OUT + 0.4, z: NEAR_L + 0.2 }, { x: dx + OUT + 1.8, z: FAR_L });
  else local.push({ x: dx + OUT - 1.0, z: NEAR_L });
  car.next = roundPath([...W(f, local), farEnd(f, plus ? 1 : -1, plus ? FAR_L : NEAR_L)], 0.9);
  // The bay stays taken until the car has backed clear of it.
  car.state = 'leaving'; car.speed = CAR_LOT_SPEED * 0.6;
}

function leaveStreetBay(state: GameState, car: Car): void {
  car.path = roundPath([{ x: car.x, z: car.z }, { x: car.x, z: car.z - 0.6 }, { x: LANE_NORTH_X, z: car.z - 1.9 }, { x: LANE_NORTH_X, z: -FAR }], 0.9);
  car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
  freeCarBay(state, car);
}

function freeCarBay(state: GameState, car: Car): void {
  const b = bayOf(state, car);
  if (b && b.carId === car.id) b.carId = null;
  car.bay = null;
}

/** Through traffic, right-hand driving: both ways along Main Road and both ways along Elm Street. */
export function trafficRoutes(): Vec2[][] {
  return [
    [{ x: -FAR, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z }],
    [{ x: FAR, z: LANE_WEST_Z }, { x: -FAR, z: LANE_WEST_Z }],
    [{ x: LANE_SOUTH_X, z: -FAR }, { x: LANE_SOUTH_X, z: FAR }],
    [{ x: LANE_NORTH_X, z: FAR }, { x: LANE_NORTH_X, z: -FAR }],
  ];
}

/**
 * Is the road into town from this end backed up right out to the edge of the map? Then through
 * traffic (and a turned-away car, which is only for show) takes another way: a jam on the busiest
 * day drains instead of feeding itself.
 */
function entryJammed(state: GameState, from: Vec2): boolean {
  let n = 0;
  for (const c of state.cars) {
    if (c.state === 'parked' || Math.abs(c.x - from.x) > 24 || Math.abs(c.z - from.z) > 24) continue;
    if ((c.v ?? CAR_ROAD_SPEED) < 1 && ++n >= 3) return true;
  }
  return false;
}

export function spawnTraffic(state: GameState): void {
  withRng(state, 'traffic', (r) => {
    const model = r.pick(CUSTOMER_CAR_MODELS.concat([8, 9, 11]));
    const routes = trafficRoutes();
    // Main Road carries most of it.
    const pts = routes[r.chance(0.72) ? r.int(0, 1) : r.int(2, 3)]!;
    if (entryJammed(state, pts[0]!)) return;
    makeCar(state, model, roundPath(pts.map((p) => ({ ...p })), 1.4), 'passing', CAR_ROAD_SPEED * r.range(0.85, 1.05));
  });
}

/** The truck to your back door: along the tarmac from the nearest way in to the tarmac by the back door; with none, to the kerb out front. */
function truckPath(state: GameState): { path: Vec2[]; kerb: boolean } {
  const o = state.shop, stop = truckStop(o), net = lotNet(o);
  const r = stop ? route(net, net.entrances.map((i) => ({ tile: i, dir: 2 })), (t) => t === stop.tile) : null;
  if (r) {
    const cx = tileAt(r.tiles[0]!).x + 0.5;
    return { path: offRoadOnto(o, farEnd(o, -1, FAR_L), roadIn(cx, true), corners(r.tiles)), kerb: false };
  }
  // Pulled up at the kerb, in the near lane by the door, and the boxes carried in.
  return { path: roundPath([farEnd(o, 1, NEAR_L), ...W(o, [{ x: o.door.x + 4, z: NEAR_L }, { x: o.door.x + 1.5, z: NEAR_L }])], 1.2), kerb: true };
}

export function spawnDeliveryTruck(state: GameState, order: Order): void {
  if (state.shop.lotBaked) {
    const { path, kerb } = truckPath(state);
    const truck = makeCar(state, TRUCK_MODEL, path, 'delivering', CAR_ROAD_SPEED * 0.8);
    truck.orderId = order.id;
    if (kerb && !state.notices.some((n) => n.day === state.day && n.text.startsWith('No tarmac to the back door'))) {
      state.notices.push({ day: state.day, text: 'No tarmac to the back door: deliveries are unloaded at the kerb. Lay tarmac from the road to it (Build, Outside).', kind: 'info' });
    }
    return;
  }
  const o = state.shop, L = lotLayout(o);
  const sx = (L.serviceLane.x0 + L.serviceLane.x1) / 2;
  // In from the shop's -x side on the far lane, a turn across the near lane up the service lane to the back door.
  const local: Vec2[] = [{ x: sx - 1.2, z: FAR_L }, { x: sx, z: NEAR_L - 0.6 }, { x: sx, z: L.serviceLane.z1 - 0.3 }, { x: sx, z: L.truckStop.z }, { x: L.truckStop.x, z: L.truckStop.z }];
  const truck = makeCar(state, TRUCK_MODEL, roundPath([farEnd(o, -1, FAR_L), ...W(o, local)], 1.2), 'delivering', CAR_ROAD_SPEED * 0.8);
  truck.orderId = order.id;
}

function truckLeave(state: GameState, car: Car): void {
  if (state.shop.lotBaked) {
    const o = state.shop, c = toLocal(o, car.x, car.z);
    // At the kerb: on down the road.
    if (onRoad(car.x, car.z)) { car.path = roundPath([{ x: car.x, z: car.z }, farEnd(o, -1, NEAR_L)], 1.2); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_ROAD_SPEED; return; }
    const net = lotNet(o), at = { x: Math.floor(c.x), z: Math.floor(c.z - 0.5) + 0.5 };
    const here = onLotGrid(at.x, at.z) ? tileIndex(at.x, at.z) : -1;
    // The way it faces, on the lot's grid (a corner turned half round faces the other way in its own terms).
    const k = o.flip ? -1 : 1, hx = k * Math.sin(car.yaw), hz = k * Math.cos(car.yaw);
    let fwd = 0;
    DIRS.forEach((d, i) => { if (d.x * hx + d.z * hz > DIRS[fwd]!.x * hx + DIRS[fwd]!.z * hz) fwd = i; });
    const r = here >= 0 && net.drive[here] ? route(net, [{ tile: here, dir: fwd }], (t, d) => net.entrances.includes(t) && d !== 2) : null;
    const tiles = r ? r.tiles.slice(1) : [];
    const cx = r ? tileAt(r.tiles[r.tiles.length - 1]!).x + 0.5 : c.x;
    car.path = roundPath([{ x: car.x, z: car.z }, ...W(o, corners(tiles)), ...roadOut(o, cx, true)], 0.6); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
    return;
  }
  const o = state.shop, L = lotLayout(o), dx = dwX(L);
  const c = toLocal(o, car.x, car.z);
  // Across the back yard to the aisle, down the exit lane, then off toward +x.
  const local: Vec2[] = [{ x: c.x, z: c.z }, { x: dx + OUT, z: c.z }, { x: dx + OUT, z: Math.max(L.driveway.z1, KERB_L - 0.3) }, { x: dx + OUT + 0.4, z: NEAR_L + 0.2 }, { x: dx + OUT + 1.8, z: FAR_L }];
  car.path = roundPath([...W(o, local), farEnd(o, 1, FAR_L)], 1.2); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
}

/** Is this point on the carriageway of either road? */
function onRoad(x: number, z: number): boolean { return Math.abs(z - ROAD_Z) < 1.1 || Math.abs(x) < SIDE_HALF + 0.1; }

type Stretch = { x: number; z: number; hx: number; hz: number }[];
/** Each path's stretches, by the point a car on it heads for next (paths are made once and only read after). */
const stretches = new WeakMap<Vec2[], Map<number, Stretch>>();
/**
 * Points every half unit along a path from the point before path[i] on (the stretch a car heading for path[i] is on),
 * off the road only, each with the way it heads there.
 */
function lotStretch(path: Vec2[], i: number): Stretch {
  let byIdx = stretches.get(path);
  if (!byIdx) { byIdx = new Map(); stretches.set(path, byIdx); }
  const hit = byIdx.get(i);
  if (hit) return hit;
  const out: Stretch = [];
  const from = path[Math.max(0, i - 1)];
  if (from) {
    let px = from.x, pz = from.z, s = 0;
    for (let k = Math.max(1, i); k < path.length && out.length < 80; k++) {
      const t = path[k]!, dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz);
      if (d < 1e-9) continue;
      for (; s < d; s += 0.5) { const x = px + (dx * s) / d, z = pz + (dz * s) / d; if (!onRoad(x, z)) out.push({ x, z, hx: dx / d, hz: dz / d }); }
      s -= d; px = t.x; pz = t.z;
    }
  }
  byIdx.set(i, out);
  return out;
}
/** How far along its path a car still has to go before it leaves the road (0 once it has; Infinity if it never does soon). */
function untilLot(car: Car): number {
  if (!onRoad(car.x, car.z)) return 0;
  let px = car.x, pz = car.z, run = 0;
  for (let k = car.pathIdx; k < car.path.length && run < 12; k++) {
    const t = car.path[k]!, dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz);
    for (let s = 0.25; s < d; s += 0.25) if (!onRoad(px + (dx * s) / d, pz + (dz * s) / d)) return run + s;
    run += d; px = t.x; pz = t.z;
    if (!onRoad(px, pz)) return run;
  }
  return Infinity;
}
/**
 * Do two stretches of path meet head to head in one lane (a lane a tile wide, where there is no passing)? Only where the
 * tarmac really is a tile wide there (with `shop`): in a wider lane they keep to their own sides and pass.
 */
function headOn(a: Stretch, b: Stretch, shop?: GameState['shop']): boolean {
  if (!a.length || !b.length) return false;
  const narrow = (p: Stretch[number]) => !shop || singleLane(shop, p);
  // (Bucketed by half-unit cell, so each point is only weighed against those beside it.)
  const cell = (x: number, z: number) => (Math.floor(x * 2) + 4096) * 8192 + Math.floor(z * 2) + 4096;
  const cells = new Map<number, Stretch>();
  for (const p of a) { const k = cell(p.x, p.z), l = cells.get(k); if (l) l.push(p); else cells.set(k, [p]); }
  for (const q of b) {
    const cx = Math.floor(q.x * 2), cz = Math.floor(q.z * 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = cells.get((cx + i + 4096) * 8192 + cz + j + 4096);
      if (l) for (const p of l) if (Math.hypot(p.x - q.x, p.z - q.z) < 0.45 && p.hx * q.hx + p.hz * q.hz < -0.7 && narrow(p)) return true;
    }
  }
  return false;
}
/** Is your lot's tarmac a single tile wide across the way a car is heading at this (world) point? Off the tarmac: no. */
function singleLane(shop: GameState['shop'], p: Stretch[number]): boolean {
  const l = toLocal(shop, p.x, p.z), x = Math.floor(l.x), z = Math.floor(l.z - 0.5) + 0.5;
  if (!onLotGrid(x, z)) return false;
  const net = lotNet(shop), i = tileIndex(x, z);
  if (!net.drive[i]) return false;
  // (Across the heading, in shop terms: a step either side.)
  const h = toLocal(shop, p.x + p.hx, p.z + p.hz), d = Math.abs(h.x - l.x) > Math.abs(h.z - l.z) ? 0 : 1;
  const side = (k: number) => { const j = step(i, d === 0 ? (k > 0 ? 0 : 2) : (k > 0 ? 1 : 3)); return j >= 0 && !!net.drive[j]; };
  return !side(1) && !side(-1);
}
/** Where a car that is driving out of your lot goes from here on (once it has backed out, if it still has to). */
const onwardOf = (o: Car) => (o.reversing ? lotStretch(o.next ?? [], 1) : lotStretch(o.path, o.pathIdx));

/**
 * Your own lot, laid by hand, can have lanes a single tile wide. A car about to turn in off the road waits there (well
 * short of the turn, out of the way of anyone pulling out) while a car driving out would meet it head on in such a lane.
 * Returns the speed factor (1: nothing holds it).
 */
function lotHold(state: GameState, car: Car): number {
  if (car.lot !== undefined || (car.state !== 'arriving' && car.state !== 'delivering') || !state.shop.lotBaked) return 1;
  const d = untilLot(car);
  if (d <= 3 || d > 10) return 1;
  let mine: Stretch | null = null;
  for (const o of state.cars) {
    if (o === car || o.lot !== undefined || o.state !== 'leaving') continue;
    // One still in its bay waits for us instead.
    if (o.reversing && Math.hypot(o.x - o.path[0]!.x, o.z - o.path[0]!.z) < 0.05) continue;
    mine ??= lotStretch(car.path, car.pathIdx);
    if (headOn(mine, onwardOf(o), state.shop)) return Math.sqrt(Math.max(0, Math.min(1, (d - 4) / 3)));
  }
  return 1;
}

/** The gap a car stops at behind another (centre to centre). */
const STOP_AT = 2.0;

/**
 * How far a car may go this tick: it keeps a gap to whatever is ahead of it in its lane
 * (or crossing in front), so cars queue instead of driving through each other.
 */
function headroom(state: GameState, car: Car): number {
  const was = car.blocker;
  car.gap = Infinity; car.blocker = undefined;
  if (car.reversing) {
    // Backing out: wait until the aisle behind is clear, and never reverse into a car.
    const t = car.path[car.pathIdx];
    if (!t) return 1;
    // Where it is backing to (the end of the arc, out in the aisle) and which way it is moving now.
    const end = car.path[car.path.length - 1]!;
    const mx = t.x - car.x, mz = t.z - car.z, ml = Math.hypot(mx, mz) || 1;
    const starting = Math.hypot(car.x - car.path[0]!.x, car.z - car.path[0]!.z) < 0.05;
    for (const o of state.cars) {
      if (o === car || o.state === 'parked' || o.state === 'gone') continue;
      // Neighbours waiting to back out of their own bays: the older one goes first.
      if (o.reversing && Math.hypot(o.x - o.path[0]!.x, o.z - o.path[0]!.z) < 0.05 && o.id > car.id) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      // Before pulling out, wait for anything near the spot or about to drive past it.
      if (starting && (Math.hypot(o.x - end.x, o.z - end.z) < 4.5 || o.path.slice(o.pathIdx, o.pathIdx + 8).some((p) => Math.hypot(p.x - end.x, p.z - end.z) < 1.8) && Math.hypot(o.x - end.x, o.z - end.z) < 9)) return 0;
      // Nor out into a lane a tile wide that a car coming in is driving up (on the lot, turning onto it, or waiting on the
      // road to: it was there first, and the cars backing out would otherwise keep it waiting one after another).
      if (starting && car.lot === undefined && o.lot === undefined && (o.state === 'arriving' || o.state === 'delivering')) {
        const d = untilLot(o);
        if ((d < 3 || (o.yielding && d <= 10)) && headOn(onwardOf(car), lotStretch(o.path, o.pathIdx), state.shop)) return 0;
      }
      const along = (dx * mx + dz * mz) / ml, side = Math.abs(dx * mz - dz * mx) / ml;
      // Once out of the bay, a car already waiting for us lets us finish.
      if (!starting && (o.waited ?? 0) > 1) continue;
      if (along > 0 && along < 2.4 && side < 1.2) return 0;
    }
    return 1;
  }
  // Lot manners: a car coming into a lot gives way to one driving out whose next stretch crosses its own.
  if (car.state === 'arriving' && !onRoad(car.x, car.z)) {
    const mine = car.path.slice(car.pathIdx, car.pathIdx + 4);
    for (const o of state.cars) {
      if (o === car || o.state !== 'leaving' || o.reversing || onRoad(o.x, o.z)) continue;
      if (Math.abs(o.x - car.x) > 3.5 || Math.abs(o.z - car.z) > 3.5) continue;
      // Two cars head to head in their own lanes of the driveway just pass; only a car turning across waits.
      if (Math.sin(car.yaw) * Math.sin(o.yaw) + Math.cos(car.yaw) * Math.cos(o.yaw) < -0.85) continue;
      const theirs = o.path.slice(o.pathIdx, o.pathIdx + 6);
      if (theirs.some((q) => mine.some((m) => Math.hypot(q.x - m.x, q.z - m.z) < 0.9))) { car.gap = 0; car.blocker = o.id; return 0; }
    }
  }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let gap = Infinity, ahead: Vec2[] | null = null;
  for (const o of state.cars) {
    if (o === car || o.state === 'gone') continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
    // A car standing still in its bay (or about to back out of it) is only in the way if our path runs into it: turning
    // into the bay beside it, the cone ahead sweeps over it (and every car pulling in braked for its neighbour).
    if (o.state === 'parked' || o.state === 'unloading' || (o.reversing && Math.hypot(o.x - o.path[0]!.x, o.z - o.path[0]!.z) < 0.05)) {
      ahead ??= pathAhead(car, 4.5);
      const k = ahead.findIndex((q, i) => i > 0 && bodyHits(o, q));
      if (k > 0 && k * 0.25 < gap) { gap = k * 0.25 + STOP_AT; car.blocker = o.id; }
      continue;
    }
    const along = dx * fx + dz * fz;
    if (along <= 0.05 || along > 4.5) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 0.86) {
      // Not in our lane, but cutting across it (turning in, pulling out) or stopped across it (backing out of a bay):
      // braked for where our way runs into it.
      if (o.yielding || ((o.v ?? 0) < 0.05 ? !o.reversing : Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz > 0.7)) continue;
      ahead ??= pathAhead(car, 4.5);
      const k = ahead.findIndex((q, i) => i > 0 && bodyHits(o, q));
      if (k > 0 && k * 0.25 < gap) { gap = k * 0.25 + STOP_AT * 0.5; car.blocker = o.id; }
      continue;
    }
    // A car waiting at the kerb for a gap is not in our lane.
    if (o.yielding && side > 0.45) continue;
    // Two cars nose to nose (a rare crossing): the older one goes first.
    const ofx = Math.sin(o.yaw), ofz = Math.cos(o.yaw);
    const facing = ofx * fx + ofz * fz < -0.5 && (-dx * ofx - dz * ofz) > 0;
    if (facing && car.id < o.id) continue;
    // Two cars each waiting for the other: the older one goes. (Each for the other: one waiting on us while we wait on
    // something else, a gap in the traffic say, is not a tie to break, and pulling away we would drive into it.)
    if (o.blocker === car.id && was === o.id && car.id < o.id && (o.waited ?? 0) > 3) continue;
    if (along < gap) { gap = along; car.blocker = o.id; }
  }
  car.gap = gap;
  if (gap === Infinity) return 1;
  // Square-root, not linear: from road speed that is a steady braking a car can actually follow, so it
  // rolls up behind the queue instead of snapping to a stop at the last moment.
  const stop = STOP_AT, free = 3.8;
  return Math.sqrt(Math.max(0, Math.min(1, (gap - stop) / (free - stop))));
}

/**
 * The traffic light: a car heading through the crossroads slows to its stop line and waits while
 * its road is red. Amber stops it too unless it is already at the line. Returns the speed factor.
 */
export function lightHold(state: GameState, car: Car): number { return light(state, car).k; }

/**
 * k: speed factor from the light; red: the car is queued for a red light somewhere ahead; room: how
 * far it may still go before its stop line (Infinity when nothing holds it).
 */
function light(state: GameState, car: Car): { k: number; red: boolean; room: number } {
  const free = { k: 1, red: false, room: Infinity };
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let road: 'main' | 'side', before: number;
  if (fx > 0.7 && Math.abs(car.z - LANE_EAST_Z) < 0.4) { road = 'main'; before = STOP_LINE.eastbound - car.x; }
  else if (fx < -0.7 && Math.abs(car.z - LANE_WEST_Z) < 0.4) { road = 'main'; before = car.x - STOP_LINE.westbound; }
  else if (fz > 0.7 && Math.abs(car.x - LANE_SOUTH_X) < 0.4) { road = 'side'; before = STOP_LINE.southbound - car.z; }
  else if (fz < -0.7 && Math.abs(car.x - LANE_NORTH_X) < 0.4) { road = 'side'; before = car.z - STOP_LINE.northbound; }
  else return free;
  if (before < -0.05 || before > 40) return free;
  // Only cars that will actually cross the line wait (one turning into a lot short of it does not).
  const crosses = car.path.slice(car.pathIdx).some((p) => {
    if (road === 'main') return fx > 0 ? p.x > STOP_LINE.eastbound : p.x < STOP_LINE.westbound;
    return fz > 0 ? p.z > STOP_LINE.southbound : p.z < STOP_LINE.northbound;
  });
  if (!crosses) return free;
  const g = greenFor(road, state.tick);
  // On amber a car too close to stop, even braking hard, carries on through.
  const v = car.v ?? car.speed;
  if (g === 'go' || (g === 'amber' && before < Math.max(1.0, (v * v) / (2 * CAR_BRAKE) + 0.1))) return free;
  // Steady braking to the line (about 6 units/s² from road speed), well within what the brakes can do.
  return { k: before > 7 ? 1 : Math.sqrt(Math.max(0, Math.min(1, (before - 0.05) / 3))), red: true, room: Math.max(0, before - 0.05) };
}

/**
 * Junction manners. A car about to cross the oncoming lane (a left turn into a lot) or to pull
 * out onto a road waits for a gap in the traffic it would cut across.
 */
function mustYield(state: GameState, car: Car): boolean {
  const ahead = car.path.slice(car.pathIdx, car.pathIdx + 8).filter((p) => Math.hypot(p.x - car.x, p.z - car.z) < 3.4);
  if (!ahead.length) return false;
  // About to turn into your lot: not across a car already pulling out of it (it is past waiting for us, out in the
  // mouth of the drive; nose to nose there, neither could get by).
  if ((car.state === 'arriving' || car.state === 'delivering') && car.lot === undefined && state.shop.lotBaked && onRoad(car.x, car.z) && untilLot(car) < 3) {
    let mine: Vec2[] | null = null;
    for (const o of state.cars) {
      if (o === car || o.lot !== undefined || o.state !== 'leaving' || o.reversing || o.yielding || (o.v ?? 0) < 0.05) continue;
      if (Math.abs(o.x - car.x) > 5 || Math.abs(o.z - car.z) > 5) continue;
      mine ??= pathAhead(car, 3);
      if (pathAhead(o, 3).some((q) => mine!.some((m) => Math.hypot(q.x - m.x, q.z - m.z) < 0.9))) return true;
    }
  }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const N = ROAD_Z - 1.0, S = ROAD_Z + 1.0;
  // Turning across the oncoming lane: it waits for a gap until its nose is in that lane, then it is committed.
  const noseZ = car.z + 0.75 * fz;
  const crossN = fx > 0.25 && car.z > LANE_WEST_Z + 0.3 && car.z < LANE_EAST_Z + 0.3 && noseZ > LANE_WEST_Z + 0.45 && ahead.some((p) => p.z < LANE_WEST_Z + 0.1);
  const crossS = fx < -0.25 && car.z < LANE_EAST_Z - 0.3 && car.z > LANE_WEST_Z - 0.3 && noseZ < LANE_EAST_Z - 0.45 && ahead.some((p) => p.z > LANE_EAST_Z - 0.1);
  const fromNorth = fz > 0.9 && Math.abs(car.x) > SIDE_HALF + 0.2 && car.z < N - 0.5 && car.z > N - 2.4 && ahead.some((p) => p.z > N + 0.2);
  const fromSouth = fz < -0.9 && Math.abs(car.x) > SIDE_HALF + 0.2 && car.z > S + 0.5 && car.z < S + 2.4 && ahead.some((p) => p.z < S - 0.2);
  const fromBay = car.x > SIDE_HALF + 0.2 && car.x < SIDE_HALF + 1.2 && fz < -0.5 && ahead.some((p) => p.x < SIDE_HALF);
  if (!crossN && !crossS && !fromNorth && !fromSouth && !fromBay) return false;
  // Pulling out of your lot, it also gives way to a car turning in at it (off the road: it has the right of way) whose
  // turn would cross its own. (Once turning, that car is out of its lane, where the checks below look.) Not to one held
  // on the road for a lane a tile wide: that one is waiting for us.
  if ((fromNorth || fromSouth) && car.lot === undefined && state.shop.lotBaked) {
    let mine: Vec2[] | null = null;
    for (const o of state.cars) {
      if (o === car || o.lot !== undefined || (o.state !== 'arriving' && o.state !== 'delivering') || o.held !== undefined || o.yielding || !onRoad(o.x, o.z)) continue;
      if (Math.abs(o.x - car.x) > 6 || Math.abs(o.z - car.z) > 6 || untilLot(o) > 5) continue;
      mine ??= pathAhead(car, 3);
      if (pathAhead(o, 4).some((q) => onRoad(q.x, q.z) && mine!.some((m) => Math.hypot(q.x - m.x, q.z - m.z) < 1.0))) return true;
    }
  }
  for (const o of state.cars) {
    if (o === car || o.state === 'parked' || o.state === 'unloading' || o.yielding) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    if (fromBay) {
      const north = Math.cos(o.yaw) < -0.8 && Math.abs(o.x - LANE_NORTH_X) < 0.45;
      if (north && dz > -3.5 && dz < 10) return true;
      continue;
    }
    const west = Math.sin(o.yaw) < -0.8 && Math.abs(o.z - LANE_WEST_Z) < 0.45;
    const east = Math.sin(o.yaw) > 0.8 && Math.abs(o.z - LANE_EAST_Z) < 0.45;
    // A gap of a few seconds: a turning car slows for its bend (or pulls away from the kerb) and takes that long to
    // clear the lane, and turning across it drives on toward whatever is coming the other way, closing the gap faster.
    const theirs = o.v ?? o.speed, mine = car.v ?? 0;
    if ((crossN || fromNorth || fromSouth) && west && dx > -1.8 && dx < 2 + GAP_SECONDS * (theirs + Math.max(0, mine * fx))) return true;
    if ((crossS || fromNorth || fromSouth) && east && dx < 1.8 && dx > -2 - GAP_SECONDS * (theirs + Math.max(0, -mine * fx))) return true;
  }
  return false;
}

/** Seconds away traffic must be for a car to turn across it or pull out in front of it. */
const GAP_SECONDS = 3;

/** Our centre at `q` would put our body into car `o` (a car's half length and half width, and ours beside it). */
function bodyHits(o: Car, q: Vec2): boolean {
  const dx = q.x - o.x, dz = q.z - o.z, fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);
  return Math.abs(dx * fx + dz * fz) < 1.25 && Math.abs(dx * fz - dz * fx) < 0.8;
}

/** Points every quarter unit along a car's path from where it is, for `len`. */
function pathAhead(c: Car, len: number): Vec2[] {
  const out: Vec2[] = [{ x: c.x, z: c.z }];
  let px = c.x, pz = c.z, run = 0;
  for (let k = c.pathIdx; k < c.path.length && run < len; k++) {
    const t = c.path[k]!, dx = t.x - px, dz = t.z - pz, d = Math.hypot(dx, dz);
    for (let s = 0.25; s <= d && run + s <= len; s += 0.25) out.push({ x: px + (dx * s) / d, z: pz + (dz * s) / d });
    run += d; px = t.x; pz = t.z;
  }
  return out;
}

/** Seconds a car waits on the road to turn into your lot before it gives up and drives on (with cars stopped behind it, before that). */
const HOLD_GIVE_UP = 15, HOLD_QUEUED = 6;

/**
 * A car that has waited too long to get into your lot (a lane a tile wide, cars coming out of it one after another)
 * drives on down the road, its bay freed, its driver gone: a customer lost, and a word about the lane.
 */
function giveUpLot(state: GameState, car: Car): void {
  const shop = state.shop, l = toLocal(shop, car.x, car.z), plus = Math.abs(l.z - FAR_L) < Math.abs(l.z - NEAR_L);
  if (car.bay !== null) { const b = shop.bays[car.bay]; if (b && b.carId === car.id) b.carId = null; }
  car.bay = null; car.held = undefined; car.yielding = false; car.state = 'passing'; car.speed = CAR_ROAD_SPEED;
  car.path = [{ x: car.x, z: car.z }, farEnd(shop, plus ? 1 : -1, plus ? FAR_L : NEAR_L)]; car.pathIdx = 1;
  state.today.turnedAway++;
  complain(state, 'lotFull');
  popup(state, { x: car.x, z: car.z }, 'Can\'t get in!', 'bad', 0.8);
  if (!state.notices.some((n) => n.day === state.day && n.text.startsWith('Cars are queueing'))) {
    state.notices.push({ day: state.day, text: 'Cars are queueing to get into your lot and giving up: a lane of tarmac two tiles wide lets cars in and out at once.', kind: 'info' });
  }
}

/** Seconds a car backing out waits for a clear aisle before it goes anyway; seconds any car waits before squeezing past. */
const REVERSE_GIVE_UP = 30, JAM_GIVE_UP = 40;

function drive(state: GameState, car: Car, speed: number, turnRate: number): boolean {
  const hold = lotHold(state, car);
  // Held to turn into the lot: waiting for a gap, as at a junction (anyone pulling out goes round it). Not for ever.
  car.held = hold <= 0.01 ? (car.held ?? 0) + TICK : undefined;
  // (Sooner with traffic stopped behind it: it is holding up the road.)
  if (car.held !== undefined && (car.held > HOLD_GIVE_UP || (car.held > HOLD_QUEUED && state.cars.some((o) => o.blocker === car.id && (o.waited ?? 0) > 1)))) { giveUpLot(state, car); return false; }
  car.yielding = hold <= 0.01 || mustYield(state, car);
  const l = light(state, car);
  const k = car.yielding ? 0 : Math.min(headroom(state, car), l.k, hold);
  if (k <= 0.01) {
    car.v = 0;
    // Waiting in a queue for a red light (or to turn in) is normal; only other hold-ups count toward the jam breaker.
    car.waited = l.red || hold <= 0.01 ? 0 : (car.waited ?? 0) + TICK;
    // Backing out waits its turn, but not for ever: in a busy two-row lot the cars it waits for can be waiting on it.
    if (car.reversing && (car.waited ?? 0) < REVERSE_GIVE_UP) return false;
    // Never jam for good: after a long wait (not at a red light), inch forward.
    if ((car.waited ?? 0) < 8) return false;
  } else car.waited = 0;
  if (car.reversing) {
    const t = car.path[car.pathIdx];
    if (!t) return true;
    if (!car.yaws || car.yaws.length !== car.path.length) {
      // A save from before the back-out arc: straight back, the nose swinging round toward the exit.
      const dx = t.x - car.x, dz = t.z - car.z, d = Math.hypot(dx, dz);
      const step = speed * 0.5 * TICK;
      car.yaw = turnToward(car.yaw, Math.atan2(-dx, -dz) + (car.next ? 0.6 * Math.sign(dx || 1) : 0), 1.6 * TICK);
      if (d <= step) { car.x = t.x; car.z = t.z; car.pathIdx++; return true; }
      car.x += (dx / d) * step; car.z += (dz / d) * step;
      return false;
    }
    return backAlong(car);
  }
  // Held up a while: creep on when there is room. Held up for good (a ring of cars each waiting on the next): squeeze through.
  const inch = (car.waited ?? 0) >= JAM_GIVE_UP ? 0.3 : (car.waited ?? 0) >= 8 && (car.gap ?? Infinity) > 1.4 ? 0.15 : 0;
  // Only a car turning off the road (into a lot, a bay, the service lane) brakes ahead of its turn.
  const turning = car.state === 'arriving' || car.state === 'delivering';
  const want = (turning ? Math.min(speed, turnSpeed(car, speed)) : speed) * Math.max(k, inch);
  // Ease toward it: pull away gently, brake firmly (the gap rules above still decide when to stop).
  const v = car.v ?? want;
  car.v = want > v ? Math.min(want, v + CAR_ACCEL * TICK) : Math.max(want, v - CAR_BRAKE * TICK);
  // Whatever the easing, never past a stop line that holds us.
  car.v = Math.min(car.v, l.room / TICK);
  return followPath(car, car.v, TICK, turnRate);
}

/**
 * Roll back along the back-out arc: off the mark gently, slowing to a stop at its end. Position and
 * heading both come from the arc (worked out on the rear axle), so the car turns only as it rolls.
 */
function backAlong(car: Car): boolean {
  const yaws = car.yaws!;
  let left = 0, px = car.x, pz = car.z;
  for (let i = car.pathIdx; i < car.path.length; i++) { const p = car.path[i]!; left += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  const want = Math.max(0.12, Math.min(BACK_SPEED, Math.sqrt(2 * BACK_BRAKE * left)));
  const v = car.v ?? 0;
  car.v = want > v ? Math.min(want, v + BACK_ACCEL * TICK) : want;
  let budget = car.v * TICK;
  while (budget > 0 && car.pathIdx < car.path.length) {
    const t = car.path[car.pathIdx]!;
    const dx = t.x - car.x, dz = t.z - car.z, d = Math.hypot(dx, dz);
    if (d <= budget) { car.x = t.x; car.z = t.z; budget -= d; car.pathIdx++; }
    else { car.x += (dx / d) * budget; car.z += (dz / d) * budget; budget = 0; }
  }
  const i = car.pathIdx;
  if (i >= car.path.length) { car.yaw = yaws[yaws.length - 1]!; return true; }
  const a = car.path[i - 1]!, b = car.path[i]!;
  const seg = Math.hypot(b.x - a.x, b.z - a.z);
  const f = seg > 1e-6 ? Math.max(0, Math.min(1, 1 - Math.hypot(b.x - car.x, b.z - car.z) / seg)) : 1;
  let dy = yaws[i]! - yaws[i - 1]!;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  car.yaw = yaws[i - 1]! + dy * f;
  return false;
}

/**
 * Pulling away and braking, units per second per second. Brisk enough (road speed in about a second)
 * that a queue clears the lights about as fast as before cars eased at all: a gentler pull-away
 * passes fewer cars per green, and on the busiest days the queue then outgrows the town.
 */
const CAR_ACCEL = 5, CAR_BRAKE = 12;

/**
 * Slow down before a turn, not in it: the sharper the bend coming up and the nearer it is, the closer
 * to lot speed. So a car turning into a lot eases off on the road and rolls in, instead of snapping
 * from road speed to lot speed at the kerb.
 */
function turnSpeed(car: Car, speed: number): number {
  if (speed <= CAR_LOT_SPEED) return speed;
  let x = car.x, z = car.z, dist = 0, best = speed;
  const yaw0 = car.yaw;
  for (let i = car.pathIdx; i < car.path.length && dist < 7; i++) {
    const t = car.path[i]!;
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    let turn = Math.atan2(dx, dz) - yaw0;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    if (Math.abs(turn) > 0.5) {
      // A bend this sharp wants lot speed by the time we reach it; further off, a blend.
      const f = Math.max(0, Math.min(1, (dist - 1) / 5));
      best = Math.min(best, CAR_LOT_SPEED + (speed - CAR_LOT_SPEED) * f);
      break;
    }
    dist += d; x = t.x; z = t.z;
  }
  return best;
}

/** Slow to lot speed off the carriageway and for the last few metres into a bay. */
function lotSpeed(car: Car): boolean {
  if (!onRoad(car.x, car.z)) return true;
  const end = car.path[car.path.length - 1];
  return !!end && car.state !== 'passing' && car.state !== 'turnedAway' && Math.hypot(end.x - car.x, end.z - car.z) < 3.2;
}

export function tickCars(state: GameState): void {
  // A parked car whose driver is gone (closing time sends the last customers home) drives off by itself.
  let drivers: Set<number> | null = null;
  for (const car of state.cars) {
    if ((car.state !== 'parked' && car.state !== 'arriving') || car.ownerId === null) continue;
    drivers ??= new Set(state.people.map((p) => p.id));
    if (drivers.has(car.ownerId)) continue;
    if (car.state === 'parked') leaveLot(state, car);
    // (One on its way to your lot still out on the road, its driver gone home at closing: it never turns in.)
    else if (car.lot === undefined && onRoad(car.x, car.z)) { car.ownerId = null; headHome(state, car); }
  }
  for (const car of state.cars) {
    car.px = car.x; car.pz = car.z; car.pyaw = car.yaw;
    switch (car.state) {
      case 'passing':
      case 'turnedAway':
      case 'leaving': {
        if (car.reversing) {
          if (drive(state, car, CAR_LOT_SPEED, 5)) {
            // Stopped at the end of the arc: a moment to change gear, then off from rest.
            car.reversing = false; car.path = car.next ?? []; car.next = undefined; car.pathIdx = 1; car.yaws = undefined;
            car.v = 0; car.timer = 0.25;
            freeCarBay(state, car);
          }
          break;
        }
        if (car.timer > 0) { car.timer -= TICK; break; }
        if (car.state === 'leaving') car.speed = onRoad(car.x, car.z) ? CAR_ROAD_SPEED : CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 6)) car.state = 'gone';
        break;
      }
      case 'arriving': {
        // (Stopped at the roadside after a bump on its way.)
        if (car.timer > 0) { car.timer -= TICK; break; }
        if (lotSpeed(car)) car.speed = CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 5)) {
          car.state = 'parked';
          // Nose in: the car keeps the heading it drove in with.
          const b = bayOf(state, car);
          if (b) { car.x = b.x; car.z = b.z; car.yaw = Math.round(car.yaw / (Math.PI / 2)) * (Math.PI / 2); }
        }
        break;
      }
      case 'parked': break;
      case 'delivering': {
        if (lotSpeed(car)) car.speed = CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 5)) { car.state = 'unloading'; car.timer = 6 * unloadK(state); cue(state, 'truck'); }
        break;
      }
      case 'unloading': {
        car.timer -= TICK;
        const order = state.orders.find((o) => o.id === car.orderId);
        if (order && order.state !== 'delivered' && car.timer < 4 * unloadK(state)) {
          deliverOrder(state, order);
        }
        if (car.timer <= 0) truckLeave(state, car);
        break;
      }
      case 'gone': break;
    }
  }
  if (state.cars.some((c) => c.state === 'gone')) state.cars = state.cars.filter((c) => c.state !== 'gone');
}

/** A loading bay unloads the truck in half the time. */
function unloadK(state: GameState): number { return hasDock(state.shop) ? BAY_UNLOAD : 1; }

export function deliverOrder(state: GameState, order: Order): void {
  order.state = 'delivered';
  for (const line of order.lines) {
    const existing = state.shop.storage.find((s) => s.productId === line.productId && s.day === state.day);
    if (existing) existing.qty += line.qty;
    else state.shop.storage.push({ productId: line.productId, qty: line.qty, day: state.day });
  }
  const o = state.shop, sd = serviceDoor(o), at = sd ? byDoor(sd, 0.5) : { x: o.backDoor.x, z: o.backDoor.z - 0.5 };
  popup(state, toWorld(o, at.x, at.z), 'Delivery!', 'info', 1.2);
  cue(state, 'boxes');
}
