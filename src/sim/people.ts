import type { GameState, Person, Fixture, Slot, CustomerType, Vec2 } from './types';
import { PRODUCTS, productDef } from './products';
import { PLOTS, WALK_SPEED, TICK, DIFFICULTY, FIXTURES, FRONT_WALK_Z, BUS_STOP, SIDEWALK_E_X, lotLayout, toWorld, toLocal, solidRect, footprintOf, zOnLevel, levelOf } from './layout';
import { fixtureFrontWorld, fixtureBackWorld, fixtureFacingWorld, fixtureCentre, fixtureAccessWorld, cellOf, isBlocked, nearestWalkable, cellIndex, canStep } from './grid';
import { findPath } from './pathfinding';
import { followPath, turnToward } from './movement';
import { withRng, nextId, popup, cue, gridFor, wallGridFor, dist, react, complain } from './state';
import { spawnCustomerCar, leaveLot } from './cars';
import { route, walkStreet, legOf, LEGS, LEG_END, CORNER_POINT, legCorner } from './streets';
import { tickRivalShopper, rivalShopperInCar } from './rivalShoppers';
import { listWeight, budgetFor, explainChoice, computeScores } from './customers';
import { pickType } from './tick';
import { effectivePrice } from './marketing';
import { cashierMistake, onShift } from './staff';
import { CARD_FEE } from './money';
import { formatMoney, dollars } from './money';
import { planDogStop, dogWalk, teenStep, arriveAtHangout, driverStep } from './life';
import { noteVisit } from './reviews';
import { maybeThief, bolt, fleeStep, chaseStep, isFree, fleeingThief } from './shoplifting';
import { freeStand, standPoint, freeStands } from './lot';
import { RIDE_REACH, rideAt, rideStep, startRide } from './storeys';
import { onEnter, tillExtras, queueDrain, grimeFactor, freeSeat, seatPose, seatApproach, freeDesk, fetchFromPallet, REST_BONUS } from './furniture';
import { RACK_STANDS } from './layout';

/** How much faster than walking someone rides a bike. */
export const BIKE_SPEED = 2.3;

export const CUSTOMER_MODELS = 12;

export function plotOf(state: GameState) { return PLOTS.find((p) => p.id === state.shop.plotId) ?? PLOTS[0]!; }

/** World-space points just outside and just inside the front door. */
// Walls are WALL_T thick outside the floor edge, so the threshold runs from z = 0 to z = 0.5.
export function doorOutside(state: GameState, id = 0): Vec2 { const s = state.shop; return toWorld(s, s.door.x + ((id % 3) - 1) * 0.22, s.door.z + 0.95 + (id % 2) * 0.3); }
export function doorInside(state: GameState, id = 0): Vec2 { const s = state.shop; return toWorld(s, s.door.x + ((id % 3) - 1) * 0.2, s.door.z - 0.7 - (id % 2) * 0.3); }
/** Where workers pick up boxes: just in front of the delivery zone. */
export function storeroomPoint(state: GameState): Vec2 { const s = state.shop; const d = s.delivery; return toWorld(s, (d.x0 + d.x1) / 2, d.z1 + 0.35); }

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

export function setPath(state: GameState, p: Person, to: Vec2, dyn?: Set<number>): boolean {
  // Partway up the stairs: up to the top first, and the new way on from there.
  const ride = p.climb !== undefined && p.path[p.pathIdx]?.ride !== undefined ? [p.path[p.pathIdx]!] : [];
  if (!ride.length) p.climb = undefined;
  const from = ride[0] ?? p;
  const path = findPath(gridFor(state), { x: from.x, z: from.z }, to, dyn);
  p.path = [...ride, ...(path ?? [to])]; p.pathIdx = 0;
  return !!path;
}

/** Queue slot k for a register: straight back from the front, then bending toward the middle of the shop. */
export function queueSlot(state: GameState, reg: Fixture, k: number): Vec2 {
  const front = fixtureFrontWorld(state.shop, reg);
  const f = fixtureFacingWorld(state.shop, reg.rot);
  const straight = 3;
  const spacing = 0.7;
  let p: Vec2;
  if (k < straight) p = { x: front.x + f.x * k * spacing, z: front.z + f.z * k * spacing };
  else {
    // Bend toward the shop's centre so the line never runs into a wall.
    const base = { x: front.x + f.x * (straight - 1) * spacing, z: front.z + f.z * (straight - 1) * spacing };
    const { x: cx, z: cz } = toWorld(state.shop, (state.shop.floor.x0 + state.shop.floor.x1) / 2, zOnLevel((state.shop.floor.z0 + state.shop.floor.z1) / 2, levelOf(reg)));
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

/**
 * A hint of who someone is, without new meshes: impulse buyers are kids and teens (smaller), convenience
 * shoppers walk a little faster (and wear workwear, drawn by the renderer), regulars are older (grey hair),
 * bargain hunters carry a reusable bag and a coupon. Deterministic: no random draws.
 */
export function typeLook(p: Person): void {
  if (p.ctype === 'impulse') p.look = { ...p.look, height: Math.round(p.look.height * 0.84 * 1000) / 1000 };
  if (p.ctype === 'convenience') p.speed *= 1.12;
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
  const bt = (state.today.byType ??= { bargain: 0, convenience: 0, loyalist: 0, impulse: 0 });
  bt[ctype]++;
  // Why they came: the two scores that most drove their choice of this store, kept for the inspect panel.
  p.store = 'player'; p.why = explainChoice(ctype, computeScores(state));
  typeLook(p);
  maybeThief(state, p);
  if (byCar) {
    const { car, onward } = spawnCustomerCar(state, p.id, fromWest);
    if (!car || onward?.kind === 'rival') {
      // Lot full: the car drives on past, and (when there is one) pulls into a rival's lot instead.
      state.today.turnedAway++;
      complain(state, 'lotFull');
      { const L = lotLayout(state.shop); popup(state, toWorld(state.shop, L.driveway.x0 + 1, L.driveway.z1), 'Lot full!', 'bad', 0.8); }
      if (car && onward?.kind === 'rival') rivalShopperInCar(state, car, onward.rival.id, look, ctype);
      return null;
    }
    p.carId = car.id; p.state = 'driving'; p.anim = 'sit'; p.x = car.x; p.z = car.z;
  } else {
    // By bike, now and then, when there is a rack with room (they do not come off the bus).
    const stand = freeStand(state.shop) && withRng(state, 'bikes', (r) => r.chance(0.45)) ? freeStand(state.shop) : null;
    if (stand) {
      (stand.rack.bikes ??= Array.from({ length: RACK_STANDS }, () => null))[stand.slot] = p.id;
      p.bike = { rackId: stand.rack.id, slot: stand.slot }; p.riding = true; p.speed *= BIKE_SPEED; p.anim = 'sit';
    }
    // On foot: off the bus at rush hour, otherwise along one of the streets, far enough out that nobody pops into view.
    const from = streetStart(state, 'customers', false, !!stand);
    const entry = frontageEntry(state, from);
    const r = route(from, entry, withRng(state, 'customers', (rr) => rr.chance(0.5)));
    p.x = from.x; p.z = from.z;
    p.path = r.path; p.xings = r.xings; p.pathIdx = 0;
    p.yaw = Math.atan2(p.path[0]!.x - p.x, p.path[0]!.z - p.z);
  }
  p.px = p.x; p.pz = p.z;
  state.people.push(p);
  return p;
}

/** Is it the morning or after-school rush, when buses unload at the stop? */
export function busRush(time: number): boolean { return (time >= 0 && time < 75) || (time >= 420 && time < 510); }

/**
 * Where someone on foot comes into town: off the bus at rush hour, otherwise some way out along
 * one of the eight sidewalk legs (far enough to be in the haze).
 */
export function streetStart(state: GameState, stream: string, far = false, noBus = false): Vec2 {
  return withRng(state, stream, (r) => {
    if (!noBus && state.phase !== 'night' && busRush(state.time) && r.chance(0.45)) return { x: BUS_STOP.x + r.range(-0.6, 0.6), z: BUS_STOP.z + r.range(-0.1, 0.1) };
    const leg = r.pick(LEGS);
    const end = LEG_END[leg];
    if (far) return { ...end };
    const c = CORNER_POINT[legCorner(leg)];
    const d = Math.hypot(end.x - c.x, end.z - c.z);
    const t = r.range(26, 34) / d;
    return { x: c.x + (end.x - c.x) * t, z: c.z + (end.z - c.z) * t };
  });
}

/** The point on the player's frontage sidewalk where someone on foot turns in, on the side they come from. */
export function frontageEntry(state: GameState, from: Vec2): Vec2 {
  const s = state.shop;
  const a = toWorld(s, -7.2, FRONT_WALK_Z), b = toWorld(s, 7.2, FRONT_WALK_Z);
  const leg = legOf(a);
  // Coming along the same leg, take the nearer end; otherwise the end nearer the crossroads.
  const ref = legOf(from) === leg ? from : CORNER_POINT[legCorner(leg)];
  return Math.abs(a.x - ref.x) < Math.abs(b.x - ref.x) ? a : b;
}

/** Walkers stroll through town from one end of a street to the end of another, crossing at the zebras. */
export function spawnWalker(state: GameState): void {
  const from = streetStart(state, 'walkers', true);
  withRng(state, 'walkers', (r) => {
    let to = LEG_END[r.pick(LEGS)];
    for (let k = 0; k < 4 && legOf(to) === legOf(from); k++) to = LEG_END[r.pick(LEGS)];
    const rt = route(from, to, r.chance(0.5));
    // Now and then a jogger, or a parent with a child a step behind.
    const who = r.next();
    const jogger = who < 0.08, family = who >= 0.08 && who < 0.22;
    const p: Person = {
      id: nextId(state), kind: 'walker', look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.9, 1.1), dog: !jogger && !family && r.chance(0.3) },
      x: from.x, z: from.z, yaw: 0, px: from.x, pz: from.z, state: 'walking', anim: 'walk',
      path: rt.path, xings: rt.xings, pathIdx: 0, speed: WALK_SPEED * (jogger ? r.range(1.7, 2.0) : r.range(0.7, 0.95)), timer: 0,
    };
    p.yaw = Math.atan2(p.path[0]!.x - p.x, p.path[0]!.z - p.z);
    state.people.push(p);
    planDogStop(state, p);
    if (family) {
      const back = { x: -Math.sin(p.yaw) * 0.7, z: -Math.cos(p.yaw) * 0.7 };
      state.people.push({ ...p, id: nextId(state), look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.6, 0.68) }, x: p.x + back.x, z: p.z + back.z, px: p.x + back.x, pz: p.z + back.z, path: [...p.path], xings: p.xings ? [...p.xings] : undefined });
    }
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
  if (p.thief) { bolt(state, p); return; }
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

/** Take anyone no longer in the world out of every till's line (and off the till), so a line never waits on a ghost. */
export function pruneTills(state: GameState): void {
  const alive = new Set(state.people.map((p) => p.id));
  for (const f of state.shop.fixtures) {
    if (f.queue && f.queue.some((id) => !alive.has(id))) f.queue = f.queue.filter((id) => alive.has(id));
    if (f.serving !== null && f.serving !== undefined && !alive.has(f.serving)) { f.serving = null; f.scanned = 0; }
  }
}

function registerOf(state: GameState, p: Person): Fixture | undefined {
  return state.shop.fixtures.find((f) => f.id === p.registerId);
}

/** Remember a product a shopper noticed (the first few). */
function noteId(p: Person, key: 'missedIds' | 'priceyIds', id: string): void {
  const a = (p[key] ??= []);
  if (a.length < 3 && !a.includes(id)) a.push(id);
}

export function startLeaving(state: GameState, p: Person, happy: boolean): void {
  noteVisit(state, p, happy);
  const reg = registerOf(state, p);
  if (reg?.queue) { const i = reg.queue.indexOf(p.id); if (i >= 0) reg.queue.splice(i, 1); }
  if (reg && reg.serving === p.id) { reg.serving = null; reg.scanned = 0; }
  p.registerId = null;
  if (!happy && (p.basket?.length ?? 0) > 0) {
    // An angry walkout knocks something over: a small spill on the floor until someone mops it.
    addSpill(state, p.x, p.z);
    state.shop.cleanliness = Math.max(0.2, state.shop.cleanliness - 0.06);
  }
  if (!happy) {
    cue(state, 'grumble');
    returnToShelves(state, p);
  }
  p.state = 'leaving'; p.anim = happy && p.basket && p.basket.length ? 'carry' : 'walk';
  setPath(state, p, doorInside(state, p.id));
}

/** A spill on the floor until someone mops it: only ever on open floor inside the shop (never under a fixture or outside). */
export function addSpill(state: GameState, x: number, z: number): boolean {
  const g = gridFor(state);
  const [cx, cz] = cellOf(g, { x, z });
  if (!g.inside[cellIndex(g, cx, cz)] || isBlocked(g, cx, cz) || state.shop.litter.length >= 6) return false;
  state.shop.litter.push({ id: nextId(state), x, z });
  cue(state, 'spill');
  return true;
}

/** Unpaid items go back where they came from (a walkout's basket, a caught shoplifter's haul). */
export function returnToShelves(state: GameState, p: Person): void {
  for (const b of p.basket ?? []) {
    const f = findFixtureWith(state, b.productId) ?? state.shop.fixtures.find((fx) => fx.slots.some((s) => s.productId === b.productId));
    const slot = f?.slots.find((s) => s.productId === b.productId);
    if (slot) slot.qty += b.qty;
    else state.shop.storage.push({ productId: b.productId, qty: b.qty, day: state.day });
  }
  p.basket = [];
}

function completeSale(state: GameState, p: Person, reg: Fixture): void {
  let total = 0, cogs = 0, units = 0;
  for (const b of p.basket ?? []) { total += b.price * b.qty; cogs += productDef(b.productId).cost * b.qty; units += b.qty; }
  // Off the magazine shelf and the flower table, and a coffee to sit down with at the café table.
  const extra = tillExtras(state);
  total += extra.revenue; cogs += extra.cost;
  const cafe = p.ctype !== 'bargain' && state.shop.fixtures.some((f) => f.type === 'cafe') ? freeSeat(state, p, ['cafe'], 99) : null;
  const coffee = !!cafe && withRng(state, 'furniture', (r) => r.chance(0.3));
  if (coffee) { total += 2.5; cogs += 0.8; }
  total = Math.round(total * 100) / 100;
  const cashier = state.people.find((x) => x.id === reg.staffId && x.kind === 'staff');
  if (cashier) total = Math.max(0, total - cashierMistake(state, cashier, total));
  p.servedBy = reg.type === 'kiosk' ? 'kiosk' : cashier ? 'staff' : 'owner';
  if (cashier) p.servedSkill = cashier.skill;
  // How they pay: card carries a fee, mobile is free and quick, cash is cash.
  const method = withRng(state, 'customers', (r) => { const x = r.next(); return x < 0.55 ? 'card' : x < 0.75 ? 'mobile' : 'cash'; });
  const fee = method === 'card' ? Math.round(total * CARD_FEE * 100) / 100 : 0;
  state.today.other += fee;
  state.cash += total - fee;
  // Receipts and wrappers: a litter bin or two catches most of them.
  const bins = Math.min(2, state.shop.fixtures.filter((f) => f.type === 'bin').length);
  state.shop.cleanliness = Math.max(0.2, state.shop.cleanliness - 0.004 * (1 - 0.3 * bins) * grimeFactor(state));
  state.today.revenue += total; state.today.cogs += cogs; state.today.itemsSold += units; state.today.served++;
  p.paid = true;
  const waited = p.maxPatience && p.patience !== undefined ? 1 - p.patience / p.maxPatience : 0;
  if (p.queuedTick !== undefined) {
    const w = (state.tick - p.queuedTick) * TICK;
    state.scores.waitSum += w; state.scores.waitSamples++;
    state.scores.avgWait = state.scores.waitSum / state.scores.waitSamples;
  }
  const sat = Math.max(0, Math.min(1, 1 - waited * 0.6 - (p.missed ?? 0) * 0.15));
  if (sat > 0.9) react(state, p.id, 'love');
  state.today.satisfaction += sat; state.today.satisfactionN++;
  const c = fixtureCentre(state.shop, reg);
  popup(state, c, `${formatMoney(total, { sign: true })}${method === 'cash' ? '' : method === 'card' ? ' card' : ' tap'}`, 'money', 1.1);
  cue(state, 'cash');
  reg.serving = null; reg.scanned = 0;
  if (!state.tutorial.completed.includes('ringUp')) completeTutorial(state, 'ringUp');
  if (coffee && cafe) { p.rest = { kind: 'cafe', fixtureId: cafe.f.id, seat: cafe.seat }; p.state = 'resting'; p.anim = 'walk'; p.timer = -1; setPath(state, p, seatApproach(state, cafe.f)); return; }
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
    popup(state, { x: d.x, z: d.z - 1 }, `${dollars(reward, true)} tip bonus`, 'money', 1.6);
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
      if (car.state === 'parked' && car.lot === 'street') {
        // Parked on Elm Street: onto the sidewalk and round to the shop on foot.
        p.x = SIDEWALK_E_X; p.z = car.z;
        const entry = frontageEntry(state, { x: p.x, z: p.z });
        const r = route({ x: p.x, z: p.z }, entry);
        p.path = r.path; p.xings = r.xings; p.pathIdx = 0;
        p.state = 'walking'; p.anim = 'walk';
        break;
      }
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
      if (walkStreet(p, p.speed, state.tick)) {
        p.xings = undefined;
        const rack = p.bike && p.riding ? state.shop.fixtures.find((f) => f.id === p.bike!.rackId) : undefined;
        // By bike: over to the rack first.
        if (rack) { const sp = standPoint(rack, p.bike!.slot); p.state = 'toRack'; setPath(state, p, toWorld(state.shop, sp.rider.x, sp.rider.z), dyn); break; }
        if (p.riding) { p.riding = false; p.speed /= BIKE_SPEED; p.bike = null; }
        p.state = 'toDoor'; p.anim = 'walk'; setPath(state, p, doorOutside(state, p.id), dyn);
      }
      break;
    }
    case 'toRack': {
      // Off the bike and lock it to the stand, then in on foot.
      if (followPath(p, p.speed, dt, 12, 0.22)) { p.riding = false; p.speed /= BIKE_SPEED; p.state = 'toDoor'; p.anim = 'walk'; setPath(state, p, doorOutside(state, p.id), dyn); }
      break;
    }
    case 'toBike': {
      if (followPath(p, p.speed, dt, 12, 0.22)) {
        // Unlock the bike and ride off home along the streets.
        const rack = state.shop.fixtures.find((f) => f.id === p.bike?.rackId);
        if (rack?.bikes && p.bike) rack.bikes[p.bike.slot] = null;
        p.bike = null; p.riding = true; p.speed *= BIKE_SPEED; p.anim = 'sit';
        const end = streetStart(state, 'customers', false, true);
        const entry = frontageEntry(state, end);
        setPath(state, p, entry, dyn);
        const rt = route(entry, end, withRng(state, 'customers', (r) => r.chance(0.5)));
        const base = p.path.length;
        p.path.push(...rt.path); p.xings = rt.xings.map((i) => i + base);
        p.state = 'toCar'; p.carId = null;
      }
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
        // A basket or a trolley by the door, music, the promo screen: lists grow on the way in.
        onEnter(state, p);
        // A messy floor is the first thing they see.
        if (state.shop.cleanliness < 0.6 || state.shop.litter.length >= 2) { complain(state, 'dirty'); p.sawMess = true; }
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
      // Walked a long way round a big shop: a sit on a bench, if there is one free nearby.
      if (!p.rested && (p.walked ?? 0) > 16) {
        p.rested = true;
        const s = freeSeat(state, p, ['bench', 'sofa']);
        if (s) { p.rest = { kind: 'seat', fixtureId: s.f.id, seat: s.seat }; p.state = 'resting'; p.anim = 'walk'; p.timer = -1; setPath(state, p, seatApproach(state, s.f), dyn); break; }
      }
      const item = list[p.listIdx!]!;
      const f = findFixtureWith(state, item.productId);
      // Not on the shelves but on the pallet: the help desk fetches it.
      if (!f && state.shop.storage.some((e) => e.productId === item.productId && e.qty > 0)) {
        const desk = freeDesk(state);
        if (desk) { p.rest = { kind: 'desk', fixtureId: desk.id, seat: 0, productId: item.productId }; p.state = 'resting'; p.anim = 'walk'; p.timer = -1; setPath(state, p, fixtureAccessWorld(state.shop, desk, p, gridFor(state)), dyn); break; }
      }
      if (!f) { p.missed = (p.missed ?? 0) + 1; noteId(p, 'missedIds', item.productId); state.today.missedItems++; complain(state, 'outOfStock', item.productId); p.listIdx!++; react(state, p.id, 'outOfStock'); break; }
      p.targetFixture = f.id;
      p.state = 'browsing'; p.anim = 'walk'; p.timer = -1;
      // From the room side: a shelf pushed against a wall is never browsed through it.
      setPath(state, p, fixtureAccessWorld(state.shop, f, p, gridFor(state)), dyn);
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
        const fair = !slot || willBuy(state, p.ctype ?? 'convenience', item.productId);
        if (slot && !fair) { complain(state, 'pricey', item.productId); react(state, p.id, 'pricey'); noteId(p, 'priceyIds', item.productId); }
        if (slot && fair && spent + price <= (p.budget ?? 999)) {
          if (price < productDef(item.productId).basePrice * 0.92) react(state, p.id, 'deal');
          const promo = state.marketing.promotion;
          const want = promo && promo.kind === 'buyTwo' && promo.productId === item.productId ? Math.max(2, item.qty) : item.qty;
          const take = Math.min(slot.qty, want, Math.max(1, Math.floor(((p.budget ?? 999) - spent) / price)));
          slot.qty -= take;
          p.basket!.push({ productId: item.productId, qty: take, price });
          cue(state, 'pick');
        } else if (!slot) { p.missed = (p.missed ?? 0) + 1; noteId(p, 'missedIds', item.productId); state.today.missedItems++; complain(state, 'outOfStock', item.productId); react(state, p.id, 'outOfStock'); }
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
      p.patience = (p.patience ?? 100) - dt * queueDrain(state);
      if (p.patience <= 0) {
        state.today.walkedOut++; complain(state, 'queue');
        react(state, p.id, 'queue');
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
        p.patience = (p.patience ?? 100) - dt * queueDrain(state);
        if (p.patience <= 0) {
          state.today.walkedOut++; complain(state, 'queue');
          react(state, p.id, 'queue');
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
        // Came by bike: back to it.
        const rack = p.bike ? state.shop.fixtures.find((f) => f.id === p.bike!.rackId) : undefined;
        if (rack) { const sp = standPoint(rack, p.bike!.slot); p.state = 'toBike'; p.anim = p.anim === 'carry' ? 'carry' : 'walk'; setPath(state, p, toWorld(state.shop, sp.rider.x, sp.rider.z), dyn); break; }
        if (p.carId !== null && p.carId !== undefined) {
          const car = state.cars.find((c) => c.id === p.carId);
          if (car && car.lot === 'street') {
            // Back round to Elm Street on foot.
            const side = { x: SIDEWALK_E_X, z: car.z };
            const entry = frontageEntry(state, side);
            setPath(state, p, entry, dyn);
            const rt = route(entry, side);
            const base = p.path.length;
            p.path.push(...rt.path, { x: car.x + 0.55, z: car.z }); p.xings = rt.xings.map((i) => i + base);
            p.state = 'toCar'; p.anim = p.anim === 'carry' ? 'carry' : 'walk';
            break;
          }
          if (car) { p.state = 'toCar'; p.anim = p.anim === 'carry' ? 'carry' : 'walk'; setPath(state, p, { x: car.x + 0.75, z: car.z + 0.55 }, dyn); break; }
        }
        // On foot: out to the sidewalk, then off along the streets until out of sight.
        const end = streetStart(state, 'customers');
        const entry = frontageEntry(state, end);
        setPath(state, p, entry, dyn);
        const rt = route(entry, end, withRng(state, 'customers', (r) => r.chance(0.5)));
        const base = p.path.length;
        p.path.push(...rt.path); p.xings = rt.xings.map((i) => i + base);
        p.state = 'toCar';
        p.carId = null;
      }
      break;
    }
    case 'resting': restStep(state, p, dyn); break;
    case 'fleeing': fleeStep(state, p, dyn); break;
    case 'toCar': {
      if (walkStreet(p, p.speed, state.tick)) {
        const car = state.cars.find((c) => c.id === p.carId);
        // Bags into the boot first: a moment at the back of the car, then away.
        if (car && p.paid && (p.basket?.length ?? 0) > 0) { p.state = 'loading'; p.anim = 'pay'; p.timer = 1.2; p.yaw = Math.atan2(car.x - p.x, car.z - p.z); break; }
        if (car) leaveLot(state, car);
        p.state = 'gone';
      }
      break;
    }
    case 'loading': {
      p.timer -= dt;
      if (p.timer <= 0) {
        const car = state.cars.find((c) => c.id === p.carId);
        if (car) leaveLot(state, car);
        p.basket = []; p.state = 'gone';
      }
      break;
    }
    default: break;
  }
}

/**
 * Sitting down or asking at the help desk: walk over, then sit (or wait at the desk) for a moment.
 * A rest gives back patience for the queue; the desk hands over one from the pallet; a coffee is drunk
 * before they head home.
 */
function restStep(state: GameState, p: Person, dyn: Set<number>): void {
  const rest = p.rest;
  const f = rest ? state.shop.fixtures.find((x) => x.id === rest.fixtureId) : undefined;
  const done = () => { p.rest = null; if (rest?.kind === 'cafe') startLeaving(state, p, true); else { p.state = 'shopping'; p.anim = 'walk'; } };
  if (!rest || !f) { done(); return; }
  if (p.timer < 0) {
    if (!followPath(p, p.speed, TICK, 12, 0.22)) return;
    if (rest.kind === 'desk') {
      const c = fixtureCentre(state.shop, f); p.yaw = Math.atan2(c.x - p.x, c.z - p.z);
      p.anim = 'pay'; p.timer = 3;
    } else {
      const pose = seatPose(state, f, rest.seat);
      p.x = pose.at.x; p.z = pose.at.z; p.yaw = pose.yaw;
      p.anim = 'sit'; p.timer = rest.kind === 'cafe' ? 7 : 4;
    }
    return;
  }
  p.timer -= TICK;
  if (p.timer > 0) return;
  if (rest.kind === 'desk') {
    // Fetched from the pallet: one in the basket, or (it went meanwhile) missed after all.
    const got = rest.productId ? fetchFromPallet(state, rest.productId) : null;
    if (got) { (p.basket ??= []).push(got); popup(state, { x: p.x, z: p.z }, 'Found it!', 'money', 1.1); }
    else if (rest.productId) { p.missed = (p.missed ?? 0) + 1; noteId(p, 'missedIds', rest.productId); state.today.missedItems++; complain(state, 'outOfStock', rest.productId); }
    p.listIdx = (p.listIdx ?? 0) + 1;
  } else {
    const max = p.maxPatience ?? 100, bonus = REST_BONUS[f.type] ?? 0.2;
    p.patience = Math.min(max * 1.4, (p.patience ?? max) + bonus * max);
  }
  // Back on their feet in front of it.
  if (rest.kind !== 'desk') { const a = seatApproach(state, f); p.x = a.x; p.z = a.z; }
  void dyn;
  done();
}

function tickWalker(state: GameState, p: Person): void {
  if (p.rivalId) { tickRivalShopper(state, p); return; }
  // Town life: drivers out arguing after a bump, teenagers hanging about, a dog that needs to stop.
  if (p.life === 'driver') { driverStep(p); return; }
  if (p.life === 'teen' && teenStep(state, p) === 'stay') return;
  if (dogWalk(state, p)) return;
  if (p.path.length === 0) return;
  if (walkStreet(p, p.speed, state.tick) && !arriveAtHangout(p)) p.state = 'gone';
}

/** Direct steering (WASD): slide along walls and fixtures instead of stopping dead. */
function steer(state: GameState, p: Person, dyn: Set<number>): void {
  // Walls from the grid; the furniture by the shape of each model, so you can walk right up to any of it.
  const g = wallGridFor(state);
  const d = p.moveDir!;
  // Pushing into the stairs at their foot (or their top, or a lift's door): ride them. Off at the other end,
  // not again till they let go or step clear and back (sliding along a lift's doors is not stepping back on).
  if (p.rideLock && Math.hypot(p.x - p.rideLock.x, p.z - p.rideLock.z) > RIDE_REACH + 0.1) p.rideLock = undefined;
  const ride = p.rideLock ? null : rideAt(state, p, d);
  if (ride) { startRide(state, p, ride); p.rideLock = { x: ride.x, z: ride.z }; p.anim = p.carrying ? 'carry' : 'walk'; if (p.task && !p.carrying) p.task = null; return; }
  const len = Math.hypot(d.x, d.z) || 1;
  const step = (p.speed * TICK) / Math.max(1, state.timeScale || 1);
  const dx = (d.x / len) * step, dz = (d.z / len) * step;
  const others = state.people.filter((o) => o !== p && o.kind !== 'walker' && o.state !== 'driving' && o.state !== 'gone' && Math.abs(o.x - p.x) < 1 && Math.abs(o.z - p.z) < 1);
  const near = (f: Fixture) => { const c = fixtureCentre(state.shop, f); return Math.abs(c.x - p.x) < 2.5 && Math.abs(c.z - p.z) < 2.5; };
  const bodies = state.shop.fixtures.filter((f) => !FIXTURES[f.type].walkable && near(f)).map((f) => solidRect(f) ?? footprintOf(f.type, f.x, f.z, f.rot));
  const gap = (x: number, z: number) => {
    const l = toLocal(state.shop, x, z);
    let d = Infinity;
    for (const b of bodies) d = Math.min(d, Math.hypot(Math.max(b.x0 - l.x, 0, l.x - b.x1), Math.max(b.z0 - l.z, 0, l.z - b.z1)));
    return d;
  };
  const free = (x: number, z: number) => {
    // People are solid: you can step away from someone you touch, never into them.
    const gd = gap(x, z);
    if (gd < 0.17 && gd < gap(p.x, p.z)) return false;
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
/**
 * What is on the pallets, product by product, the most needed first: the emptiest shelf slot it
 * fills, then the ones not on a shelf yet.
 */
export function palletChoices(state: GameState): { productId: string; qty: number }[] {
  const have = new Map<string, number>();
  for (const e of state.shop.storage) if (e.qty > 0) have.set(e.productId, (have.get(e.productId) ?? 0) + e.qty);
  // Ties go to the shelf slot met first, the way the shop is laid out.
  const gap = new Map<string, { gap: number; first: number }>();
  let k = 0;
  for (const f of state.shop.fixtures) for (const sl of f.slots) {
    k++;
    if (!sl.productId || !have.has(sl.productId)) continue;
    const g = FIXTURES[f.type].capacity - sl.qty, cur = gap.get(sl.productId);
    if (!cur || g > cur.gap) gap.set(sl.productId, { gap: g, first: cur && g <= cur.gap ? cur.first : k });
  }
  const key = (id: string) => gap.get(id) ?? { gap: -2, first: Infinity };
  return [...have.entries()].map(([productId, qty]) => ({ productId, qty })).sort((a, b) => (key(b.productId).gap - key(a.productId).gap) || (key(a.productId).first - key(b.productId).first));
}

/** The box to pick up next: the most needed, or (just after putting one back) the next product along. */
export function neediestInStorage(state: GameState, after?: string | null): string | null {
  const list = palletChoices(state);
  if (!list.length) return null;
  const i = after ? list.findIndex((c) => c.productId === after) : -1;
  return list[i >= 0 ? (i + 1) % list.length : 0]!.productId;
}

/** Why a product cannot go on a kind of fixture, in a few words (null when it can). */
export function wrongFixture(productId: string, type: Fixture['type']): string | null {
  const def = productDef(productId), fdef = FIXTURES[type];
  if (!fdef.slots) return 'That does not hold stock.';
  if (def.chilled && !fdef.chilled) return `${def.name} needs a chiller`;
  if (!def.chilled && fdef.chilled) return `${def.name} does not go in the chiller`;
  if (fdef.accepts && !fdef.accepts.includes(def.category)) return `${def.name} does not go on the ${fdef.name.toLowerCase()}`;
  return null;
}

/** Is someone close enough to the delivery pallet to reach it? */
function atPallet(state: GameState, p: Person): boolean {
  const d = state.shop.delivery;
  const lo = toLocal(state.shop, p.x, p.z);
  const zone = toWorld(state.shop, Math.max(d.x0, Math.min(d.x1, lo.x)), Math.max(d.z0, Math.min(d.z1, lo.z)));
  if (Math.hypot(p.x - zone.x, p.z - zone.z) <= 1.4) return true;
  // Or by any of the extra pallets (the stock on them is one pool).
  return state.shop.fixtures.some((f) => f.type === 'pallet' && Math.max(Math.abs(lo.x - (f.x + 0.5)), Math.abs(lo.z - (f.z + 0.5))) <= 1.3);
}

/** Put the box you are holding back on the pallet (in person: next to it), hands empty after. */
export function ownerPutBack(state: GameState): string | null {
  const o = state.people.find((x) => x.kind === 'owner');
  if (!o) return 'Nobody to carry.';
  if (!o.carrying) return 'You are not holding a box.';
  if (!atPallet(state, o)) return 'Walk over to the pallet first.';
  const { productId, qty } = o.carrying;
  const same = state.shop.storage.find((e) => e.productId === productId && e.day === state.day);
  if (same) same.qty += qty; else state.shop.storage.push({ productId, qty, day: state.day });
  o.carrying = null;
  o.anim = 'idle';
  cue(state, 'thud');
  return null;
}

/** Pick up a box from the delivery zone (in person: you must be standing next to it). */
export function ownerPickUp(state: GameState, productId?: string): string | null {
  const o = state.people.find((x) => x.kind === 'owner');
  if (!o) return 'Nobody to carry.';
  if (!atPallet(state, o)) return 'Walk over to the boxes first.';
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
  const wrong = wrongFixture(o.carrying.productId, f.type);
  if (wrong) return `${wrong}.`;
  const left = placeOnFixture(state, f, o.carrying.productId, o.carrying.qty, mayTakeOver(state, o, f, o.carrying.productId));
  if (left === o.carrying.qty) {
    // Nothing went on: either every slot is full, or the room left is all in slots of other products.
    const full = f.slots.every((sl) => sl.productId && sl.qty >= fdef.capacity);
    return full ? 'That one is full.' : `No room for ${def.name} there: every spot holds something else.`;
  }
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

/** A cashier's till has nobody at it or waiting. */
export function tillIdle(state: GameState, p: Person): boolean {
  const reg = state.shop.fixtures.find((f) => f.staffId === p.id);
  return !reg || (!reg.serving && !(reg.queue?.length));
}

/**
 * The spill this worker should mop: the nearest one nobody else is on their way to. A cleaner goes
 * anywhere in the shop for one; a cashier only steps a few metres from the till.
 */
function spillFor(state: GameState, p: Person): { id: number; x: number; z: number } | null {
  const reach = p.role === 'cleaner' ? Infinity : p.role === 'cashier' ? 4 : 9;
  let best: { id: number; x: number; z: number } | null = null, bestD = reach;
  for (const l of state.shop.litter) {
    if (state.people.some((o) => o !== p && o.state === 'toStock' && o.timer === -2 && o.targetFixture === l.id)) continue;
    const d = dist(p, l);
    if (d < bestD) { best = l; bestD = d; }
  }
  return best;
}

/** Where a worker stands when idle. */
function homeOf(state: GameState, p: Person): Vec2 {
  const reg = state.shop.fixtures.find((f) => f.type === 'register');
  if (p.kind === 'owner') return { x: p.x, z: p.z }; // the manager stays where the player leaves them
  switch (p.role) {
    case 'cashier': { const mine = state.shop.fixtures.find((f) => f.staffId === p.id); if (mine) return fixtureBackWorld(state.shop, mine); if (!reg) return storeroomPoint(state); break; }
    case 'stocker': { const sp = storeroomPoint(state); return { x: sp.x + 0.8, z: sp.z + 0.4 }; }
    case 'cleaner': { const d = doorInside(state); return { x: d.x - 1.2, z: d.z - 0.3 }; }
  }
  // Everyone else, and a spare cashier with no till of their own: by the pallet.
  const sp = storeroomPoint(state); return { x: sp.x + 2.2, z: sp.z + 0.6 };
}

/** A cashier on shift without a till takes one nobody on shift is working (its own cashier's shift is over). */
function takeTill(state: GameState, p: Person): void {
  if (p.kind !== 'staff' || p.role !== 'cashier' || !onShift(p, state.time) || state.shop.fixtures.some((f) => f.staffId === p.id)) return;
  const till = state.shop.fixtures.find((f) => (f.type === 'register' || f.type === 'kiosk') && (() => {
    if (!f.staffId) return true;
    const o = state.people.find((x) => x.id === f.staffId);
    return !o || !onShift(o, state.time);
  })());
  if (till) till.staffId = p.id;
}
/** A cashier who has no till to work (a spare): they lend a hand on the floor instead. */
function spareCashier(state: GameState, p: Person): boolean {
  return p.role === 'cashier' && !state.shop.fixtures.some((f) => f.staffId === p.id);
}

/** Workers (the owner and staff): stand at their post, carry stock, clean up. */
function tickWorker(state: GameState, p: Person, dyn: Set<number>): void {
  const dt = TICK;
  if (p.kind === 'owner' && !(p.moveDir && (p.moveDir.x !== 0 || p.moveDir.z !== 0))) p.rideLock = undefined;
  if (p.kind === 'owner' && p.climb === undefined && p.moveDir && (p.moveDir.x !== 0 || p.moveDir.z !== 0)) { steer(state, p, dyn); return; }
  if (p.kind === 'owner' && p.state === 'walking') {
    // Click-to-move.
    if (followPath(p, p.speed / Math.max(1, state.timeScale || 1), dt, 12, 0.15)) { p.state = 'idle'; p.anim = p.carrying ? 'carry' : 'idle'; }
    else p.anim = p.carrying ? 'carry' : 'walk';
    return;
  }
  // Off shift: stand out by the back door (or walk there), do nothing else.
  if (p.kind === 'staff' && !onShift(p, state.time)) {
    const s = state.shop; const off = toWorld(s, s.backDoor.x + 1.6, s.backDoor.z - 1.0);
    if (p.task || p.carrying) { if (p.carrying) { state.shop.storage.push({ productId: p.carrying.productId, qty: p.carrying.qty, day: state.day }); p.carrying = null; } p.task = null; }
    if (dist(p, off) > 0.4) { if (p.state !== 'toRegister' || p.pathIdx >= p.path.length) { p.state = 'toRegister'; p.anim = 'walk'; setPath(state, p, off, dyn); } followPath(p, p.speed, dt, 12, 0.22); }
    else { p.state = 'idle'; p.anim = 'idle'; }
    return;
  }
  // A shoplifter making a run for it: whoever has nothing on goes after them.
  if (p.kind === 'staff') {
    if (p.chase !== undefined && p.chase !== null) { chaseStep(state, p, dyn); return; }
    const thief = isFree(state, p) ? fleeingThief(state, p) : null;
    if (thief) { p.chase = thief.id; p.state = 'chasing'; chaseStep(state, p, dyn); return; }
  }
  takeTill(state, p);
  const home = homeOf(state, p);
  const floorHand = p.kind === 'staff' && (p.role !== 'cashier' || spareCashier(state, p));
  // Anyone with nothing on finds something to do: shelves to fill (everyone but a cashier, who keeps
  // to the till; a spare cashier with no till helps), a spill to mop (cleaners see to spills first and go furthest for one), and failing
  // all that, now and then a shelf to tidy, so nobody just stands about.
  if ((p.state === 'idle' || p.state === 'toRegister') && !p.task) {
    const spill = () => (p.state === 'idle' && state.shop.litter.length && isFree(state, p) ? spillFor(state, p) : null);
    const mop = (l: { id: number; x: number; z: number }) => {
      p.state = 'toStock'; p.anim = 'walk'; p.timer = -2; // -2 marks a cleaning trip
      p.targetFixture = l.id; p.idleFor = 0;
      setPath(state, p, { x: l.x, z: l.z }, dyn);
    };
    if (p.kind === 'staff' && p.role === 'cleaner') { const l = spill(); if (l) { mop(l); return; } }
    if (floorHand && onShift(p, state.time)) {
      let best: { f: Fixture; ratio: number } | null = null;
      for (const f of state.shop.fixtures) {
        const def = FIXTURES[f.type]; if (!def.slots) continue;
        const cap = def.slots * def.capacity; const have = f.slots.reduce((a, sl) => a + sl.qty, 0);
        const ratio = have / cap;
        // Any shelf with room for something on the pallet, the emptiest first.
        if (ratio < 1 && (!best || ratio < best.ratio) && pickCarryTask(state, f)) best = { f, ratio };
      }
      if (best) { const t = pickCarryTask(state, best.f)!; p.task = { type: 'carry', fixtureId: best.f.id, productId: t.productId, qty: t.qty }; p.idleFor = 0; }
    }
    if (!p.task) { const l = spill(); if (l) { mop(l); return; } }
    // Nothing doing: after a while at their post, off to straighten a shelf (not a cashier).
    if (!p.task && floorHand && p.state === 'idle' && dist(p, home) <= 0.35 && isFree(state, p)) {
      p.idleFor = (p.idleFor ?? 0) + dt;
      if (p.idleFor > 9) {
        const shelves = state.shop.fixtures.filter((f) => FIXTURES[f.type].slots > 0);
        const f = shelves.length ? withRng(state, 'tidy', (r) => r.pick(shelves)) : null;
        p.idleFor = withRng(state, 'tidy', (r) => -r.range(0, 8));
        if (f) {
          p.state = 'toStock'; p.anim = 'walk'; p.timer = -3; // -3 marks tidying a shelf
          p.targetFixture = f.id;
          setPath(state, p, fixtureAccessWorld(state.shop, f, p, gridFor(state)), dyn);
          return;
        }
      }
    }
  }
  switch (p.state) {
    case 'idle': {
      if (p.task && p.carrying) {
        // Already holding stock: take it straight to the shelf.
        const f = state.shop.fixtures.find((x) => x.id === p.task!.fixtureId);
        if (f) { p.state = 'carrying'; p.anim = 'carry'; setPath(state, p, fixtureAccessWorld(state.shop, f, p, gridFor(state)), dyn); }
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
      // A cashier off mopping goes straight back when someone comes to pay.
      if (p.timer === -2 && ((p.role === 'cashier' && !tillIdle(state, p)) || !state.shop.litter.some((x) => x.id === p.targetFixture))) { p.state = 'idle'; p.timer = 0; p.targetFixture = null; p.path = []; p.pathIdx = 0; break; }
      if (followPath(p, p.speed, dt, 12, 0.22)) {
        if (p.timer === -3) {
          // Tidying: face the shelf and straighten it for a moment.
          const f = state.shop.fixtures.find((x) => x.id === p.targetFixture);
          if (f) { const c = fixtureCentre(state.shop, f); p.yaw = Math.atan2(c.x - p.x, c.z - p.z); }
          p.state = 'stocking'; p.anim = 'browse'; p.timer = 2.5; p.task = null; p.targetFixture = null;
          break;
        }
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
        setPath(state, p, fixtureAccessWorld(state.shop, f, p, gridFor(state)), dyn);
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
          if (drop) { popup(state, { x: p.x, z: p.z }, 'Dropped one', 'bad', 1.1); addSpill(state, p.x, p.z); }
          const left = placeOnFixture(state, f, p.carrying.productId, Math.max(0, p.carrying.qty - drop), mayTakeOver(state, p, f, p.carrying.productId));
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
/**
 * The slots a product can go into, in the order they are filled: the ones already holding it that
 * have room, then empty ones, then ones sold out of something else.
 */
function slotsFor(f: Fixture, productId: string, takeOver = true): Slot[] {
  const cap = FIXTURES[f.type].capacity;
  return [
    ...f.slots.filter((sl) => sl.productId === productId && sl.qty < cap),
    ...f.slots.filter((sl) => !sl.productId),
    // A sold-out slot goes to another product only when the manager says so, or (staff) for one new to the shop.
    ...(takeOver ? f.slots.filter((sl) => sl.productId && sl.productId !== productId && sl.qty === 0) : []),
  ];
}

/** How many of a product would fit on this fixture right now. */
export function roomOnFixture(f: Fixture, productId: string): number {
  const cap = FIXTURES[f.type].capacity;
  return slotsFor(f, productId).reduce((a, sl) => a + cap - (sl.productId === productId ? sl.qty : 0), 0);
}

/**
 * Put stock on a fixture, topping up its slots of that product and then taking free ones, until the
 * box is empty or nothing more fits. A full slot of the product no longer turns the box away while
 * the shelf beside it is empty. Returns how many are left over.
 */
export function placeOnFixture(state: GameState, f: Fixture, productId: string, qty: number, takeOver = true): number {
  const cap = FIXTURES[f.type].capacity;
  let left = qty;
  for (const slot of slotsFor(f, productId, takeOver)) {
    if (left <= 0) break;
    if (slot.productId !== productId) { slot.productId = productId; slot.qty = 0; }
    const put = Math.min(cap - slot.qty, left);
    slot.qty += put; left -= put;
  }
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
  // Else a slot nothing has been put in yet, with any fitting product not already here; or a sold-out
  // slot with a product new to the shop (one already on another shelf never takes a sold-out product's
  // place, or the range would shrink to whatever the pallet has most of).
  if (f.slots.some((s) => !s.productId)) {
    const entry = storage.find((e) => fits(e.productId) && !f.slots.some((s) => s.productId === e.productId && s.qty > 0));
    if (entry) return { productId: entry.productId, qty: Math.min(def.capacity, entry.qty, 8) };
  }
  if (f.slots.some((s) => s.productId && s.qty === 0)) {
    const entry = storage.find((e) => fits(e.productId) && !shelvedAnywhere(state, e.productId));
    if (entry) return { productId: entry.productId, qty: Math.min(def.capacity, entry.qty, 8) };
  }
  return null;
}

/**
 * May this box go into a slot sold out of something else? Only when it is on purpose: the manager
 * stocking a shelf that has none of the product yet, or staff shelving a product new to the shop.
 * Otherwise what is left over goes back on the pallet, so a sold-out product keeps its place and the
 * range never shrinks to whatever there is most of.
 */
function mayTakeOver(state: GameState, p: Person, f: Fixture, productId: string): boolean {
  return p.kind === 'owner' ? !f.slots.some((s) => s.productId === productId) : !shelvedAnywhere(state, productId);
}

/** Is a product on a shelf anywhere in the shop, even sold out there? */
function shelvedAnywhere(state: GameState, productId: string): boolean {
  return state.shop.fixtures.some((f) => f.slots.some((s) => s.productId === productId));
}

function separate(state: GameState, dyn: Set<number>): void {
  const g = gridFor(state);
  const movers = state.people.filter((p) => p.kind !== 'walker' && p.state !== 'driving' && p.state !== 'queued' && p.state !== 'paying' && p.state !== 'gone' && !(p.state === 'resting' && p.timer > 0) && p.climb === undefined);
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
  // Out on the streets (waiting at a kerb, off at a rival's) nobody is stuck: the grid only covers our plot.
  if (p.kind === 'walker' || p.heldAnim || (p.xings && p.xings.length) || p.state === 'walking') { p.stuckTicks = 0; return; }
  const moving = p.climb === undefined && p.path.length > 0 && p.pathIdx < p.path.length && p.state !== 'queued' && p.state !== 'paying' && p.state !== 'driving' && p.state !== 'browsing' && p.state !== 'pickBox' && p.state !== 'stocking';
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
    if (!rideStep(state, p)) switch (p.kind) {
      case 'customer': tickCustomer(state, p, dyn); break;
      case 'walker': tickWalker(state, p); break;
      case 'owner': tickWorker(state, p, dyn); break;
      case 'staff': tickWorker(state, p, dyn); break;
    }
    watchdog(state, p, dyn);
  }
  separate(state, dyn);
  if (state.people.some((p) => p.state === 'gone')) { state.people = state.people.filter((p) => p.state !== 'gone'); pruneTills(state); freeStands(state); }
}
