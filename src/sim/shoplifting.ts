import type { GameState, Person } from './types';
import { thiefFactor } from './furniture';
import { TICK } from './layout';
import { productDef } from './products';
import { followPath } from './movement';
import { withRng, popup, cue, dist, react } from './state';
import { onShift, gainXp, staffLevel } from './staff';
import { securityFactor, watchAt, gateAt, FREEZE, GATE_STOP, QUIPS } from './security';
import { formatMoney } from './money';
import { doorInside, doorOutside, setPath, returnToShelves, tillIdle } from './people';

/**
 * Shoplifters, and the staff who catch them. Now and then a shopper fills a basket and, instead of
 * queueing, makes a run for the door. Whoever on the staff has nothing on (no box to shelve, nobody
 * at their till) gives chase: they cut the thief off at the door when they can get there first, and
 * otherwise run straight at them. Run into one yourself and you catch them too. Caught, the goods go
 * back on the shelves; away, what they took is the day's theft, at cost (the shop paid for it).
 */

/** A shopper's chance of being a shoplifter, from the third day on. */
export const THIEF_CHANCE = 0.02;
const FROM_DAY = 3;
/** A thief runs this much faster than they walked; staff give chase faster still. */
const BOLT = 1.5;
export const RUN = 1.9;
/** Close enough to grab them. */
export const GRAB = 0.6;
/** How long a caught thief stands there before slinking off. */
const BUSTED = 1.4;

export function maybeThief(state: GameState, p: Person): void {
  if (state.day < FROM_DAY) return;
  // A well-lit shop puts some of them off.
  if (withRng(state, 'thieves', (r) => r.chance(THIEF_CHANCE * thiefFactor(state) * securityFactor(state)))) p.thief = true;
}

/** Staff with nothing on: on shift, at their post or walking back to it, hands empty, nobody at their till. */
export function isFree(state: GameState, p: Person): boolean {
  if (p.kind !== 'staff' || !onShift(p, state.time) || p.task || p.carrying) return false;
  if (p.chase !== undefined && p.chase !== null) return false;
  // At their post or on the way back, or only tidying a shelf (that can wait).
  const tidying = (p.state === 'toStock' && p.timer === -3) || (p.state === 'stocking' && !p.task && !p.carrying);
  if (p.state !== 'idle' && p.state !== 'toRegister' && !tidying) return false;
  return p.role !== 'cashier' || tillIdle(state, p);
}

/**
 * A shoplifter on the run this free member of staff should go after: the two nearest with nothing on give
 * chase (three when a camera sees them go), and a guard always does.
 */
export function fleeingThief(state: GameState, p: Person): Person | null {
  for (const t of state.people) {
    if (t.state !== 'fleeing' || t.busted) continue;
    if (p.role === 'guard') return t;
    const most = watchAt(state, t) ? 3 : 2;
    const after = state.people.filter((s) => s.chase === t.id).length;
    if (after >= most) continue;
    const d = dist(p, t);
    const nearer = state.people.filter((s) => s !== p && s.kind === 'staff' && dist(s, t) < d && isFree(state, s)).length;
    if (nearer < most - after) return t;
  }
  return null;
}

/** Done shopping with a full basket: a thief makes a run for the door instead of the till. */
export function bolt(state: GameState, p: Person): void {
  p.state = 'fleeing'; p.anim = 'carry';
  p.speed *= BOLT;
  p.timer = 0;
  setPath(state, p, doorOutside(state, p.id));
  popup(state, { x: p.x, z: p.z }, watchAt(state, p) ? 'Shoplifter! On camera' : 'Shoplifter!', 'bad', 1.5);
  react(state, p.id, 'thief');
  cue(state, 'alarm');
}

/** A thief on the run: out of the door and away, unless someone gets a hand on them. */
export function fleeStep(state: GameState, p: Person, dyn: Set<number>): void {
  if (p.busted) {
    p.timer -= TICK;
    p.anim = 'idle';
    if (p.timer <= 0) { p.speed /= BOLT; p.state = 'leaving'; p.anim = 'walk'; p.path = []; p.pathIdx = 0; }
    return;
  }
  const owner = state.people.find((o) => o.kind === 'owner');
  if (owner && dist(owner, p) < GRAB) { caught(state, p, owner); return; }
  // Held still by a smart camera a moment (once), long enough for someone to get there.
  if ((p.frozen ?? 0) > 0) { p.frozen = Math.max(0, p.frozen! - TICK); p.anim = 'idle'; return; }
  if (!p.zapped && watchAt(state, p)?.smart) {
    p.zapped = true; p.frozen = FREEZE; p.anim = 'idle';
    popup(state, { x: p.x, z: p.z }, 'Frozen by the smart camera!', 'info', 1.6);
    cue(state, 'beep');
    return;
  }
  // Through the tag gates: they beep, and most are stopped there and then (more of them on camera).
  if (!p.gated && gateAt(state, p)) {
    p.gated = true;
    cue(state, 'alarm');
    if (withRng(state, 'gates', (r) => r.chance(Math.min(0.9, GATE_STOP + (watchAt(state, p) ? 0.2 : 0))))) { caught(state, p, null); return; }
    popup(state, { x: p.x, z: p.z }, 'Beep beep!', 'bad', 1.3);
  }
  if (state.tick % 52 === 0) react(state, p.id, 'thief');
  if (state.tick % 20 === 0) setPath(state, p, doorOutside(state, p.id), dyn);
  if (followPath(p, p.speed, TICK, 14, 0.25)) getAway(state, p);
}

/** Out of the door with the goods. */
function getAway(state: GameState, p: Person): void {
  const cost = Math.round((p.basket ?? []).reduce((a, b) => a + productDef(b.productId).cost * b.qty, 0) * 100) / 100;
  state.today.theft = Math.round((state.today.theft + cost) * 100) / 100;
  state.today.escaped = (state.today.escaped ?? 0) + 1;
  popup(state, { x: p.x, z: p.z }, `${formatMoney(-cost)} shoplifted`, 'bad', 1.5);
  cue(state, 'bad');
  // Away down the street like anyone leaving (no stop at the car boot: nothing was paid for).
  p.state = 'leaving'; p.anim = 'carry'; p.path = []; p.pathIdx = 0; p.paid = false;
}

/** A hand on the thief (or the tag gates stop them): the goods go back, and they slink off empty-handed, protesting. */
export function caught(state: GameState, p: Person, by: Person | null): void {
  returnToShelves(state, p);
  p.busted = true; p.timer = BUSTED; p.anim = 'idle'; p.frozen = 0;
  if (by) {
    p.yaw = Math.atan2(by.x - p.x, by.z - p.z);
    by.yaw = Math.atan2(p.x - by.x, p.z - by.z);
  }
  state.today.caught = (state.today.caught ?? 0) + 1;
  popup(state, { x: p.x, z: p.z }, !by ? 'Stopped at the gates!' : by.kind === 'owner' ? 'Caught!' : `${by.name?.split(' ')[0] ?? 'Staff'} caught them!`, 'money', 1.5);
  popup(state, { x: p.x, z: p.z }, withRng(state, 'quips', (r) => r.pick(QUIPS)), 'info', 1.85);
  cue(state, 'caught');
  if (by) gainXp(state, by, 40);
}

/**
 * A member of staff after a thief. Cut them off at the door when you can get there first, otherwise
 * straight at them; a hand on them and they are caught.
 */
export function chaseStep(state: GameState, p: Person, dyn: Set<number>): void {
  const t = state.people.find((x) => x.id === p.chase);
  if (!t || t.state !== 'fleeing' || t.busted || dist(p, t) < GRAB) {
    if (t && t.state === 'fleeing' && !t.busted) caught(state, t, p);
    p.chase = null; p.state = 'idle'; p.anim = 'idle'; p.path = []; p.pathIdx = 0;
    return;
  }
  // A guard runs harder, and on their scooter from level 3 harder still.
  const run = p.speed * RUN * (p.role === 'guard' ? (staffLevel(p) >= 3 ? 1.45 : 1.2) : 1);
  const door = doorInside(state, t.id);
  const first = dist(p, door) / run < dist(t, door) / Math.max(0.1, t.speed);
  const goal = first && dist(p, t) > 1.6 ? door : { x: t.x, z: t.z };
  if (state.tick % 6 === 0 || p.pathIdx >= p.path.length) setPath(state, p, goal, dyn);
  if (followPath(p, run, TICK, 16, 0.15)) { p.anim = 'idle'; p.yaw = Math.atan2(t.x - p.x, t.z - p.z); }
  else p.anim = 'walk';
}
