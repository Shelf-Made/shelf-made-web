/**
 * Town life: the small things that happen round the crossroads on any day, none of them the player's
 * doing. Dog walkers stop while the dog does its business on the verge (some bag it, some don't).
 * After school a few teenagers hang about somewhere (the bus stop, a rival's door, right outside your
 * shop), smoking, dropping cans and wrappers, until they drift off or you ask them to move along. Now
 * and then a driver bumps the car in front in a queue on Main Road: both stop with their hazards on,
 * the drivers get out and argue over it, then they drive on (the traffic behind waits).
 *
 * The mess stays where it falls until the town is swept overnight; in front of your shop, shoppers
 * pull a face at it (and you can pick it up). Everything here draws on its own random stream, so the
 * day's trade, traffic and walkers roll exactly as they would without it.
 */
import type { GameState, Person, Vec2, Car } from './types';
import { withRng, nextId, popup, cue, react, complain } from './state';
import { route, onZebra, LEGS, LEG_END, legOf } from './streets';
import { toWorld, toLocal, FRONT_WALK_Z, BUS_STOP, SIDE_HALF, ROAD_Z, PLOT_RECT, TICK } from './layout';
import { CUSTOMER_MODELS, doorOutside } from './people';

export type TownLitterKind = 'poop' | 'can' | 'wrapper' | 'butt';
export interface TownLitter { id: number; kind: TownLitterKind; x: number; z: number; yaw: number }
/** A group of teenagers hanging about at a spot until `until` (game seconds into the day). */
export interface Hangout { id: number; x: number; z: number; until: number; teens: number[]; nextLitter: number; mine: boolean; where: string }
/** Two cars that bumped, stopped in the road until `until`. */
export interface Bump { id: number; a: number; b: number; x: number; z: number; until: number }
export interface TownLife { litter: TownLitter[]; hangouts: Hangout[]; bumps: Bump[]; nextTeens: number; nextBump: number }

/** Most pieces of town litter at once (the oldest is swept away first). */
const MAX_LITTER = 60;

export function lifeOf(state: GameState): TownLife {
  state.life ??= { litter: [], hangouts: [], bumps: [], nextTeens: 330, nextBump: 90 };
  return state.life;
}

/** Is a point on the player's frontage (the pavement, apron and lot in front of the shop)? */
export function onFrontage(state: GameState, p: Vec2): boolean {
  const l = toLocal(state.shop, p.x, p.z);
  return l.x > PLOT_RECT.x0 - 0.5 && l.x < PLOT_RECT.x1 + 0.5 && l.z > state.shop.floor.z1 - 0.2 && l.z < FRONT_WALK_Z + 0.45;
}

/** Drop a piece of litter in town. */
export function dropLitter(state: GameState, kind: TownLitterKind, at: Vec2): void {
  const life = lifeOf(state);
  const yaw = withRng(state, 'life', (r) => r.range(0, Math.PI * 2));
  life.litter.push({ id: nextId(state), kind, x: at.x, z: at.z, yaw });
  if (life.litter.length > MAX_LITTER) life.litter.shift();
  // Mess outside the door makes the shop look uncared for.
  if (onFrontage(state, at)) state.shop.cleanliness = Math.max(0, state.shop.cleanliness - (kind === 'poop' ? 0.02 : 0.01));
}

// ---- Dog walkers.

/** A new walker with a dog: whether (and after how long) the dog will need to stop. */
export function planDogStop(state: GameState, p: Person): void {
  if (!p.look.dog) return;
  withRng(state, 'life', (r) => { if (r.chance(0.55)) p.poopIn = r.range(4, 32); });
}

/**
 * A dog walker's step: stop on the pavement (never on a crossing or at a kerb) while the dog squats,
 * then walk on. Returns true while stopped (the walker does not move this tick).
 */
export function dogWalk(state: GameState, p: Person): boolean {
  if (p.dogStop !== undefined) {
    const before = p.dogStop;
    p.dogStop -= TICK;
    // Halfway through: the deed is done, and most owners bag it.
    if (before > 1.4 && p.dogStop <= 1.4) {
      const bag = withRng(state, 'life', (r) => r.chance(0.35));
      const at = { x: p.x - Math.sin(p.yaw) * 0.42 + Math.cos(p.yaw) * 0.3, z: p.z - Math.cos(p.yaw) * 0.42 - Math.sin(p.yaw) * 0.3 };
      if (!bag) dropLitter(state, 'poop', at);
    }
    if (p.dogStop <= 0) { p.dogStop = undefined; p.anim = p.heldAnim ?? 'walk'; p.heldAnim = undefined; return false; }
    return true;
  }
  if (p.poopIn === undefined) return false;
  p.poopIn -= TICK;
  const atKerb = !!(p.xings && p.xings.length && p.pathIdx > p.xings[0]!);
  if (p.poopIn <= 0 && !atKerb && !onZebra(p)) {
    p.poopIn = undefined;
    p.dogStop = 2.8;
    p.heldAnim = p.anim; p.anim = 'idle';
    return true;
  }
  return false;
}

// ---- Teenagers.

/** Where teenagers hang about: outside your shop, at the bus stop, or by an open rival's door. */
function hangoutSpot(state: GameState, r: { next(): number; pick<T>(a: T[]): T; range(a: number, b: number): number }): { at: Vec2; mine: boolean; where: string } {
  const k = r.next();
  if (k < 0.4) {
    // On the pavement in front of your shop, a little to one side of the door.
    const side = r.next() < 0.5 ? -1 : 1;
    return { at: toWorld(state.shop, state.shop.door.x + side * r.range(1.6, 3.2), FRONT_WALK_Z), mine: true, where: 'outside your shop' };
  }
  const open = state.rivals.filter((x) => x.open && x.boughtDay === undefined);
  // Beside the bus shelter (under its roof they would vanish from view).
  if (k < 0.7 || !open.length) return { at: { x: BUS_STOP.x + r.range(1.9, 2.8), z: BUS_STOP.z }, mine: false, where: 'at the bus stop' };
  const rv = r.pick(open);
  return { at: { x: rv.x + r.range(-1.2, 1.2), z: rv.z }, mine: false, where: `outside ${rv.name}` };
}

function spawnTeens(state: GameState): void {
  const life = lifeOf(state);
  withRng(state, 'life', (r) => {
    const spot = hangoutSpot(state, r);
    const leg = r.pick(LEGS);
    const from = LEG_END[legOf(spot.at) === leg ? LEGS[(LEGS.indexOf(leg) + 2) % LEGS.length]! : leg];
    const n = 2 + Math.floor(r.range(0, 3));
    const h: Hangout = { id: nextId(state), x: spot.at.x, z: spot.at.z, until: state.time + r.range(70, 150), teens: [], nextLitter: state.time + r.range(8, 18), mine: spot.mine, where: spot.where };
    for (let i = 0; i < n; i++) {
      // Each stands at their own place round a little circle, facing in.
      const a = (i / n) * Math.PI * 2 + r.range(-0.3, 0.3), rad = 0.42 + r.range(0, 0.12);
      const stand = { x: spot.at.x + Math.cos(a) * rad, z: spot.at.z + Math.sin(a) * rad * 0.7 };
      const rt = route(from, stand, r.chance(0.5));
      const start = { x: from.x + r.range(-0.4, 0.4), z: from.z + r.range(-0.4, 0.4) };
      const p: Person = {
        id: nextId(state), kind: 'walker', look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.8, 0.9) },
        x: start.x, z: start.z, yaw: 0, px: start.x, pz: start.z, state: 'walking', anim: 'walk',
        path: rt.path, xings: rt.xings, pathIdx: 0, speed: 1.1 * r.range(0.8, 0.95), timer: 0,
        life: 'teen', hangout: h.id, smoking: r.chance(0.55),
      };
      p.yaw = Math.atan2(p.path[0]!.x - p.x, p.path[0]!.z - p.z);
      state.people.push(p);
      h.teens.push(p.id);
    }
    life.hangouts.push(h);
  });
}

/** Send a group on its way: each teenager walks off along a street out of town. */
export function breakUp(state: GameState, h: Hangout): void {
  const life = lifeOf(state);
  withRng(state, 'life', (r) => {
    const leg = r.pick(LEGS);
    for (const id of h.teens) {
      const p = state.people.find((x) => x.id === id);
      if (!p) continue;
      const rt = route(p, LEG_END[leg], r.chance(0.5));
      p.path = rt.path; p.xings = rt.xings; p.pathIdx = 0; p.state = 'walking'; p.anim = 'walk'; p.hangout = undefined;
    }
  });
  life.hangouts = life.hangouts.filter((x) => x !== h);
}

/** The manager asks the group outside the shop to move along: they go (and the last one drops something on the way). */
export function moveAlong(state: GameState, hangoutId: number): boolean {
  const h = lifeOf(state).hangouts.find((x) => x.id === hangoutId);
  if (!h) return false;
  popup(state, { x: h.x, z: h.z }, 'Alright, alright…', 'info', 1.4);
  breakUp(state, h);
  return true;
}

/** A teenager's step: walk to the spot, then hang about there (facing the others). Walking off is ordinary walking. */
export function teenStep(state: GameState, p: Person): 'walk' | 'stay' {
  if (p.hangout === undefined) return 'walk';
  const h = lifeOf(state).hangouts.find((x) => x.id === p.hangout);
  if (!h) { p.hangout = undefined; return 'walk'; }
  if (p.state === 'idle') { p.yaw = Math.atan2(h.x - p.x, h.z - p.z); return 'stay'; }
  return 'walk';
}

/** The walk to the spot is over: stand there. */
export function arriveAtHangout(p: Person): boolean {
  if (p.life !== 'teen' || p.hangout === undefined) return false;
  p.state = 'idle'; p.anim = 'idle'; p.path = []; p.pathIdx = 0;
  return true;
}

// ---- Fender benders.

/** Is a car on Main Road, well clear of the junction (where a stopped car holds up only its own lane)? */
function onMainClear(c: Car): boolean { return Math.abs(c.z - ROAD_Z) < 1.6 && Math.abs(c.x) > SIDE_HALF + 4 && Math.abs(c.x) < 34; }

/** Screenshots: make two cars on Main Road (one close behind the other in a lane) have their bump now. */
export function stageBump(state: GameState): boolean {
  const passing = state.cars.filter((c) => c.state === 'passing' && onMainClear(c));
  for (const b of passing) for (const a of passing) {
    if (a === b || Math.abs(a.z - b.z) > 0.3) continue;
    const ahead = (a.x - b.x) * Math.sin(b.yaw);
    if (ahead < 1.5 || ahead > 8) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z), k = (d - 1.75) / d;
    b.x += (a.x - b.x) * k; b.z += (a.z - b.z) * k; b.px = b.x; b.pz = b.z;
    a.v = 0; b.v = 1; b.gap = 1.7; b.blocker = a.id;
    lifeOf(state).nextBump = 0;
    tryBump(state, true);
    return lifeOf(state).bumps.length > 0;
  }
  return false;
}

function tryBump(state: GameState, force = false): void {
  const life = lifeOf(state);
  // A car close behind another in a queue, still rolling when the one in front has stopped.
  // (Queued cars wait about two units apart, centre to centre; one still doing more than a crawl inside 2.8 is too close.)
  // Only cars driving through (or on their way out of town) can be held: they wait out their timer where they stand.
  const held = (c: Car) => (c.state === 'passing' || c.state === 'turnedAway' || c.state === 'leaving') && !c.reversing && c.timer <= 0 && onMainClear(c);
  // Nobody close behind it (a car stopping dead must not have another run into it), and slow enough that it stops short.
  const tailgated = (c: Car) => state.cars.some((t) => t.blocker === c.id && (t.v ?? 0) > 0.3 && (t.gap ?? Infinity) < 3.5);
  const cand = state.cars.filter((c) => held(c) && (c.v ?? 0) > 0.6 && (c.v ?? 0) < 1.8 && c.gap !== undefined && c.gap < 2.8 && !tailgated(c) && state.cars.some((a) => a.id === c.blocker && held(a) && (a.v ?? 0) < 0.8));
  if (!cand.length) return;
  withRng(state, 'life', (r) => {
    if (!force && !r.chance(0.6)) return;
    const b = r.pick(cand);
    const a = state.cars.find((c) => c.id === b.blocker);
    if (!a) return;
    // Bumper to bumper: the follower ends up touching the one it hit.
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > 1.76 && d < 2.3) { const k = (d - 1.75) / d; b.x += (a.x - b.x) * k; b.z += (a.z - b.z) * k; }
    // Six to eight minutes of game time at the roadside: over before the cars queued behind start to creep (eight).
    const dur = r.range(6, 8.2);
    for (const c of [a, b]) { c.timer = dur; c.v = 0; }
    const bump: Bump = { id: nextId(state), a: a.id, b: b.id, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, until: state.time + dur };
    life.bumps.push(bump);
    popup(state, { x: bump.x, z: bump.z }, 'Bump!', 'bad', 1.3);
    cue(state, 'thud');
    // The two drivers get out on the pavement side and have words.
    const kerb = Math.sign(a.z - ROAD_Z) || 1;
    for (const c of [a, b]) {
      const x = c.x, z = c.z + kerb * 0.75;
      state.people.push({
        id: nextId(state), kind: 'walker', look: { model: r.int(0, CUSTOMER_MODELS - 1), variant: r.int(0, 3), height: r.range(0.92, 1.08) },
        x, z, px: x, pz: z, yaw: 0, state: 'idle', anim: 'idle', path: [], pathIdx: 0, speed: 0, timer: dur - 0.6, life: 'driver', bumpId: bump.id,
      });
    }
    const drivers = state.people.slice(-2);
    drivers[0]!.yaw = Math.atan2(drivers[1]!.x - drivers[0]!.x, drivers[1]!.z - drivers[0]!.z);
    drivers[1]!.yaw = drivers[0]!.yaw + Math.PI;
    life.nextBump = state.time + r.range(220, 520);
  });
}

/** A driver out of their car: argue, then get back in (gone). */
export function driverStep(p: Person): void {
  p.timer -= TICK;
  if (p.timer <= 0) p.state = 'gone';
}

// ---- Each tick.

export function tickLife(state: GameState): void {
  const life = lifeOf(state);
  const day = state.phase === 'open' || state.phase === 'closing';
  // Once a second is plenty for everything below.
  if (state.tick % 20 !== 0) return;
  // After school: a group turns up somewhere, on most days.
  if (day && state.time > 330 && state.time < 640 && state.time >= life.nextTeens && life.hangouts.length === 0) {
    const go = withRng(state, 'life', (r) => { life.nextTeens = state.time + r.range(160, 420); return r.chance(0.75); });
    if (go) spawnTeens(state);
  }
  for (const h of [...life.hangouts]) {
    if (state.time >= h.until || !day) { breakUp(state, h); continue; }
    if (state.time >= h.nextLitter) {
      // Somebody drops something: a can, a wrapper, or (the smokers) a cigarette end.
      withRng(state, 'life', (r) => {
        h.nextLitter = state.time + r.range(12, 26);
        const here = h.teens.map((id) => state.people.find((p) => p.id === id)).filter((p): p is Person => !!p && p.state === 'idle');
        if (!here.length) return;
        const p = r.pick(here);
        const kind: TownLitterKind = p.smoking && r.chance(0.5) ? 'butt' : r.chance(0.5) ? 'can' : 'wrapper';
        const a = r.range(0, Math.PI * 2), d = r.range(0.3, 1.0);
        dropLitter(state, kind, { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d });
        p.throwTick = state.tick;
      });
    }
    // Hanging about outside your door: shoppers going past don't like it.
    if (h.mine) for (const c of state.people) if (c.kind === 'customer' && (c.state === 'toDoor' || c.state === 'leaving' || c.state === 'toCar') && Math.hypot(c.x - h.x, c.z - h.z) < 1.8) react(state, c.id, 'ew');
  }
  // Mess on your frontage: a shopper who steps near it pulls a face (and some say so).
  if (life.litter.length) {
    for (const c of state.people) {
      if (c.kind !== 'customer' || (c.state !== 'toDoor' && c.state !== 'leaving' && c.state !== 'toCar')) continue;
      const l = life.litter.find((x) => Math.abs(x.x - c.x) < 0.5 && Math.abs(x.z - c.z) < 0.5);
      if (!l || !onFrontage(state, l)) continue;
      react(state, c.id, 'ew');
      if (l.kind === 'poop' && withRng(state, 'life', (r) => r.chance(0.3))) complain(state, 'dirty');
    }
  }
  // Bumps: over once their time is up (the cars' own timers release them); a new one now and then.
  life.bumps = life.bumps.filter((b) => state.time < b.until);
  if (day && state.time > 60 && state.time < 690 && state.time >= life.nextBump && life.bumps.length === 0) tryBump(state);
}

/** Overnight: the street sweeper comes round; anyone still hanging about has gone home. */
export function sweepTown(state: GameState): void {
  const life = lifeOf(state);
  life.litter = [];
  for (const h of [...life.hangouts]) breakUp(state, h);
  life.bumps = [];
  life.nextTeens = 330; life.nextBump = 90;
}

/** Pick up a piece of town litter (the manager, on the frontage). */
export function pickUpLitter(state: GameState, id: number): boolean {
  const life = lifeOf(state);
  const i = life.litter.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const l = life.litter[i]!;
  life.litter.splice(i, 1);
  if (onFrontage(state, l)) state.shop.cleanliness = Math.min(1, state.shop.cleanliness + 0.02);
  cue(state, 'pick');
  return true;
}

/** Litter the manager can reach and pick up: anything on the shop's frontage. */
export function frontageLitter(state: GameState): TownLitter[] { return lifeOf(state).litter.filter((l) => onFrontage(state, l)); }

/** Where a person stands relative to the shop door (for tests). */
export function doorDistance(state: GameState, p: Vec2): number { const d = doorOutside(state); return Math.hypot(p.x - d.x, p.z - d.z); }
