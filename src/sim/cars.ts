import type { GameState, Car, Vec2, Order } from './types';
import { LANE_EAST_Z, LANE_WEST_Z, MAP_X, MAP_Z, CAR_ROAD_SPEED, CAR_LOT_SPEED, TICK, lotLayout } from './layout';
import { followPath, roundPath } from './movement';
import { withRng, nextId, popup, cue } from './state';

export const CAR_MODELS = 12; // index into the renderer's car list; 6 and 7 are delivery trucks
export const TRUCK_MODEL = 6;
const CUSTOMER_CAR_MODELS = [0, 1, 2, 3, 4, 5, 10];

export function drivewayX(state: GameState): number { const L = lotLayout(state.shop); return state.shop.originX + (L.driveway.x0 + L.driveway.x1) / 2; }
export function serviceX(state: GameState): number { const L = lotLayout(state.shop); return state.shop.originX + (L.serviceLane.x0 + L.serviceLane.x1) / 2; }

function makeCar(state: GameState, model: number, path: Vec2[], carState: Car['state'], speed: number): Car {
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
    const pts = fromWest ? [{ x: -MAP_X - 4, z: LANE_EAST_Z }, { x: MAP_X + 4, z: LANE_EAST_Z }] : [{ x: MAP_X + 4, z: LANE_WEST_Z }, { x: -MAP_X - 4, z: LANE_WEST_Z }];
    const car = makeCar(state, model, pts, 'turnedAway', CAR_ROAD_SPEED);
    car.ownerId = ownerId;
    return null;
  }
  const bay = state.shop.bays[bayIdx]!;
  bay.carId = -1; // reserved
  const oz = state.shop.originZ;
  const L = lotLayout(state.shop);
  const pts: Vec2[] = fromWest
    ? [{ x: -MAP_X - 4, z: LANE_EAST_Z }, { x: dx, z: LANE_EAST_Z }, { x: dx, z: oz + L.driveway.z0 }]
    : [{ x: MAP_X + 4, z: LANE_WEST_Z }, { x: dx, z: LANE_WEST_Z }, { x: dx, z: oz + L.driveway.z0 }];
  const aisleX = bay.x < state.shop.originX + L.aisle.x0 ? dx : dx; // both rows are entered from the aisle
  pts.push({ x: aisleX, z: bay.z }, { x: bay.x, z: bay.z });
  const car = makeCar(state, model, roundPath(pts, 1.0), 'arriving', CAR_ROAD_SPEED);
  car.bay = bayIdx; car.ownerId = ownerId; bay.carId = car.id;
  return car;
}

export function leaveLot(state: GameState, car: Car): void {
  const dx = drivewayX(state);
  const oz = state.shop.originZ;
  const east = withRng(state, 'traffic', (r) => r.chance(0.5));
  const L = lotLayout(state.shop);
  const pts: Vec2[] = [{ x: car.x, z: car.z }, { x: dx, z: car.z }, { x: dx, z: oz + L.driveway.z1 - 0.3 }];
  if (east) pts.push({ x: dx + 1.5, z: LANE_EAST_Z }, { x: MAP_X + 4, z: LANE_EAST_Z });
  else pts.push({ x: dx - 1.5, z: LANE_WEST_Z }, { x: -MAP_X - 4, z: LANE_WEST_Z });
  car.path = roundPath(pts, 1.0); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
  if (car.bay !== null) { const b = state.shop.bays[car.bay]; if (b && b.carId === car.id) b.carId = null; car.bay = null; }
}

export function spawnTraffic(state: GameState): void {
  withRng(state, 'traffic', (r) => {
    const model = r.pick(CUSTOMER_CAR_MODELS.concat([8, 9, 11]));
    const route = r.int(0, 5);
    let pts: Vec2[];
    switch (route) {
      case 0: pts = [{ x: -MAP_X - 4, z: LANE_EAST_Z }, { x: MAP_X + 4, z: LANE_EAST_Z }]; break;
      case 1: pts = [{ x: MAP_X + 4, z: LANE_WEST_Z }, { x: -MAP_X - 4, z: LANE_WEST_Z }]; break;
      case 2: pts = [{ x: 30.5, z: -MAP_Z - 4 }, { x: 30.5, z: LANE_WEST_Z }, { x: -MAP_X - 4, z: LANE_WEST_Z }]; break;
      case 3: pts = [{ x: -29.5, z: MAP_Z + 4 }, { x: -29.5, z: LANE_EAST_Z }, { x: MAP_X + 4, z: LANE_EAST_Z }]; break;
      case 4: pts = [{ x: -MAP_X - 4, z: LANE_EAST_Z }, { x: 30.5, z: LANE_EAST_Z }, { x: 30.5, z: MAP_Z + 4 }]; break;
      default: pts = [{ x: MAP_X + 4, z: LANE_WEST_Z }, { x: -29.5, z: LANE_WEST_Z }, { x: -29.5, z: -MAP_Z - 4 }]; break;
    }
    makeCar(state, model, roundPath(pts, 1.4), 'passing', CAR_ROAD_SPEED * r.range(0.8, 1.1));
  });
}

export function spawnDeliveryTruck(state: GameState, order: Order): void {
  const sx = serviceX(state);
  const o = state.shop;
  const L = lotLayout(o);
  const stop = { x: o.originX + L.truckStop.x, z: o.originZ + L.truckStop.z };
  const pts: Vec2[] = [
    { x: -MAP_X - 4, z: LANE_EAST_Z }, { x: sx, z: LANE_EAST_Z }, { x: sx, z: o.originZ + L.serviceLane.z1 - 0.3 },
    { x: sx, z: stop.z }, { x: stop.x, z: stop.z },
  ];
  const truck = makeCar(state, TRUCK_MODEL, roundPath(pts, 1.2), 'delivering', CAR_ROAD_SPEED * 0.8);
  truck.orderId = order.id;
}

function truckLeave(state: GameState, car: Car): void {
  const o = state.shop;
  const dx = drivewayX(state);
  const L = lotLayout(o);
  const pts: Vec2[] = [{ x: car.x, z: car.z }, { x: dx, z: car.z }, { x: dx, z: o.originZ + L.driveway.z1 - 0.3 }, { x: dx + 1.5, z: LANE_EAST_Z }, { x: MAP_X + 4, z: LANE_EAST_Z }];
  car.path = roundPath(pts, 1.2); car.pathIdx = 1; car.state = 'leaving'; car.speed = CAR_LOT_SPEED;
}

export function tickCars(state: GameState): void {
  const dt = TICK;
  for (const car of state.cars) {
    car.px = car.x; car.pz = car.z; car.pyaw = car.yaw;
    switch (car.state) {
      case 'passing':
      case 'turnedAway':
      case 'leaving': {
        if (car.state === 'leaving' && car.z > LANE_WEST_Z - 0.4) car.speed = CAR_ROAD_SPEED;
        if (followPath(car, car.speed, dt, 6)) car.state = 'gone';
        break;
      }
      case 'arriving': {
        const oz = state.shop.originZ;
        if (car.z < oz + 2.0) car.speed = CAR_LOT_SPEED;
        if (followPath(car, car.speed, dt, 5)) {
          car.state = 'parked';
          if (car.bay !== null) { const b = state.shop.bays[car.bay]!; car.yaw = b.yaw; car.x = b.x; car.z = b.z; }
        }
        break;
      }
      case 'parked': break;
      case 'delivering': {
        const oz = state.shop.originZ;
        if (car.z < oz + 2.0) car.speed = CAR_LOT_SPEED;
        if (followPath(car, car.speed, dt, 5)) { car.state = 'unloading'; car.timer = 6; cue(state, 'truck'); }
        break;
      }
      case 'unloading': {
        car.timer -= dt;
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
