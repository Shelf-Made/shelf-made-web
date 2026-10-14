import type { GameState, Person, Fixture, CustomerType, Vec2 } from './types';
import { PRODUCTS, productDef } from './products';
import { PLOTS, STARTER, WALK_SPEED, TICK, DIFFICULTY, FIXTURES, MAP_X, SIDEWALK_N_Z } from './layout';
import { fixtureFrontWorld, fixtureBackWorld, fixtureFacing, fixtureCentre, cellOf, isBlocked, nearestWalkable, cellIndex } from './grid';
import { findPath } from './pathfinding';
import { followPath } from './movement';
import { withRng, nextId, popup, cue, gridFor, dist } from './state';
import { spawnCustomerCar, leaveLot } from './cars';

const CUSTOMER_MODELS = 12;
const TYPE_BASE: Record<CustomerType, number> = { bargain: 0.3, convenience: 0.3, loyalist: 0.2, impulse: 0.2 };

export function plotOf(state: GameState) { return PLOTS.find((p) => p.id === state.shop.plotId) ?? PLOTS[0]!; }

/** World-space points just outside and just inside the front door. */
export function doorOutside(state: GameState): Vec2 { const s = state.shop; return { x: s.originX + s.door.x, z: s.originZ + s.door.z + 0.7 }; }
export function doorInside(state: GameState): Vec2 { const s = state.shop; return { x: s.originX + s.door.x, z: s.originZ + s.door.z - 0.7 }; }
export function storeroomPoint(state: GameState): Vec2 { const s = state.shop; return { x: s.originX + (s.storeroom.x0 + s.storeroom.x1) / 2 - 1, z: s.originZ + (s.storeroom.z0 + s.storeroom.z1) / 2 }; }

/** Cells occupied by parked cars, so people walk around them. */
export function dynamicBlockers(state: GameState): Set<number> {
  const g = gridFor(state);
  const set = new Set<number>();
  for (const car of state.cars) {
    if (car.state !== 'parked' && car.state !== 'unloading') continue;
    const hw = car.state === 'unloading' ? 1.0 : 0.8, hd = 0.45;
    for (let dx = -hw; dx <= hw; dx += 0.5) for (let dz = -hd; dz <= hd; dz += 0.45) {
      const [cx, cz] = cellOf(g, { x: car.x + dx, z: car.z + dz });
      if (cx >= 0 && cz >= 0 && cx < g.w && cz < g.h) set.add(cellIndex(g, cx, cz));
    }
  }
  return set;
}

function setPath(state: GameState, p: Person, to: Vec2, dyn?: Set<number>): boolean {
  const path = findPath(gridFor(state), { x: p.x, z: p.z }, to, dyn);
  if (!path) { p.path = [to]; p.pathIdx = 0; return false; }
  p.path = path; p.pathIdx = 0;
  return true;
}

/** Queue slot k for a register: straight back from the front, then bending sideways. */
export function queueSlot(state: GameState, reg: Fixture, k: number): Vec2 {
  const front = fixtureFrontWorld(state.shop, reg);
  const f = fixtureFacing(reg.rot);
  const straight = 3;
  const spacing = 0.62;
  if (k < straight) return { x: front.x + f.x * k * spacing, z: front.z + f.z * k * spacing };
  // Bend: perpendicular, to the left of the facing direction.
  const side = { x: -f.z, z: f.x };
  const base = { x: front.x + f.x * (straight - 1) * spacing, z: front.z + f.z * (straight - 1) * spacing };
  const j = k - straight + 1;
  return { x: base.x + side.x * j * spacing, z: base.z + side.z * j * spacing };
}

function chooseType(state: GameState): CustomerType {
  const plot = plotOf(state);
  return withRng(state, 'customers', (r) => {
    const types = Object.keys(TYPE_BASE) as CustomerType[];
    const weights = types.map((t) => TYPE_BASE[t] * plot.mix[t]);
    let x = r.next() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < types.length; i++) { x -= weights[i]!; if (x <= 0) return types[i]!; }
    return 'convenience';
  });
}

function stockedProducts(state: GameState): Set<string> {
  const set = new Set<string>();
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId) set.add(s.productId);
  return set;
}

function makeList(state: GameState, ctype: CustomerType): { productId: string; qty: number }[] {
  const stocked = stockedProducts(state);
  return withRng(state, 'customers', (r) => {
    const n = r.pick([1, 2, 2, 2, 3, 3, 4]);
    const pool = PRODUCTS.map((p) => ({ id: p.id, w: p.demand * (stocked.has(p.id) ? 4 : 1) * (ctype === 'loyalist' && p.brand ? 2.5 : 1) * (ctype === 'impulse' && p.impulse ? 2 : 1) }));
    const list: { productId: string; qty: number }[] = [];
    for (let i = 0; i < n; i++) {
      const total = pool.reduce((a, b) => a + b.w, 0);
      let x = r.next() * total;
      let pick = pool[0]!;
      for (const it of pool) { x -= it.w; if (x <= 0) { pick = it; break; } }
      pool.splice(pool.indexOf(pick), 1);
      list.push({ productId: pick.id, qty: r.chance(0.3) ? 2 : 1 });
    }
    return list;
  });
}

export function spawnCustomer(state: GameState, forceFoot = false): Person | null {
  const diff = DIFFICULTY[state.difficulty];
  const byCar = withRng(state, 'customers', (r) => r.chance(0.55)) && !forceFoot;
  const fromWest = withRng(state, 'customers', (r) => r.chance(0.5));
  const ctype = chooseType(state);
  const look = withRng(state, 'looks', (r) => ({ model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.92, 1.08) }));
  const patience = withRng(state, 'customers', (r) => r.range(70, 150) * diff.patienceMul * (ctype === 'convenience' ? 0.75 : 1));
  const p: Person = {
    id: nextId(state), kind: 'customer', look, x: 0, z: 0, yaw: 0, px: 0, pz: 0, state: 'walking', anim: 'walk', path: [], pathIdx: 0,
    speed: WALK_SPEED * withRng(state, 'customers', (r) => r.range(0.9, 1.1)), timer: 0,
    ctype, list: makeList(state, ctype), basket: [], listIdx: 0, missed: 0, patience, maxPatience: patience, carId: null, registerId: null, mood: 1, arrivedTick: state.tick, stuckTicks: 0,
  };
  state.today.customers++;
  if (byCar) {
    const car = spawnCustomerCar(state, p.id, fromWest);
    if (!car) {
      state.today.turnedAway++;
      popup(state, { x: state.shop.originX + STARTER.driveway.x0 + 1, z: state.shop.originZ + STARTER.driveway.z1 }, 'Lot full!', 'bad', 0.8);
      return null;
    }
    p.carId = car.id; p.state = 'driving'; p.anim = 'sit'; p.x = car.x; p.z = car.z;
  } else {
    const sx = state.shop.originX + (fromWest ? -14 : 14);
    p.x = sx; p.z = SIDEWALK_N_Z + withRng(state, 'customers', (r) => r.range(-0.12, 0.12));
    p.path = [{ x: state.shop.originX + (fromWest ? -7.2 : 7.2), z: p.z }]; p.pathIdx = 0;
    p.yaw = fromWest ? Math.PI / 2 : -Math.PI / 2;
  }
  p.px = p.x; p.pz = p.z;
  state.people.push(p);
  return p;
}

export function spawnWalker(state: GameState): void {
  withRng(state, 'walkers', (r) => {
    const fromWest = r.chance(0.5);
    const south = r.chance(0.5);
    const z = (south ? 3.75 : SIDEWALK_N_Z) + r.range(-0.1, 0.1);
    const p: Person = {
      id: nextId(state), kind: 'walker', look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.9, 1.1), dog: r.chance(0.3) },
      x: fromWest ? -MAP_X - 2 : MAP_X + 2, z, yaw: fromWest ? Math.PI / 2 : -Math.PI / 2, px: 0, pz: 0, state: 'walking', anim: 'walk',
      path: [{ x: fromWest ? MAP_X + 2 : -MAP_X - 2, z }], pathIdx: 0, speed: WALK_SPEED * r.range(0.7, 0.95), timer: 0,
    };
    p.px = p.x; p.pz = p.z;
    state.people.push(p);
  });
}

function findFixtureWith(state: GameState, productId: string): Fixture | null {
  let best: Fixture | null = null, bestQty = 0;
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId === productId && s.qty > bestQty) { best = f; bestQty = s.qty; }
  return best;
}

function willBuy(state: GameState, ctype: CustomerType, productId: string): boolean {
  const def = productDef(productId);
  const r = (state.prices[productId] ?? def.basePrice) / def.basePrice;
  const tolerance = ctype === 'bargain' ? 0.35 : ctype === 'convenience' ? 0.8 : ctype === 'loyalist' ? 0.6 : 0.5;
  const p = r <= 1.0 ? 1 : Math.max(0.05, 1 - (r - 1) / tolerance);
  return withRng(state, 'customers', (rr) => rr.chance(p));
}

function chooseRegister(state: GameState): Fixture | null {
  let best: Fixture | null = null, bestLen = Infinity;
  for (const f of state.shop.fixtures) {
    if (f.type !== 'register' && f.type !== 'kiosk') continue;
    const len = (f.queue?.length ?? 0) + (f.serving ? 1 : 0);
    if (len < bestLen) { best = f; bestLen = len; }
  }
  return best;
}

function finishShopping(state: GameState, p: Person): void {
  if (!p.basket || p.basket.length === 0) { startLeaving(state, p, false); return; }
  const reg = chooseRegister(state);
  if (!reg) { startLeaving(state, p, false); return; }
  reg.queue ??= [];
  reg.queue.push(p.id);
  p.registerId = reg.id;
  p.queueSlot = reg.queue.length - 1 + (reg.serving ? 1 : 0);
  p.state = 'toQueue'; p.anim = 'walk';
  setPath(state, p, queueSlot(state, reg, p.queueSlot));
}

function registerOf(state: GameState, p: Person): Fixture | undefined {
  return state.shop.fixtures.find((f) => f.id === p.registerId);
}

export function startLeaving(state: GameState, p: Person, happy: boolean): void {
  const reg = registerOf(state, p);
  if (reg?.queue) { const i = reg.queue.indexOf(p.id); if (i >= 0) reg.queue.splice(i, 1); }
  if (reg && reg.serving === p.id) { reg.serving = null; reg.scanned = 0; }
  p.registerId = null;
  if (!happy) {
    // Put unpaid items back where they came from.
    for (const b of p.basket ?? []) {
      const f = findFixtureWith(state, b.productId) ?? state.shop.fixtures.find((fx) => fx.slots.some((s) => s.productId === b.productId));
      const slot = f?.slots.find((s) => s.productId === b.productId);
      if (slot) slot.qty += b.qty;
    }
    p.basket = [];
  }
  p.state = 'leaving'; p.anim = happy && p.basket && p.basket.length ? 'carry' : 'walk';
  setPath(state, p, doorInside(state));
}

function completeSale(state: GameState, p: Person, reg: Fixture): void {
  let total = 0, cogs = 0, units = 0;
  for (const b of p.basket ?? []) { total += b.price * b.qty; cogs += productDef(b.productId).cost * b.qty; units += b.qty; }
  total = Math.round(total * 100) / 100;
  state.cash += total;
  state.today.revenue += total; state.today.cogs += cogs; state.today.itemsSold += units; state.today.served++;
  const waited = p.maxPatience && p.patience !== undefined ? 1 - p.patience / p.maxPatience : 0;
  const sat = Math.max(0, Math.min(1, 1 - waited * 0.6 - (p.missed ?? 0) * 0.15));
  state.today.satisfaction += sat; state.today.satisfactionN++;
  const c = fixtureCentre(state.shop, reg);
  popup(state, c, `+$${total.toFixed(2)}`, 'money', 1.1);
  cue(state, 'cash');
  reg.serving = null; reg.scanned = 0;
  if (!state.tutorial.completed.includes('ringUp')) completeTutorial(state, 'ringUp');
  startLeaving(state, p, true);
}

export function completeTutorial(state: GameState, step: string): void {
  const t = state.tutorial;
  if (t.completed.includes(step)) return;
  t.completed.push(step);
  if (t.enabled && !t.done) {
    const reward = 25;
    state.cash += reward; t.rewardsPaid += reward;
    const d = doorOutside(state);
    popup(state, { x: d.x, z: d.z - 1 }, `+$${reward} tip bonus`, 'money', 1.6);
    cue(state, 'reward');
    t.step = Math.min(t.step + 1, 5);
    if (t.completed.length >= 5) t.done = true;
  }
}

/** The player (or a cashier) scans one item at a register. */
export function scanItem(state: GameState, reg: Fixture): boolean {
  if (!reg.serving) return false;
  const p = state.people.find((x) => x.id === reg.serving);
  if (!p || p.state !== 'paying') return false;
  const units = (p.basket ?? []).reduce((a, b) => a + b.qty, 0);
  reg.scanned = (reg.scanned ?? 0) + 1;
  cue(state, 'beep');
  if (reg.scanned >= units) completeSale(state, p, reg);
  return true;
}

function tickCustomer(state: GameState, p: Person, dyn: Set<number>): void {
  const dt = TICK;
  switch (p.state) {
    case 'driving': {
      const car = state.cars.find((c) => c.id === p.carId);
      if (!car) { p.state = 'gone'; break; }
      p.x = car.x; p.z = car.z; p.yaw = car.yaw;
      if (car.state === 'parked') {
        // Step out beside the car, on the aisle side.
        p.x = car.x + 0.75; p.z = car.z + 0.55;
        const spot = nearestWalkable(gridFor(state), { x: p.x, z: p.z }, dyn);
        p.x = spot.x; p.z = spot.z;
        p.state = 'toDoor'; p.anim = 'walk';
        setPath(state, p, doorOutside(state), dyn);
      }
      break;
    }
    case 'walking': {
      if (followPath(p, p.speed, dt)) { p.state = 'toDoor'; setPath(state, p, doorOutside(state), dyn); }
      break;
    }
    case 'toDoor': {
      if (followPath(p, p.speed, dt)) { p.state = 'entering'; cue(state, 'chime'); setPath(state, p, doorInside(state), dyn); }
      break;
    }
    case 'entering': {
      if (followPath(p, p.speed, dt)) {
        if (state.phase !== 'open') { startLeaving(state, p, false); break; }
        p.state = 'shopping';
        if (state.today.served === 0 && state.today.walkedOut === 0 && state.tutorial.enabled && !state.tutorial.completed.includes('ringUp')) {
          const d = doorInside(state);
          popup(state, { x: d.x, z: d.z - 0.3 }, 'Your first customer is here!', 'info', 1.3);
        }
      }
      break;
    }
    case 'shopping': {
      const list = p.list ?? [];
      if ((p.listIdx ?? 0) >= list.length) { finishShopping(state, p); break; }
      const item = list[p.listIdx!]!;
      const f = findFixtureWith(state, item.productId);
      if (!f) { p.missed = (p.missed ?? 0) + 1; p.listIdx!++; break; }
      p.targetFixture = f.id;
      p.state = 'browsing'; p.anim = 'walk'; p.timer = -1;
      setPath(state, p, fixtureFrontWorld(state.shop, f), dyn);
      break;
    }
    case 'browsing': {
      if (p.timer < 0) {
        if (followPath(p, p.speed, dt)) {
          p.timer = withRng(state, 'customers', (r) => r.range(1.2, 2.6));
          p.anim = 'browse';
          const f = state.shop.fixtures.find((x) => x.id === p.targetFixture);
          if (f) { const c = fixtureCentre(state.shop, f); p.yaw = Math.atan2(c.x - p.x, c.z - p.z); }
        }
        break;
      }
      p.timer -= dt;
      if (p.timer <= 0) {
        const item = (p.list ?? [])[p.listIdx ?? 0]!;
        const f = state.shop.fixtures.find((x) => x.id === p.targetFixture);
        const slot = f?.slots.find((s) => s.productId === item.productId && s.qty > 0);
        if (slot && willBuy(state, p.ctype ?? 'convenience', item.productId)) {
          const take = Math.min(slot.qty, item.qty);
          slot.qty -= take;
          p.basket!.push({ productId: item.productId, qty: take, price: state.prices[item.productId] ?? productDef(item.productId).basePrice });
          cue(state, 'pick');
        } else if (!slot) p.missed = (p.missed ?? 0) + 1;
        p.listIdx = (p.listIdx ?? 0) + 1;
        p.state = 'shopping'; p.anim = p.basket!.length ? 'carry' : 'walk';
      }
      break;
    }
    case 'toQueue': {
      const reg = registerOf(state, p);
      if (!reg || !reg.queue) { startLeaving(state, p, false); break; }
      const idx = reg.queue.indexOf(p.id);
      const slot = idx + (reg.serving ? 1 : 0);
      if (slot !== p.queueSlot) { p.queueSlot = slot; setPath(state, p, queueSlot(state, reg, slot), dyn); }
      if (followPath(p, p.speed, dt)) {
        p.state = 'queued'; p.anim = p.basket!.length ? 'carry' : 'idle';
        const c = fixtureCentre(state.shop, reg); p.yaw = Math.atan2(c.x - p.x, c.z - p.z);
      }
      break;
    }
    case 'queued': {
      const reg = registerOf(state, p);
      if (!reg || !reg.queue) { startLeaving(state, p, false); break; }
      const idx = reg.queue.indexOf(p.id);
      if (idx === 0 && !reg.serving) {
        reg.serving = p.id; reg.scanned = 0; reg.queue.shift();
        p.state = 'paying'; p.anim = 'walk'; p.queueSlot = 0;
        setPath(state, p, queueSlot(state, reg, 0), dyn);
        p.timer = -1;
        break;
      }
      const slot = idx + (reg.serving ? 1 : 0);
      if (slot !== p.queueSlot) { p.queueSlot = slot; p.state = 'toQueue'; p.anim = 'walk'; setPath(state, p, queueSlot(state, reg, slot), dyn); break; }
      p.patience = (p.patience ?? 100) - dt;
      if (p.patience <= 0) {
        state.today.walkedOut++;
        popup(state, { x: p.x, z: p.z }, 'Too slow!', 'bad', 1.1);
        state.today.satisfactionN++;
        startLeaving(state, p, false);
      }
      break;
    }
    case 'paying': {
      const reg = registerOf(state, p);
      if (!reg) { startLeaving(state, p, false); break; }
      if (p.timer < 0) {
        if (followPath(p, p.speed, dt)) {
          p.timer = 0; p.anim = 'pay';
          const c = fixtureCentre(state.shop, reg); p.yaw = Math.atan2(c.x - p.x, c.z - p.z);
        }
        break;
      }
      // A cashier scans automatically; otherwise the player clicks.
      const cashier = state.people.find((s) => s.id === reg.staffId && s.state === 'working');
      if (cashier) {
        p.timer += dt;
        const rate = 0.55 / (0.6 + (cashier.skill ?? 0.5));
        if (p.timer >= rate) { p.timer = 0; scanItem(state, reg); }
      } else {
        p.patience = (p.patience ?? 100) - dt;
        if (p.patience <= 0) {
          state.today.walkedOut++;
          popup(state, { x: p.x, z: p.z }, 'Too slow!', 'bad', 1.1);
          state.today.satisfactionN++;
          startLeaving(state, p, false);
        }
      }
      break;
    }
    case 'leaving': {
      if (followPath(p, p.speed, dt)) {
        cue(state, 'chime');
        if (p.carId !== null && p.carId !== undefined) {
          const car = state.cars.find((c) => c.id === p.carId);
          if (car) { p.state = 'toCar'; p.anim = p.anim === 'carry' ? 'carry' : 'walk'; setPath(state, p, { x: car.x + 0.75, z: car.z + 0.55 }, dyn); break; }
        }
        // On foot: walk to the sidewalk, then off along it until out of sight.
        const west = withRng(state, 'customers', (r) => r.chance(0.5));
        const edge = { x: state.shop.originX + (west ? -7.4 : 7.4), z: SIDEWALK_N_Z };
        setPath(state, p, edge, dyn);
        p.path.push({ x: state.shop.originX + (west ? -16 : 16), z: SIDEWALK_N_Z });
        p.state = 'toCar';
        p.carId = null;
      }
      break;
    }
    case 'toCar': {
      if (followPath(p, p.speed, dt)) {
        const car = state.cars.find((c) => c.id === p.carId);
        if (car) leaveLot(state, car);
        p.state = 'gone';
      }
      break;
    }
    default: break;
  }
}

function tickWalker(state: GameState, p: Person): void {
  if (p.path.length === 0) return;
  if (followPath(p, p.speed, TICK)) p.state = 'gone';
}

/** Owner: stands at the register, carries stock when asked. */
function tickOwner(state: GameState, p: Person, dyn: Set<number>): void {
  const dt = TICK;
  const reg = state.shop.fixtures.find((f) => f.type === 'register');
  switch (p.state) {
    case 'idle': {
      if (p.task) {
        p.state = 'toStock'; p.anim = 'walk';
        setPath(state, p, storeroomPoint(state), dyn);
      } else if (reg) {
        const home = fixtureBackWorld(state.shop, reg);
        if (dist(p, home) > 0.3) { p.state = 'toRegister'; p.anim = 'walk'; setPath(state, p, home, dyn); }
        else { p.anim = 'idle'; p.yaw = Math.atan2(0, -1) ; const fc = fixtureCentre(state.shop, reg); p.yaw = Math.atan2(fc.x - p.x, fc.z - p.z); }
      }
      break;
    }
    case 'toRegister': {
      if (followPath(p, p.speed, dt)) { p.state = 'idle'; }
      if (p.task) p.state = 'idle';
      break;
    }
    case 'toStock': {
      if (followPath(p, p.speed, dt)) { p.state = 'pickBox'; p.anim = 'browse'; p.timer = 0.8; p.yaw = Math.PI; }
      break;
    }
    case 'pickBox': {
      p.timer -= dt;
      if (p.timer <= 0) {
        const task = p.task;
        if (!task) { p.state = 'idle'; break; }
        const entry = state.shop.storage.find((s) => s.productId === task.productId && s.qty > 0);
        const f = state.shop.fixtures.find((x) => x.id === task.fixtureId);
        if (!entry || !f) { p.task = null; p.state = 'idle'; break; }
        const qty = Math.min(entry.qty, task.qty);
        entry.qty -= qty;
        if (entry.qty <= 0) state.shop.storage.splice(state.shop.storage.indexOf(entry), 1);
        p.carrying = { productId: task.productId, qty };
        p.state = 'carrying'; p.anim = 'carry';
        setPath(state, p, fixtureFrontWorld(state.shop, f), dyn);
      }
      break;
    }
    case 'carrying': {
      if (followPath(p, p.speed, dt)) {
        p.state = 'stocking'; p.anim = 'browse'; p.timer = 1.2;
        const f = state.shop.fixtures.find((x) => x.id === p.task?.fixtureId);
        if (f) { const c = fixtureCentre(state.shop, f); p.yaw = Math.atan2(c.x - p.x, c.z - p.z); }
      }
      break;
    }
    case 'stocking': {
      p.timer -= dt;
      if (p.timer <= 0) {
        const f = state.shop.fixtures.find((x) => x.id === p.task?.fixtureId);
        if (f && p.carrying) {
          const left = placeOnFixture(state, f, p.carrying.productId, p.carrying.qty);
          if (left > 0) state.shop.storage.push({ productId: p.carrying.productId, qty: left, day: state.day });
          cue(state, 'stock');
          completeTutorial(state, 'stock');
        }
        p.carrying = null; p.task = null; p.state = 'idle'; p.anim = 'idle';
      }
      break;
    }
    default: p.state = 'idle';
  }
}

/** Put units on a fixture, filling the matching slot or an empty one. Returns units that did not fit. */
export function placeOnFixture(state: GameState, f: Fixture, productId: string, qty: number): number {
  const def = FIXTURES[f.type];
  let left = qty;
  const slot = f.slots.find((s) => s.productId === productId) ?? f.slots.find((s) => s.productId === null || s.qty === 0);
  if (!slot) return left;
  slot.productId = productId;
  const room = def.capacity - slot.qty;
  const put = Math.min(room, left);
  slot.qty += put; left -= put;
  return left;
}

/** What the owner should carry to this fixture, or null if nothing fits. */
export function pickCarryTask(state: GameState, f: Fixture): { productId: string; qty: number } | null {
  const def = FIXTURES[f.type];
  if (def.slots === 0) return null;
  const storage = state.shop.storage.filter((s) => s.qty > 0);
  const fits = (pid: string) => {
    const p = productDef(pid);
    if (p.chilled && !def.chilled) return false;
    if (!p.chilled && def.chilled && f.type !== 'fridge') return false;
    if (def.accepts && !def.accepts.includes(p.category)) return false;
    return true;
  };
  // Lowest-stocked slot whose product is in storage.
  let best: { productId: string; qty: number; need: number } | null = null;
  for (const s of f.slots) {
    if (!s.productId) continue;
    const entry = storage.find((e) => e.productId === s.productId);
    if (!entry) continue;
    const need = def.capacity - s.qty;
    if (need <= 0) continue;
    if (!best || need > best.need) best = { productId: s.productId, qty: Math.min(need, entry.qty, 8), need };
  }
  if (best) return { productId: best.productId, qty: best.qty };
  // Else an empty slot with any fitting product.
  const empty = f.slots.find((s) => !s.productId || s.qty === 0);
  if (empty) {
    const entry = storage.find((e) => fits(e.productId) && !f.slots.some((s) => s.productId === e.productId && s.qty > 0));
    if (entry) return { productId: entry.productId, qty: Math.min(def.capacity, entry.qty, 8) };
  }
  return null;
}

function separate(state: GameState, dyn: Set<number>): void {
  const g = gridFor(state);
  const movers = state.people.filter((p) => p.kind !== 'walker' && p.state !== 'driving' && p.state !== 'queued' && p.state !== 'paying' && p.state !== 'gone');
  for (let i = 0; i < movers.length; i++) {
    const a = movers[i]!;
    let fx = 0, fz = 0;
    for (let j = 0; j < movers.length; j++) {
      if (i === j) continue;
      const b = movers[j]!;
      const dx = a.x - b.x, dz = a.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.42 && d > 1e-4) { const push = (0.42 - d) * 0.5; fx += (dx / d) * push; fz += (dz / d) * push; }
      else if (d <= 1e-4) { fx += (i < j ? 0.02 : -0.02); }
    }
    if (fx === 0 && fz === 0) continue;
    const nx = a.x + fx, nz = a.z + fz;
    const [cx, cz] = cellOf(g, { x: nx, z: nz });
    if (!isBlocked(g, cx, cz, dyn)) { a.x = nx; a.z = nz; }
  }
}

/** Nobody stays stuck: a person who has not moved toward a path target for 8 s is placed on the nearest walkable cell and re-pathed. */
function watchdog(state: GameState, p: Person, dyn: Set<number>): void {
  const moving = p.path.length > 0 && p.pathIdx < p.path.length && p.state !== 'queued' && p.state !== 'paying' && p.state !== 'driving' && p.state !== 'browsing' && p.state !== 'pickBox' && p.state !== 'stocking';
  if (!moving) { p.stuckTicks = 0; return; }
  const moved = Math.hypot(p.x - p.px, p.z - p.pz);
  p.stuckTicks = moved < 0.002 ? (p.stuckTicks ?? 0) + 1 : 0;
  if ((p.stuckTicks ?? 0) > 8 / TICK) {
    state.stuckRescues++;
    p.stuckTicks = 0;
    const target = p.path[p.path.length - 1]!;
    const spot = nearestWalkable(gridFor(state), { x: p.x, z: p.z }, dyn);
    p.x = spot.x; p.z = spot.z;
    if (!setPath(state, p, target, dyn)) { p.x = target.x; p.z = target.z; p.pathIdx = p.path.length; }
  }
}

export function tickPeople(state: GameState): void {
  const dyn = dynamicBlockers(state);
  for (const p of state.people) {
    p.px = p.x; p.pz = p.z;
    switch (p.kind) {
      case 'customer': tickCustomer(state, p, dyn); break;
      case 'walker': tickWalker(state, p); break;
      case 'owner': tickOwner(state, p, dyn); break;
      case 'staff': tickStaff(state, p, dyn); break;
    }
    watchdog(state, p, dyn);
  }
  separate(state, dyn);
  if (state.people.some((p) => p.state === 'gone')) state.people = state.people.filter((p) => p.state !== 'gone');
}

/** Staff behaviour lands in Part 2; for now they stand at their post. */
function tickStaff(_state: GameState, p: Person, _dyn: Set<number>): void {
  if (p.state !== 'working') { p.state = 'working'; p.anim = 'idle'; }
}
