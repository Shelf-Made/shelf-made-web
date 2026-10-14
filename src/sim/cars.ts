import type { GameState, Car, Vec2, Order, ParkingBay, RivalState } from './types';
import {
  ROAD_Z, LANE_EAST_Z, LANE_WEST_Z, LANE_NORTH_X, LANE_SOUTH_X, SIDE_HALF, STOP_LINE, CAR_ROAD_SPEED, CAR_LOT_SPEED, TICK, ROAD_FAR,
  lotLayout, toWorld, toLocal, greenFor, type Frame, type LotLayout,
} from './layout';
import { followPath, roundPath, turnToward } from './movement';
import { withRng, nextId, popup, cue } from './state';
import { rivalFrame, rivalShape } from './rivals';

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
export function drivewayX(state: GameState): number { const s = playerSite(state); return toWorld(s.frame, dwX(s.L), 0).x; }
export function serviceX(state: GameState): number { const L = lotLayout(state.shop); return toWorld(state.shop, (L.serviceLane.x0 + L.serviceLane.x1) / 2, 0).x; }

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

export function freeBay(state: GameState): number { return state.shop.bays.findIndex((b) => b.carId === null); }

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
  return [{ x: FAR, z: LANE_WEST_Z }, { x: 2.4, z: LANE_WEST_Z }, { x: LANE_NORTH_X, z: ROAD_Z - 1.2 }, { x: LANE_NORTH_X, z: bay.z + 2.4 }, { x: bay.x, z: bay.z + 0.7 }, { x: bay.x, z: bay.z }];
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
    const car = makeCar(state, model, passByPath(fromWest), 'turnedAway', CAR_ROAD_SPEED);
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
  const bayIdx = freeBay(state);
  const model = withRng(state, 'traffic', (r) => r.pick(CUSTOMER_CAR_MODELS));
  if (bayIdx < 0) {
    const preferStreet = withRng(state, 'traffic', (r) => r.chance(0.35));
    const dest = onwardDestination(state, fromWest, drivewayX(state), preferStreet);
    const car = carTo(state, dest, fromWest, model, ownerId);
    return { car, onward: dest };
  }
  const site = playerSite(state);
  site.bays[bayIdx]!.carId = -1; // reserved
  const car = makeCar(state, model, roundPath(pathIntoLot(site, bayIdx, fromWest), 1.0), 'arriving', CAR_ROAD_SPEED);
  car.bay = bayIdx; car.ownerId = ownerId; site.bays[bayIdx]!.carId = car.id;
  return { car, onward: null };
}

/** Back out of a bay and drive away, out of whichever lot the car is in. */
export function leaveLot(state: GameState, car: Car): void {
  if (car.lot === 'street') { leaveStreetBay(state, car); return; }
  const site = siteOf(state, car.lot) ?? playerSite(state);
  const f = site.frame, L = site.L, dx = dwX(L);
  const plus = withRng(state, 'traffic', (r) => r.chance(0.5));
  const c = toLocal(f, car.x, car.z);
  // Back out into the aisle first (the car keeps facing the bay), then drive out on the exit lane.
  const back = { x: dx + OUT + (c.x < dx ? 0 : 0.9), z: c.z };
  car.path = [{ x: car.x, z: car.z }, toWorld(f, back.x, back.z)]; car.pathIdx = 1; car.reversing = true;
  const local: Vec2[] = [back, { x: dx + OUT, z: c.z + 0.9 }, { x: dx + OUT, z: Math.max(L.driveway.z1, KERB_L - 0.3) }];
  if (plus) local.push({ x: dx + OUT + 0.4, z: NEAR_L + 0.2 }, { x: dx + OUT + 1.8, z: FAR_L });
  else local.push({ x: dx + OUT - 1.0, z: NEAR_L });
  car.next = roundPath([...W(f, local), farEnd(f, plus ? 1 : -1, plus ? FAR_L : NEAR_L)], 0.9);
  // The bay stays taken until the car has backed clear of it.
  car.state = 'leaving'; car.speed = CAR_LOT_SPEED * 0.6;
}

function leaveStreetBay(state: GameState, car: Car): void {
  car.path = roundPath([{ x: car.x, z: car.z }, { x: car.x, z: car.z - 0.8 }, { x: LANE_NORTH_X, z: car.z - 2.4 }, { x: LANE_NORTH_X, z: -FAR }], 0.9);
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

export function spawnTraffic(state: GameState): void {
  withRng(state, 'traffic', (r) => {
    const model = r.pick(CUSTOMER_CAR_MODELS.concat([8, 9, 11]));
    const routes = trafficRoutes();
    // Main Road carries most of it.
    const pts = routes[r.chance(0.72) ? r.int(0, 1) : r.int(2, 3)]!;
    makeCar(state, model, roundPath(pts.map((p) => ({ ...p })), 1.4), 'passing', CAR_ROAD_SPEED * r.range(0.85, 1.05));
  });
}

export function spawnDeliveryTruck(state: GameState, order: Order): void {
  const o = state.shop, L = lotLayout(o);
  const sx = (L.serviceLane.x0 + L.serviceLane.x1) / 2;
  // In from the shop's -x side on the far lane, a turn across the near lane up the service lane to the back door.
  const local: Vec2[] = [{ x: sx - 1.2, z: FAR_L }, { x: sx, z: NEAR_L - 0.6 }, { x: sx, z: L.serviceLane.z1 - 0.3 }, { x: sx, z: L.truckStop.z }, { x: L.truckStop.x, z: L.truckStop.z }];
  const truck = makeCar(state, TRUCK_MODEL, roundPath([farEnd(o, -1, FAR_L), ...W(o, local)], 1.2), 'delivering', CAR_ROAD_SPEED * 0.8);
  truck.orderId = order.id;
}

function truckLeave(state: GameState, car: Car): void {
  const o = state.shop, L = lotLayout(o), dx = dwX(L);
  const c = toLocal(o, car.x, car.z);
  // Across the back yard to the aisle, down the exit lane, then off toward +x.
  const local: Vec2[] = [{ x: c.x, z: c.z }, { x: dx + OUT, z: c.z }, { x: dx + OUT, z: Math.max(L.driveway.z1, KERB_L - 0.3) }, { x: dx + OUT + 0.4, z: NEAR_L + 0.2 }, { x: dx + OUT + 1.8, z: FAR_L }];
  car.path = roundPath([...W(o, local), farEnd(o, 1, FAR_L)], 1.2); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
}

/** Is this point on the carriageway of either road? */
function onRoad(x: number, z: number): boolean { return Math.abs(z - ROAD_Z) < 1.1 || Math.abs(x) < SIDE_HALF + 0.1; }

/**
 * How far a car may go this tick: it keeps a gap to whatever is ahead of it in its lane
 * (or crossing in front), so cars queue instead of driving through each other.
 */
function headroom(state: GameState, car: Car): number {
  car.gap = Infinity; car.blocker = undefined;
  if (car.reversing) {
    // Backing out: wait until the aisle behind is clear, and never reverse into a car.
    const t = car.path[car.pathIdx];
    if (!t) return 1;
    const mx = t.x - car.x, mz = t.z - car.z, ml = Math.hypot(mx, mz) || 1;
    const starting = Math.hypot(car.x - car.path[0]!.x, car.z - car.path[0]!.z) < 0.05;
    for (const o of state.cars) {
      if (o === car || o.state === 'parked' || o.state === 'gone') continue;
      // Neighbours waiting to back out of their own bays: the older one goes first.
      if (o.reversing && Math.hypot(o.x - o.path[0]!.x, o.z - o.path[0]!.z) < 0.05 && o.id > car.id) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      // Before pulling out, wait for anything near the spot or about to drive past it.
      if (starting && (Math.hypot(o.x - t.x, o.z - t.z) < 4.5 || o.path.slice(o.pathIdx, o.pathIdx + 8).some((p) => Math.hypot(p.x - t.x, p.z - t.z) < 1.8) && Math.hypot(o.x - t.x, o.z - t.z) < 9)) return 0;
      const along = (dx * mx + dz * mz) / ml, side = Math.abs(dx * mz - dz * mx) / ml;
      // Once out of the bay, a car already waiting for us lets us finish.
      if (!starting && (o.waited ?? 0) > 1) continue;
      if (along > 0 && along < 2.4 && side < 1.2) return 0;
    }
    return 1;
  }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let gap = Infinity;
  for (const o of state.cars) {
    if (o === car || o.state === 'gone') continue;
    // A car about to back out is still in its bay: not in our way yet.
    if (o.reversing && Math.hypot(o.x - o.path[0]!.x, o.z - o.path[0]!.z) < 0.05) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
    const along = dx * fx + dz * fz;
    if (along <= 0.05 || along > 4.5) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 0.86) continue;
    // A car waiting at the kerb for a gap is not in our lane.
    if (o.yielding && side > 0.45) continue;
    // Two cars nose to nose (a rare crossing): the older one goes first.
    const ofx = Math.sin(o.yaw), ofz = Math.cos(o.yaw);
    const facing = ofx * fx + ofz * fz < -0.5 && (-dx * ofx - dz * ofz) > 0;
    if (facing && car.id < o.id) continue;
    // Two cars each waiting for the other: the older one goes.
    if (o.blocker === car.id && car.id < o.id && (o.waited ?? 0) > 3) continue;
    if (along < gap) { gap = along; car.blocker = o.id; }
  }
  car.gap = gap;
  if (gap === Infinity) return 1;
  const stop = 2.0, free = 3.8;
  return Math.max(0, Math.min(1, (gap - stop) / (free - stop)));
}

/**
 * The traffic light: a car heading through the crossroads slows to its stop line and waits while
 * its road is red. Amber stops it too unless it is already at the line. Returns the speed factor.
 */
export function lightHold(state: GameState, car: Car): number { return light(state, car).k; }

/** k: speed factor from the light; red: the car is queued for a red light somewhere ahead. */
function light(state: GameState, car: Car): { k: number; red: boolean } {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let road: 'main' | 'side', before: number;
  if (fx > 0.7 && Math.abs(car.z - LANE_EAST_Z) < 0.4) { road = 'main'; before = STOP_LINE.eastbound - car.x; }
  else if (fx < -0.7 && Math.abs(car.z - LANE_WEST_Z) < 0.4) { road = 'main'; before = car.x - STOP_LINE.westbound; }
  else if (fz > 0.7 && Math.abs(car.x - LANE_SOUTH_X) < 0.4) { road = 'side'; before = STOP_LINE.southbound - car.z; }
  else if (fz < -0.7 && Math.abs(car.x - LANE_NORTH_X) < 0.4) { road = 'side'; before = car.z - STOP_LINE.northbound; }
  else return { k: 1, red: false };
  if (before < -0.05 || before > 40) return { k: 1, red: false };
  // Only cars that will actually cross the line wait (one turning into a lot short of it does not).
  const crosses = car.path.slice(car.pathIdx).some((p) => {
    if (road === 'main') return fx > 0 ? p.x > STOP_LINE.eastbound : p.x < STOP_LINE.westbound;
    return fz > 0 ? p.z > STOP_LINE.southbound : p.z < STOP_LINE.northbound;
  });
  if (!crosses) return { k: 1, red: false };
  const g = greenFor(road, state.tick);
  if (g === 'go' || (g === 'amber' && before < 1.0)) return { k: 1, red: false };
  return { k: before > 7 ? 1 : Math.max(0, Math.min(1, (before - 0.05) / 2.2)), red: true };
}

/**
 * Junction manners. A car about to cross the oncoming lane (a left turn into a lot) or to pull
 * out onto a road waits for a gap in the traffic it would cut across.
 */
function mustYield(state: GameState, car: Car): boolean {
  const ahead = car.path.slice(car.pathIdx, car.pathIdx + 8).filter((p) => Math.hypot(p.x - car.x, p.z - car.z) < 3.4);
  if (!ahead.length) return false;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const N = ROAD_Z - 1.0, S = ROAD_Z + 1.0;
  // Still straight, before the turn: once a car has begun its turn it is committed.
  const crossN = fx > 0.9 && Math.abs(car.z - LANE_EAST_Z) < 0.3 && ahead.some((p) => p.z < LANE_WEST_Z + 0.1);
  const crossS = fx < -0.9 && Math.abs(car.z - LANE_WEST_Z) < 0.3 && ahead.some((p) => p.z > LANE_EAST_Z - 0.1);
  const fromNorth = fz > 0.9 && Math.abs(car.x) > SIDE_HALF + 0.2 && car.z < N - 0.5 && car.z > N - 2.4 && ahead.some((p) => p.z > N + 0.2);
  const fromSouth = fz < -0.9 && Math.abs(car.x) > SIDE_HALF + 0.2 && car.z > S + 0.5 && car.z < S + 2.4 && ahead.some((p) => p.z < S - 0.2);
  const fromBay = car.x > SIDE_HALF + 0.2 && car.x < SIDE_HALF + 1.2 && fz < -0.5 && ahead.some((p) => p.x < SIDE_HALF);
  if (!crossN && !crossS && !fromNorth && !fromSouth && !fromBay) return false;
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
    if ((crossN || fromNorth || fromSouth) && west && dx > -1.8 && dx < 10) return true;
    if ((crossS || fromNorth || fromSouth) && east && dx < 1.8 && dx > -10) return true;
  }
  return false;
}

function drive(state: GameState, car: Car, speed: number, turnRate: number): boolean {
  car.yielding = mustYield(state, car);
  const l = light(state, car);
  const k = car.yielding ? 0 : Math.min(headroom(state, car), l.k);
  if (k <= 0.01) {
    // Waiting in a queue for a red light is normal; only other hold-ups count toward the jam breaker.
    car.waited = l.red ? 0 : (car.waited ?? 0) + TICK;
    // Backing out never forces its way.
    if (car.reversing) return false;
    // Never jam for good: after a long wait (not at a red light), inch forward.
    if ((car.waited ?? 0) < 8) return false;
  } else car.waited = 0;
  if (car.reversing) {
    const t = car.path[car.pathIdx];
    if (!t) return true;
    const dx = t.x - car.x, dz = t.z - car.z, d = Math.hypot(dx, dz);
    const step = speed * 0.5 * TICK;
    // Backing out: the nose swings round toward the exit while the car rolls backwards.
    car.yaw = turnToward(car.yaw, Math.atan2(-dx, -dz) + (car.next ? 0.6 * Math.sign(dx || 1) : 0), 1.6 * TICK);
    if (d <= step) { car.x = t.x; car.z = t.z; car.pathIdx++; return true; }
    car.x += (dx / d) * step; car.z += (dz / d) * step;
    return false;
  }
  const inch = (car.waited ?? 0) >= 8 && (car.gap ?? Infinity) > 1.4 ? 0.15 : 0;
  return followPath(car, speed * Math.max(k, inch), TICK, turnRate);
}

/** Slow to lot speed off the carriageway and for the last few metres into a bay. */
function lotSpeed(car: Car): boolean {
  if (!onRoad(car.x, car.z)) return true;
  const end = car.path[car.path.length - 1];
  return !!end && car.state !== 'passing' && car.state !== 'turnedAway' && Math.hypot(end.x - car.x, end.z - car.z) < 3.2;
}

export function tickCars(state: GameState): void {
  for (const car of state.cars) {
    car.px = car.x; car.pz = car.z; car.pyaw = car.yaw;
    switch (car.state) {
      case 'passing':
      case 'turnedAway':
      case 'leaving': {
        if (car.reversing) {
          if (drive(state, car, CAR_LOT_SPEED, 5)) { car.reversing = false; car.path = car.next ?? []; car.next = undefined; car.pathIdx = 1; freeCarBay(state, car); }
          break;
        }
        if (car.state === 'leaving') car.speed = onRoad(car.x, car.z) ? CAR_ROAD_SPEED : CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 6)) car.state = 'gone';
        break;
      }
      case 'arriving': {
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
        if (drive(state, car, car.speed, 5)) { car.state = 'unloading'; car.timer = 6; cue(state, 'truck'); }
        break;
      }
      case 'unloading': {
        car.timer -= TICK;
        const order = state.orders.find((o) => o.id === car.orderId);
        if (order && order.state !== 'delivered' && car.timer < 4) {
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

export function deliverOrder(state: GameState, order: Order): void {
  order.state = 'delivered';
  for (const line of order.lines) {
    const existing = state.shop.storage.find((s) => s.productId === line.productId && s.day === state.day);
    if (existing) existing.qty += line.qty;
    else state.shop.storage.push({ productId: line.productId, qty: line.qty, day: state.day });
  }
  const o = state.shop;
  popup(state, toWorld(o, o.backDoor.x, o.backDoor.z - 0.5), 'Delivery!', 'info', 1.2);
  cue(state, 'boxes');
}
