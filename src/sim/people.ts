import type { GameState, Person, Fixture, CustomerType, Vec2 } from './types';
import { PRODUCTS, productDef } from './products';
import { PLOTS, WALK_SPEED, TICK, DIFFICULTY, FIXTURES, MAP_X, SIDEWALK_N_Z, lotLayout } from './layout';
import { fixtureFrontWorld, fixtureBackWorld, fixtureFacing, fixtureCentre, cellOf, isBlocked, nearestWalkable, cellIndex, canStep } from './grid';
import { findPath } from './pathfinding';
import { followPath, turnToward } from './movement';
import { withRng, nextId, popup, cue, gridFor, dist } from './state';
import { spawnCustomerCar, leaveLot } from './cars';
import { listWeight, budgetFor } from './customers';
import { pickType } from './tick';
import { effectivePrice } from './marketing';
import { cashierMistake, onShift } from './staff';
import { CARD_FEE } from './money';

const CUSTOMER_MODELS = 12;

export function plotOf(state: GameState) { return PLOTS.find((p) => p.id === state.shop.plotId) ?? PLOTS[0]!; }

/** World-space points just outside and just inside the front door. */
// Walls are WALL_T thick outside the floor edge, so the threshold runs from z = 0 to z = 0.5.
export function doorOutside(state: GameState, id = 0): Vec2 { const s = state.shop; return { x: s.originX + s.door.x + ((id % 3) - 1) * 0.22, z: s.originZ + s.door.z + 0.95 + (id % 2) * 0.3 }; }
export function doorInside(state: GameState, id = 0): Vec2 { const s = state.shop; return { x: s.originX + s.door.x + ((id % 3) - 1) * 0.2, z: s.originZ + s.door.z - 0.7 - (id % 2) * 0.3 }; }
/** Where workers pick up boxes: just in front of the delivery zone. */
export function storeroomPoint(state: GameState): Vec2 { const s = state.shop; const d = s.delivery; return { x: s.originX + (d.x0 + d.x1) / 2, z: s.originZ + d.z1 + 0.35 }; }

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

/** Queue slot k for a register: straight back from the front, then bending toward the middle of the shop. */
export function queueSlot(state: GameState, reg: Fixture, k: number): Vec2 {
  const front = fixtureFrontWorld(state.shop, reg);
  const f = fixtureFacing(reg.rot);
  const straight = 3;
  const spacing = 0.7;
  let p: Vec2;
  if (k < straight) p = { x: front.x + f.x * k * spacing, z: front.z + f.z * k * spacing };
  else {
    // Bend toward the shop's centre so the line never runs into a wall.
    const base = { x: front.x + f.x * (straight - 1) * spacing, z: front.z + f.z * (straight - 1) * spacing };
    const cx = state.shop.originX + (state.shop.floor.x0 + state.shop.floor.x1) / 2;
    const cz = state.shop.originZ + (state.shop.floor.z0 + state.shop.floor.z1) / 2;
    let side = { x: -f.z, z: f.x };
    if ((cx - base.x) * side.x + (cz - base.z) * side.z < 0) side = { x: f.z, z: -f.x };
    const j = k - straight + 1;
    p = { x: base.x + side.x * j * spacing, z: base.z + side.z * j * spacing };
  }
  return nearestWalkable(gridFor(state), p, undefined, 4);
}

function stockedProducts(state: GameState): Set<string> {
  const set = new Set<string>();
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId) set.add(s.productId);
  return set;
}

/** Products placed near the door or on end caps get a visibility bonus on shopping lists. */
function exposure(state: GameState): Map<string, number> {
  const m = new Map<string, number>();
  const d = doorInside(state);
  for (const f of state.shop.fixtures) {
    const c = fixtureCentre(state.shop, f);
    const near = Math.hypot(c.x - d.x, c.z - d.z) < 2.6 ? 1.3 : 1;
    const endcap = f.type === 'endcap' || f.type === 'rack' ? 1.4 : 1;
    for (const sl of f.slots) if (sl.productId && sl.qty > 0) m.set(sl.productId, Math.max(m.get(sl.productId) ?? 1, near * endcap));
  }
  return m;
}

function makeList(state: GameState, ctype: CustomerType): { productId: string; qty: number }[] {
  const stocked = stockedProducts(state);
  const expo = exposure(state);
  return withRng(state, 'customers', (r) => {
    const n = r.pick([2, 2, 3, 3, 3, 4]);
    const pool = PRODUCTS.map((p) => ({ id: p.id, w: listWeight(ctype, p.id, stocked.has(p.id)) * (expo.get(p.id) ?? 1) }));
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
  const ctype = pickType(state);
  const look = withRng(state, 'looks', (r) => ({ model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.92, 1.08) }));
  const patience = withRng(state, 'customers', (r) => r.range(70, 150) * diff.patienceMul * (ctype === 'convenience' ? 0.75 : 1));
  const p: Person = {
    id: nextId(state), kind: 'customer', look, x: 0, z: 0, yaw: 0, px: 0, pz: 0, state: 'walking', anim: 'walk', path: [], pathIdx: 0,
    speed: WALK_SPEED * withRng(state, 'customers', (r) => r.range(0.9, 1.1)), timer: 0,
    ctype, list: makeList(state, ctype), basket: [], listIdx: 0, missed: 0, patience, maxPatience: patience, carId: null, registerId: null, mood: 1, arrivedTick: state.tick, stuckTicks: 0,
    budget: budgetFor(ctype, withRng(state, 'customers', (r) => r.next())),
  };
  state.today.customers++;
  if (byCar) {
    const car = spawnCustomerCar(state, p.id, fromWest);
    if (!car) {
      state.today.turnedAway++;
      { const L = lotLayout(state.shop); popup(state, { x: state.shop.originX + L.driveway.x0 + 1, z: state.shop.originZ + L.driveway.z1 }, 'Lot full!', 'bad', 0.8); }
      return null;
    }
    p.carId = car.id; p.state = 'driving'; p.anim = 'sit'; p.x = car.x; p.z = car.z;
  } else {
    // Far enough along the sidewalk that nobody pops into view near the shop.
    const sx = state.shop.originX + (fromWest ? -26 : 26);
    p.x = sx; p.z = SIDEWALK_N_Z + withRng(state, 'customers', (r) => r.range(-0.12, 0.12));
    p.path = [{ x: state.shop.originX + (fromWest ? -7.2 : 7.2), z: p.z }]; p.pathIdx = 0;
    p.yaw = fromWest ? Math.PI / 2 : -Math.PI / 2;
  }
  p.px = p.x; p.pz = p.z;
  state.people.push(p);
  return p;
}

/** Walkers stroll the whole of Main Street, from one tunnel to the other. */
const WALKER_FAR = MAP_X + 14;

export function spawnWalker(state: GameState): void {
  withRng(state, 'walkers', (r) => {
    const fromWest = r.chance(0.5);
    const south = r.chance(0.5);
    const z = (south ? 3.75 : SIDEWALK_N_Z) + r.range(-0.1, 0.1);
    const p: Person = {
      id: nextId(state), kind: 'walker', look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.9, 1.1), dog: r.chance(0.3) },
      x: fromWest ? -WALKER_FAR : WALKER_FAR, z, yaw: fromWest ? Math.PI / 2 : -Math.PI / 2, px: 0, pz: 0, state: 'walking', anim: 'walk',
      path: [{ x: fromWest ? WALKER_FAR : -WALKER_FAR, z }], pathIdx: 0, speed: WALK_SPEED * r.range(0.7, 0.95), timer: 0,
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
  const r = effectivePrice(state, productId) / def.basePrice;
  const tolerance = ctype === 'bargain' ? 0.35 : ctype === 'convenience' ? 0.8 : ctype === 'loyalist' ? 0.6 : 0.5;
  const p = r <= 1.0 ? 1 : Math.max(0.05, 1 - (r - 1) / tolerance);
  return withRng(state, 'customers', (rr) => rr.chance(p));
}

function chooseRegister(state: GameState, ctype?: CustomerType): Fixture | null {
  let best: Fixture | null = null, bestLen = Infinity;
  for (const f of state.shop.fixtures) {
    if (f.type !== 'register' && f.type !== 'kiosk') continue;
    let len = (f.queue?.length ?? 0) + (f.serving ? 1 : 0);
    if (f.type === 'kiosk') len += ctype === 'loyalist' ? 3 : 1.5;
    if (len < bestLen) { best = f; bestLen = len; }
  }
  return best;
}

function finishShopping(state: GameState, p: Person): void {
  if (!p.basket || p.basket.length === 0) { startLeaving(state, p, false); return; }
  const reg = chooseRegister(state, p.ctype);
  if (!reg) { startLeaving(state, p, false); return; }
  reg.queue ??= [];
  reg.queue.push(p.id);
  p.registerId = reg.id;
  p.queuedTick = state.tick;
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
  if (!happy && (p.basket?.length ?? 0) > 0) {
    // An angry walkout knocks something over: a small spill on the floor until someone mops it.
    // Spills only ever land on open floor inside the shop (never under a fixture or outside).
    const g = gridFor(state);
    const [cx, cz] = cellOf(g, { x: p.x, z: p.z });
    if (g.inside[cellIndex(g, cx, cz)] && !isBlocked(g, cx, cz) && state.shop.litter.length < 6) { state.shop.litter.push({ id: nextId(state), x: p.x, z: p.z }); cue(state, 'spill'); }
    state.shop.cleanliness = Math.max(0.2, state.shop.cleanliness - 0.06);
  }
  if (!happy) {
    cue(state, 'grumble');
    // Put unpaid items back where they came from.
    for (const b of p.basket ?? []) {
      const f = findFixtureWith(state, b.productId) ?? state.shop.fixtures.find((fx) => fx.slots.some((s) => s.productId === b.productId));
      const slot = f?.slots.find((s) => s.productId === b.productId);
      if (slot) slot.qty += b.qty;
    }
    p.basket = [];
  }
  p.state = 'leaving'; p.anim = happy && p.basket && p.basket.length ? 'carry' : 'walk';
  setPath(state, p, doorInside(state, p.id));
}

function completeSale(state: GameState, p: Person, reg: Fixture): void {
  let total = 0, cogs = 0, units = 0;
  for (const b of p.basket ?? []) { total += b.price * b.qty; cogs += productDef(b.productId).cost * b.qty; units += b.qty; }
  total = Math.round(total * 100) / 100;
  const cashier = state.people.find((x) => x.id === reg.staffId && x.kind === 'staff');
  if (cashier) total = Math.max(0, total - cashierMistake(state, cashier, total));
  // How they pay: card carries a fee, mobile is free and quick, cash is cash.
  const method = withRng(state, 'customers', (r) => { const x = r.next(); return x < 0.55 ? 'card' : x < 0.75 ? 'mobile' : 'cash'; });
  const fee = method === 'card' ? Math.round(total * CARD_FEE * 100) / 100 : 0;
  state.today.other += fee;
  state.cash += total - fee;
  state.shop.cleanliness = Math.max(0.2, state.shop.cleanliness - 0.004);
  state.today.revenue += total; state.today.cogs += cogs; state.today.itemsSold += units; state.today.served++;
  const waited = p.maxPatience && p.patience !== undefined ? 1 - p.patience / p.maxPatience : 0;
  if (p.queuedTick !== undefined) {
    const w = (state.tick - p.queuedTick) * TICK;
    state.scores.waitSum += w; state.scores.waitSamples++;
    state.scores.avgWait = state.scores.waitSum / state.scores.waitSamples;
  }
  const sat = Math.max(0, Math.min(1, 1 - waited * 0.6 - (p.missed ?? 0) * 0.15));
  state.today.satisfaction += sat; state.today.satisfactionN++;
  const c = fixtureCentre(state.shop, reg);
  popup(state, c, `+$${total.toFixed(2)}${method === 'cash' ? '' : method === 'card' ? ' card' : ' tap'}`, 'money', 1.1);
  cue(state, 'cash');
  reg.serving = null; reg.scanned = 0;
  if (!state.tutorial.completed.includes('ringUp')) completeTutorial(state, 'ringUp');
  startLeaving(state, p, true);
}

/** The guided first day, in order. Each step pays a small reward the first time. */
export const TUTORIAL_STEPS = ['counter', 'shelf', 'order', 'stock', 'open', 'ringUp', 'price', 'openTomorrow'] as const;

export function completeTutorial(state: GameState, step: string): void {
  const t = state.tutorial;
  if (t.completed.includes(step)) return;
  t.completed.push(step);
  if (t.enabled && !t.done) {
    const reward = 20;
    state.cash += reward; t.rewardsPaid += reward;
    const d = doorOutside(state);
    popup(state, { x: d.x, z: d.z - 1 }, `+$${reward} tip bonus`, 'money', 1.6);
    cue(state, 'reward');
    t.step = Math.min(t.step + 1, TUTORIAL_STEPS.length);
    if (TUTORIAL_STEPS.every((id) => t.completed.includes(id))) t.done = true;
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
        setPath(state, p, doorOutside(state, p.id), dyn);
      }
      break;
    }
    case 'walking': {
      if (followPath(p, p.speed, dt, 12, 0.22)) { p.state = 'toDoor'; setPath(state, p, doorOutside(state, p.id), dyn); }
      break;
    }
    case 'toDoor': {
      if (followPath(p, p.speed, dt, 12, 0.22)) { p.state = 'entering'; cue(state, 'chime'); setPath(state, p, doorInside(state, p.id), dyn); }
      break;
    }
    case 'entering': {
      if (followPath(p, p.speed, dt, 12, 0.22)) {
        if (state.phase !== 'open') { startLeaving(state, p, false); break; }
        p.state = 'shopping';
        if (p.ctype === 'impulse') {
          const tempt = state.shop.fixtures.filter((f) => (f.type === 'endcap' || f.type === 'rack') && f.slots.some((sl) => sl.productId && sl.qty > 0));
          if (tempt.length && withRng(state, 'customers', (r) => r.chance(0.6))) {
            const f = withRng(state, 'customers', (r) => r.pick(tempt));
            const sl = f.slots.find((x) => x.productId && x.qty > 0)!;
            if (!p.list!.some((it) => it.productId === sl.productId)) p.list!.push({ productId: sl.productId!, qty: 1 });
          }
        }
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
      if (!f) { p.missed = (p.missed ?? 0) + 1; state.today.missedItems++; p.listIdx!++; break; }
      p.targetFixture = f.id;
      p.state = 'browsing'; p.anim = 'walk'; p.timer = -1;
      setPath(state, p, fixtureFrontWorld(state.shop, f), dyn);
      break;
    }
    case 'browsing': {
      if (p.timer < 0) {
        if (followPath(p, p.speed, dt, 12, 0.22)) {
          p.timer = withRng(state, 'customers', (r) => r.range(1.2, 2.6));
          p.anim = 'browse';
          const f = state.shop.fixtures.find((x) => x.id === p.targetFixture);
          if (f) { const c = fixtureCentre(state.shop, f); p.yaw = Math.atan2(c.x - p.x, c.z - p.z); }
        }
        break;
      }
      p.timer -= dt;
      if (state.tick % 10 === 0 && state.people.some((o) => o !== p && o.kind === 'customer' && Math.abs(o.x - p.x) < 0.6 && Math.abs(o.z - p.z) < 0.6)) p.crowded = (p.crowded ?? 0) + 1;
      if (p.timer <= 0) {
        const item = (p.list ?? [])[p.listIdx ?? 0]!;
        const f = state.shop.fixtures.find((x) => x.id === p.targetFixture);
        const slot = f?.slots.find((s) => s.productId === item.productId && s.qty > 0);
        const price = effectivePrice(state, item.productId);
        const spent = (p.basket ?? []).reduce((a, b) => a + b.price * b.qty, 0);
        if (slot && willBuy(state, p.ctype ?? 'convenience', item.productId) && spent + price <= (p.budget ?? 999)) {
          const promo = state.marketing.promotion;
          const want = promo && promo.kind === 'buyTwo' && promo.productId === item.productId ? Math.max(2, item.qty) : item.qty;
          const take = Math.min(slot.qty, want, Math.max(1, Math.floor(((p.budget ?? 999) - spent) / price)));
          slot.qty -= take;
          p.basket!.push({ productId: item.productId, qty: take, price });
          cue(state, 'pick');
        } else if (!slot) { p.missed = (p.missed ?? 0) + 1; state.today.missedItems++; }
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
      if (followPath(p, p.speed, dt, 12, 0.22)) {
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
        if (followPath(p, p.speed, dt, 12, 0.22)) {
          p.timer = 0; p.anim = 'pay';
          const c = fixtureCentre(state.shop, reg); p.yaw = Math.atan2(c.x - p.x, c.z - p.z);
        }
        break;
      }
      // A cashier scans automatically; at a kiosk the shopper does it (slowly, with the odd hiccup); otherwise the player clicks.
      const cashier = state.people.find((s) => s.id === reg.staffId && s.kind === 'staff' && onShift(s, state.time) && dist(s, fixtureBackWorld(state.shop, reg)) < 0.8);
      if (cashier) {
        p.timer += dt;
        const rate = 0.55 / (0.6 + (cashier.skill ?? 0.5));
        if (p.timer >= rate) { p.timer = 0; scanItem(state, reg); }
      } else if (reg.type === 'kiosk') {
        p.timer += dt;
        const rate = p.ctype === 'convenience' ? 1.1 : 1.6;
        if (p.timer >= rate) {
          p.timer = withRng(state, 'customers', (r) => (r.chance(0.08) ? -2.5 : 0)); // "unexpected item in the bagging area"
          if (p.timer === 0) scanItem(state, reg);
          else popup(state, { x: p.x, z: p.z }, 'Kiosk hiccup', 'bad', 1.0);
        }
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
      if (followPath(p, p.speed, dt, 12, 0.22)) {
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
      if (followPath(p, p.speed, dt, 12, 0.22)) {
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

/** Direct steering (WASD): slide along walls and fixtures instead of stopping dead. */
function steer(state: GameState, p: Person, dyn: Set<number>): void {
  const g = gridFor(state);
  const d = p.moveDir!;
  const len = Math.hypot(d.x, d.z) || 1;
  const step = (p.speed * TICK) / Math.max(1, state.timeScale || 1);
  const dx = (d.x / len) * step, dz = (d.z / len) * step;
  const others = state.people.filter((o) => o !== p && o.kind !== 'walker' && o.state !== 'driving' && o.state !== 'gone' && Math.abs(o.x - p.x) < 1 && Math.abs(o.z - p.z) < 1);
  const free = (x: number, z: number) => {
    // People are solid: you can step away from someone you touch, never into them.
    for (const o of others) { const dn = Math.hypot(o.x - x, o.z - z); if (dn < 0.38 && dn < Math.hypot(o.x - p.x, o.z - p.z)) return false; }
    const r = 0.18; // body radius: keep the whole body out of walls and fixtures
    const [cx0, cz0] = cellOf(g, { x: p.x, z: p.z });
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [0, 0]] as const) {
      const [cx, cz] = cellOf(g, { x: x + ox, z: z + oz });
      if (isBlocked(g, cx, cz, dyn)) return false;
      if ((cx !== cx0 || cz !== cz0) && !canStep(g, cx0, cz0, cx, cz, dyn) && Math.abs(cx - cx0) + Math.abs(cz - cz0) === 1) return false;
    }
    return true;
  };
  if (free(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
  else if (free(p.x + dx, p.z)) p.x += dx;
  else if (free(p.x, p.z + dz)) p.z += dz;
  p.yaw = turnToward(p.yaw, Math.atan2(d.x, d.z), 14 * TICK);
  p.path = []; p.pathIdx = 0;
  if (p.state !== 'carrying') p.state = 'idle';
  p.anim = p.carrying ? 'carry' : 'walk';
  // A pending carry trip is cancelled by taking the controls; what you hold stays in your hands.
  if (p.task && !p.carrying) p.task = null;
}

/** How far the owner is from a world point. */
export function ownerDist(state: GameState, to: Vec2): number {
  const o = state.people.find((x) => x.kind === 'owner');
  return o ? Math.hypot(o.x - to.x, o.z - to.z) : Infinity;
}

/** The product the shelves most need, of those waiting in the delivery zone. */
export function neediestInStorage(state: GameState): string | null {
  const have = new Map<string, number>();
  for (const e of state.shop.storage) if (e.qty > 0) have.set(e.productId, (have.get(e.productId) ?? 0) + e.qty);
  if (!have.size) return null;
  let best: string | null = null, bestGap = -1;
  for (const f of state.shop.fixtures) for (const sl of f.slots) {
    if (!sl.productId || !have.has(sl.productId)) continue;
    const gap = FIXTURES[f.type].capacity - sl.qty;
    if (gap > bestGap) { bestGap = gap; best = sl.productId; }
  }
  return best ?? [...have.keys()][0]!;
}

/** Pick up a box from the delivery zone (in person: you must be standing next to it). */
export function ownerPickUp(state: GameState, productId?: string): string | null {
  const o = state.people.find((x) => x.kind === 'owner');
  if (!o) return 'Nobody to carry.';
  const d = state.shop.delivery;
  const zone = { x: state.shop.originX + Math.max(d.x0, Math.min(d.x1, o.x - state.shop.originX)), z: state.shop.originZ + Math.max(d.z0, Math.min(d.z1, o.z - state.shop.originZ)) };
  if (Math.hypot(o.x - zone.x, o.z - zone.z) > 1.4) return 'Walk over to the boxes first.';
  if (o.carrying) {
    // Put back what you hold first, then take the new box.
    state.shop.storage.push({ productId: o.carrying.productId, qty: o.carrying.qty, day: state.day });
    o.carrying = null;
  }
  const pid = productId ?? neediestInStorage(state);
  if (!pid) return 'No boxes waiting. Order stock first.';
  const entry = state.shop.storage.find((e) => e.productId === pid && e.qty > 0);
  if (!entry) return 'None of that left.';
  const qty = Math.min(8, entry.qty);
  entry.qty -= qty;
  state.shop.storage = state.shop.storage.filter((e) => e.qty > 0);
  o.carrying = { productId: pid, qty };
  o.anim = 'carry';
  cue(state, 'pick');
  return null;
}

/** Put what you carry onto the fixture you are standing at. */
export function ownerStock(state: GameState, fixtureId: number): string | null {
  const o = state.people.find((x) => x.kind === 'owner');
  const f = state.shop.fixtures.find((x) => x.id === fixtureId);
  if (!o || !f) return 'Nothing there.';
  if (!o.carrying) return 'Pick up a box from the delivery area first.';
  const c = fixtureCentre(state.shop, f);
  if (Math.hypot(o.x - c.x, o.z - c.z) > 1.5) return 'Step closer to the shelf.';
  const def = productDef(o.carrying.productId);
  const fdef = FIXTURES[f.type];
  if (!fdef.slots) return 'That does not hold stock.';
  if (def.chilled && !fdef.chilled) return `${def.name} needs a chiller.`;
  if (!def.chilled && fdef.chilled) return `${def.name} does not go in the chiller.`;
  if (fdef.accepts && !fdef.accepts.includes(def.category)) return `${def.name} does not fit there.`;
  const left = placeOnFixture(state, f, o.carrying.productId, o.carrying.qty);
  if (left === o.carrying.qty) return 'That one is full.';
  o.carrying = left > 0 ? { productId: o.carrying.productId, qty: left } : null;
  o.anim = o.carrying ? 'carry' : 'idle';
  cue(state, 'stock');
  completeTutorial(state, 'stock');
  return null;
}

/** Owner standing at a till? */
export function ownerAt(state: GameState, reg: Fixture): boolean {
  const o = state.people.find((x) => x.kind === 'owner');
  if (!o) return false;
  const back = fixtureBackWorld(state.shop, reg);
  return Math.hypot(o.x - back.x, o.z - back.z) < 0.75;
}

/** Walk the owner to a point (click-to-move or "go to the till"). */
export function ownerWalkTo(state: GameState, to: Vec2): boolean {
  const o = state.people.find((x) => x.kind === 'owner');
  if (!o) return false;
  if (o.state === 'pickBox' || o.state === 'stocking') return false;
  const ok = setPath(state, o, to, dynamicBlockers(state));
  if (!ok) return false;
  o.moveDir = null;
  if (!o.carrying) o.task = null;
  o.state = o.carrying && o.task ? 'carrying' : 'walking';
  return true;
}

/** Where a worker stands when idle. */
function homeOf(state: GameState, p: Person): Vec2 {
  const reg = state.shop.fixtures.find((f) => f.type === 'register');
  if (p.kind === 'owner') return { x: p.x, z: p.z }; // the manager stays where the player leaves them
  switch (p.role) {
    case 'cashier': { const mine = state.shop.fixtures.find((f) => f.staffId === p.id); return mine ? fixtureBackWorld(state.shop, mine) : (reg ? fixtureBackWorld(state.shop, reg) : storeroomPoint(state)); }
    case 'stocker': { const sp = storeroomPoint(state); return { x: sp.x + 0.8, z: sp.z + 0.4 }; }
    case 'cleaner': { const d = doorInside(state); return { x: d.x - 1.2, z: d.z - 0.3 }; }
    default: { const sp = storeroomPoint(state); return { x: sp.x + 2.2, z: sp.z + 0.6 }; }
  }
}

/** Workers (the owner and staff): stand at their post, carry stock, clean up. */
function tickWorker(state: GameState, p: Person, dyn: Set<number>): void {
  const dt = TICK;
  if (p.kind === 'owner' && p.moveDir && (p.moveDir.x !== 0 || p.moveDir.z !== 0)) { steer(state, p, dyn); return; }
  if (p.kind === 'owner' && p.state === 'walking') {
    // Click-to-move.
    if (followPath(p, p.speed / Math.max(1, state.timeScale || 1), dt, 12, 0.15)) { p.state = 'idle'; p.anim = p.carrying ? 'carry' : 'idle'; }
    else p.anim = p.carrying ? 'carry' : 'walk';
    return;
  }
  // Off shift: stand out by the back door (or walk there), do nothing else.
  if (p.kind === 'staff' && !onShift(p, state.time)) {
    const s = state.shop; const off = { x: s.originX + s.backDoor.x + 1.6, z: s.originZ + s.backDoor.z - 1.0 };
    if (p.task || p.carrying) { if (p.carrying) { state.shop.storage.push({ productId: p.carrying.productId, qty: p.carrying.qty, day: state.day }); p.carrying = null; } p.task = null; }
    if (dist(p, off) > 0.4) { if (p.state !== 'toRegister' || p.pathIdx >= p.path.length) { p.state = 'toRegister'; p.anim = 'walk'; setPath(state, p, off, dyn); } followPath(p, p.speed, dt, 12, 0.22); }
    else { p.state = 'idle'; p.anim = 'idle'; }
    return;
  }
  const home = homeOf(state, p);
  // Stockers and the free owner look for shelves to fill; cleaners look for litter.
  if ((p.state === 'idle' || p.state === 'toRegister') && !p.task) {
    const stocks = p.kind === 'staff' ? p.role === 'stocker' : !state.shop.fixtures.some((f) => f.type === 'register' && f.staffId);
    if (stocks && p.kind === 'staff') {
      let best: { f: Fixture; ratio: number } | null = null;
      for (const f of state.shop.fixtures) {
        const def = FIXTURES[f.type]; if (!def.slots) continue;
        const cap = def.slots * def.capacity; const have = f.slots.reduce((a, sl) => a + sl.qty, 0);
        const ratio = have / cap;
        if (ratio < 0.5 && pickCarryTask(state, f) && (!best || ratio < best.ratio)) best = { f, ratio };
      }
      if (best) { const t = pickCarryTask(state, best.f)!; p.task = { type: 'carry', fixtureId: best.f.id, productId: t.productId, qty: t.qty }; }
    }
    if (p.kind === 'staff' && p.role === 'cleaner' && state.shop.litter.length && p.state === 'idle') {
      const l = state.shop.litter[0]!;
      p.state = 'toStock'; p.anim = 'walk'; p.timer = -2; // -2 marks a cleaning trip
      p.targetFixture = l.id;
      setPath(state, p, { x: l.x, z: l.z }, dyn);
      return;
    }
  }
  switch (p.state) {
    case 'idle': {
      if (p.task && p.carrying) {
        // Already holding stock: take it straight to the shelf.
        const f = state.shop.fixtures.find((x) => x.id === p.task!.fixtureId);
        if (f) { p.state = 'carrying'; p.anim = 'carry'; setPath(state, p, fixtureFrontWorld(state.shop, f), dyn); }
        else p.task = null;
      } else if (p.task) { p.state = 'toStock'; p.anim = 'walk'; p.timer = 0; setPath(state, p, storeroomPoint(state), dyn); }
      else if (dist(p, home) > 0.35) { p.state = 'toRegister'; p.anim = 'walk'; setPath(state, p, home, dyn); }
      else {
        p.anim = p.carrying ? 'carry' : 'idle';
        const reg = state.shop.fixtures.find((f) => f.staffId === p.id) ?? (p.kind === 'owner' ? state.shop.fixtures.find((f) => (f.type === 'register' || f.type === 'kiosk') && ownerAt(state, f)) : undefined);
        if (reg && p.state === 'idle' && (p.kind !== 'owner' || !p.moveDir)) { const fc = fixtureCentre(state.shop, reg); p.yaw = turnToward(p.yaw, Math.atan2(fc.x - p.x, fc.z - p.z), 8 * dt); }
      }
      break;
    }
    case 'working': { p.state = 'idle'; break; }
    case 'toRegister': {
      if (followPath(p, p.speed, dt, 12, 0.22)) p.state = 'idle';
      if (p.task) p.state = 'idle';
      break;
    }
    case 'toStock': {
      if (followPath(p, p.speed, dt, 12, 0.22)) {
        if (p.timer === -2) {
          // Cleaning trip: pick up the litter.
          const i = state.shop.litter.findIndex((l) => l.id === p.targetFixture);
          if (i >= 0) { state.shop.litter.splice(i, 1); state.shop.cleanliness = Math.min(1, state.shop.cleanliness + 0.08); cue(state, 'pick'); }
          p.state = 'stocking'; p.anim = 'browse'; p.timer = 1.0; p.carrying = null; p.task = null; p.targetFixture = null;
        } else { p.state = 'pickBox'; p.anim = 'browse'; p.timer = 0.8; p.yaw = Math.PI; }
      }
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
      if (followPath(p, p.speed, dt, 12, 0.22)) {
        p.state = 'stocking'; p.anim = 'browse'; p.timer = 1.2 / Math.max(0.5, p.kind === 'staff' ? 0.6 + (p.skill ?? 0.5) : 1);
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
          // A clumsy stocker drops a unit now and then.
          const drop = p.kind === 'staff' && withRng(state, 'staff', (r) => r.chance(Math.max(0, 0.08 - (p.skill ?? 0.5) * 0.08))) ? 1 : 0;
          if (drop) popup(state, { x: p.x, z: p.z }, 'Dropped one', 'bad', 1.1);
          const left = placeOnFixture(state, f, p.carrying.productId, Math.max(0, p.carrying.qty - drop));
          if (left > 0) state.shop.storage.push({ productId: p.carrying.productId, qty: left, day: state.day });
          cue(state, 'stock');
          if (p.kind === 'owner') completeTutorial(state, 'stock');
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
    // The player is never shoved; everyone else steps round them.
    if (a.kind === 'owner') continue;
    let fx = 0, fz = 0;
    for (let j = 0; j < movers.length; j++) {
      if (i === j) continue;
      const b = movers[j]!;
      const dx = a.x - b.x, dz = a.z - b.z;
      const d = Math.hypot(dx, dz);
      const reach = b.kind === 'owner' ? 0.48 : 0.42;
      if (d < reach && d > 1e-4) { const push = (reach - d) * (b.kind === 'owner' ? 1 : 0.5); fx += (dx / d) * push; fz += (dz / d) * push; }
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
    if (p.kind === 'customer' && (p.state === 'shopping' || p.state === 'browsing')) p.walked = (p.walked ?? 0) + Math.hypot(p.x - p.px, p.z - p.pz);
    switch (p.kind) {
      case 'customer': tickCustomer(state, p, dyn); break;
      case 'walker': tickWalker(state, p); break;
      case 'owner': tickWorker(state, p, dyn); break;
      case 'staff': tickWorker(state, p, dyn); break;
    }
    watchdog(state, p, dyn);
  }
  separate(state, dyn);
  if (state.people.some((p) => p.state === 'gone')) state.people = state.people.filter((p) => p.state !== 'gone');
}
