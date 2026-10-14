/**
 * The rivals' customers, made visible. A share of the town's shoppers (in proportion to each
 * rival's share of trade) walk or drive to a rival, go in at its door, and come back out a while
 * later carrying its bags. They change nothing in the economy: they show it. A rival's sale
 * visibly pulls more of them across the zebras.
 */
import type { GameState, Person, Car, CustomerType, RivalState } from './types';
import { DAY_SECONDS, TICK, WALK_SPEED, FRONT_WALK_Z, SIDEWALK_E_X, PLOTS, toWorld, toLocal, lotLayout } from './layout';
import { withRng, nextId } from './state';
import { rivalShares, TYPE_BASE } from './customers';
import { rivalFrame, rivalShape } from './rivals';
import { route, walkStreet, LEG_END, LEGS } from './streets';
import { carTo, onwardDestination, leaveLot } from './cars';
import { followPath } from './movement';

/** Of the town's shoppers who pick a rival, how many we draw. */
export const RIVAL_VISIBLE = 0.7;
const MODELS = 12;

/** Expected visible shoppers per day for each open rival. */
export function rivalVisitors(state: GameState): Record<string, number> {
  const open = state.rivals.filter((r) => r.open);
  const out: Record<string, number> = {};
  if (!open.length) return out;
  const pool = state.demandBase * (1 + 0.75 * open.length) * state.eventDemand;
  const shares = rivalShares(state);
  for (const r of open) {
    const mix = PLOTS.find((p) => p.corner === r.corner)?.mix;
    let n = 0;
    for (const t of Object.keys(TYPE_BASE) as CustomerType[]) n += pool * TYPE_BASE[t] * (mix?.[t] ?? 1) * (shares[r.id]?.[t] ?? 0);
    out[r.id] = n * RIVAL_VISIBLE;
  }
  return out;
}

/** Called every tick while the town is open: spawn rival shoppers at the expected rate. */
export function tickRivalSpawns(state: GameState, curve: number): void {
  const v = rivalVisitors(state);
  const total = Object.values(v).reduce((a, b) => a + b, 0);
  if (total <= 0) return;
  state.rivalSpawn += (total / DAY_SECONDS) * curve * TICK;
  while (state.rivalSpawn >= 1) {
    state.rivalSpawn -= 1;
    const id = withRng(state, 'rivalCustomers', (r) => { let x = r.next() * total; for (const [k, n] of Object.entries(v)) { x -= n; if (x <= 0) return k; } return Object.keys(v)[0]!; });
    const rival = state.rivals.find((r) => r.id === id);
    if (rival) spawnRivalShopper(state, rival);
  }
}

function look(state: GameState) { return withRng(state, 'rivalCustomers', (r) => ({ model: r.int(0, MODELS - 1), variant: r.int(0, 3), height: r.range(0.92, 1.08) })); }

function shopper(state: GameState, rivalId: string, lk: Person['look'], x: number, z: number): Person {
  const p: Person = { id: nextId(state), kind: 'walker', rivalId, look: lk, x, z, yaw: 0, px: x, pz: z, state: 'walking', anim: 'walk', path: [], pathIdx: 0, speed: WALK_SPEED * withRng(state, 'rivalCustomers', (r) => r.range(0.85, 1.05)), timer: 0 };
  state.people.push(p);
  return p;
}

/** The point on a rival's frontage sidewalk in front of its door, and the door itself. */
export function rivalFront(r: RivalState) { const f = rivalFrame(r); return { front: toWorld(f, 0, FRONT_WALK_Z), door: toWorld(f, 0, 0.9) }; }

export function spawnRivalShopper(state: GameState, r: RivalState): void {
  const byCar = withRng(state, 'rivalCustomers', (rr) => rr.chance(0.45));
  if (byCar) {
    const fromWest = withRng(state, 'rivalCustomers', (rr) => rr.chance(0.5));
    const bay = r.bays.findIndex((b) => b.carId === null);
    const dest = bay >= 0 ? { kind: 'rival' as const, rival: r, bay } : onwardDestination(state, fromWest, fromWest ? -999 : 999);
    if (dest.kind !== 'away' && !(dest.kind === 'rival' && dest.rival !== r)) {
      const p = shopper(state, r.id, look(state), 0, 0);
      const car = carTo(state, dest, fromWest, withRng(state, 'rivalCustomers', (rr) => rr.pick([0, 1, 2, 3, 4, 5, 10])), p.id);
      if (car) { p.carId = car.id; p.state = 'driving'; p.anim = 'sit'; p.x = car.x; p.z = car.z; return; }
      p.state = 'gone';
      return;
    }
  }
  const from = withRng(state, 'rivalCustomers', (rr) => { const e = LEG_END[rr.pick(LEGS)]; const t = rr.range(0.3, 0.38); return { x: e.x * (Math.abs(e.x) > 50 ? t : 1), z: e.z * (Math.abs(e.z) > 50 ? t : 1) }; });
  const p = shopper(state, r.id, look(state), from.x, from.z);
  const { front, door } = rivalFront(r);
  const rt = route(from, front, withRng(state, 'rivalCustomers', (rr) => rr.chance(0.5)));
  p.path = [...rt.path, door]; p.xings = rt.xings;
}

/** A car that found the player's lot full and went to a rival instead: its driver shops there. */
export function rivalShopperInCar(state: GameState, car: Car, rivalId: string, lk: Person['look']): void {
  const p = shopper(state, rivalId, lk, car.x, car.z);
  car.ownerId = p.id;
  p.carId = car.id; p.state = 'driving'; p.anim = 'sit';
}

/** From a parked car to the rival's door: down the aisle and along the apron (shop-relative), or round from Elm Street. */
function pathFromCar(state: GameState, r: RivalState, car: Car): { path: Person['path']; xings: number[] } {
  const { front, door } = rivalFront(r);
  if (car.lot === 'street') {
    const side = { x: SIDEWALK_E_X, z: car.z };
    const rt = route(side, front);
    return { path: [side, ...rt.path, door], xings: rt.xings.map((i) => i + 1) };
  }
  const f = rivalFrame(r), L = lotLayout(rivalShape(r));
  const c = toLocal(f, car.x, car.z);
  const ax = (L.aisle.x0 + L.aisle.x1) / 2;
  return { path: [toWorld(f, ax, c.z), toWorld(f, ax, 0.9), door], xings: [] };
}

export function tickRivalShopper(state: GameState, p: Person): void {
  const r = state.rivals.find((x) => x.id === p.rivalId);
  if (!r) { p.state = 'gone'; return; }
  switch (p.state) {
    case 'driving': {
      const car = state.cars.find((c) => c.id === p.carId);
      if (!car) { p.state = 'gone'; break; }
      p.x = car.x; p.z = car.z; p.yaw = car.yaw;
      if (car.state === 'parked') {
        const route0 = pathFromCar(state, r, car);
        p.path = route0.path; p.xings = route0.xings; p.pathIdx = 0;
        p.state = 'walking'; p.anim = 'walk';
      }
      break;
    }
    case 'walking': {
      if (walkStreet(p, p.speed, state.tick)) {
        // In at the door: out of sight for a while.
        p.state = 'inRival'; p.timer = withRng(state, 'rivalCustomers', (rr) => rr.range(25, 70));
      }
      break;
    }
    case 'inRival': {
      p.timer -= TICK;
      if (p.timer > 0) break;
      p.bags = true; p.anim = 'carry';
      const car = p.carId !== null && p.carId !== undefined ? state.cars.find((c) => c.id === p.carId) : undefined;
      if (car) {
        const there = pathFromCar(state, r, car);
        // The way back: reverse the walk (kerbs are where the reversed zebras begin).
        const back = there.path.slice().reverse();
        back.push({ x: car.x + (car.lot === 'street' ? 0.55 : 0.75), z: car.z + (car.lot === 'street' ? 0 : 0.55) });
        const n = there.path.length;
        p.path = back.slice(1); p.pathIdx = 0;
        // A zebra kerb at index k going out is crossed from index n-2-k coming back.
        p.xings = there.xings.map((k) => n - 2 - k - 1 + 0).filter((k) => k >= 0).sort((a, b) => a - b);
        p.state = 'toCar';
      } else {
        const { front } = rivalFront(r);
        const end = withRng(state, 'rivalCustomers', (rr) => LEG_END[rr.pick(LEGS)]);
        const rt = route(front, end, withRng(state, 'rivalCustomers', (rr) => rr.chance(0.5)));
        p.path = [front, ...rt.path]; p.xings = rt.xings.map((i) => i + 1); p.pathIdx = 0;
        p.state = 'leaving';
      }
      break;
    }
    case 'leaving': {
      if (walkStreet(p, p.speed, state.tick)) p.state = 'gone';
      break;
    }
    case 'toCar': {
      if (walkStreet(p, p.speed, state.tick)) {
        const car = state.cars.find((c) => c.id === p.carId);
        if (car && car.state === 'parked') leaveLot(state, car);
        p.state = 'gone';
      }
      break;
    }
    default: if (followPath(p, p.speed, TICK)) p.state = 'gone';
  }
}
