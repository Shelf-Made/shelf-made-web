import type { GameState, Car, Vec2, Order } from './types';
import { ROAD_Z, LANE_EAST_Z, LANE_WEST_Z, CAR_ROAD_SPEED, CAR_LOT_SPEED, TICK, lotLayout, ROAD_FAR } from './layout';
import { followPath, roundPath, turnToward } from './movement';

const FAR = ROAD_FAR;
/** Driveway lanes: in on the east half, out on the west half (traffic keeps right). */
const IN = 0.45, OUT = -0.45;
/** The north kerb of Main Street. */
const ROAD_EDGE_N = ROAD_Z - 1.0;
const ROAD_EDGE_S = ROAD_Z + 1.0;
import { withRng, nextId, popup, cue } from './state';

export const CAR_MODELS = 12; // index into the renderer's car list; 6 and 7 are delivery trucks
export const TRUCK_MODEL = 6;
const CUSTOMER_CAR_MODELS = [0, 1, 2, 3, 4, 5, 10];

export function drivewayX(state: GameState): number { const L = lotLayout(state.shop); return state.shop.originX + (L.driveway.x0 + L.driveway.x1) / 2; }
export function serviceX(state: GameState): number { const L = lotLayout(state.shop); return state.shop.originX + (L.serviceLane.x0 + L.serviceLane.x1) / 2; }

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

export function freeBay(state: GameState): number {
  return state.shop.bays.findIndex((b) => b.carId === null);
}

/** Spawn a customer's car heading for a bay. Returns null when the lot is full (the car drives past instead). */
export function spawnCustomerCar(state: GameState, ownerId: number, fromWest: boolean): Car | null {
  const bayIdx = freeBay(state);
  const dx = drivewayX(state);
  const model = withRng(state, 'traffic', (r) => r.pick(CUSTOMER_CAR_MODELS));
  if (bayIdx < 0) {
    const pts = fromWest ? [{ x: -FAR, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z }] : [{ x: FAR, z: LANE_WEST_Z }, { x: -FAR, z: LANE_WEST_Z }];
    const car = makeCar(state, model, pts, 'turnedAway', CAR_ROAD_SPEED);
    car.ownerId = ownerId;
    return null;
  }
  const bay = state.shop.bays[bayIdx]!;
  bay.carId = -1; // reserved
  const oz = state.shop.originZ;
  const L = lotLayout(state.shop);
  const pts: Vec2[] = fromWest
    ? [{ x: -FAR, z: LANE_EAST_Z }, { x: dx + IN - 1.2, z: LANE_EAST_Z }, { x: dx + IN, z: LANE_WEST_Z - 0.6 }, { x: dx + IN, z: oz + L.driveway.z0 }]
    : [{ x: FAR, z: LANE_WEST_Z }, { x: dx + IN + 0.9, z: LANE_WEST_Z }, { x: dx + IN, z: LANE_WEST_Z - 0.8 }, { x: dx + IN, z: oz + L.driveway.z0 }];
  // Both bay rows are entered from the aisle; the car pulls in nose first.
  pts.push({ x: dx + IN, z: bay.z }, { x: bay.x, z: bay.z });
  const car = makeCar(state, model, roundPath(pts, 1.0), 'arriving', CAR_ROAD_SPEED);
  car.bay = bayIdx; car.ownerId = ownerId; bay.carId = car.id;
  return car;
}

export function leaveLot(state: GameState, car: Car): void {
  const dx = drivewayX(state);
  const oz = state.shop.originZ;
  const east = withRng(state, 'traffic', (r) => r.chance(0.5));
  const L = lotLayout(state.shop);
  // Back out into the aisle first (the car keeps facing the bay), then drive out on the exit lane.
  const back = { x: dx + OUT + (car.x < dx ? 0 : 0.9), z: car.z };
  car.path = [{ x: car.x, z: car.z }, back]; car.pathIdx = 1; car.reversing = true;
  // Straight down the exit lane to the kerb, then out onto the road.
  const pts: Vec2[] = [back, { x: dx + OUT, z: car.z + 0.9 }, { x: dx + OUT, z: Math.max(oz + L.driveway.z1, ROAD_EDGE_N - 0.3) }];
  if (east) pts.push({ x: dx + OUT + 0.4, z: LANE_WEST_Z + 0.2 }, { x: dx + OUT + 1.8, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z });
  else pts.push({ x: dx + OUT - 1.0, z: LANE_WEST_Z }, { x: -FAR, z: LANE_WEST_Z });
  car.next = roundPath(pts, 0.9);
  car.state = 'leaving'; car.speed = CAR_LOT_SPEED * 0.6;
  if (car.bay !== null) { const b = state.shop.bays[car.bay]; if (b && b.carId === car.id) b.carId = null; car.bay = null; }
}

/** Through traffic: in from one tunnel, out by the other. Right-hand driving: westbound on the north lane. */
export function trafficRoutes(): Vec2[][] {
  return [
    [{ x: -FAR, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z }],
    [{ x: FAR, z: LANE_WEST_Z }, { x: -FAR, z: LANE_WEST_Z }],
  ];
}

export function spawnTraffic(state: GameState): void {
  withRng(state, 'traffic', (r) => {
    const model = r.pick(CUSTOMER_CAR_MODELS.concat([8, 9, 11]));
    const routes = trafficRoutes();
    const pts = routes[r.int(0, routes.length - 1)]!;
    makeCar(state, model, roundPath(pts.map((p) => ({ ...p })), 1.4), 'passing', CAR_ROAD_SPEED * r.range(0.85, 1.05));
  });
}

export function spawnDeliveryTruck(state: GameState, order: Order): void {
  const sx = serviceX(state);
  const o = state.shop;
  const L = lotLayout(o);
  const stop = { x: o.originX + L.truckStop.x, z: o.originZ + L.truckStop.z };
  // In from the west, a left turn across the westbound lane up the service lane to the back door.
  const pts: Vec2[] = [
    { x: -FAR, z: LANE_EAST_Z }, { x: sx - 1.2, z: LANE_EAST_Z }, { x: sx, z: LANE_WEST_Z - 0.6 }, { x: sx, z: o.originZ + L.serviceLane.z1 - 0.3 },
    { x: sx, z: stop.z }, { x: stop.x, z: stop.z },
  ];
  const truck = makeCar(state, TRUCK_MODEL, roundPath(pts, 1.2), 'delivering', CAR_ROAD_SPEED * 0.8);
  truck.orderId = order.id;
}

function truckLeave(state: GameState, car: Car): void {
  const o = state.shop;
  const dx = drivewayX(state);
  const L = lotLayout(o);
  // Across the back yard to the aisle, down the exit lane, then east.
  const pts: Vec2[] = [{ x: car.x, z: car.z }, { x: dx + OUT, z: car.z }, { x: dx + OUT, z: Math.max(o.originZ + L.driveway.z1, ROAD_EDGE_N - 0.3) }, { x: dx + OUT + 0.4, z: LANE_WEST_Z + 0.2 }, { x: dx + OUT + 1.8, z: LANE_EAST_Z }, { x: FAR, z: LANE_EAST_Z }];
  car.path = roundPath(pts, 1.2); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
}

/**
 * How far a car may go this tick: it keeps a gap to whatever is ahead of it in its lane
 * (or crossing in front), so cars queue instead of driving through each other.
 */
function headroom(state: GameState, car: Car): number {
  if (car.reversing) {
    // Backing out: wait until the aisle behind is clear, and never reverse into a car.
    const t = car.path[car.pathIdx];
    if (!t) return 1;
    const mx = t.x - car.x, mz = t.z - car.z, ml = Math.hypot(mx, mz) || 1;
    const starting = Math.hypot(car.x - car.path[0]!.x, car.z - car.path[0]!.z) < 0.05;
    for (const o of state.cars) {
      if (o === car || o.state === 'parked' || o.state === 'gone') continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      if (starting && Math.hypot(o.x - t.x, o.z - t.z) < 2.8) return 0;
      const along = (dx * mx + dz * mz) / ml, side = Math.abs(dx * mz - dz * mx) / ml;
      if (along > 0 && along < 2.4 && side < 1.2) return 0;
    }
    return 1;
  }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  let gap = Infinity;
  for (const o of state.cars) {
    if (o === car || o.state === 'gone') continue;
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
    gap = Math.min(gap, along);
  }
  if (gap === Infinity) return 1;
  const stop = 2.0, free = 3.8;
  return Math.max(0, Math.min(1, (gap - stop) / (free - stop)));
}

/**
 * Junction manners. A car about to cross the westbound lane (a left turn into the lot) or to pull
 * out of the lot onto the road waits for a gap in the traffic it would cut across.
 */
function mustYield(state: GameState, car: Car): boolean {
  const ahead = car.path.slice(car.pathIdx, car.pathIdx + 8).filter((p) => Math.hypot(p.x - car.x, p.z - car.z) < 3.4);
  if (!ahead.length) return false;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  // Still straight, before the stop line: once a car has begun its turn it is committed.
  const crossing = fx > 0.9 && Math.abs(car.z - LANE_EAST_Z) < 0.3 && ahead.some((p) => p.z < LANE_WEST_Z + 0.1);
  const fromNorth = fz > 0.9 && car.z < ROAD_EDGE_N - 0.5 && car.z > ROAD_EDGE_N - 2.4 && ahead.some((p) => p.z > ROAD_EDGE_N + 0.2);
  const fromSouth = fz < -0.9 && car.z > ROAD_EDGE_S + 0.5 && car.z < ROAD_EDGE_S + 2.4 && ahead.some((p) => p.z < ROAD_EDGE_S - 0.2);
  if (!crossing && !fromNorth && !fromSouth) return false;
  for (const o of state.cars) {
    if (o === car || o.state === 'parked' || o.state === 'unloading' || o.yielding) continue;
    const dx = o.x - car.x;
    const west = Math.sin(o.yaw) < -0.8 && Math.abs(o.z - LANE_WEST_Z) < 0.45;
    const east = Math.sin(o.yaw) > 0.8 && Math.abs(o.z - LANE_EAST_Z) < 0.45;
    if (west && dx > -1.8 && dx < 10) return true;
    if (!crossing && east && dx < 1.8 && dx > -10) return true;
  }
  return false;
}

function drive(state: GameState, car: Car, speed: number, turnRate: number): boolean {
  car.yielding = mustYield(state, car);
  const k = car.yielding ? 0 : headroom(state, car);
  if (k <= 0.01) {
    car.waited = (car.waited ?? 0) + TICK;
    // Never jam for good: after a long wait, inch forward.
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
  return followPath(car, speed * Math.max(k, (car.waited ?? 0) >= 8 ? 0.15 : 0), TICK, turnRate);
}

export function tickCars(state: GameState): void {
  for (const car of state.cars) {
    car.px = car.x; car.pz = car.z; car.pyaw = car.yaw;
    switch (car.state) {
      case 'passing':
      case 'turnedAway':
      case 'leaving': {
        if (car.reversing) {
          if (drive(state, car, CAR_LOT_SPEED, 5)) { car.reversing = false; car.path = car.next ?? []; car.next = undefined; car.pathIdx = 1; }
          break;
        }
        if (car.state === 'leaving' && car.z > LANE_WEST_Z - 0.4) car.speed = CAR_ROAD_SPEED;
        else if (car.state === 'leaving') car.speed = CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 6)) car.state = 'gone';
        break;
      }
      case 'arriving': {
        const oz = state.shop.originZ;
        if (car.z < oz + 3.2) car.speed = CAR_LOT_SPEED;
        if (drive(state, car, car.speed, 5)) {
          car.state = 'parked';
          // Nose in: the car keeps the heading it drove in with.
          if (car.bay !== null) { const b = state.shop.bays[car.bay]!; car.x = b.x; car.z = b.z; car.yaw = Math.round(car.yaw / (Math.PI / 2)) * (Math.PI / 2); }
        }
        break;
      }
      case 'parked': break;
      case 'delivering': {
        const oz = state.shop.originZ;
        if (car.z < oz + 3.2) car.speed = CAR_LOT_SPEED;
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
  popup(state, { x: o.originX + o.backDoor.x, z: o.originZ + o.backDoor.z - 0.5 }, 'Delivery!', 'info', 1.2);
  cue(state, 'boxes');
}
